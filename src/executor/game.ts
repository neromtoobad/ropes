/**
 * The rules of LAST CANDLE, as a state machine over one round.
 *
 *   openRound   a new window is live -> record it, take picks
 *   enterRound  place one order per alive run that picked
 *   closeRound  settle -> redeem winners -> eliminate losers -> roll stacks
 *
 * The executor wallet is pooled. This module is the ledger that decides whose
 * money is whose; never read a player's position off the wallet.
 */
import { db } from "../lib/db";
import { fmtUsd, fmtProb } from "../lib/chain";
import { currentMarket, settlement, type LiveMarket } from "../lib/market";
import { buy, redeemAll, type Side } from "../lib/orders";
import * as registry from "../lib/registry";

export { db };

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Don't try to enter a window with less runway than this — it can lock mid-send. */
const MIN_ENTRY_SECONDS = 12;

/**
 * Record the live window as a round, if it isn't already.
 * Returns the round row plus the live market, or null when nothing is tradeable.
 */
export async function openRound() {
  const market = await currentMarket(MIN_ENTRY_SECONDS);
  if (!market) return null;

  const existing = await db.round.findUnique({ where: { marketId: market.marketId } });
  if (existing) return { round: existing, market };

  const last = await db.round.findFirst({ orderBy: { index: "desc" } });
  const round = await db.round.create({
    data: {
      marketId: market.marketId,
      pool: market.pool,
      index: (last?.index ?? 0) + 1,
      opensAt: market.opensAt,
      expiresAt: market.expiresAt,
      status: "open",
    },
  });
  log(`ROUND ${round.index} open  market=${market.marketId.slice(0, 10)}…  ` +
      `expires ${market.expiresAt.toISOString().slice(11, 19)}  ` +
      `yesBid=${market.yesBid ? fmtProb(market.yesBid) : "-"} yesAsk=${market.yesAsk ? fmtProb(market.yesAsk) : "-"}`);

  // Mirror the window on-chain so the reactive handler has something to settle.
  // Best-effort: the game does not wait on the public log to be correct.
  if (registry.enabled) {
    await registry.openRound(market.pool, BigInt(market.onchain.nonce ?? 0), market.marketId);
  }
  return { round, market };
}

/** Resolve each alive run's side for this round: explicit pick, else autoPick. */
function sideFor(run: { pendingSide: string | null; autoPick: string | null }): Side | null {
  if (run.pendingSide === "UP" || run.pendingSide === "DOWN") return run.pendingSide;
  if (run.autoPick === "UP" || run.autoPick === "DOWN") return run.autoPick;
  if (run.autoPick === "RANDOM") return Math.random() < 0.5 ? "UP" : "DOWN";
  return null; // no pick = sit this round out, stack preserved
}

/**
 * Enter the round: ONE order per side, shared at the average fill price.
 *
 * Orders go through a single wallet, so placing them per-player means the book
 * moves between sends — two players picking the same side five seconds apart
 * filled at 0.497 and 0.741 in testing. Honest market behaviour, but it reads
 * as rigged in a game. Batching by side makes every player on a side pay
 * exactly the same price, and costs one transaction instead of N.
 */
export async function enterRound(roundId: string, market: LiveMarket) {
  const alive = await db.run.findMany({ where: { status: "alive" }, include: { player: true } });

  // Who still needs a position this round, and on which side.
  const pending: { run: (typeof alive)[number]; side: Side }[] = [];
  for (const run of alive) {
    const already = await db.position.findUnique({
      where: { runId_roundId: { runId: run.id, roundId } },
    });
    if (already || run.stack <= 0n) continue;
    const side = sideFor(run);
    if (!side) {
      log(`  ${run.player.displayName} sits out (no pick)`);
      continue;
    }
    pending.push({ run, side });
  }
  if (!pending.length) return [];

  const entered: string[] = [];

  for (const side of ["UP", "DOWN"] as const) {
    const group = pending.filter((p) => p.side === side);
    if (!group.length) continue;

    const totalBudget = group.reduce((sum, p) => sum + p.run.stack, 0n);

    let fill;
    try {
      fill = await buy(market, side, totalBudget);
    } catch (err) {
      log(`  ${side} x${group.length} order FAILED: ${String(err).slice(0, 120)}`);
      continue;
    }
    if (fill.contracts === 0n) {
      const who = group.map((g) => g.run.player.displayName).join(", ");
      log(fill.tooExpensive
        ? `  ${side} x${group.length} declined @ ${fmtProb(fill.priceRaw)} (above cap) — ${who} sit out`
        : `  ${side} x${group.length} no fill — ${who} sit out`);
      continue;
    }

    log(`  ${side} x${group.length} @ ${fmtProb(fill.priceRaw)}  ` +
        `${fmtUsd(fill.contracts)} contracts for ${fmtUsd(fill.cost)}`);

    const rows: registry.EntryRow[] = [];

    // Split pro rata by stake. The last run absorbs the rounding residual so
    // the attributed sums equal the fill EXACTLY — attributing more contracts
    // than we hold would over-redeem at settlement.
    let contractsLeft = fill.contracts;
    let costLeft = fill.cost;

    for (let i = 0; i < group.length; i++) {
      const { run } = group[i];
      const isLast = i === group.length - 1;
      const contracts = isLast ? contractsLeft : (fill.contracts * run.stack) / totalBudget;
      // Belt and braces: a run can never be charged more than it staked, even
      // if the fill somehow overshot the budget. Anything above that is the
      // house's problem, not the player's.
      const share = isLast ? costLeft : (fill.cost * run.stack) / totalBudget;
      const cost = share > run.stack ? run.stack : share;
      contractsLeft -= contracts;
      costLeft -= cost;

      await db.position.create({
        data: {
          runId: run.id,
          roundId,
          side,
          contracts,
          priceRaw: fill.priceRaw, // the shared average — identical for the group
          cost,
          stackBefore: run.stack,
          orderTx: fill.tx,
        },
      });
      // Whatever the book could not absorb stays in their stack.
      await db.run.update({
        where: { id: run.id },
        data: { stack: run.stack - cost, pendingSide: null },
      });
      entered.push(run.player.displayName);
      rows.push({ runId: run.id, contracts, remainder: run.stack - cost, stackBefore: run.stack });
      log(`      ${run.player.displayName.padEnd(5)} ${fmtUsd(contracts)} contracts, ${fmtUsd(cost)}`);
    }

    // One transaction for the side, matching how the orders were batched.
    if (registry.enabled && rows.length) {
      const ok = await registry.enterMany(market.pool, BigInt(market.onchain.nonce ?? 0), side, rows);
      log(`      registry ${ok ? "mirrored" : "MIRROR FAILED"} ${side} x${rows.length}`);
    }
  }
  return entered;
}

/**
 * Settle a round: redeem in one transaction, then attribute.
 *
 * Winners' stacks grow to their contract count (each winning contract redeems
 * for exactly 1). That IS the 1/p growth — buy at p, redeem at 1.
 * A void pays both sides 0.5 and eliminates nobody.
 */
export async function closeRound(roundId: string) {
  const round = await db.round.findUniqueOrThrow({
    where: { id: roundId },
    include: { positions: { include: { run: { include: { player: true } } } } },
  });
  const s = await settlement(round.marketId as `0x${string}`);
  if (!s.settled) return false;

  const { redeemed, txs } = await redeemAll(
    round.marketId as `0x${string}`,
    s.onchain,
    s.voided,
    s.winningOutcome,
  );

  log(`ROUND ${round.index} SETTLED  ${s.voided ? "VOID" : `winner=${s.winningOutcome === 0 ? "UP" : "DOWN"}`}  ` +
      `redeemed ${fmtUsd(redeemed)}`);

  // The registry settles itself from the settlement block — we never push it.
  // Reading it back is how we know the reactive path actually ran.
  if (registry.enabled) {
    const onchain = await registry.roundState(round.pool as `0x${string}`, BigInt(s.onchain.nonce ?? 0));
    log(`  registry: ${onchain?.settled ? "already settled itself on-chain ✓" : "not settled on-chain (callback missed?)"}`);
  }

  for (const pos of round.positions) {
    const won = !s.voided && (pos.side === "UP" ? 0 : 1) === s.winningOutcome;
    // Void: every contract pays 0.5. Win: every contract pays 1. Loss: 0.
    const payout = s.voided ? pos.contracts / 2n : won ? pos.contracts : 0n;
    const stackAfter = pos.run.stack + payout;
    const outcome = s.voided ? "push" : won ? "won" : "lost";

    await db.position.update({ where: { id: pos.id }, data: { outcome, stackAfter } });

    if (!s.voided && !won) {
      // Do NOT zero the stack. The lot grid and a moving book can leave part of
      // the budget undeployed; that collateral was never at risk, so it is not
      // ours to confiscate. run.stack is already the undeployed remainder.
      const remainder = pos.run.stack;
      await db.run.update({
        where: { id: pos.runId },
        data: {
          status: "eliminated",
          endedRoundIndex: round.index,
          finalMultiple: Number(remainder) / Number(pos.run.buyIn),
        },
      });
      log(`  ☠ ${pos.run.player.displayName} eliminated` +
          (remainder > 0n ? `  (${fmtUsd(remainder)} undeployed, returned)` : ""));
    } else {
      await db.run.update({ where: { id: pos.runId }, data: { stack: stackAfter } });
      const mult = Number(stackAfter) / Number(pos.run.buyIn);
      log(`  ✓ ${pos.run.player.displayName} ${fmtUsd(pos.stackBefore)} → ${fmtUsd(stackAfter)}  (${mult.toFixed(2)}x)`);
    }
  }

  await db.round.update({
    where: { id: roundId },
    data: {
      status: s.voided ? "voided" : "settled",
      winningOutcome: s.winningOutcome,
      settledAt: new Date(),
      redeemTx: txs[0],
    },
  });
  return true;
}

/**
 * Bank out: sell the live position back and end the run.
 *
 * Banking ends a run, and the player then sits out one full round before they
 * may buy a new seat.
 */
export async function bank(runId: string, currentRoundIndex: number) {
  const run = await db.run.findUniqueOrThrow({ where: { id: runId }, include: { player: true } });
  if (run.status !== "alive") throw new Error(`run is ${run.status}, cannot bank`);

  const mult = Number(run.stack) / Number(run.buyIn);
  await db.run.update({
    where: { id: runId },
    data: { status: "banked", endedRoundIndex: currentRoundIndex, finalMultiple: mult },
  });
  await db.player.update({
    where: { id: run.playerId },
    // Sits out this round and the next one; eligible the round after.
    data: { eligibleFromRoundIndex: currentRoundIndex + 2 },
  });
  if (registry.enabled) await registry.bankRun(runId, run.stack);
  log(`  💰 ${run.player.displayName} banked at ${mult.toFixed(2)}x (${fmtUsd(run.stack)})`);
  return mult;
}

/** Buy a seat. Refused while the player is sitting out after a bank. */
export async function joinGame(wallet: string, displayName: string, buyIn: bigint, roundIndex: number, autoPick?: string) {
  const player = await db.player.upsert({
    where: { wallet },
    create: { wallet, displayName },
    update: {},
  });
  if (roundIndex < player.eligibleFromRoundIndex) {
    throw new Error(`${displayName} is sitting out until round ${player.eligibleFromRoundIndex}`);
  }
  const open = await db.run.findFirst({ where: { playerId: player.id, status: "alive" } });
  if (open) throw new Error(`${displayName} already has a live run`);

  return db.run.create({
    data: { playerId: player.id, buyIn, stack: buyIn, startedRoundIndex: roundIndex, autoPick },
  });
}
