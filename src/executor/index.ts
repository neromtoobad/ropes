/**
 * The executor. One tick loop drives the whole game.
 *
 *   npx tsx src/executor/index.ts
 *
 * Settlement lands ~0.2-1.2s after expiry (Somnia's reactive oracle callback,
 * no keeper), and the redeem-and-roll takes ~2.7s, so a 1s tick is plenty to
 * run one-minute rounds without ever missing a window.
 */
import { houseCollateral, houseGas, fmtUsd, sleep, HOUSE } from "../lib/chain.js";
import { openRound, enterRound, closeRound, db } from "./game.js";

const TICK_MS = 1000;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

let stopping = false;
process.on("SIGINT", () => { log("shutting down…"); stopping = true; });

async function preflight() {
  const gas = await houseGas();
  const collateral = await houseCollateral();
  log(`house ${HOUSE}`);
  log(`gas ${(Number(gas) / 1e18).toFixed(4)} STT   collateral ${fmtUsd(collateral)} tUSDC`);
  // An underfunded executor does not stop — it sends orders that revert and
  // pays gas on every cycle, silently. Refuse to start instead.
  if (gas === 0n) throw new Error("no STT for gas");
  if (collateral === 0n) throw new Error("no tUSDC collateral");
}

async function tick() {
  // 1. Settle anything that has expired. Do this FIRST so survivors' stacks are
  //    free before we try to enter the next window.
  const pending = await db.round.findMany({ where: { status: { in: ["open", "locked"] } } });
  for (const round of pending) {
    if (round.expiresAt.getTime() > Date.now()) continue;
    try {
      await closeRound(round.id);
    } catch (err) {
      log(`close round ${round.index} failed: ${String(err).slice(0, 160)}`);
    }
  }

  // 2. Open the live window and enter it.
  const opened = await openRound();
  if (!opened) return;
  const { round, market } = opened;
  if (round.status !== "open") return;
  await enterRound(round.id, market);
}

async function main() {
  await preflight();
  log("executor running. ctrl-c to stop.\n");
  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      log(`tick failed: ${String(err).slice(0, 200)}`);
    }
    await sleep(TICK_MS);
  }
  await db.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
