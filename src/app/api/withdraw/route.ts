import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Ask for the whole bankroll back on-chain. Flag only — the executor sends
 * it on its next tick (one-nonce rule) to the address pinned at first
 * deposit.
 */
export async function POST(req: Request) {
  const { playerKey } = await req.json();
  if (!playerKey) return NextResponse.json({ error: "playerKey required" }, { status: 400 });

  const player = await db.player.findUnique({ where: { wallet: playerKey } });
  if (!player) return NextResponse.json({ error: "no such player" }, { status: 404 });
  if (!player.address) {
    return NextResponse.json({ error: "no withdrawal address — deposit first" }, { status: 409 });
  }
  if (player.balance <= 0n) {
    return NextResponse.json({ error: "nothing to withdraw" }, { status: 409 });
  }
  await db.player.update({ where: { id: player.id }, data: { withdrawRequested: true } });
  return NextResponse.json({ ok: true, pending: true });
}
