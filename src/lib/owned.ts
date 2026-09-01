import { db } from "./db";

/**
 * A run belongs to exactly one player key, and only that key may act on it.
 *
 * Run ids are PUBLIC — every seat's id is in /api/state so the wall can be
 * drawn — so a route that accepts a bare runId lets anyone bail, flip, or
 * auto-bail anyone else's live run. Every mutating route resolves the run
 * through here instead.
 */
export async function ownedRun(runId: unknown, playerKey: unknown) {
  if (typeof runId !== "string" || typeof playerKey !== "string" || !runId || !playerKey) {
    return { error: "runId and playerKey required", status: 400 as const };
  }
  const run = await db.run.findUnique({ where: { id: runId }, include: { player: true } });
  if (!run) return { error: "no such run", status: 404 as const };
  if (run.player.wallet !== playerKey) return { error: "not your run", status: 403 as const };
  if (run.status !== "alive") return { error: `run is ${run.status}`, status: 409 as const };
  return { run };
}
