import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toUsd } from "@/lib/chain";
import { computeBadges } from "@/lib/badges";

/**
 * MY LEDGER — one player's complete money story, straight from the same
 * SQLite the executor writes. Totals, badges, run history, and the
 * round-by-round value series of the live run (the equity sparkline).
 */
export async function GET(req: Request) {
  const playerKey = new URL(req.url).searchParams.get("playerKey");
  if (!playerKey) return NextResponse.json({ error: "playerKey required" }, { status: 400 });

  const player = await db.player.findUnique({ where: { wallet: playerKey } });
  if (!player) {
    return NextResponse.json({ name: null, totals: null, badges: [], runs: [], series: null });
  }

  const runs = await db.run.findMany({
    where: { playerId: player.id },
    include: { positions: { include: { round: true } } },
    orderBy: { startedRoundIndex: "desc" },
  });

  // Money in vs money out, at cost for the live run (the wall marks it live).
  const staked = runs.reduce((n, r) => n + toUsd(r.buyIn), 0);
  const returned = runs
    .filter((r) => r.status !== "alive")
    .reduce((n, r) => n + toUsd(r.stack), 0);
  const aliveStack = runs
    .filter((r) => r.status === "alive")
    .reduce((n, r) => n + toUsd(r.stack), 0);

  const history = runs.map((r) => ({
    id: r.id,
    status: r.status,
    buyIn: toUsd(r.buyIn),
    stack: toUsd(r.stack),
    multiple: r.finalMultiple ?? toUsd(r.stack) / toUsd(r.buyIn),
    rounds: r.roundsSurvived,
    net: (r.status === "eliminated" ? toUsd(r.stack) : toUsd(r.stack)) - toUsd(r.buyIn),
    paid: Boolean(r.depositTx),
    payoutTx: r.payoutTx?.startsWith("0x") ? r.payoutTx : null,
    // Each bell's damage or gift, oldest first: the story of the run.
    perRound: [...r.positions]
      .sort((a, b) => a.round.index - b.round.index)
      .filter((p) => p.stackAfter !== null)
      .map((p) => ({
        round: p.round.index,
        side: p.side,
        outcome: p.outcome,
        after: toUsd(p.stackAfter!),
        net: toUsd(p.stackAfter!) - toUsd(p.stackBefore),
      })),
  }));

  const alive = history.find((h) => h.status === "alive") ?? null;
  const series = alive ? [alive.buyIn, ...alive.perRound.map((p) => p.after)] : null;

  return NextResponse.json({
    name: player.displayName,
    totals: {
      staked,
      returned,
      aliveStack,
      net: returned + aliveStack - staked,
      games: runs.length,
    },
    badges: computeBadges(runs),
    runs: history,
    series,
  });
}
