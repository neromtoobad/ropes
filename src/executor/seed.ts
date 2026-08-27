/**
 * Seed bot players so the loop can be tested with no UI.
 *
 *   npx tsx src/executor/seed.ts [count]
 *
 * Real players pick through the web app in phase 2; these pick via autoPick.
 */
import { fmtUsd } from "../lib/chain";
import { db, joinGame } from "./game";


const NAMES = ["ada", "bram", "cyd", "dez", "eli", "fern", "gus", "hana"];

const count = Math.min(Number(process.argv[2] ?? 4), NAMES.length);
const current = await db.round.findFirst({ orderBy: { index: "desc" } });
const roundIndex = current?.index ?? 0;

for (let i = 0; i < count; i++) {
  const name = NAMES[i];
  // Alternate sides so both books get hit and the round has a real split —
  // which is also what makes eliminations happen instead of everyone surviving.
  const autoPick = i % 2 === 0 ? "UP" : "DOWN";
  try {
    const run = await joinGame(
      `0x${(i + 1).toString(16).padStart(40, "0")}`,
      name,
      0n,
      roundIndex,
      autoPick,
    );
    console.log(`seated ${name.padEnd(5)} ${autoPick.padEnd(4)} buyIn ${fmtUsd(run.buyIn)}`);
  } catch (err) {
    console.log(`skip ${name}: ${String(err).replace("Error: ", "").slice(0, 80)}`);
  }
}
await db.$disconnect();
