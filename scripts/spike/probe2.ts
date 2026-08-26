import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const ex = new SomniaMarkets({
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
});
const S = 1e6; // testnet collateral: 6 decimals

const live = await ex.client.listLiveBinaryMarkets({ limit: 100 });
for (const m of live.sort((a: any, b: any) => Number(a.intervalSec) - Number(b.intervalSec))) {
  const oc = await ex.client.getMarketOnchain(m.marketId as `0x${string}`);
  const book = oc.status === 1 ? (await ex.client.watchMarket(oc.pool), ex.client.getLiveBinaryOrderBook(oc.pool)) : null;
  const bid = book?.yesBids[0], ask = book?.yesAsks[0];
  const secsLeft = Math.round(Number(m.expiry) - Date.now() / 1000);
  console.log(
    `${m.asset.padEnd(4)} ${(Number(m.intervalSec) / 60 + "m").padEnd(5)}`,
    `status=${oc.status}`,
    `left=${String(secsLeft).padStart(5)}s`,
    `trades=${String(m.tradeCount).padStart(4)}`,
    `bid=${bid ? (Number(bid.price) / S).toFixed(3) : "  -  "}`,
    `ask=${ask ? (Number(ask.price) / S).toFixed(3) : "  -  "}`,
    `depth=${bid ? (Number(bid.quantity) / S).toFixed(0) : "0"}`,
  );
}

// How many 1m markets have actually settled and traded?
const past = await ex.client.listPastBinaryMarkets({ status: "Finalized", asset: "BTC", limit: 50 });
const oneMin = past.filter((m: any) => Number(m.intervalSec) === 60);
console.log(`\npast BTC markets: ${past.length}, of which 1m: ${oneMin.length}`);
console.log("recent 1m settled:", oneMin.slice(0, 5).map((m: any) => ({
  expiry: new Date(Number(m.expiry) * 1000).toISOString().slice(11, 19),
  trades: m.tradeCount,
  vol: (Number(m.cumulativeQuoteVolume) / S).toFixed(1),
})));
process.exit(0);
