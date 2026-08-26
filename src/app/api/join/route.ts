import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ONE } from "@/lib/chain";

/** The fixed seat price. One number, so the table's maths stays legible. */
const BUY_IN = 10n * ONE;

export async function POST(req: Request) {
  const { playerKey, name } = await req.json();
  if (!playerKey || !name) {
    return NextResponse.json({ error: "playerKey and name required" }, { status: 400 });
  }

  const round = await db.round.findFirst({ orderBy: { index: "desc" } });
  const roundIndex = round?.index ?? 0;

  const player = await db.player.upsert({
    where: { wallet: playerKey },
    create: { wallet: playerKey, displayName: String(name).slice(0, 12) },
    update: { displayName: String(name).slice(0, 12) },
  });

  // Banking ends a run and costs you the next round — you cannot immediately
  // re-buy your way back to the table.
  if (roundIndex < player.eligibleFromRoundIndex) {
    return NextResponse.json(
      { error: `sitting out until round ${player.eligibleFromRoundIndex}` },
      { status: 409 },
    );
  }
  const existing = await db.run.findFirst({ where: { playerId: player.id, status: "alive" } });
  if (existing) return NextResponse.json({ runId: existing.id });

  const run = await db.run.create({
    data: { playerId: player.id, buyIn: BUY_IN, stack: BUY_IN, startedRoundIndex: roundIndex },
  });
  return NextResponse.json({ runId: run.id });
}
