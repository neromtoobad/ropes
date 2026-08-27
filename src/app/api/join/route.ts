import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { joinGame } from "@/executor/game";
import { verifyDeposit } from "@/lib/payments";
import { SEAT_PRICE } from "@/executor/tables";

/**
 * Buy a seat.
 *
 * Delegates to the same joinGame the executor's seed path uses — this route
 * used to create runs itself and silently skipped the tables refactor, so a
 * human joining through the UI got a run with no table, invisible on the wall,
 * paying no pot cut. One join path, ever.
 *
 * Two ways in:
 * - walletless (no depositTx): free play on the house bankroll, as ever.
 * - paid (depositTx): the tx must be a real 10 tUSDC transfer to the house.
 *   The payout address is DERIVED from the transfer's `from` — the browser's
 *   word is never trusted, so claiming someone else's deposit pays them.
 *
 * This route never sends a transaction. The house wallet has one nonce and
 * the executor owns it; deposits are incoming and payouts happen in the tick.
 */
export async function POST(req: Request) {
  const { playerKey, name, depositTx } = await req.json();
  if (!playerKey || !name) {
    return NextResponse.json({ error: "playerKey and name required" }, { status: 400 });
  }

  let paid: { payoutAddress: string; depositTx: string } | undefined;
  if (depositTx) {
    try {
      const d = await verifyDeposit(depositTx as `0x${string}`, SEAT_PRICE);
      paid = { payoutAddress: d.from, depositTx };
    } catch (err) {
      return NextResponse.json({ error: String(err).replace("Error: ", "") }, { status: 402 });
    }
  }

  const round = await db.round.findFirst({ orderBy: { index: "desc" } });
  try {
    const run = await joinGame(
      playerKey,
      String(name).slice(0, 12),
      0n,
      round?.index ?? 0,
      undefined,
      paid,
    );
    return NextResponse.json({ runId: run.id, paid: Boolean(paid) });
  } catch (err) {
    const message = String(err).replace("Error: ", "");
    // "already has a live run" should hand back the existing seat, not an error.
    if (message.includes("already has a live run")) {
      const player = await db.player.findUnique({ where: { wallet: playerKey } });
      const existing = player
        ? await db.run.findFirst({ where: { playerId: player.id, status: "alive" } })
        : null;
      if (existing) return NextResponse.json({ runId: existing.id });
    }
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
