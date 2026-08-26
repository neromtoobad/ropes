/**
 * LAST CANDLE — day-0 spike.
 *
 * Proves the one loop the whole game sits on:
 *   buy -> settle -> redeem
 *
 * and measures the number that decides how short a round can be:
 *   how many seconds from settlement to redeemed-and-ready-to-re-enter.
 *
 * Throwaway. No abstractions on purpose.
 *   npx tsx scripts/spike/loop.ts [cadenceMinutes]
 */
import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi } from "viem";

// Testnet collateral is tUSDC at 6 decimals. Mainnet USDso is 18. Never a constant.
const DECIMALS = 6;
const ONE = 10n ** BigInt(DECIMALS);
const TICK = 1000n; // read from the pool below; this is the fallback
const CADENCE_MIN = Number(process.argv[2] ?? 5);
const STAKE_CONTRACTS = 2; // small — we only need a fill, not a position

const t0 = Date.now();
const log = (...a: unknown[]) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const usd = (raw: bigint) => (Number(raw) / Number(ONE)).toFixed(4);
const prob = (raw: bigint) => (Number(raw) / Number(ONE)).toFixed(3);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COLLATERAL = SOMNIA_TESTNET_ADDRESSES.collateral! as `0x${string}`;

const pk = process.env.PRIVATE_KEY;
if (!pk || pk === "0x") throw new Error("set PRIVATE_KEY in .env");
const me = privateKeyToAccount(pk as `0x${string}`).address;

const ex = new SomniaMarkets({
  indexerUrl: process.env.INDEXER_URL!,
  chain: somniaShannon,
  wsRpcUrl: process.env.WS_RPC_URL!,
  addresses: SOMNIA_TESTNET_ADDRESSES,
  privateKey: pk as `0x${string}`,
});

const bal = () =>
  ex.client.getViemClient().readContract({
    address: COLLATERAL,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [me],
  }) as Promise<bigint>;

// ---------------------------------------------------------------- 1. funding
log("wallet", me);
const gas = await ex.client.getViemClient().getBalance({ address: me });
log("STT (gas):", (Number(gas) / 1e18).toFixed(4));
if (gas === 0n) {
  console.error("\n  NO GAS. Fund this address with testnet STT, then re-run:\n  " + me + "\n");
  process.exit(1);
}

let collateral = await bal();
log("tUSDC:", usd(collateral));
if (collateral < 100n * ONE) {
  log("minting from faucet (10,000 tUSDC cap)...");
  const f = await ex.trader.faucet();
  log("  faucet tx", f.receipt?.transactionHash, f.receipt?.status);
  collateral = await bal();
  log("tUSDC now:", usd(collateral));
}

// ------------------------------------------------- 2. pick a tradeable market
// Prefer a market where YES is the favourite, so redeem shows a real payout
// rather than a successful zero.
log(`\nlooking for a BTC ${CADENCE_MIN}m market...`);
let chosen: { row: any; oc: any; ask: bigint; pool: `0x${string}` } | null = null;

for (let attempt = 0; attempt < 20 && !chosen; attempt++) {
  const live = await ex.client.listLiveBinaryMarkets({ limit: 100 });
  const rows = live.filter(
    (m: any) => m.asset === "BTC" && Number(m.intervalSec) === CADENCE_MIN * 60,
  );
  for (const row of rows) {
    // GOTCHA 1: the indexer lags. Gate every write on the on-chain status.
    const oc = await ex.client.getMarketOnchain(row.marketId as `0x${string}`);
    if (oc.status !== 1) continue;

    const secsLeft = Number(row.expiry) - Date.now() / 1000;
    // Need enough runway to place an order before the window locks.
    if (secsLeft < Math.min(20, CADENCE_MIN * 12)) continue;

    await ex.client.watchMarket(oc.pool);
    const book = ex.client.getLiveBinaryOrderBook(oc.pool);
    const ask = book.yesAsks[0]?.price;
    const bid = book.yesBids[0]?.price;
    log(
      `  candidate left=${secsLeft.toFixed(0)}s`,
      `yesBid=${bid ? prob(bid) : "-"} yesAsk=${ask ? prob(ask) : "-"}`,
    );
    if (!ask) continue;
    chosen = { row, oc, ask, pool: oc.pool };
    break;
  }
  if (!chosen) {
    log("  none tradeable yet, waiting for the next window...");
    await sleep(5000);
  }
}
if (!chosen) throw new Error("no tradeable market found");

const { row, oc, ask, pool } = chosen;
const marketId = row.marketId as `0x${string}`;
log("\nMARKET", {
  marketId,
  cadence: Number(row.intervalSec) / 60 + "m",
  expiry: new Date(Number(row.expiry) * 1000).toISOString(),
  pool,
});

const grid = await ex.client.getBinaryBookParams(pool);
const tick = grid.tickSize ?? TICK;
const lot = grid.lotSize ?? TICK;
log("grid", { tick: tick.toString(), lot: lot.toString() });

// ------------------------------------------------------------- 3. buy YES
// Cross the touch with a buffer, IOC so nothing rests behind our back.
const snap = (v: bigint, step: bigint) => (v / step) * step;
const price = snap(ask + 20n * tick > ONE - tick ? ONE - tick : ask + 20n * tick, tick);
const quantity = snap(BigInt(STAKE_CONTRACTS) * ONE, lot);
if (quantity === 0n) throw new Error("size floored to zero by the lot grid");

log(`\nBUY_YES ${STAKE_CONTRACTS} contracts @ limit ${prob(price)} (ask ${prob(ask)}) IOC`);
const before = await bal();

const order = await ex.trader.placeOrder({
  pool,
  side: "BUY_YES",
  price,
  quantity,
  orderType: 1, // MARKET / IOC — remainder never rests
  // expireTimestampNs omitted: the SDK defaults it to the pool's market expiry,
  // which is exactly what a one-shot order wants.
});
log("  tx", order.receipt?.transactionHash, order.receipt?.status);
if (order.receipt?.status === "reverted") throw new Error("order reverted on-chain");

// GOTCHA: read the position from chain, not from what we asked for.
const held = await ex.client.getOutcomeBalance({ outcomeToken: oc.outcomeToken, account: me, id: oc.yesId });
const after = await bal();
log("  filled:", usd(held), "YES contracts, cost", usd(before - after), "tUSDC");
if (held === 0n) throw new Error("no fill — nothing to redeem, spike inconclusive");

// -------------------------------------------------------- 4. wait for settle
const expiryMs = Number(row.expiry) * 1000;
log(`\nwaiting for settlement (expiry in ${((expiryMs - Date.now()) / 1000).toFixed(0)}s)...`);
let settledAt = 0;
for (let i = 0; i < 600; i++) {
  const s = await ex.client.getMarketOnchain(marketId);
  if (s.isResolved || s.isVoided) {
    settledAt = Date.now();
    log(`  SETTLED  resolved=${s.isResolved} voided=${s.isVoided} winner=${s.winningOutcome}`);
    log(`  settlement landed ${((settledAt - expiryMs) / 1000).toFixed(1)}s after expiry`);
    break;
  }
  await sleep(1000);
}
if (!settledAt) throw new Error("never settled");

// ------------------------------------------------------------- 5. redeem
// GOTCHA: loadMarkets() will NOT show a settled market. The binary tier will,
// under the terminal status "Finalized".
const finalized = await ex.client.listBinaryMarkets({ status: "Finalized", limit: 120 });
const found = finalized.some((m: any) => m.marketId === marketId);
log(`\nfound in listBinaryMarkets({status:"Finalized"})? ${found}`);

const oc2 = await ex.client.getMarketOnchain(marketId);
// Voided pays BOTH sides 0.5 and has no winner to infer.
const toClaim: (0 | 1)[] = oc2.isVoided ? [0, 1] : [oc2.winningOutcome === 0 ? 0 : 1];
const balBefore = await bal();

for (const outcomeIdx of toClaim) {
  const id = outcomeIdx === 0 ? oc2.yesId : oc2.noId;
  const amount = await ex.client.getOutcomeBalance({ outcomeToken: oc2.outcomeToken, account: me, id });
  if (amount === 0n) { log(`  outcome ${outcomeIdx}: nothing held, skip`); continue; }
  log(`  redeeming ${usd(amount)} of outcome ${outcomeIdx}...`);
  const r = await ex.trader.redeem({
    marketId,
    market: oc2.marketAddress,
    outcomeToken: oc2.outcomeToken,
    outcomeIdx,
    amount,
  });
  log("  tx", r.receipt?.transactionHash, r.receipt?.status);
  if (r.receipt?.status === "reverted") throw new Error("redeem reverted");
}

const balAfter = await bal();
const redeemedAt = Date.now();

// ---------------------------------------------------------------- 6. verdict
const rollSecs = (redeemedAt - settledAt) / 1000;
console.log(`
=========================== SPIKE RESULT ===========================
  wallet          ${me}
  market          BTC ${Number(row.intervalSec) / 60}m  ${marketId}
  bought          ${usd(held)} YES @ ~${prob(ask)}
  paid            ${usd(before - after)} tUSDC
  redeemed        ${usd(balAfter - balBefore)} tUSDC
  net             ${usd(balAfter - before)} tUSDC

  settle -> redeemed    ${rollSecs.toFixed(1)}s     <-- the round-length gate
  verdict               ${rollSecs < 25 ? "1m ROUNDS VIABLE" : rollSecs < 90 ? "5m rounds — 1m too tight" : "15m rounds"}
====================================================================
`);
process.exit(0);
