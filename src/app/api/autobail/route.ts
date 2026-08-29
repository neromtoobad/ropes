import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Auto-bail: set (or clear) the multiple at which this run sells itself.
 * Only a flag on the run — the executor watches the sellable mark every tick
 * and fires the normal bail path when it crosses (the one-nonce rule).
 */
export async function POST(req: Request) {
  const { runId, at } = await req.json();
  if (at !== null && (typeof at !== "number" || at < 1.05 || at > 50)) {
    return NextResponse.json({ error: "target must be between 1.05× and 50×" }, { status: 400 });
  }
  const run = await db.run.findUnique({ where: { id: runId } });
  if (!run) return NextResponse.json({ error: "no such run" }, { status: 404 });
  if (run.status !== "alive") {
    return NextResponse.json({ error: `run is ${run.status}` }, { status: 409 });
  }
  await db.run.update({ where: { id: runId }, data: { autoBailAt: at } });
  return NextResponse.json({ ok: true, autoBailAt: at });
}
