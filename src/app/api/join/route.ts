import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { joinGame } from "@/executor/game";

/**
 * Buy a seat.
 *
 * Delegates to the same joinGame the executor's seed path uses — this route
 * used to create runs itself and silently skipped the tables refactor, so a
 * human joining through the UI got a run with no table, invisible on the wall,
 * paying no pot cut. One join path, ever.
 */
export async function POST(req: Request) {
  const { playerKey, name } = await req.json();
  if (!playerKey || !name) {
    return NextResponse.json({ error: "playerKey and name required" }, { status: 400 });
  }

  const round = await db.round.findFirst({ orderBy: { index: "desc" } });
  try {
    const run = await joinGame(playerKey, String(name).slice(0, 12), 0n, round?.index ?? 0);
    return NextResponse.json({ runId: run.id });
  } catch (err) {
    const message = String(err).replace("Error: ", "");
    // "already has a live run" should hand back the existing seat, not an error.
    if (message.includes("already has a live run")) {
      const player = await db.player.findUnique({ where: { wallet: playerKey } });
      const existing = player
        ? await db.run.findFirst({ where: { playerId: player.id, status: "alive" } })
        : null;
      if (existing) return NextResponse.json({ runId: existing.id });
    }
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
