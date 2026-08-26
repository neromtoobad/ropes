/**
 * Finding and reading the current round's market.
 *
 * Two rules from the gotchas doc that this module exists to enforce:
 *   1. Gate every write on the ON-CHAIN status, never the indexer's (it lags).
 *   2. Key everything by marketId. Pools are recycled between windows, so state
 *      keyed by pool address silently attaches to a market we never traded.
 */
import { exchange, ASSET, INTERVAL_SEC } from "./chain";

export type Onchain = Awaited<ReturnType<typeof exchange.client.getMarketOnchain>>;

export interface LiveMarket {
  marketId: `0x${string}`;
  pool: `0x${string}`;
  onchain: Onchain;
  expiresAt: Date;
  opensAt: Date;
  secondsLeft: number;
  /** Best resting YES ask / bid, raw units. undefined when that side is empty. */
  yesAsk?: bigint;
  yesBid?: bigint;
  tick: bigint;
  lot: bigint;
}

/** Status 1 = Trading. The only status that accepts orders. */
const TRADING = 1;

/**
 * The live window of our series, or null if none is currently tradeable.
 *
 * `minSecondsLeft` guards the lock race: a window seconds from close can lock
 * between our snapshot and our send.
 */
export async function currentMarket(minSecondsLeft = 5): Promise<LiveMarket | null> {
  const rows = await exchange.client.listLiveBinaryMarkets({ limit: 100 });
  const candidates = rows
    .filter((m: any) => m.asset === ASSET && Number(m.intervalSec) === INTERVAL_SEC)
    .sort((a: any, b: any) => Number(a.expiry) - Number(b.expiry));

  for (const row of candidates) {
    const marketId = row.marketId as `0x${string}`;
    const onchain = await exchange.client.getMarketOnchain(marketId);
    if (onchain.status !== TRADING) continue;

    const expiresAt = new Date(Number(row.expiry) * 1000);
    const secondsLeft = (expiresAt.getTime() - Date.now()) / 1000;
    if (secondsLeft < minSecondsLeft) continue;

    const pool = onchain.pool as `0x${string}`;
    const grid = await exchange.client.getBinaryBookParams(pool);

    // watchMarket hydrates the local store; getLiveBinaryOrderBook is then
    // zero-round-trip. fetchOrderBook(symbol) is NOT usable here — indexer rows
    // carry no `symbol`, and it hangs without loadMarkets().
    await exchange.client.watchMarket(pool);
    const book = exchange.client.getLiveBinaryOrderBook(pool);

    return {
      marketId,
      pool,
      onchain,
      expiresAt,
      opensAt: new Date(Number(row.tradingStart ?? Number(row.expiry) - INTERVAL_SEC) * 1000),
      secondsLeft,
      yesAsk: book.yesAsks[0]?.price,
      yesBid: book.yesBids[0]?.price,
      tick: grid.tickSize ?? 1000n,
      lot: grid.lotSize ?? 1000n,
    };
  }
  return null;
}

/** Re-read a market's settlement state. Cheap, on-chain, authoritative. */
export async function settlement(marketId: `0x${string}`) {
  const oc = await exchange.client.getMarketOnchain(marketId);
  return {
    onchain: oc,
    settled: oc.isResolved || oc.isVoided,
    voided: oc.isVoided,
    // A voided market pays BOTH sides 0.5 and has no winner to infer.
    winningOutcome: oc.isVoided ? null : (oc.winningOutcome as 0 | 1),
  };
}

/** Our position in one outcome of a market, raw units. */
export async function outcomeBalance(oc: Onchain, account: `0x${string}`, outcomeIdx: 0 | 1) {
  // NB: object argument. The recipes doc shows positional args; those throw.
  return exchange.client.getOutcomeBalance({
    outcomeToken: oc.outcomeToken,
    account,
    id: outcomeIdx === 0 ? oc.yesId : oc.noId,
  });
}
