import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ownedRun } from "@/lib/owned";

/**
 * Auto-bail: set (or clear) the multiple at which this run sells itself.
 * Only a flag on the run — the executor watches the sellable mark every tick
 * and fires the normal bail path when it crosses (the one-nonce rule).
 */
export async function POST(req: Request) {
  const { runId, playerKey, at } = await req.json();
  if (at !== null && (typeof at !== "number" || at < 1.05 || at > 50)) {
    return NextResponse.json({ error: "target must be between 1.05× and 50×" }, { status: 400 });
  }
  const owned = await ownedRun(runId, playerKey);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });
  await db.run.update({ where: { id: owned.run.id }, data: { autoBailAt: at } });
  return NextResponse.json({ ok: true, autoBailAt: at });
}
