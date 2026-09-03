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
import { fmtUsd, fmtProb, ONE , INTERVAL_SEC } from "../lib/chain";
import { currentMarket, settlement, type LiveMarket } from "../lib/market";
import { exchange, ASSET } from "../lib/chain";
import { buy, redeemAll, sellPosition, type Side } from "../lib/orders";
import * as registry from "../lib/registry";
import { fillingTable, STARTING_STACK, SEAT_PRICE, POT_CUT, MAX_SEATS } from "./tables";
import { debitSeat, houseCollateralHttp } from "../lib/payments";

export { db };

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Free-seat circuit breakers. See joinGame. */
const FREE_ALIVE_MAX = 12;
const FREE_PER_10_ROUNDS = 12;
const HOUSE_FLOOR = 150n * ONE;

/** Don't try to enter a window with less runway than this — it can lock mid-send. */
const MIN_ENTRY_SECONDS = 12;

/**
 * Record the live window as a round, if it isn't already.
 * Returns the round row plus the live market, or null when nothing is tradeable.
 */
export async function openRound() {
  const market = await currentMarket(MIN_ENTRY_SECONDS);
  if (!market) return null;

  const book = {
    yesBid: market.yesBid ? Number(market.yesBid) / 1e6 : null,
    yesAsk: market.yesAsk ? Number(market.yesAsk) / 1e6 : null,
  };

  const existing = await db.round.findUnique({ where: { marketId: market.marketId } });
  if (existing) {
    // Keep the mirrored book fresh — the web app renders from this, not the chain.
    const updated = await db.round.update({ where: { id: existing.id }, data: book });
    return { round: updated, market };
  }

  const last = await db.round.findFirst({ orderBy: { index: "desc" } });
  const round = await db.round.create({
    data: {
      marketId: market.marketId,
      pool: market.pool,
      index: (last?.index ?? 0) + 1,
      opensAt: market.opensAt,
      expiresAt: market.expiresAt,
      status: "open",
      strike: market.strike || null,
      oracleQuestionId: market.oracleQuestionId,
      ...book,
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
/**
 * Entries only land in the first ENTRY_WINDOW_S seconds of a window. It makes
 * the round a discrete thing: everyone in it entered at (nearly) the same
 * price picture, and a bet placed mid-ride queues for the next window instead
 * of buying a short sprint at whatever the book has become. The retry loop for
 * the empty-at-open book lives entirely inside this grace period.
 *
 * It was 20s, and that was too tight to be playable. These 1m books are empty
 * at the open and the resting MM often has not quoted 20 seconds in, so a bet
 * would miss its window, roll to the next one, and miss again — observed live
 * taking three rounds to fill, which reads as a broken game rather than a thin
 * market. 35s still leaves a real ride (25s minimum) and roughly doubles the
 * number of retries a pick gets inside the window it was placed for.
 */
export const ENTRY_WINDOW_S = 35;
let lockedLogFor = -1;

export async function enterRound(roundId: string, market: LiveMarket) {
  const round = await db.round.findUniqueOrThrow({ where: { id: roundId } });
  const remaining = (round.expiresAt.getTime() - Date.now()) / 1000;
  if (remaining < INTERVAL_SEC - ENTRY_WINDOW_S) {
    if (lockedLogFor !== round.index) {
      lockedLogFor = round.index;
      log(`  entries locked for round ${round.index} — late bets ride the next window`);
    }
    return [];
  }

  // Only sealed tables play. A run in a filling table is seated and watching —
  // its field is not fixed yet, so it cannot be in a battle royale.
  const alive = await db.run.findMany({
    where: { status: "alive", table: { status: "sealed" } },
    include: { player: true },
  });

  // Who still needs a position this round, and on which side. The whole
  // field's positions come back in ONE read — a lookup per run cost a network
  // round trip each, which is the difference between a tick and a stall.
  const held = new Set(
    (
      await db.position.findMany({
        where: { roundId, runId: { in: alive.map((r) => r.id) } },
        select: { runId: true },
      })
    ).map((p) => p.runId),
  );
  const pending: { run: (typeof alive)[number]; side: Side }[] = [];
  for (const run of alive) {
    const already = held.has(run.id);
    if (already || run.stack <= 0n) continue;
    const side = sideFor(run);
    if (!side) {
      log(`  ${run.player.displayName} sits out (no pick)`);
      continue;
    }
    // A pick made DURING this window is for the next one. One minute to
    // choose, one minute to watch — never a sprint bought mid-window.
    if (run.pickedForRound !== null && run.pickedForRound > round.index) continue;
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

  // Where BTC finished, so a death can be shown for what it was — a miss by
  // some exact number of dollars, not just "you lost". Read from the price feed
  // rather than getMarketResolution, whose openingAnswer/closingAnswer come back
  // null on these markets: the indexer never populates them.
  let close: number | null = null;
  try {
    close = (await exchange.fetchPrice(ASSET))?.price ?? null;
  } catch {
    // Never block a settlement on a cosmetic read.
  }

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
    // A bailed position was sold back mid-round; it is not in this settlement.
    if (pos.outcome) continue;
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
          // A pending bail the bell beat to the punch is resolved by the bell.
          bailRequested: false,
        },
      });
      log(`  ☠ ${pos.run.player.displayName} eliminated` +
          (remainder > 0n ? `  (${fmtUsd(remainder)} undeployed, returned)` : ""));
    } else {
      await db.run.update({
        where: { id: pos.runId },
        data: { stack: stackAfter, roundsSurvived: { increment: 1 } },
      });
      const mult = Number(stackAfter) / Number(pos.run.buyIn);
      log(`  ✓ ${pos.run.player.displayName} ${fmtUsd(pos.stackBefore)} → ${fmtUsd(stackAfter)}  (${mult.toFixed(2)}x)`);
    }
  }

  // Stacks are final for this round — clear out anyone who can no longer play.
  await sweepZombies(round.index);

  await db.round.update({
    where: { id: roundId },
    data: {
      status: s.voided ? "voided" : "settled",
      winningOutcome: s.winningOutcome,
      settledAt: new Date(),
      close,
      redeemTx: txs[0],
    },
  });
  return true;
}

/**
 * Fulfil bail requests.
 *
 * The API only raises a flag — orders go through this process's single nonce.
 * With an open position in the live round we sell it back to the book and
 * credit the measured proceeds; between rounds the stack is already cash. A
 * book that cannot serve the sale leaves the flag up for the next tick, and if
 * the bell beats us to it, settlement pays out first and the bank completes
 * after — the player exits with whichever resolution reached them first.
 */
export async function processBails(roundId: string, market: LiveMarket, roundIndex: number) {
  const requests = await db.run.findMany({
    where: { status: "alive", bailRequested: true },
    include: { player: true },
  });

  const bailPositions = await db.position.findMany({
    where: { roundId, runId: { in: requests.map((r) => r.id) } },
  });
  for (const run of requests) {
    const pos = bailPositions.find((p) => p.runId === run.id) ?? null;

    if (pos && !pos.outcome) {
      const side = pos.side as Side;
      let sale;
      try {
        sale = await sellPosition(market, side, pos.contracts);
      } catch (err) {
        log(`  bail sell FAILED for ${run.player.displayName}: ${String(err).slice(0, 100)}`);
        continue;
      }
      if (sale.sold === 0n) {
        log(`  bail: book cannot fill ${run.player.displayName} yet — retrying next tick`);
        continue;
      }
      // Mark the position exited so settlement cannot pay it a second time.
      await db.position.update({
        where: { id: pos.id },
        data: { outcome: "bailed", stackAfter: run.stack + sale.proceeds },
      });
      await db.run.update({
        where: { id: run.id },
        data: { stack: run.stack + sale.proceeds, pendingSide: null },
      });
      log(`  🪂 ${run.player.displayName} sold ${fmtUsd(sale.sold)} contracts for ${fmtUsd(sale.proceeds)}`);
    }

    // Stack is now all cash (or always was, between rounds). Bank it.
    const fresh = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    if (fresh.status === "alive") {
      await db.run.update({ where: { id: run.id }, data: { bailRequested: false } });
      await bank(run.id, roundIndex);
    }
  }
}

/**
 * What an IOC sale of `contracts` would ACTUALLY realize against the resting
 * depth — walk the levels, never the touch. Selling UP consumes YES bids at
 * their price; selling DOWN consumes YES asks, each paying ONE − price. A book
 * that cannot absorb the whole size returns null: there is no honest mark, so
 * a trigger reading this must wait rather than fire into the void. (Found the
 * hard way: a touch-priced trigger fired a 10.00 stake into a book that paid
 * 1.70 for it.)
 */
function realizableProceeds(side: Side, contracts: bigint, market: LiveMarket): bigint | null {
  const levels = side === "UP" ? market.yesBidLevels : market.yesAskLevels;
  let left = contracts;
  let proceeds = 0n;
  for (const l of levels) {
    if (left === 0n) break;
    const take = l.quantity < left ? l.quantity : left;
    proceeds += (take * (side === "UP" ? l.price : ONE - l.price)) / ONE;
    left -= take;
  }
  return left > 0n ? null : proceeds;
}

/**
 * Auto-bail: the discipline tool. A run carrying a target multiple bails
 * ITSELF the tick its sellable value crosses the line. This only raises the
 * same flag the BAIL button does — the sale still goes through the single
 * sequential writer and pays whatever the book actually pays, so the target
 * is a trigger, never a promised price.
 */
export async function armAutoBails(roundId: string, market: LiveMarket) {
  const armed = await db.run.findMany({
    where: { status: "alive", bailRequested: false, autoBailAt: { not: null } },
    include: { player: true },
  });

  const armedPositions = await db.position.findMany({
    where: { roundId, runId: { in: armed.map((r) => r.id) } },
  });
  for (const run of armed) {
    const pos = armedPositions.find((p) => p.runId === run.id) ?? null;

    let mult: number;
    if (pos && !pos.outcome) {
      // Depth-aware: the mark is what the book would pay for the WHOLE
      // position right now. A thin book gives no mark and the trigger waits.
      const proceeds = realizableProceeds(pos.side as Side, pos.contracts, market);
      if (proceeds == null) continue;
      mult = Number(run.stack + proceeds) / Number(run.buyIn);
    } else {
      // Between rounds the stack is already cash. A bell that carried it past
      // the target banks it here — otherwise a set-and-walk-away player whose
      // win LANDED at settlement would sit above their line forever, unbanked.
      mult = Number(run.stack) / Number(run.buyIn);
    }

    if (mult >= run.autoBailAt!) {
      await db.run.update({ where: { id: run.id }, data: { bailRequested: true } });
      log(
        `  ⚡ auto-bail: ${run.player.displayName} at ${mult.toFixed(2)}× ≥ target ` +
          `${run.autoBailAt!.toFixed(2)}× — ${pos && !pos.outcome ? "selling" : "banking"}`,
      );
    }
  }
}

/**
 * A stack this small is not a player any more.
 *
 * Below the buy-in's floor a run cannot compound its way back — it just holds a
 * seat at 0.06x while everyone else plays. The sweep cashes it out so the table
 * stays a table. The run still ends honestly: whatever is left is theirs.
 */
export const MIN_STACK = ONE; // 1.00 tUSDC

export async function sweepZombies(currentRoundIndex: number) {
  const zombies = await db.run.findMany({
    where: {
      status: "alive",
      stack: { lt: MIN_STACK },
      /**
       * A bet in flight is NOT a small stack.
       *
       * `stack` is idle cash only — entering a round moves nearly all of it
       * into contracts. And rounds OVERLAP: the next window opens and takes
       * entries while the previous one is still waiting to settle, so the
       * sweep that runs after round N routinely sees a player who has just
       * deployed into round N+1 holding ~0.03 in cash.
       *
       * Without this, that player was swept at 0.00x with their contracts
       * still riding — a real bet, placed and paid for, deleted by the
       * janitor a few seconds later.
       */
      positions: { none: { outcome: null } },
    },
    include: { player: true },
  });
  for (const z of zombies) {
    try {
      await bank(z.id, currentRoundIndex, true);
    } catch (err) {
      log(`  sweep failed for ${z.player.displayName}: ${String(err).slice(0, 100)}`);
    }
  }
  return zombies.length;
}

/**
 * Bank out: sell the live position back and end the run.
 *
 * Banking ends a run, and the player then sits out one full round before they
 * may buy a new seat.
 */
export async function bank(runId: string, currentRoundIndex: number, auto = false) {
  const run = await db.run.findUniqueOrThrow({ where: { id: runId }, include: { player: true } });
  if (run.status !== "alive") throw new Error(`run is ${run.status}, cannot bank`);

  const mult = Number(run.stack) / Number(run.buyIn);
  await db.run.update({
    where: { id: runId },
    data: { status: "banked", endedRoundIndex: currentRoundIndex, finalMultiple: mult, bankedAuto: auto },
  });
  // The sit-out is a MULTIPLAYER rule: it stops someone banking and instantly
  // re-seating to dodge a table they were losing. Solo there is nobody to
  // dodge, so it was only ever a two-minute lockout between climbs — applied
  // even to a player the sweep cashed out, who never chose to leave. Dying
  // already carries no cooldown at all, which is the tell that this is
  // vestigial: bail and wait two minutes, or bust and climb again at once.
  const seated = run.tableId
    ? await db.run.count({ where: { tableId: run.tableId } })
    : 0;
  await db.player.update({
    where: { id: run.playerId },
    data: { eligibleFromRoundIndex: seated >= 2 ? currentRoundIndex + 2 : 0 },
  });
  if (registry.enabled) await registry.bankRun(runId, run.stack);
  log(`  ${auto ? "🧹" : "💰"} ${run.player.displayName} ${auto ? "swept" : "banked"} at ${mult.toFixed(2)}x (${fmtUsd(run.stack)})`);
  return mult;
}

/**
 * Buy a seat at whichever table is currently filling.
 *
 * The seat costs SEAT_PRICE; POT_CUT of that is held by the table and the rest
 * becomes the starting stack, so a multiple is always measured against what is
 * actually at risk. The pot goes to whoever is last standing.
 */
export async function joinGame(
  wallet: string,
  displayName: string,
  _buyIn: bigint,
  roundIndex: number,
  autoPick?: string,
  /** Funded seat: debit the player's bankroll and mark the run real-money
   *  (its proceeds credit the balance back when it ends). */
  funded?: boolean,
) {
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

  /**
   * Free seats are the house's money on a real market, and the join route is
   * public with no login. Left uncapped, a loop of fresh player keys could
   * put the entire house collateral onto the book in minutes. Three limits,
   * each cheap, together bounding the worst case to a slow trickle:
   *  - how many free runs may be alive at once,
   *  - how many free seats may open per ten windows,
   *  - a collateral floor below which free play pauses entirely.
   * Funded seats are the player's own money and are not limited here.
   */
  if (!funded) {
    const [aliveFree, recentFree, collateral] = await Promise.all([
      db.run.count({ where: { status: "alive", payoutAddress: null } }),
      db.run.count({ where: { payoutAddress: null, startedRoundIndex: { gte: roundIndex - 10 } } }),
      houseCollateralHttp().catch(() => null),
    ]);
    if (aliveFree >= FREE_ALIVE_MAX) throw new Error("the house is full right now — try again in a minute");
    if (recentFree >= FREE_PER_10_ROUNDS) throw new Error("free seats are going fast — try again in a few minutes");
    if (collateral !== null && collateral < HOUSE_FLOOR) throw new Error("free play is paused while the house tops up");
  }

  const table = await fillingTable();
  const seated = await db.run.count({ where: { tableId: table.id } });
  if (seated >= MAX_SEATS) throw new Error("this table is full — the next one opens shortly");

  let payoutAddress: string | undefined;
  if (funded) {
    const fresh = await db.player.findUniqueOrThrow({ where: { id: player.id } });
    if (!fresh.address) throw new Error("no funded account — deposit first");
    await debitSeat(player.id, SEAT_PRICE);
    payoutAddress = fresh.address;
  }

  let run;
  try {
    run = await db.run.create({
      data: {
        playerId: player.id,
        tableId: table.id,
        buyIn: STARTING_STACK,
        stack: STARTING_STACK,
        startedRoundIndex: roundIndex,
        autoPick,
        payoutAddress,
      },
    });
  } catch (err) {
    // The seat never existed — the money goes straight back.
    if (funded) {
      await db.player.update({ where: { id: player.id }, data: { balance: { increment: SEAT_PRICE } } });
    }
    throw err;
  }
  await db.table.update({ where: { id: table.id }, data: { pot: { increment: POT_CUT } } });
  return run;
}
