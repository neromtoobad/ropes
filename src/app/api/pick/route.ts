import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ownedRun } from "@/lib/owned";

/**
 * Choose a side. Not riding yet: the executor enters it in the open window on
 * its next tick. Already riding: the pick QUEUES for the next window, so the
 * bell rolls the stack straight in with no gap. Batched with everyone on that
 * side either way.
 *
 * A pick is only changeable until the executor fills it — after that the
 * position exists on-chain and the only way out is to bank.
 */
export async function POST(req: Request) {
  const { runId, playerKey, side } = await req.json();
  if (side !== "UP" && side !== "DOWN") {
    return NextResponse.json({ error: "side must be UP or DOWN" }, { status: 400 });
  }
  const owned = await ownedRun(runId, playerKey);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const round = await db.round.findFirst({ orderBy: { index: "desc" } });
  if (round) {
    const filled = await db.position.findUnique({
      where: { runId_roundId: { runId: owned.run.id, roundId: round.id } },
    });
    if (filled) {
      await db.run.update({
        where: { id: owned.run.id },
        data: { pendingSide: side, pickedForRound: round.index + 1 },
      });
      return NextResponse.json({ ok: true, side, queuedFor: round.index + 1 });
    }
  }

  await db.run.update({
    where: { id: owned.run.id },
    data: { pendingSide: side, pickedForRound: null },
  });
  return NextResponse.json({ ok: true, side });
}
