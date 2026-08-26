/**
 * Placing and redeeming. Every gotcha we hit in the spike lives here so the
 * game logic never has to think about them.
 */
import { exchange, ONE, snap, HOUSE, houseCollateral } from "./chain.js";
import { outcomeBalance, type LiveMarket, type Onchain } from "./market.js";

/**
 * 2 = ImmediateOrCancel. Fills what crosses now, cancels the rest.
 *
 * NOT 1 — that is FillOrKill, which reverts the whole order when the book
 * cannot serve the full size. The day-0 spike used 1 and got away with it only
 * because a 2-contract order always fills; the first batched order reverted
 * eight times in a row with FillOrKillNotFillable(), paying gas each time.
 */
const ORDER_TYPE_MARKET = 2;

/**
 * Refuse to enter above this probability. At 0.99 a player risks their whole
 * stack for a 1% gain — strictly bad, and it happens often on a 1m window that
 * has already made its mind up. Sitting the round out preserves the stack.
 */
const MAX_ENTRY_PRICE_PCT = 90n;

/** How far through the touch we're willing to cross, in ticks. */
const CROSS_TICKS = 20n;

export type Side = "UP" | "DOWN";

export interface Fill {
  contracts: bigint;
  cost: bigint;
  /** Effective price actually paid per contract, raw. 0 when nothing filled. */
  priceRaw: bigint;
  tx?: string;
  /** Set when we declined the entry because the side was above the price cap. */
  tooExpensive?: boolean;
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
): Promise<Fill> {
  const outcomeIdx = side === "UP" ? 0 : 1;
  const collateralStart = await houseCollateral();
  const outcomeStart = await outcomeBalance(market.onchain, HOUSE, outcomeIdx);

  let remaining = budget;
  let lastTx: string | undefined;
  let tooExpensive = false;
  let lastPrice = 0n;

  // Two passes. The book moves between our read and the fill — often in our
  // favour on a 1m window — so a single order sized at the touch can leave 20%
  // of the budget undeployed. The top-up spends what the first pass did not.
  for (let pass = 0; pass < 2 && remaining > 0n; pass++) {
    // Read the book RIGHT NOW; the snapshot from round open is already stale.
    const live = exchange.client.getLiveBinaryOrderBook(market.pool);
    const yesTouch = side === "UP" ? live.yesAsks[0]?.price : live.yesBids[0]?.price;
    if (yesTouch === undefined) break;

    const sidePrice = side === "UP" ? yesTouch : ONE - yesTouch;
    if (sidePrice <= 0n || sidePrice >= ONE) break;
    lastPrice = sidePrice;
    if (sidePrice * 100n > ONE * MAX_ENTRY_PRICE_PCT) { tooExpensive = true; break; }

    // Limit is always in YES terms. Crossing further means a higher YES price
    // for UP and a lower one for DOWN.
    const raw = side === "UP"
      ? yesTouch + CROSS_TICKS * market.tick
      : yesTouch - CROSS_TICKS * market.tick;
    const bounded = raw < market.tick ? market.tick
      : raw > ONE - market.tick ? ONE - market.tick : raw;
    const limit = snap(bounded, market.tick);

    const quantity = snap((remaining * ONE) / sidePrice, market.lot);
    if (quantity === 0n) break;

    let res;
    try {
      res = await exchange.trader.placeOrder({
        pool: market.pool,
        side: side === "UP" ? "BUY_YES" : "BUY_NO",
        price: limit,
        quantity,
        orderType: ORDER_TYPE_MARKET,
        // expireTimestampNs omitted: the SDK defaults it to the pool's market
        // expiry, which is what a one-shot order wants.
      });
    } catch (err) {
      // The quote we read was gone by the time we landed. On a quoting loop
      // this is a normal event, not a fault — same class as PostOnlyWouldCross.
      if (String(err).includes("ImmediateOrCancelNoFill")) break;
      throw err;
    }
    if (res.receipt?.status === "reverted") break;
    lastTx = res.receipt?.transactionHash ?? lastTx;

    const spentSoFar = collateralStart - (await houseCollateral());
    const justSpent = budget - remaining >= 0n ? spentSoFar - (budget - remaining) : spentSoFar;
    remaining = budget - spentSoFar;
    // Nothing moved — the book could not serve us; a third try will not help.
    if (justSpent <= 0n) break;
  }

  // Truth is the chain, not what we asked for.
  const contracts = (await outcomeBalance(market.onchain, HOUSE, outcomeIdx)) - outcomeStart;
  const cost = collateralStart - (await houseCollateral());
  const priceRaw = contracts > 0n ? (cost * ONE) / contracts : lastPrice;

  return { contracts, cost, priceRaw, tx: lastTx, tooExpensive: tooExpensive && contracts === 0n };
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
