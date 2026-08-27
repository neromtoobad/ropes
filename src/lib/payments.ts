/**
 * Real money in, real money out — for players who connect a wallet.
 *
 * A paid seat is a plain 10 tUSDC ERC-20 transfer from the player's wallet to
 * the house, verified here by receipt. Proceeds go back the same way when the
 * run ends. In-round trading stays custodial: the 1-minute cadence needs one
 * sequential writer (the one-nonce rule), which is the whole reason the house
 * wallet exists.
 *
 * Two invariants keep this honest with zero auth:
 * - the payout address is DERIVED from the deposit's `from`, never taken from
 *   the browser — claiming someone else's deposit tx just pays them, not you.
 * - depositTx is unique in the ledger, so a transfer buys exactly one seat.
 *
 * Payouts run ONLY inside the executor's tick (never from a Next API route):
 * the house wallet has one nonce and the SDK owns it — a second concurrent
 * writer races it and both lose.
 */
import { createWalletClient, http, erc20Abi, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { db } from "./db";
import { exchange, COLLATERAL, HOUSE, fmtUsd } from "./chain";

const pk = process.env.PRIVATE_KEY as `0x${string}`;
const wallet = createWalletClient({
  account: privateKeyToAccount(pk),
  chain: somniaShannon,
  transport: http("https://api.infra.testnet.somnia.network"),
});

/** Somnia's gas schedule is dear and nothing here estimates. Be generous. */
const GAS = 1_000_000n;

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/**
 * Verify a seat deposit: the tx must be a successful tUSDC transfer of at
 * least `minAmount` to the house. Returns who paid and how much — the payer
 * IS the payout address, whatever the browser claims.
 */
export async function verifyDeposit(
  txHash: `0x${string}`,
  minAmount: bigint,
): Promise<{ from: `0x${string}`; amount: bigint }> {
  const used = await db.run.findUnique({ where: { depositTx: txHash } });
  if (used) throw new Error("that deposit already bought a seat");

  const receipt = await exchange.client
    .getViemClient()
    .getTransactionReceipt({ hash: txHash })
    .catch(() => null);
  if (!receipt) throw new Error("deposit tx not found — wait a moment and retry");
  if (receipt.status !== "success") throw new Error("deposit tx reverted");

  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  const paid = transfers.find(
    (t) =>
      t.address.toLowerCase() === COLLATERAL.toLowerCase() &&
      t.args.to.toLowerCase() === HOUSE.toLowerCase() &&
      t.args.value >= minAmount,
  );
  if (!paid) throw new Error(`no tUSDC transfer of ${fmtUsd(minAmount)} to the house in that tx`);
  return { from: paid.args.from, amount: paid.args.value };
}

/**
 * Send every payout that is owed. Called from the executor tick, awaited.
 *
 * Owed = a run that ended (banked, or eliminated with an undeployed remainder
 * — money that never reached the market is still the player's), bound to a
 * wallet, not yet paid. The "sending" claim makes a crashed send visible to
 * the doctor instead of double-paying on restart.
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
      data: { payoutTx: "sending" },
    });
    if (claimed.count !== 1) continue; // someone else got there

    try {
      const hash = await wallet.writeContract({
        address: COLLATERAL,
        abi: erc20Abi,
        functionName: "transfer",
        args: [run.payoutAddress as `0x${string}`, run.stack],
        gas: GAS,
      });
      const receipt = await exchange.client.getViemClient().waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`payout reverted: ${hash}`);
      await db.run.update({ where: { id: run.id }, data: { payoutTx: hash } });
      log(
        `  💸 PAID OUT ${fmtUsd(run.stack)} → ${run.payoutAddress!.slice(0, 8)}… ` +
          `(${run.player.displayName})  ${hash}`,
      );
    } catch (err) {
      // Release the claim so the next tick retries; never stall the game.
      await db.run.update({ where: { id: run.id }, data: { payoutTx: null } });
      log(`  payout failed for ${run.player.displayName}: ${String(err).slice(0, 140)}`);
    }
  }
}
