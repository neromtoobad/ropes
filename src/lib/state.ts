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
  crowd: { up: number; down: number; undecided: number };
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
  board: { name: string; multiple: number; status: string }[];
}

const CAP = Number(MAX_ENTRY_PRICE_PCT) / 100;

export async function getTableState(): Promise<TableState> {
  const round = await db.round.findFirst({ orderBy: { index: "desc" } });

  // Live book. Cheap — watchMarket keeps a local store, so this is zero RTT
  // once the market is being watched.
  let up: number | null = null;
  let down: number | null = null;
  try {
    const market = await currentMarket(0);
    if (market && round && market.marketId === round.marketId) {
      if (market.yesAsk !== undefined) up = Number(market.yesAsk) / Number(ONE);
      if (market.yesBid !== undefined) down = 1 - Number(market.yesBid) / Number(ONE);
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
      };
    });

  const crowd = {
    up: seats.filter((s) => s.pick === "UP").length,
    down: seats.filter((s) => s.pick === "DOWN").length,
    undecided: seats.filter((s) => !s.pick).length,
  };

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

  const board = runs
    .filter((r) => r.status !== "alive" && r.finalMultiple !== null)
    .sort((a, b) => (b.finalMultiple ?? 0) - (a.finalMultiple ?? 0))
    .slice(0, 10)
    .map((r) => ({ name: r.player.displayName, multiple: r.finalMultiple ?? 0, status: r.status }));

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
    seats,
    lastResult,
    board,
  };
}
