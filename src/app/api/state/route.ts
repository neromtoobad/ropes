import { NextResponse } from "next/server";
import { getTableState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getTableState());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
