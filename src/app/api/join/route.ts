import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { joinGame } from "@/executor/game";
import { creditDeposit } from "@/lib/payments";
import { SEAT_PRICE } from "@/executor/tables";

/**
 * Buy a seat. One join path, ever (via joinGame).
 *
 * Three ways in:
 * - bankroll (default when the balance covers a seat): debit and sit. No
 *   wallet popup — winnings already credited the balance, so a winner rolls
 *   into the next seat with one click.
 * - depositTx: a fresh on-chain deposit — credit the bankroll first, then
 *   sit from it. The withdrawal address derives from the transfer's sender.
 * - free: no balance, no tx — house-bankroll play, unchanged.
 *
 * This route never sends a transaction (one-nonce rule).
 */
export async function POST(req: Request) {
  const { playerKey, name, depositTx } = await req.json();
  if (!playerKey || !name) {
    return NextResponse.json({ error: "playerKey and name required" }, { status: 400 });
  }

  if (depositTx) {
    try {
      await creditDeposit(playerKey, depositTx as `0x${string}`);
    } catch (err) {
      return NextResponse.json({ error: String(err).replace("Error: ", "") }, { status: 402 });
    }
  }

  const player = await db.player.findUnique({ where: { wallet: playerKey } });
  const funded = Boolean(player && player.address && player.balance >= SEAT_PRICE);

  const round = await db.round.findFirst({ orderBy: { index: "desc" } });
  try {
    const run = await joinGame(
      playerKey,
      String(name).slice(0, 12),
      0n,
      round?.index ?? 0,
      undefined,
      funded,
    );
    return NextResponse.json({ runId: run.id, paid: funded });
  } catch (err) {
    const message = String(err).replace("Error: ", "");
    // "already has a live run" should hand back the existing seat, not an error.
    if (message.includes("already has a live run")) {
      const p = await db.player.findUnique({ where: { wallet: playerKey } });
      const existing = p
        ? await db.run.findFirst({ where: { playerId: p.id, status: "alive" } })
        : null;
      if (existing) return NextResponse.json({ runId: existing.id });
    }
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
