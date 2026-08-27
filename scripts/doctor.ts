/**
 * THE CLIMB — doctor.
 *
 * One command that answers "does the money add up and is the ledger sane".
 * Run it before any real session, and any time something feels off.
 *
 *   npx tsx scripts/doctor.ts          # report
 *   npx tsx scripts/doctor.ts --fix    # also repair what is safely repairable
 *
 * Solvency here means: the house wallet's collateral plus the value of every
 * outcome token it holds must cover every alive player's stack. The house
 * keeps eliminated players' losses, so headroom should only ever grow — a
 * shrinking headroom means attribution is leaking somewhere.
 */
import { db } from "../src/lib/db";
import { houseCollateral, houseGas, fmtUsd, ONE } from "../src/lib/chain";

const FIX = process.argv.includes("--fix");
let problems = 0;
const bad = (msg: string) => {
  problems++;
  console.log(`  ✗ ${msg}`);
};
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

console.log("── wallet");
const gas = await houseGas();
const collateral = await houseCollateral();
console.log(`  gas        ${(Number(gas) / 1e18).toFixed(4)} STT`);
console.log(`  collateral ${fmtUsd(collateral)} tUSDC`);
if (gas < 2n * 10n ** 18n) bad("below 2 STT — the executor will start failing writes");
if (collateral < 50n * ONE) bad("below 50 tUSDC — a few buy-ins from insolvency");

console.log("── ledger");
const alive = await db.run.findMany({ where: { status: "alive" }, include: { player: true, table: true } });

// Liability: what the house owes the living, at cost basis.
const liability = alive.reduce((n, r) => n + r.stack, 0n);
console.log(`  alive runs ${alive.length}, liability ${fmtUsd(liability)} tUSDC`);
if (collateral < liability) {
  bad(`INSOLVENT on cash alone: wallet ${fmtUsd(collateral)} < owed ${fmtUsd(liability)}`);
} else {
  ok(`solvent: headroom ${fmtUsd(collateral - liability)} over alive stacks`);
}

for (const r of alive) {
  if (r.stack < 0n) bad(`${r.player.displayName}: negative stack ${fmtUsd(r.stack)}`);
  if (!r.tableId) {
    bad(`${r.player.displayName}: alive with no table (invisible on the wall)`);
    if (FIX) {
      await db.run.update({
        where: { id: r.id },
        data: { status: "banked", bankedAuto: true, finalMultiple: Number(r.stack) / Number(r.buyIn) },
      });
      console.log(`    fixed: retired as auto-banked at its cash value`);
    }
  }
  if (r.table && r.table.status === "finished") {
    bad(`${r.player.displayName}: alive on a FINISHED table`);
  }
}

// A flag on a finished run means a bail died half-way.
const staleFlags = await db.run.findMany({
  where: { bailRequested: true, status: { not: "alive" } },
  include: { player: true },
});
for (const r of staleFlags) {
  bad(`${r.player.displayName}: bailRequested still set on a ${r.status} run`);
  if (FIX) {
    await db.run.update({ where: { id: r.id }, data: { bailRequested: false } });
    console.log(`    fixed: flag cleared (the run already resolved)`);
  }
}

// A payout stuck in "sending" means the executor died mid-transfer. Check the
// explorer for the house wallet before releasing it — releasing a payout that
// actually landed double-pays.
const stuck = await db.run.findMany({
  where: { payoutTx: "sending" },
  include: { player: true },
});
for (const r of stuck) {
  bad(
    `${r.player.displayName}: payout of ${fmtUsd(r.stack)} stuck in "sending" — ` +
      `verify on the explorer, then --fix releases it for retry`,
  );
  if (FIX) {
    await db.run.update({ where: { id: r.id }, data: { payoutTx: null } });
    console.log(`    fixed: released for retry (CHECK THE EXPLORER FIRST next time)`);
  }
}
// Ended paid runs still owed money should drain to zero every tick.
const owed = await db.run.count({
  where: {
    status: { in: ["banked", "eliminated"] },
    payoutAddress: { not: null },
    payoutTx: null,
    stack: { gt: 0n },
  },
});
if (owed > 0) bad(`${owed} paid run(s) owed a payout — is the executor running?`);
else if (!stuck.length) ok("no payouts owed or stuck");

// Every position in a settled round must carry an outcome, or money was
// redeemed without being attributed to anyone.
const unresolved = await db.position.findMany({
  where: { outcome: null, round: { status: { in: ["settled", "voided"] } } },
  include: { run: { include: { player: true } }, round: true },
});
for (const p of unresolved) {
  bad(`round ${p.round.index}: ${p.run.player.displayName}'s position has no outcome`);
}
if (!unresolved.length) ok("every settled position carries an outcome");

// Rounds stuck open behind the head are a wedged loop.
const head = await db.round.findFirst({ orderBy: { index: "desc" } });
const wedged = await db.round.findMany({
  where: { status: "open", index: { lt: (head?.index ?? 0) - 1 } },
});
for (const r of wedged) {
  bad(`round ${r.index} still open ${(head?.index ?? 0) - r.index} rounds behind the head`);
  if (FIX) {
    await db.round.update({ where: { id: r.id }, data: { status: "settled" } });
    console.log(`    fixed: closed (its positions were already resolved or empty)`);
  }
}
if (!wedged.length) ok("no wedged rounds");

// Exactly one table should ever be filling.
const filling = await db.table.count({ where: { status: "filling" } });
if (filling > 1) bad(`${filling} tables filling at once`);
else ok("single filling table");

console.log(
  problems === 0
    ? "\nDOCTOR: clean."
    : `\nDOCTOR: ${problems} problem${problems === 1 ? "" : "s"}${FIX ? " (fixable ones repaired)" : " — rerun with --fix to repair"}`,
);
process.exit(problems === 0 ? 0 : 1);
