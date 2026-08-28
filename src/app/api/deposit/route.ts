import { NextResponse } from "next/server";
import { creditDeposit } from "@/lib/payments";
import { toUsd } from "@/lib/chain";

/** Credit a verified on-chain deposit to the player's bankroll. */
export async function POST(req: Request) {
  const { playerKey, txHash } = await req.json();
  if (!playerKey || !txHash) {
    return NextResponse.json({ error: "playerKey and txHash required" }, { status: 400 });
  }
  try {
    const r = await creditDeposit(playerKey, txHash as `0x${string}`);
    return NextResponse.json({ ok: true, credited: toUsd(r.amount) });
  } catch (err) {
    return NextResponse.json({ error: String(err).replace("Error: ", "") }, { status: 402 });
  }
}
