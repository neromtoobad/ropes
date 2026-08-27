/**
 * THE CLIMB — motion spike.
 *
 * The pivot rests on one unanswered question: does a character's height move in
 * a way that is fun to watch?
 *
 * A climber's height is `contracts × live probability`. Probability barely moves
 * early in a 1-minute window and then swings hard near expiry, so the risk is a
 * character that sits still for forty seconds and then teleports — which would
 * be worse than the chart it replaces.
 *
 * This samples a real BTC 1m window every second and reports what a climber
 * would actually have done. No orders, no money: it prices a NOTIONAL position
 * off the live book, because the shape of the motion is the only question here.
 *
 *   npx tsx scripts/spike/climb.ts [rounds]
 */
import "dotenv/config";
import { exchange, ONE, ASSET, sleep } from "../../src/lib/chain";
import { currentMarket } from "../../src/lib/market";

const ROUNDS = Number(process.argv[2] ?? 5);
const STAKE = 10; // tUSDC, notional

interface Sample {
  round: number;
  t: number; // seconds since we started watching
  secsLeft: number;
  price: number | null; // BTC
  strike: number;
  upProb: number | null; // live UP probability
  height: number | null; // climber height, 0..1 of the wall
}

const rows: Sample[] = [];

/**
 * Height is what your position is worth, as a multiple of what you paid.
 *
 * Buy at `entry`, hold `stake/entry` contracts, worth `contracts × live` now —
 * so the multiple is simply `live / entry`. Everyone starts at 1.0x and climbs
 * or slips from there, and a contrarian entry has further to climb, which is
 * exactly the leverage story.
 *
 * The raw multiple is unbounded and asymmetric (a 2x is +1.0, a halving is
 * -0.5), so the wall uses a log scale squashed through tanh: symmetric, bounded
 * to 0..1, and it never explodes the way `(live-entry)/(1-entry)` did when a
 * player entered near certainty.
 */
/**
 * Curve gain, measured on real rounds rather than guessed.
 *
 * 1.0 left a favourite-buyer travelling 0.127 of the wall — invisible. 2.6 made
 * that visible but clipped the best round, pinning it at the floor for 12% of
 * its seconds and flattening a last-second save. 1.8 is the last gain before
 * that clipping starts: it nearly doubles the small climbs (0.127 → 0.224)
 * while the dramatic round still uses the full wall with nothing pinned.
 */
export const CURVE_GAIN = 1.8;

export function heightFor(entryProb: number, liveProb: number) {
  if (entryProb <= 0 || liveProb <= 0) return null;
  const multiple = liveProb / entryProb;
  // 0.5 is where you entered. A doubling and a halving are equal distances.
  return 0.5 + 0.5 * Math.tanh(CURVE_GAIN * Math.log(multiple));
}

console.log(`sampling ${ROUNDS} rounds of BTC 1m…\n`);
const t0 = Date.now();
let watched = 0;
let seenMarket: string | null = null;
let entryProb: number | null = null;

while (watched < ROUNDS) {
  // Resolve the window ONCE. Re-resolving every tick cost three network calls a
  // second and cut sampling to a third of the round.
  const market = await currentMarket(0);
  if (!market) {
    await sleep(500);
    continue;
  }
  if (market.marketId === seenMarket) {
    await sleep(500);
    continue;
  }

  seenMarket = market.marketId;
  entryProb = null;
  watched++;
  console.log(`\n── round ${watched}  ${market.marketId.slice(0, 10)}…  strike ${market.strike}`);

  // Watch this ONE window all the way to expiry, including the lock — the last
  // seconds are the whole point and the previous version never saw them.
  const expiry = market.expiresAt.getTime();
  while (Date.now() < expiry + 1500) {
    // Zero round-trip: watchMarket already hydrated the local store.
    const book = exchange.client.getLiveBinaryOrderBook(market.pool);
    const ask = book.yesAsks[0]?.price;
    const bid = book.yesBids[0]?.price;
    // Mid is the honest read of "what is my position worth right now".
    const upProb =
      ask !== undefined && bid !== undefined
        ? (Number(ask) + Number(bid)) / 2 / Number(ONE)
        : ask !== undefined
          ? Number(ask) / Number(ONE)
          : null;

    if (entryProb === null && upProb !== null && upProb > 0.02 && upProb < 0.9) {
      entryProb = upProb;
      console.log(`   entered UP @ ${entryProb.toFixed(3)}  (${(STAKE / entryProb).toFixed(2)} contracts)`);
    }

    let price: number | null = null;
    try {
      price = (await exchange.fetchPrice(ASSET))?.price ?? null;
    } catch {
      /* a feed hiccup must not stop the sample */
    }

    const secsLeft = Math.max(0, (expiry - Date.now()) / 1000);
    const height = entryProb !== null && upProb !== null ? heightFor(entryProb, upProb) : null;

    rows.push({ round: watched, t: (Date.now() - t0) / 1000, secsLeft, price, strike: market.strike, upProb, height });

    if (upProb !== null && height !== null) {
      const col = Math.max(0, Math.min(46, Math.round(height * 46)));
      console.log(
        `   ${secsLeft.toFixed(0).padStart(2)}s  p=${upProb.toFixed(3)}  ` +
          `h=${height.toFixed(3)}  |${" ".repeat(col)}◆`,
      );
    }
    await sleep(1000);
  }
}

// ------------------------------------------------------------------ verdict
const byRound = new Map<number, Sample[]>();
for (const r of rows) {
  if (r.height === null) continue;
  byRound.set(r.round, [...(byRound.get(r.round) ?? []), r]);
}

console.log(`\n${"=".repeat(64)}\nMOTION REPORT\n${"=".repeat(64)}`);

let totalEarlyMove = 0;
let totalLateMove = 0;
let usable = 0;

for (const [round, samples] of byRound) {
  if (samples.length < 10) continue;
  usable++;
  const heights = samples.map((s) => s.height!);
  const span = Math.max(...heights) - Math.min(...heights);

  // How much of the motion happens in the last 15 seconds versus before it?
  const late = samples.filter((s) => s.secsLeft <= 15).map((s) => s.height!);
  const early = samples.filter((s) => s.secsLeft > 15).map((s) => s.height!);
  const range = (a: number[]) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
  const earlyMove = range(early);
  const lateMove = range(late);
  totalEarlyMove += earlyMove;
  totalLateMove += lateMove;

  // Per-second change: a climber that never moves is the failure mode.
  const steps = heights.slice(1).map((h, i) => Math.abs(h - heights[i]));
  const still = steps.filter((s) => s < 0.005).length / steps.length;

  console.log(
    `round ${round}  samples ${String(samples.length).padStart(3)}  ` +
      `span ${span.toFixed(3)}  early ${earlyMove.toFixed(3)}  late ${lateMove.toFixed(3)}  ` +
      `still ${(still * 100).toFixed(0)}%`,
  );
}

const avgEarly = usable ? totalEarlyMove / usable : 0;
const avgLate = usable ? totalLateMove / usable : 0;
const allSteps = rows
  .filter((r) => r.height !== null)
  .map((r) => r.height!)
  .slice(1)
  .map((h, i) => Math.abs(h - rows.filter((r) => r.height !== null).map((r) => r.height!)[i]));
const stillPct = allSteps.length
  ? allSteps.filter((s) => s < 0.005).length / allSteps.length
  : 1;

console.log(`\naverage motion before the last 15s : ${avgEarly.toFixed(3)}`);
console.log(`average motion in the last 15s     : ${avgLate.toFixed(3)}`);
console.log(`seconds the climber barely moved   : ${(stillPct * 100).toFixed(0)}%`);

const readsWell = avgEarly > 0.08 && stillPct < 0.6;
const dramaticFinish = avgLate >= avgEarly * 0.8;

console.log(`\nVERDICT`);
console.log(`  climbs continuously   ${readsWell ? "YES" : "NO"}`);
console.log(`  finish is dramatic    ${dramaticFinish ? "YES" : "NO"}`);
console.log(
  `  ${
    readsWell && dramaticFinish
      ? "→ the cliff reads. build it."
      : readsWell
        ? "→ moves, but the finish is flat. consider weighting height by time remaining."
        : "→ too still. remap: try distance-from-strike, or amplify small moves."
  }`,
);

// CSV so the shape can actually be plotted rather than argued about.
const fs = await import("node:fs");
const csv = ["round,t,secsLeft,btc,strike,upProb,height"]
  .concat(
    rows.map((r) =>
      [r.round, r.t.toFixed(1), r.secsLeft.toFixed(1), r.price ?? "", r.strike, r.upProb ?? "", r.height ?? ""].join(","),
    ),
  )
  .join("\n");
fs.writeFileSync("design/climb-motion.csv", csv);
console.log(`\nwrote design/climb-motion.csv  (${rows.length} samples)`);
process.exit(0);
