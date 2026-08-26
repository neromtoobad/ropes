/**
 * The single read the table renders from.
 *
 * Prices here are LIVE and indicative — the price a player sees when they pick
 * is not the price they get. The 1m book is empty for the first 5-10s of every
 * window, so entry lands partway in at whatever the book has by then. The UI
 * must present these as "pays about", never as a promise.
 */
import { db } from "./db";
import { ONE, toUsd } from "./chain";
import { currentMarket } from "./market";
import { exchange, ASSET } from "./chain";
import { MAX_ENTRY_PRICE_PCT } from "./orders";

export interface SeatView {
  runId: string;
  name: string;
  stack: number;
  status: "alive" | "banked" | "eliminated";
  /** The side they've chosen for the live round, once locked in. */
  pick: "UP" | "DOWN" | null;
  /** Filled position for the live round, if the executor got them in. */
  inRound: boolean;
  fillPrice: number | null;
  multiple: number;
  /** Rounds survived so far. The number a player actually brags about. */
  rounds: number;
}

export interface TableState {
  round: {
    index: number;
    marketId: string;
    expiresAt: string;
    secondsLeft: number;
    status: string;
  } | null;
  /** Live probability of each side, 0-1. null when the book is empty. */
  price: { up: number | null; down: number | null };
  /** What a stack turns into if that side wins — 1/p. null when unpriceable. */
  pays: { up: number | null; down: number | null };
  /** True when that side is above the entry cap and the executor will decline. */
  capped: { up: boolean; down: boolean };
  /**
   * Two pools, the way a round actually works. `live` is the locked round
   * playing out in front of you — those stacks are already committed. `next` is
   * what you are still choosing into.
   */
  crowd: {
    up: number;
    down: number;
    undecided: number;
    /** Collateral committed to each side of the LIVE round. */
    liveStake: { up: number; down: number };
    /** Stacks whose call is already in for the round after this one. */
    nextCall: { up: number; down: number; undecided: number };
  };
  /** True once the executor has filled the live round — no more changing it. */
  locked: boolean;
  /** BTC against the line. `strike` is fixed for the window; `price` is live. */
  btc: { price: number | null; strike: number | null; oracleQuestionId: string | null };
  seats: SeatView[];
  /** Most recently settled round, for the bell. */
  lastResult: {
    index: number;
    winner: "UP" | "DOWN" | null;
    voided: boolean;
    redeemTx: string | null;
    killed: string[];
    survived: { name: string; from: number; to: number }[];
  } | null;
  board: { name: string; multiple: number; status: string; rounds: number }[];
  /** Recent deaths and exits, newest first. A battle royale needs a kill feed. */
  feed: {
    kind: "died" | "banked";
    name: string;
    round: number;
    multiple: number;
    rounds: number;
    /** How far the wrong side of the line they finished. The near miss. */
    missedBy: number | null;
  }[];
  /** The number to beat. A run is measured in rounds survived, not dollars. */
  record: { name: string; rounds: number; multiple: number } | null;
}

const CAP = Number(MAX_ENTRY_PRICE_PCT) / 100;

export async function getTableState(): Promise<TableState> {
  const round = await db.round.findFirst({ orderBy: { index: "desc" } });

  // Live book. Cheap — watchMarket keeps a local store, so this is zero RTT
  // once the market is being watched.
  let up: number | null = null;
  let down: number | null = null;
  let strike: number | null = null;
  let oracleQuestionId: string | null = null;
  try {
    const market = await currentMarket(0);
    if (market && round && market.marketId === round.marketId) {
      if (market.yesAsk !== undefined) up = Number(market.yesAsk) / Number(ONE);
      if (market.yesBid !== undefined) down = 1 - Number(market.yesBid) / Number(ONE);
      strike = market.strike || null;
      oracleQuestionId = market.oracleQuestionId;
    }
  } catch {
    // A book read failing must never blank the table.
  }

  const runs = await db.run.findMany({
    include: {
      player: true,
      positions: round ? { where: { roundId: round.id } } : false,
    },
    orderBy: [{ status: "asc" }, { stack: "desc" }],
  });

  const seats: SeatView[] = runs
    .filter((r) => r.status === "alive")
    .map((r) => {
      const pos = (r.positions ?? [])[0];
      return {
        runId: r.id,
        name: r.player.displayName,
        stack: toUsd(r.stack + (pos?.cost ?? 0n)),
        status: r.status as SeatView["status"],
        pick: (pos?.side ?? r.pendingSide ?? r.autoPick) as "UP" | "DOWN" | null,
        inRound: Boolean(pos),
        fillPrice: pos ? Number(pos.priceRaw) / Number(ONE) : null,
        multiple: toUsd(r.stack + (pos?.cost ?? 0n)) / toUsd(r.buyIn),
        rounds: r.roundsSurvived,
      };
    });

  const inRound = runs.filter((r) => r.status === "alive" && (r.positions ?? [])[0]);
  const crowd = {
    up: seats.filter((s) => s.pick === "UP").length,
    down: seats.filter((s) => s.pick === "DOWN").length,
    undecided: seats.filter((s) => !s.pick).length,
    liveStake: {
      up: inRound.filter((r) => r.positions![0].side === "UP").reduce((n, r) => n + toUsd(r.positions![0].cost), 0),
      down: inRound.filter((r) => r.positions![0].side === "DOWN").reduce((n, r) => n + toUsd(r.positions![0].cost), 0),
    },
    nextCall: {
      up: runs.filter((r) => r.status === "alive" && (r.pendingSide ?? r.autoPick) === "UP").length,
      down: runs.filter((r) => r.status === "alive" && (r.pendingSide ?? r.autoPick) === "DOWN").length,
      undecided: runs.filter((r) => r.status === "alive" && !(r.pendingSide ?? r.autoPick)).length,
    },
  };
  // Once anyone is filled, the live round is committed and on rails.
  const locked = inRound.length > 0;

  // The bell: the most recent settled round and what it did to the table.
  const settled = await db.round.findFirst({
    where: { status: { in: ["settled", "voided"] } },
    orderBy: { index: "desc" },
    include: { positions: { include: { run: { include: { player: true } } } } },
  });

  const lastResult = settled
    ? {
        index: settled.index,
        winner: settled.winningOutcome === null ? null : settled.winningOutcome === 0 ? ("UP" as const) : ("DOWN" as const),
        voided: settled.status === "voided",
        redeemTx: settled.redeemTx,
        killed: settled.positions.filter((p) => p.outcome === "lost").map((p) => p.run.player.displayName),
        survived: settled.positions
          .filter((p) => p.outcome === "won" || p.outcome === "push")
          .map((p) => ({
            name: p.run.player.displayName,
            from: toUsd(p.stackBefore),
            to: toUsd(p.stackAfter ?? p.stackBefore),
          })),
      }
    : null;

  // The external feed the market settles against.
  let price: number | null = null;
  try {
    const t = await exchange.fetchPrice(ASSET);
    price = t?.price ?? null;
  } catch {
    // A feed hiccup must not blank the table.
  }

  // The kill feed. Deaths first — that is the drama — with banks woven in.
  const recent = await db.run.findMany({
    where: { status: { in: ["eliminated", "banked"] } },
    include: { player: true, positions: { include: { round: true } } },
    orderBy: { endedRoundIndex: "desc" },
    take: 12,
  });

  const feed = recent.map((r) => {
    const last = r.positions.sort((a, b) => b.round.index - a.round.index)[0];
    const rd = last?.round;
    // A death is far more interesting when you know it was $3.20, not "a loss".
    const missedBy =
      r.status === "eliminated" && rd?.strike != null && rd?.close != null
        ? Math.abs(rd.close - rd.strike)
        : null;
    return {
      kind: (r.status === "eliminated" ? "died" : "banked") as "died" | "banked",
      name: r.player.displayName,
      round: r.endedRoundIndex ?? 0,
      multiple: r.finalMultiple ?? 0,
      rounds: r.roundsSurvived,
      missedBy,
    };
  });

  // Longest run ever seen at this table, alive or dead.
  const best = await db.run.findFirst({
    include: { player: true },
    orderBy: [{ roundsSurvived: "desc" }, { finalMultiple: "desc" }],
  });
  const record =
    best && best.roundsSurvived > 0
      ? {
          name: best.player.displayName,
          rounds: best.roundsSurvived,
          multiple: best.finalMultiple ?? toUsd(best.stack) / toUsd(best.buyIn),
        }
      : null;

  const board = runs
    .filter((r) => r.status !== "alive" && r.finalMultiple !== null)
    .sort((a, b) => (b.finalMultiple ?? 0) - (a.finalMultiple ?? 0))
    .slice(0, 10)
    .map((r) => ({
      name: r.player.displayName,
      multiple: r.finalMultiple ?? 0,
      status: r.status,
      rounds: r.roundsSurvived,
    }));

  return {
    round: round
      ? {
          index: round.index,
          marketId: round.marketId,
          expiresAt: round.expiresAt.toISOString(),
          secondsLeft: Math.max(0, (round.expiresAt.getTime() - Date.now()) / 1000),
          status: round.status,
        }
      : null,
    price: { up, down },
    pays: { up: up ? 1 / up : null, down: down ? 1 / down : null },
    capped: { up: up !== null && up > CAP, down: down !== null && down > CAP },
    crowd,
    locked,
    btc: { price, strike, oracleQuestionId },
    seats,
    lastResult,
    board,
    feed,
    record,
  };
}
