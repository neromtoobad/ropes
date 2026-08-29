import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toUsd } from "@/lib/chain";
import { computeBadges } from "@/lib/badges";

/**
 * Everyone who has ever sat down, ranked by lifetime net gain. Reads the same
 * ledger the executor writes — there is no separate "leaderboard backend",
 * the game's accounting IS the backend.
 */
export async function GET() {
  const players = await db.player.findMany({
    include: {
      runs: { include: { positions: { include: { round: true } } } },
    },
  });

  const rows = players
    .filter((p) => p.runs.length > 0)
    .map((p) => {
      const staked = p.runs.reduce((n, r) => n + toUsd(r.buyIn), 0);
      const back = p.runs.reduce((n, r) => n + toUsd(r.stack), 0); // alive at cost
      const best = Math.max(
        0,
        ...p.runs.map((r) => r.finalMultiple ?? toUsd(r.stack) / toUsd(r.buyIn)),
      );
      const longest = Math.max(0, ...p.runs.map((r) => r.roundsSurvived));
      return {
        // The db id, NOT p.wallet — the wallet field is the playerKey, which
        // acts as the player's credential and must never leave the server.
        id: p.id,
        name: p.displayName,
        games: p.runs.length,
        net: back - staked,
        best,
        longest,
        badges: computeBadges(p.runs).map((b) => b.icon),
        alive: p.runs.some((r) => r.status === "alive"),
      };
    })
    .sort((a, b) => b.net - a.net);

  return NextResponse.json({ rows });
}
