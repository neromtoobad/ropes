import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Autoplay: keep calling the same side every round without touching the screen.
 *
 * The executor already falls back to `autoPick` when there is no explicit pick,
 * so this only ever sets that field — no new path through the game loop.
 */
export async function POST(req: Request) {
  const { runId, on, side } = await req.json();
  if (on && side !== "UP" && side !== "DOWN") {
    return NextResponse.json({ error: "pick a side first" }, { status: 400 });
  }
  const run = await db.run.findUnique({ where: { id: runId } });
  if (!run) return NextResponse.json({ error: "no such run" }, { status: 404 });
  if (run.status !== "alive") {
    return NextResponse.json({ error: `run is ${run.status}` }, { status: 409 });
  }
  await db.run.update({ where: { id: runId }, data: { autoPick: on ? side : null } });
  return NextResponse.json({ ok: true, autoPick: on ? side : null });
}
