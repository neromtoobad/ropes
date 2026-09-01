import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ownedRun } from "@/lib/owned";

/**
 * Autoplay: keep calling the same side every round without touching the screen.
 *
 * The executor already falls back to `autoPick` when there is no explicit pick,
 * so this only ever sets that field — no new path through the game loop.
 */
export async function POST(req: Request) {
  const { runId, playerKey, on, side } = await req.json();
  if (on && side !== "UP" && side !== "DOWN") {
    return NextResponse.json({ error: "pick a side first" }, { status: 400 });
  }
  const owned = await ownedRun(runId, playerKey);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });
  await db.run.update({ where: { id: owned.run.id }, data: { autoPick: on ? side : null } });
  return NextResponse.json({ ok: true, autoPick: on ? side : null });
}
