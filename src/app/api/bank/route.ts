import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bank } from "@/executor/game";

export async function POST(req: Request) {
  const { runId } = await req.json();
  const round = await db.round.findFirst({ orderBy: { index: "desc" } });
  try {
    const multiple = await bank(runId, round?.index ?? 0);
    return NextResponse.json({ ok: true, multiple });
  } catch (err) {
    return NextResponse.json({ error: String(err).replace("Error: ", "") }, { status: 409 });
  }
}
