/**
 * The bankroll: real money in, real money out — deposit once, play forever.
 *
 * A verified deposit CREDITS the player's balance. Seats DEBIT it (no wallet
 * popup once funded). A paid run's proceeds credit it back the moment the
 * run ends, so winnings roll into the next seat with zero friction. The
 * balance leaves the house only when the player asks — a withdrawal flag the
 * executor honors on its next tick.
 *
 * Invariants that keep this honest with zero auth:
 * - the withdrawal address is DERIVED from the first deposit's sender, never
 *   taken from the browser — hijacking a playerKey pays the depositor.
 * - deposit txs are consumed once (unique in CashFlow.tx via check).
 * - ONLY real money touches a balance: free seats stake the house directly
 *   and their proceeds never credit anyone.
 * - all sends happen inside the executor tick (the one-nonce rule).
 */
import { createPublicClient, createWalletClient, http, erc20Abi, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { db } from "./db";
import { COLLATERAL, HOUSE, fmtUsd } from "./chain";

const pk = process.env.PRIVATE_KEY as `0x${string}`;
/** Receipt reads get their OWN plain HTTP client. The SDK's client rides a
 *  WebSocket that dies silently and never reconnects (see AGENTS.md) — fine
 *  for the supervised executor, fatal inside a long-lived web server. */
const pub = createPublicClient({
  chain: somniaShannon,
  transport: http("https://api.infra.testnet.somnia.network"),
});
const wallet = createWalletClient({
  account: privateKeyToAccount(pk),
  chain: somniaShannon,
  transport: http("https://api.infra.testnet.somnia.network"),
});

/** Somnia's gas schedule is dear and nothing here estimates. Be generous. */
const GAS = 1_000_000n;

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/**
 * Verify a deposit tx (a tUSDC transfer to the house) and credit the
 * player's balance with EXACTLY what arrived. Replay-proof: each tx credits
 * once. Also pins the player's withdrawal address on first deposit.
 */
export async function creditDeposit(playerKey: string, txHash: `0x${string}`) {
  const used = await db.cashFlow.findFirst({ where: { kind: "deposit", tx: txHash } });
  if (used) throw new Error("that deposit was already credited");

  // The chain may index a hair behind the sender's own node — retry briefly
  // before telling anyone to try again.
  let receipt = null;
  for (let attempt = 0; attempt < 4 && !receipt; attempt++) {
    receipt = await pub.getTransactionReceipt({ hash: txHash }).catch(() => null);
    if (!receipt) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!receipt) throw new Error("deposit tx not found — wait a moment and retry");
  if (receipt.status !== "success") throw new Error("deposit tx reverted");

  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  const paid = transfers.find(
    (t) =>
      t.address.toLowerCase() === COLLATERAL.toLowerCase() &&
      t.args.to.toLowerCase() === HOUSE.toLowerCase() &&
      t.args.value > 0n,
  );
  if (!paid) throw new Error("no tUSDC transfer to the house in that tx");

  const player = await db.player.upsert({
    where: { wallet: playerKey },
    create: { wallet: playerKey, displayName: "climber", address: paid.args.from },
    update: {},
  });
  await db.player.update({
    where: { id: player.id },
    data: {
      balance: { increment: paid.args.value },
      // First deposit pins the withdrawal address; later deposits from other
      // wallets still credit, but the money only ever leaves to the original.
      ...(player.address ? {} : { address: paid.args.from }),
    },
  });
  await db.cashFlow.create({
    data: { playerId: player.id, kind: "deposit", amount: paid.args.value, tx: txHash },
  });
  return { amount: paid.args.value, address: paid.args.from };
}

/** Debit a seat from the balance. Throws if the bankroll can't cover it. */
export async function debitSeat(playerId: string, price: bigint) {
  const taken = await db.player.updateMany({
    where: { id: playerId, balance: { gte: price } },
    data: { balance: { decrement: price } },
  });
  if (taken.count !== 1) throw new Error("balance can't cover a seat — deposit first");
  await db.cashFlow.create({ data: { playerId, kind: "seat", amount: price } });
}

/**
 * Credit every ended paid run's proceeds to its player's balance. Runs in
 * the executor tick. payoutTx="balance" marks the run settled into the
 * bankroll (the feed's explorer link only renders for 0x hashes).
 */
export async function processPayouts() {
  const owed = await db.run.findMany({
    where: {
      status: { in: ["banked", "eliminated"] },
      payoutAddress: { not: null },
      payoutTx: null,
      stack: { gt: 0n },
    },
    include: { player: true },
  });

  for (const run of owed) {
    const claimed = await db.run.updateMany({
      where: { id: run.id, payoutTx: null },
      data: { payoutTx: "balance" },
    });
    if (claimed.count !== 1) continue;
    await db.player.update({
      where: { id: run.playerId },
      data: { balance: { increment: run.stack } },
    });
    await db.cashFlow.create({
      data: { playerId: run.playerId, kind: "win", amount: run.stack },
    });
    log(
      `  💰 ${fmtUsd(run.stack)} → ${run.player.displayName}'s bankroll ` +
        `(balance ${fmtUsd(run.player.balance + run.stack)})`,
    );
  }
}

/**
 * Send requested withdrawals on-chain. The whole balance goes at once — a
 * bankroll is either playing or leaving. Claim-then-send so a crash mid-
 * transfer is visible (balance already zeroed, flow row holds "sending")
 * rather than double-paid; the doctor flags stuck rows.
 */
export async function processWithdrawals() {
  const asking = await db.player.findMany({
    where: { withdrawRequested: true, balance: { gt: 0n }, address: { not: null } },
  });

  for (const p of asking) {
    const amount = p.balance;
    const claimed = await db.player.updateMany({
      where: { id: p.id, balance: amount, withdrawRequested: true },
      data: { balance: 0n, withdrawRequested: false },
    });
    if (claimed.count !== 1) continue;

    const flow = await db.cashFlow.create({
      data: { playerId: p.id, kind: "withdrawal", amount, tx: "sending" },
    });
    try {
      const hash = await wallet.writeContract({
        address: COLLATERAL,
        abi: erc20Abi,
        functionName: "transfer",
        args: [p.address as `0x${string}`, amount],
        gas: GAS,
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`withdrawal reverted: ${hash}`);
      await db.cashFlow.update({ where: { id: flow.id }, data: { tx: hash } });
      log(`  💸 WITHDREW ${fmtUsd(amount)} → ${p.address!.slice(0, 8)}… (${p.displayName})  ${hash}`);
    } catch (err) {
      // Put the money back and let the next tick retry.
      await db.player.update({
        where: { id: p.id },
        data: { balance: { increment: amount }, withdrawRequested: true },
      });
      await db.cashFlow.delete({ where: { id: flow.id } });
      log(`  withdrawal failed for ${p.displayName}: ${String(err).slice(0, 140)}`);
    }
  }
}
