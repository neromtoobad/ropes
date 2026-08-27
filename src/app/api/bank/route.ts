import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * BAIL. This route only raises a flag: orders go through the executor's single
 * wallet nonce, so the sale and the banking happen on its next tick (~1s). The
 * client plays the leap immediately; the money follows right behind it.
 */
export async function POST(req: Request) {
  const { runId } = await req.json();
  const run = await db.run.findUnique({ where: { id: runId } });
  if (!run) return NextResponse.json({ error: "no such run" }, { status: 404 });
  if (run.status !== "alive") {
    return NextResponse.json({ error: `run is ${run.status}` }, { status: 409 });
  }
  await db.run.update({ where: { id: runId }, data: { bailRequested: true } });
  return NextResponse.json({ ok: true, pending: true });
}
