import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
const ex = new SomniaMarkets({
  indexerUrl: process.env.INDEXER_URL!, chain: somniaShannon,
  wsRpcUrl: process.env.WS_RPC_URL!, addresses: SOMNIA_TESTNET_ADDRESSES,
});
const live = await ex.client.listLiveBinaryMarkets({ limit: 20 });
const m = live.find((x: any) => x.asset === "BTC")!;
const oc: any = await ex.client.getMarketOnchain(m.marketId as `0x${string}`);
console.log("getMarketOnchain keys:", Object.keys(oc));
console.log(JSON.stringify(oc, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log("\nindexer row keys:", Object.keys(m));
process.exit(0);
