/**
 * Placing and redeeming. Every gotcha we hit in the spike lives here so the
 * game logic never has to think about them.
 */
import { exchange, ONE, snap, HOUSE, houseCollateral } from "./chain.js";
import { outcomeBalance, type LiveMarket, type Onchain } from "./market.js";

/** IOC. The unfilled remainder never rests on the book behind our back. */
const ORDER_TYPE_MARKET = 1;

/** How far through the touch we're willing to cross, in ticks. */
const CROSS_TICKS = 20n;

export type Side = "UP" | "DOWN";

export interface Fill {
  contracts: bigint;
  cost: bigint;
  /** Effective price actually paid per contract, raw. 0 when nothing filled. */
  priceRaw: bigint;
  tx?: string;
}

/**
 * Spend `budget` of collateral on `side` of `market`, crossing the touch.
 *
 * Sizing: quantity = budget / price, so a winning position redeems at
 * budget/price — the 1/p growth the whole game is built on.
 *
 * Returns a zero fill rather than throwing when the book cannot serve us; the
 * caller decides whether that eliminates a player or sits them out.
 */
export async function buy(
  market: LiveMarket,
  side: Side,
  budget: bigint,
  collateralBefore: bigint,
  outcomeBefore: bigint,
): Promise<Fill> {
  // Re-read the book RIGHT NOW. The snapshot taken when the round opened is
  // stale by the time we send — on a 1m market that mispriced sizing badly
  // enough that players under-deployed their whole stack.
  const live = exchange.client.getLiveBinaryOrderBook(market.pool);
  const yesTouch = side === "UP" ? live.yesAsks[0]?.price : live.yesBids[0]?.price;
  if (yesTouch === undefined) return { contracts: 0n, cost: 0n, priceRaw: 0n };

  // Price we expect to pay, in that side's own terms.
  const sidePrice = side === "UP" ? yesTouch : ONE - yesTouch;
  if (sidePrice <= 0n || sidePrice >= ONE) return { contracts: 0n, cost: 0n, priceRaw: 0n };

  // Limit, expressed in YES terms either way. Crossing further for UP means a
  // higher YES price; for DOWN it means a lower one.
  const raw = side === "UP" ? yesTouch + CROSS_TICKS * market.tick : yesTouch - CROSS_TICKS * market.tick;
  const bounded = raw < market.tick ? market.tick : raw > ONE - market.tick ? ONE - market.tick : raw;
  const limit = snap(bounded, market.tick);

  // Size so the whole budget is deployed at the expected price.
  const quantity = snap((budget * ONE) / sidePrice, market.lot);
  if (quantity === 0n) return { contracts: 0n, cost: 0n, priceRaw: 0n };

  const res = await exchange.trader.placeOrder({
    pool: market.pool,
    side: side === "UP" ? "BUY_YES" : "BUY_NO",
    price: limit,
    quantity,
    orderType: ORDER_TYPE_MARKET,
    // expireTimestampNs omitted on purpose: the SDK defaults it to the pool's
    // market expiry, which is what a one-shot order wants.
  });
  if (res.receipt?.status === "reverted") {
    return { contracts: 0n, cost: 0n, priceRaw: 0n, tx: res.receipt?.transactionHash };
  }

  // Truth is the chain, not what we asked for. Measure the delta.
  const outcomeAfter = await outcomeBalance(market.onchain, HOUSE, side === "UP" ? 0 : 1);
  const collateralAfter = await houseCollateral();

  const contracts = outcomeAfter - outcomeBefore;
  const cost = collateralBefore - collateralAfter;
  const priceRaw = contracts > 0n ? (cost * ONE) / contracts : 0n;

  return { contracts, cost, priceRaw, tx: res.receipt?.transactionHash };
}

/**
 * Redeem every winning contract the house holds in a settled market, in ONE
 * transaction. Attribution back to individual runs is the ledger's job.
 *
 * A voided market pays both sides 0.5 and has no winner to infer, so both
 * outcomes are claimed explicitly.
 */
export async function redeemAll(
  marketId: `0x${string}`,
  oc: Onchain,
  voided: boolean,
  winningOutcome: 0 | 1 | null,
): Promise<{ redeemed: bigint; txs: string[] }> {
  const claim: (0 | 1)[] = voided ? [0, 1] : winningOutcome === null ? [] : [winningOutcome];
  const txs: string[] = [];
  const before = await houseCollateral();

  for (const outcomeIdx of claim) {
    const amount = await outcomeBalance(oc, HOUSE, outcomeIdx);
    // Redeeming a losing position succeeds and pays nothing — skip on 0 rather
    // than spending gas to learn that.
    if (amount === 0n) continue;
    const res = await exchange.trader.redeem({
      marketId,
      market: oc.marketAddress,
      outcomeToken: oc.outcomeToken,
      outcomeIdx,
      amount,
    });
    if (res.receipt?.status === "reverted") throw new Error(`redeem reverted for outcome ${outcomeIdx}`);
    if (res.receipt?.transactionHash) txs.push(res.receipt.transactionHash);
  }

  const after = await houseCollateral();
  return { redeemed: after - before, txs };
}
