import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const ex = new SomniaMarkets({
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
});

log("listLiveBinaryMarkets...");
const live = await ex.client.listLiveBinaryMarkets({ limit: 100 });
log(`got ${live.length}`);

const byCadence = new Map<string, number>();
for (const m of live) {
  const k = `${m.asset} ${Number(m.intervalSec) / 60}m`;
  byCadence.set(k, (byCadence.get(k) ?? 0) + 1);
}
log("cadences:", Object.fromEntries(byCadence));

const btc = live
  .filter((m) => m.asset === "BTC")
  .sort((a, b) => Number(a.intervalSec) - Number(b.intervalSec))[0];
if (!btc) { log("no BTC market"); process.exit(0); }

log("market:", {
  marketId: btc.marketId,
  interval: Number(btc.intervalSec) / 60 + "m",
  expiry: new Date(Number(btc.expiry) * 1000).toISOString(),
  tradeCount: btc.tradeCount,
  outcomes: btc.outcomes?.map((o: any) => o.symbol),
});

log("getMarketOnchain...");
const oc = await ex.client.getMarketOnchain(btc.marketId as `0x${string}`);
log("status:", oc.status, "pool:", oc.pool);

log("getBinaryBookParams...");
const p = await ex.client.getBinaryBookParams(oc.pool);
log("grid:", { tick: p.tickSize?.toString(), lot: p.lotSize?.toString(), min: p.minQuantity?.toString() });

log("getLiveBinaryOrderBook (needs watch)...");
const watch = await ex.client.watchMarket(oc.pool);
const book = ex.client.getLiveBinaryOrderBook(oc.pool);
log("yesBids:", book.yesBids.slice(0, 3), "yesAsks:", book.yesAsks.slice(0, 3));
log("noBids:", book.noBids.slice(0, 3), "noAsks:", book.noAsks.slice(0, 3));
watch.close?.();
process.exit(0);
