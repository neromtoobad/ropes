/**
 * Finding and reading the current round's market.
 *
 * Two rules from the gotchas doc that this module exists to enforce:
 *   1. Gate every write on the ON-CHAIN status, never the indexer's (it lags).
 *   2. Key everything by marketId. Pools are recycled between windows, so state
 *      keyed by pool address silently attaches to a market we never traded.
 */
import { exchange, ASSET, CADENCES } from "./chain";

export type Onchain = Awaited<ReturnType<typeof exchange.client.getMarketOnchain>>;

export interface LiveMarket {
  marketId: `0x${string}`;
  pool: `0x${string}`;
  onchain: Onchain;
  expiresAt: Date;
  opensAt: Date;
  secondsLeft: number;
  /** This market's cadence in seconds — 60 normally, 300 when the venue has
   *  stopped publishing 1m windows. Everything timed off a round reads this
   *  rather than assuming a minute. */
  intervalSec: number;
  /** Best resting YES ask / bid, raw units. undefined when that side is empty. */
  yesAsk?: bigint;
  yesBid?: bigint;
  /** Full resting depth, best level first — for marks that must answer "what
   *  would the book ACTUALLY pay for this whole size", not "what's the touch". */
  yesBidLevels: { price: bigint; quantity: bigint }[];
  yesAskLevels: { price: bigint; quantity: bigint }[];
  tick: bigint;
  lot: bigint;
  /** The line to beat: the window's opening price. Row is scaled by 100. */
  strike: number;
  /** The oracle question behind this market, for the provably-fair deep link. */
  oracleQuestionId: string | null;
}

/** Status 1 = Trading. The only status that accepts orders. */
const TRADING = 1;

/**
 * The live window of our series, or null if none is currently tradeable.
 *
 * `minSecondsLeft` guards the lock race: a window seconds from close can lock
 * between our snapshot and our send.
 */
/** When each cadence last had a live row. Module state is fine: one executor. */
const lastSeenAt = new Map<number, number>();
/** A cadence must be missing for longer than its own 1m window to count as gone. */
const ABSENT_AFTER_S = 90;

export async function currentMarket(minSecondsLeft = 5): Promise<LiveMarket | null> {
  const rows = await exchange.client.listLiveBinaryMarkets({ limit: 100 });
  /*
   * Prefer the 1-minute window; fall back only when the venue is not
   * publishing one. dreamDEX's testnet dropped every cadence under 4h for ~90
   * minutes on 4 Sep, which froze the game completely — a five-minute round is
   * a slower game than this is meant to be, but it is a game, and a frozen
   * clock in front of a judge is not. The first cadence with a tradeable
   * window wins, so the game returns to 1m by itself the moment 1m returns.
   */
  const forCadence = (sec: number) =>
    rows
      .filter((m: any) => m.asset === ASSET && Number(m.intervalSec) === sec)
      .sort((a: any, b: any) => Number(a.expiry) - Number(b.expiry));

  /*
   * Fall back only when a cadence is ABSENT, never when its current window is
   * merely too close to expiry.
   *
   * Flattening every cadence into one list was wrong: with ~9s left on the
   * live 1m window, that window failed the runway check and the loop fell
   * straight through to a 5m market — opening a five-minute round while 1m was
   * perfectly healthy (observed live, round 6575). Waiting ten seconds for the
   * next 1m window is always the right answer. So: take the first cadence that
   * has ANY live market, and if none of its windows is enterable right now,
   * return null and try again next tick rather than reaching for a slower one.
   */
  /*
   * "Absent" means absent for a sustained stretch, not for one tick.
   *
   * At every :00/:05 boundary the indexer lists the new 5m window a few
   * seconds BEFORE it lists the new 1m window. For those seconds 1m genuinely
   * has no rows, the first cut fell back, and a five-minute round was opened
   * alongside the one-minute one — 183 times over twenty hours, and once with
   * a real player's position in it (round 7094). A cadence only counts as
   * gone when it has been missing for longer than one of its own windows.
   */
  /*
   * And "has a row" must mean "has a window still AHEAD of us".
   *
   * A listed row whose expiry is already in the past is a corpse, not a live
   * cadence — but counting rows alone could not tell the difference, so a
   * corpse held the loop on its cadence, every window it offered failed the
   * runway check, and `currentMarket` returned null on every tick for as long
   * as the venue kept listing it. The loop then sat there opening nothing,
   * silently: no round, no error, nothing in the log. Measured on the live
   * executor, once every four hours to the minute (15:55, 19:55, 23:55, 03:55,
   * 07:55, 11:55 UTC on 12-13 sep), one whole five-minute window went dark
   * each time — an hour of dead clock a day, and a player who arrived in one
   * saw a countdown frozen at 0:00 with a live game either side of it.
   *
   * Judging liveness on a FUTURE expiry keeps both rules intact: a 1m window
   * with 9s left is still ahead of us, so it still holds the loop and we still
   * wait a tick for the next 1m window rather than reaching for a 5m one
   * (fall back on absence, never on runway), while a cadence that has nothing
   * but expired rows stops counting as present and the fallback can do its job.
   */
  const now = Date.now();
  const liveFor = (sec: number) => forCadence(sec).filter((m: any) => Number(m.expiry) * 1000 > now);
  for (const sec of CADENCES) if (liveFor(sec).length) lastSeenAt.set(sec, now);
  let candidates: any[] = [];
  let heldBy = 0;
  for (const sec of CADENCES) {
    const seen = lastSeenAt.get(sec) ?? 0;
    const missingFor = (now - seen) / 1000;
    if (missingFor <= ABSENT_AFTER_S) {
      heldBy = sec;
      candidates = liveFor(sec);
      break; // this cadence is live (or only just blinked) — never reach past it
    }
  }
  reportCadence(heldBy);

  const rejected: string[] = [];
  for (const row of candidates) {
    const marketId = row.marketId as `0x${string}`;
    const rowInterval = Number(row.intervalSec);
    const onchain = await exchange.client.getMarketOnchain(marketId);
    if (onchain.status !== TRADING) {
      rejected.push(`${marketId.slice(0, 10)}… status=${onchain.status}`);
      continue;
    }

    const expiresAt = new Date(Number(row.expiry) * 1000);
    const secondsLeft = (expiresAt.getTime() - Date.now()) / 1000;
    if (secondsLeft < minSecondsLeft) {
      rejected.push(`${marketId.slice(0, 10)}… ${secondsLeft.toFixed(0)}s left`);
      continue;
    }

    const pool = onchain.pool as `0x${string}`;
    const grid = await exchange.client.getBinaryBookParams(pool);

    // watchMarket hydrates the local store; getLiveBinaryOrderBook is then
    // zero-round-trip. fetchOrderBook(symbol) is NOT usable here — indexer rows
    // carry no `symbol`, and it hangs without loadMarkets().
    await exchange.client.watchMarket(pool);
    const book = exchange.client.getLiveBinaryOrderBook(pool);

    reportLit();
    return {
      marketId,
      pool,
      onchain,
      expiresAt,
      intervalSec: rowInterval,
      opensAt: new Date(Number(row.tradingStart ?? Number(row.expiry) - rowInterval) * 1000),
      secondsLeft,
      yesAsk: book.yesAsks[0]?.price,
      yesBid: book.yesBids[0]?.price,
      yesBidLevels: book.yesBids.map((l) => ({ price: l.price, quantity: l.quantity })),
      yesAskLevels: book.yesAsks.map((l) => ({ price: l.price, quantity: l.quantity })),
      tick: grid.tickSize ?? 1000n,
      lot: grid.lotSize ?? 1000n,
      strike: row.strike ? Number(row.strike) / 100 : 0,
      oracleQuestionId: row.oracleQuestionId ? String(row.oracleQuestionId) : null,
    };
  }
  reportDark(heldBy, rows.length, candidates.length, rejected);
  return null;
}

/**
 * Say so when there is nothing to open.
 *
 * Returning null here stops the whole game — no round opens, so the page has
 * nothing to count down to — and it used to do that in complete silence: the
 * executor's log went blank for five minutes at a stretch with no round, no
 * error and no failed tick, which is indistinguishable from a healthy quiet
 * spell right up until someone tries to play. A dark game has to be legible
 * in the log of the process that turned the lights off.
 *
 * The last seconds of every window are legitimately marketless — the live one
 * has less runway than `minSecondsLeft` and the next is not listed yet — so a
 * gap only counts as dark once it outlasts that (`DARK_AFTER_MS`), and is then
 * reported every 30s plus once on recovery. A healthy game says nothing at
 * all; a stuck one costs a couple of lines a minute.
 */
const DARK_AFTER_MS = 45_000;
let darkSince = 0;
let darkLoggedAt = 0;

function reportDark(heldBy: number, rowCount: number, candidateCount: number, rejected: string[]) {
  const now = Date.now();
  if (!darkSince) darkSince = now;
  if (now - darkSince < DARK_AFTER_MS) return;
  if (darkLoggedAt && now - darkLoggedAt < 30_000) return;
  darkLoggedAt = now;
  const why = candidateCount === 0
    ? heldBy
      ? `cadence ${heldBy}s is held but has no live window right now`
      : `no cadence in ${CADENCES.join("/")}s has a live window`
    : `every ${heldBy}s window was refused: ${rejected.slice(0, 4).join(", ")}`;
  console.log(
    `${new Date().toISOString().slice(11, 19)} NO MARKET TO OPEN — the clock is dark for ` +
    `${Math.round((now - darkSince) / 1000)}s. ${why}. ${rowCount} live rows listed.`,
  );
}

/**
 * Say which cadence the game is on, whenever that changes.
 *
 * The venue stopped publishing 1m BTC windows around midday on 12 sep and the
 * game moved to its 5m fallback — correctly, silently, and for over a day
 * before anyone noticed the clock was counting five minutes instead of one.
 * Nothing in the log marked the change, so working out WHEN it happened meant
 * reading round expiry times by hand across two days of history.
 *
 * This is a one-line answer to "why is the round five minutes?" and, more
 * usefully, to "has the one-minute game come back yet?" — the return is
 * automatic and takes one tick, so the log is the only place it shows up.
 */
let lastCadence = 0;

function reportCadence(heldBy: number) {
  // 0 means nothing is live at all; that is the dark path's story to tell,
  // not a cadence change, and treating it as one would log a switch every
  // time the venue blinked.
  if (!heldBy || heldBy === lastCadence) return;
  const was = lastCadence;
  lastCadence = heldBy;
  const t = new Date().toISOString().slice(11, 19);
  if (!was) {
    console.log(`${t} cadence: ${heldBy}s windows`);
  } else if (heldBy < was) {
    console.log(`${t} cadence: BACK to ${heldBy}s windows (was ${was}s) — the venue is publishing them again`);
  } else {
    console.log(`${t} cadence: FELL BACK to ${heldBy}s windows (was ${was}s) — the venue has stopped publishing ${was}s windows`);
  }
}

/** Called on the way out of a successful pick, so the next outage starts clean
 *  and the log says how long this one lasted. */
function reportLit() {
  if (!darkSince) return;
  const was = Math.round((Date.now() - darkSince) / 1000);
  darkSince = 0;
  darkLoggedAt = 0;
  if (was * 1000 >= DARK_AFTER_MS) {
    console.log(`${new Date().toISOString().slice(11, 19)} market found again after ${was}s dark`);
  }
}

/** Re-read a market's settlement state. Cheap, on-chain, authoritative. */
export async function settlement(marketId: `0x${string}`) {
  const oc = await exchange.client.getMarketOnchain(marketId);
  return {
    onchain: oc,
    settled: oc.isResolved || oc.isVoided,
    voided: oc.isVoided,
    // A voided market pays BOTH sides 0.5 and has no winner to infer.
    winningOutcome: oc.isVoided ? null : (oc.winningOutcome as 0 | 1),
  };
}

/** Our position in one outcome of a market, raw units. */
export async function outcomeBalance(oc: Onchain, account: `0x${string}`, outcomeIdx: 0 | 1) {
  // NB: object argument. The recipes doc shows positional args; those throw.
  return exchange.client.getOutcomeBalance({
    outcomeToken: oc.outcomeToken,
    account,
    id: outcomeIdx === 0 ? oc.yesId : oc.noId,
  });
}
