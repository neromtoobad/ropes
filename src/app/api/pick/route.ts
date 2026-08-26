import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Choose a side for the live round. The executor picks this up on its next tick
 * and batches it with everyone else on that side.
 *
 * A pick is only changeable until the executor fills it — after that the
 * position exists on-chain and the only way out is to bank.
 */
export async function POST(req: Request) {
  const { runId, side } = await req.json();
  if (side !== "UP" && side !== "DOWN") {
    return NextResponse.json({ error: "side must be UP or DOWN" }, { status: 400 });
  }
  const run = await db.run.findUnique({ where: { id: runId } });
  if (!run) return NextResponse.json({ error: "no such run" }, { status: 404 });
  if (run.status !== "alive") {
    return NextResponse.json({ error: `run is ${run.status}` }, { status: 409 });
  }

  const round = await db.round.findFirst({ orderBy: { index: "desc" } });
  if (round) {
    const filled = await db.position.findUnique({
      where: { runId_roundId: { runId, roundId: round.id } },
    });
    if (filled) return NextResponse.json({ error: "already in this round" }, { status: 409 });
  }

  await db.run.update({ where: { id: runId }, data: { pendingSide: side } });
  return NextResponse.json({ ok: true, side });
}
