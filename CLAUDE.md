# CLAUDE.md — LAST CANDLE

> rename to `AGENTS.md` before submitting. never commit the filename `CLAUDE.md`.

**a battle royale on bitcoin. every 15 minutes, half the players die.**

---

## what we are building

players buy a 10 USDso seat. every 15 minutes a round runs on a real dreamDEX BTC 15m event
contract. each player picks UP or DOWN; their whole stack goes in. wrong side eliminates them,
right side multiplies their stack by 1/p and rolls it straight into the next round. players can
bank out mid-round at live value. last one standing takes the biggest multiple.

the tournament is not simulated. winners take losers' money and survivors compound — that is what
already happens when a crowd repeatedly trades one market. we draw it.

## why it qualifies

somnia × dreamdex event contracts hackathon, $5,000 pool, deadline **8 sep 2026 18:00**.

➠ every round is a real event-contract trade through `@somnia-chain/markets-sdk`
➠ eliminations land on-chain via **somnia on-chain reactivity** — both sponsor products, stacked
➠ one seat fires N orders across N rounds → direct trading-activity multiplier
➠ our players fill both sides of a market whose DOWN book currently reads "no liquidity"

judging: technical 25 · innovation 20 · UX 20 · ecosystem 20 · presentation 15.

---

## spike proof — 26 aug, PASSED

full loop proven end to end on a **1-minute** BTC market, including a winning redemption.

```
MARKET      BTC 1m  0x...a393
BUY_YES     2 contracts @ ~0.871 IOC        paid      1.7360 tUSDC
SETTLED     resolved, winner = 0 (YES)      landed    0.2s after expiry
REDEEM      tx 0xd122da7260adb81096a1597f836f3aa005d3a15d8889813b3c4d7fbf79f819a3
            redeemed 2.0000 tUSDC           net      +0.2640 tUSDC

settle -> redeemed        2.7s
```

earlier 5m run, losing side, proved the other branch: redeem correctly skips a losing position
rather than reverting. buy tx `0x451b114029c7d45d7c20520a1a0328d1c23622a3112842cdce88cdc30ad70ed0`.

### what this settles

➠ **1m rounds are viable with room to spare** — 2.7s of roll inside a 60s window.
➠ **settlement is near-instant**: 0.2s and 1.2s after expiry across two runs. somnia's reactive
  oracle callback is doing exactly what the docs claim, with no keeper.
➠ players fill against the resting MM even at 0.871 — **our MM is a backstop, not critical path**.
➠ `ROUND = BTC 1m`. `8 → 4 → 2 → 1` is a three-minute battle royale.

## verified config — confirmed live 26 aug, do not re-derive

```ts
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

new SomniaMarkets({
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",   // NOT in the docs. from the bot kit
  chain: somniaShannon,                                    // 50312
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,                     // baked into the SDK
  privateKey,
});
```

mainnet indexer is `https://prd.smk.somnia.host/v1/graphql`. sdk on npm is **0.28.1**.

**collateral is tUSDC, 6 decimals**, `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`. there is no
faucet page — `exchange.trader.faucet()` mints 10,000 tUSDC to msg.sender, capped per call.
STT for gas is a separate, human faucet.

grid on testnet: `tick = lot = minQuantity = 1000` raw = **0.001** in both probability and
contracts.

### testnet cadences — the docs are wrong about this

docs say "15-minute and 1-hour windows". that is **mainnet**. testnet runs, for both BTC and ETH:

```
1m · 5m · 15m · 60m · 240m · 1440m        12 live markets at once
```

**1m markets are real and settle reliably** — 38 of the last 50 finalized BTC markets were 1m,
expiring exactly on the minute. this is why a round is 1m, not 15m: `8 → 4 → 2 → 1` is a
**three-minute** battle royale that fits in the demo video live.

### the books are NOT empty

a resting market maker quotes both sides, ~200 contracts at the touch, ~0.025 spread. observed on
1m, 15m, 60m, 240m and 1440m. **our MM is a backstop, not critical path.** most markets show
`trades = 0`, so we would be creating essentially all of the organic volume.

## tech stack

```
next 15 + react 19 + typescript      app router
tailwind + shadcn/ui                 the table
@somnia-chain/markets-sdk  >=0.28.0  PINNED. below this, float prices revert
viem 2.x + wagmi 2.x                 somnia shannon testnet, chain 50312
node worker                          executor + market maker, separate processes
sqlite + prisma                      executor bookkeeping
foundry                              ArenaRegistry.sol only
railway                              executor + MM, 24/7
```

verify exact versions at install. the SDK ships react hooks and realtime watches — **use them,
do not rebuild a websocket layer.**

## repo structure

```
apps/web/            next app. the table, the pick, the bank button
services/executor/   the loop: watch → resolve → redeem → roll. owns the house wallet
services/mm/         two-sided quoting bot so every player fills
contracts/           ArenaRegistry.sol + reactivity subscription
packages/shared/     game rules, fair-value math, market helpers
scripts/spike/       day-0 throwaway. keep it, it is proof
```

## build phases

- [x] **phase 0 — spike (26 aug)** buy → settle → redeem, 3 tx hashes in one transcript
- [ ] **phase 1 — loop + MM (27–29 aug)** executor rolls stacks unattended; MM fills both sides
- [ ] **phase 2 — the table (30 aug–2 sep)** 8 seats, live stacks, pick, bank, countdown
- [ ] **phase 3 — reactive registry (3–4 sep)** eliminations land on-chain in the same block
- [ ] **phase 4 — real run (5 sep)** 8 humans, one full run, recorded
- [ ] **phase 5 — submission (6–7 sep)** README, 4 slides, <3min video

## commands

```bash
pnpm install
pnpm dev                        # next app on :3000
pnpm --filter executor dev      # the game loop
pnpm --filter mm dev            # quoting bot
pnpm spike                      # day-0 proof script
forge test                      # ArenaRegistry
forge script script/Deploy.s.sol --rpc-url somnia_testnet --broadcast
```

## the rules, exactly

| | |
|---|---|
| round | one BTC 15m dreamDEX market, real clock (:00 :15 :30 :45 UTC) |
| buy-in | 10 USDso, fixed, one seat |
| pick | UP or DOWN before lock. whole stack goes in |
| win | stack × 1/p, already staked next round |
| lose | eliminated, stack gone, loss capped at buy-in |
| bank | sell mid-round at live value, run ends, multiple recorded |
| joining | no lobbies. whoever is in when the bell rings, plays |

**contrarianism pays and it is visible.** stack grows by 1/p, so a crowded side pays little and a
lonely side pays a lot. show the crowd's split on screen — that is the strategy layer, free.

## demo plan — what the judge sees, in order

1. the table: 8 seats, stacks, a countdown at 0:40
2. a player picks DOWN while the crowd is on UP — payout number jumps
3. the bell. four seats go dark at once, four stacks double
4. the on-chain elimination event, same block as settlement, explorer link
5. one player banks at 8x and walks
6. the board: real runs, real multiples

**the remembered moment:** the bell rings and half the table dies at once.

## pitch, 60 seconds, spoken

> dreamDEX just launched event contracts — bet whether bitcoin closes above or below its price
> fifteen minutes from now. it's a trading terminal. order books, position tabs. built for traders.
>
> we turned it into a battle royale.
>
> you buy a seat. every fifteen minutes bitcoin decides who lives. pick wrong, you're out. pick
> right, your stack doubles and it's already in the next round. bank out any time — or push.
>
> nobody's odds are made up. the payouts come from a real order book, and there's no house taking
> a cut, so if you win, you win in full. you can never lose more than your seat.
>
> and when a round settles, somnia's on-chain reactivity eliminates the losers in the same block.
> no server, no keeper, no cron job. the chain runs the tournament.
>
> eight players, forty-five minutes, one survivor. every fifteen minutes, forever.

## things that burned us

*(append every time something bites — this file is memory)*

➠ **git identity was not configured before the first commit.** AI commit attribution got a project
  marked down at ETHGlobal Open Agents. configure it first, always.
➠ SDK **below 0.28.0**: a float price is a few wei off the tick grid and reverts `InvalidPrice`.
  testnet is 6-decimal and hides it. pin the version.
➠ **testnet collateral is 6 decimals, mainnet is 18.** divide by the collateral's decimals, never
  a constant.
➠ `loadMarkets()` **will not show a settled market**. redeem needs
  `listBinaryMarkets({ status: "Finalized" })` and an explicit outcome index.
➠ the indexer lags by seconds. gate every write on `getMarketOnchain` status `1 = Trading`.
➠ **pools are recycled between windows.** state keyed by pool address silently attaches to a
  market we never traded. key by `marketId` or symbol.
➠ `expireTimestampNs` is mandatory and in **nanoseconds**. `0` reverts `OrderAlreadyExpired`.
➠ a reverted write does not always throw. check the balance before signing or the executor burns
  gas every cycle in silence.
➠ unified verbs have no `receipt` of their own — read `(order.info as PlaceOrderResult).receipt`.
➠ `PostOnlyWouldCross` **throws**, it does not return a status. catch it, treat as normal.
➠ a **voided** market pays both sides 0.5 and has no winning outcome to infer. a void round is a
  push — nobody dies, stacks carry.
➠ **`listLiveBinaryMarkets` rows have `outcomes: undefined` and `symbol: undefined`.** the recipes
  doc assumes `m.outcomes[0].symbol` exists — it does not on the indexer row. drive the raw trader
  tier with `oc.pool` from `getMarketOnchain` instead, or call `loadMarkets()` for symbols.
➠ `expireTimestampNs` **defaults to the pool's market expiry** when omitted, which is what a
  one-shot order wants. the gotchas doc calls it mandatory; the SDK fills it in.
➠ `fetchOrderBook(symbol)` hangs without `loadMarkets()`. use
  `watchMarket(pool)` + `getLiveBinaryOrderBook(pool)` — sub-second, and it needs no symbol.
➠ book prices come back as **raw bigints at 6 decimals** — `271000n` is `0.271`.
➠ **`getOutcomeBalance` takes an OBJECT**, not positional args. the recipes doc shows
  `getOutcomeBalance(outcomeToken, me, yesId)`; the real signature is
  `getOutcomeBalance({ outcomeToken, account, id })`. positional args fail with
  `Address "undefined" is invalid`.
➠ **there is no `getCollateralBalance`.** read the collateral ERC-20 directly with viem
  `readContract({ address: COLLATERAL, abi: erc20Abi, functionName: "balanceOf" })`.
➠ redeeming a **losing** position is correctly a no-op — `getOutcomeBalance` returns 0 for the
  losing id, so skip on 0 rather than sending a tx that pays nothing.
➠ **`cd` inside a Bash tool call persists across calls.** a `cd node_modules/...` wrote `.env` and
  `.gitignore` into the package directory instead of the repo. always `cd` back to the repo root.

## things NOT to do

➠ do not build a per-user escrow contract. house executor, disclosed in the video.
➠ do not let the registry contract place orders. it advances game state only.
➠ do not add ETH, 1h markets, or market selection. one market: BTC 15m.
➠ do not fake players on screen. ever. four real humans narrated honestly beats eight fake ones.
➠ do not rebuild the SDK's websocket layer. it ships hooks.
➠ do not promise a fixed multiple before a round — p is unknown until filled. show live values.
➠ do not add squads, insurance, or free-play mode. the table is the product.
➠ do not write the video script before phase 4 exists.
