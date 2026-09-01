import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ownedRun } from "@/lib/owned";

/**
 * BAIL. This route only raises a flag: orders go through the executor's single
 * wallet nonce, so the sale and the banking happen on its next tick (~1s). The
 * client plays the leap immediately; the money follows right behind it.
 */
export async function POST(req: Request) {
  const { runId, playerKey } = await req.json();
  const owned = await ownedRun(runId, playerKey);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });
  await db.run.update({ where: { id: owned.run.id }, data: { bailRequested: true } });
  return NextResponse.json({ ok: true, pending: true });
}
