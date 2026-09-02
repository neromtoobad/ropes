import { createServer } from "node:http";

/**
 * A liveness endpoint, so the executor can live on a free web-service tier.
 *
 * Render's free plan runs one web service and spins it down after 15 minutes
 * without inbound traffic. A background worker — the natural shape for this
 * loop — costs $7/mo. So the loop answers HTTP: an external pinger keeps it
 * awake for free, and the answer is HONEST — it reports the last completed
 * tick and returns 503 once that goes stale, so a monitor sees a wedged loop
 * as down rather than as a cheerful 200 from a process that stopped playing.
 *
 * Only starts when PORT is set (Render sets it). Locally, nothing changes.
 */
const STALE_MS = 120_000;

export function startHealthServer(lastTick: () => number) {
  const port = Number(process.env.PORT);
  if (!port) return null;
  const server = createServer((req, res) => {
    const age = Date.now() - lastTick();
    const ok = age < STALE_MS;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok, lastTickAgoMs: age, path: req.url }));
  });
  server.listen(port, () => console.log(`health on :${port}`));
  return server;
}
