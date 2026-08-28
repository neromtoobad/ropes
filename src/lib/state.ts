/**
 * The single read the table renders from.
 *
 * Prices here are LIVE and indicative — the price a player sees when they pick
 * is not the price they get. The 1m book is empty for the first 5-10s of every
 * window, so entry lands partway in at whatever the book has by then. The UI
 * must present these as "pays about", never as a promise.
 */
import { db } from "./db";
import { ONE, toUsd, INTERVAL_SEC } from "./chain";
import { exchange, ASSET, HOUSE, COLLATERAL } from "./chain";
import { MAX_ENTRY_PRICE_PCT } from "./orders";
import { MAX_SEATS } from "../executor/tables";
import { ENTRY_WINDOW_S } from "../executor/game";

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
  /** This player's best-ever finished multiple — their ghost on the wall. */
  best: number | null;
  /** What this round's position cost, so the client can mark it to market. */
  costInRound: number;
  /** The seat price this run started from — the denominator of every multiple. */
  buyIn: number;
}

export interface TableState {
  round: {
    index: number;
    marketId: string;
    expiresAt: string;
    secondsLeft: number;
    status: string;
    /** Seconds until entries close for THIS window (0 = closed; bets now
     *  queue for the next). The executor enforces the same cutoff. */
    betsCloseIn: number;
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
  /**
   * The cohort. This is what makes the game finite: a sealed table has a fixed
   * roster and resolves to exactly one champion.
   */
  table: {
    index: number;
    status: "filling" | "sealed" | "finished";
    seated: number;
    alive: number;
    maxSeats: number;
    pot: number;
    /** Seconds until a filling table locks its roster. */
    sealsIn: number;
  } | null;
  /** The most recent champion, for the victory moment. */
  champion: { name: string; multiple: number; rounds: number; pot: number; tableIndex: number } | null;
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
    /** How far past the line BTC closed, in dollars. The verdict's margin. */
    closedBy: number | null;
  } | null;
  board: { name: string; multiple: number; status: string; rounds: number }[];
  /** Recent deaths and exits, newest first. A battle royale needs a kill feed. */
  feed: {
    kind: "died" | "banked" | "swept";
    name: string;
    round: number;
    multiple: number;
    rounds: number;
    /** How far the wrong side of the line they finished. The near miss. */
    missedBy: number | null;
    /** Set once the executor sent this run's proceeds on-chain. */
    payoutTx: string | null;
  }[];
  /** Where a paid seat's 10 tUSDC goes, and the token it goes in. */
  pay: { house: string; collateral: string };
  /** The number to beat. A run is measured in rounds survived, not dollars. */
  record: { name: string; rounds: number; multiple: number } | null;
  /**
   * The gold ghost on the wall: the best MULTIPLE anyone ever finished with.
   * Distinct from `record` (the longest run) — a 3R run at 0.4x is a survival
   * record but painting it as a height target would put the flag on the floor.
   */
  wallRecord: { name: string; multiple: number } | null;
}

const CAP = Number(MAX_ENTRY_PRICE_PCT) / 100;

export async function getTableState(): Promise<TableState> {
  const round = await db.round.findFirst({ orderBy: { index: "desc" } });

  // The book, the line and the oracle link all come from the row the executor
  // mirrors each tick. The web app never touches the chain: a second
  // SomniaMarkets instance means a second WebSocket, and when that one died
  // silently the whole table went blank while the game itself was fine.
  const up = round?.yesAsk ?? null;
  const down = round?.yesBid != null ? 1 - round.yesBid : null;
  const strike = round?.strike ?? null;
  const oracleQuestionId = round?.oracleQuestionId ?? null;

  // The table the game is currently being played on: the sealed one if there is
  // a live match, otherwise the one taking arrivals.
  const activeTable =
    (await db.table.findFirst({ where: { status: "sealed" }, orderBy: { index: "desc" } })) ??
    (await db.table.findFirst({ where: { status: "filling" }, orderBy: { index: "desc" } }));

  const runs = await db.run.findMany({
    include: {
      player: true,
      positions: round ? { where: { roundId: round.id } } : false,
    },
    orderBy: [{ status: "asc" }, { stack: "desc" }],
  });

  // Best finished multiple per player, for the personal ghost line. One query,
  // grouped, rather than a lookup per seat.
  const bests = await db.run.groupBy({
    by: ["playerId"],
    where: { status: { in: ["banked", "eliminated"] }, finalMultiple: { not: null } },
    _max: { finalMultiple: true },
  });
  const bestByPlayer = new Map(bests.map((b) => [b.playerId, b._max.finalMultiple ?? null]));

  const seats: SeatView[] = runs
    .filter((r) => r.status === "alive" && (!activeTable || r.tableId === activeTable.id))
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
        best: bestByPlayer.get(r.playerId) ?? null,
        costInRound: toUsd(pos?.cost ?? 0n),
        buyIn: toUsd(r.buyIn),
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
        closedBy:
          settled.strike != null && settled.close != null
            ? settled.close - settled.strike
            : null,
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
      // A sweep is not a cash-out. Saying "banked" would credit a decision the
      // player never made.
      kind: (r.status === "eliminated" ? "died" : r.bankedAuto ? "swept" : "banked") as
        | "died"
        | "banked"
        | "swept",
      name: r.player.displayName,
      round: r.endedRoundIndex ?? 0,
      multiple: r.finalMultiple ?? 0,
      rounds: r.roundsSurvived,
      missedBy,
      payoutTx: r.payoutTx && r.payoutTx !== "sending" ? r.payoutTx : null,
    };
  });

  // Longest run ever seen at this table, alive or dead.
  const best = await db.run.findFirst({
    include: { player: true },
    orderBy: [{ roundsSurvived: "desc" }, { finalMultiple: "desc" }],
  });
  const bestRun = await db.run.findFirst({
    where: { status: { in: ["banked", "eliminated"] }, finalMultiple: { gt: 1 } },
    orderBy: { finalMultiple: "desc" },
    include: { player: true },
  });
  const wallRecord = bestRun
    ? { name: bestRun.player.displayName, multiple: bestRun.finalMultiple! }
    : null;

  const record =
    best && best.roundsSurvived > 0
      ? {
          name: best.player.displayName,
          rounds: best.roundsSurvived,
          multiple: best.finalMultiple ?? toUsd(best.stack) / toUsd(best.buyIn),
        }
      : null;

  // The last champion — a table that actually resolved to one player.
  const champRun = await db.run.findFirst({
    where: { isChampion: true },
    include: { player: true, table: true },
    orderBy: { endedRoundIndex: "desc" },
  });
  const champion = champRun
    ? {
        name: champRun.player.displayName,
        multiple: champRun.finalMultiple ?? 0,
        rounds: champRun.roundsSurvived,
        pot: toUsd(champRun.table?.pot ?? 0n),
        tableIndex: champRun.table?.index ?? 0,
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
      ? (() => {
          const secondsLeft = Math.max(0, (round.expiresAt.getTime() - Date.now()) / 1000);
          return {
            index: round.index,
            marketId: round.marketId,
            expiresAt: round.expiresAt.toISOString(),
            secondsLeft,
            status: round.status,
            betsCloseIn: Math.max(0, secondsLeft - (INTERVAL_SEC - ENTRY_WINDOW_S)),
          };
        })()
      : null,
    price: { up, down },
    pays: { up: up ? 1 / up : null, down: down ? 1 / down : null },
    capped: { up: up !== null && up > CAP, down: down !== null && down > CAP },
    crowd,
    locked,
    table: activeTable
      ? {
          index: activeTable.index,
          status: activeTable.status as "filling" | "sealed" | "finished",
          seated: await db.run.count({ where: { tableId: activeTable.id } }),
          alive: await db.run.count({ where: { tableId: activeTable.id, status: "alive" } }),
          maxSeats: MAX_SEATS,
          pot: toUsd(activeTable.pot),
          sealsIn: Math.max(0, (activeTable.sealsAt.getTime() - Date.now()) / 1000),
        }
      : null,
    champion,
    btc: { price, strike, oracleQuestionId },
    pay: { house: HOUSE, collateral: COLLATERAL },
    seats,
    lastResult,
    board,
    feed,
    record,
    wallRecord,
  };
}
