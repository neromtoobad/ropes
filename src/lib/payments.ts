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
import { createPublicClient, createWalletClient, http, erc20Abi, parseEventLogs, verifyMessage } from "viem";
import { depositMessage } from "./depositMessage";
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
 * player's balance with EXACTLY what arrived.
 *
 * Three things make this safe against a stranger who can see the transfer on
 * the explorer (everyone can):
 *  - the SENDER must sign for this player key. A hash alone proved nothing —
 *    anyone could claim anyone's deposit, and a claimant with a withdrawal
 *    address already pinned could then withdraw money that was never theirs.
 *  - the CashFlow row is written FIRST, under a database-level unique on tx,
 *    and the balance moves only after. Check-then-write let two simultaneous
 *    claims both credit.
 *  - a bankroll that already withdraws to one wallet does not accept deposits
 *    from another; the first deposit pins the address, later ones must match.
 */
export async function creditDeposit(playerKey: string, txHash: `0x${string}`, signature: unknown) {
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    throw new Error("deposit must be signed by the wallet that sent it");
  }

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

  const signedBySender = await verifyMessage({
    address: paid.args.from,
    message: depositMessage(txHash, playerKey),
    signature: signature as `0x${string}`,
  }).catch(() => false);
  if (!signedBySender) throw new Error("signature does not match the wallet that sent the deposit");

  const player = await db.player.upsert({
    where: { wallet: playerKey },
    create: { wallet: playerKey, displayName: "climber", address: paid.args.from },
    update: {},
  });
  if (player.address && player.address.toLowerCase() !== paid.args.from.toLowerCase()) {
    throw new Error(`this bankroll withdraws to ${player.address.slice(0, 8)}… — deposit from that wallet`);
  }

  // Row first, money second. The unique index is the only replay guard that
  // holds under concurrency.
  try {
    await db.cashFlow.create({
      data: { playerId: player.id, kind: "deposit", amount: paid.args.value, tx: txHash },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new Error("that deposit was already credited");
    throw err;
  }
  await db.player.update({
    where: { id: player.id },
    data: {
      balance: { increment: paid.args.value },
      ...(player.address ? {} : { address: paid.args.from }),
    },
  });
  return { amount: paid.args.value, address: paid.args.from };
}

/** House collateral over plain HTTP — safe inside a serverless route, unlike
 *  the SDK client's WebSocket. Used as the free-seat circuit breaker. */
export async function houseCollateralHttp(): Promise<bigint> {
  return pub.readContract({ address: COLLATERAL, abi: erc20Abi, functionName: "balanceOf", args: [HOUSE] });
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
      data: { playerId: p.id, kind: "withdrawal", amount, tx: `sending:${p.id}` },
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
