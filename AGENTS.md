# AGENTS.md — ROPES

> rename to `AGENTS.md` before submitting. never commit the filename `CLAUDE.md`.

**a battle royale on bitcoin. every minute, half the players die.**

---

## what we are building

players buy a 10 tUSDC seat. every minute a round runs on a real dreamDEX BTC 1m event
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
➠ almost every market shows `trades = 0` — one seat fires an order every single minute

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

## phase 1 findings — 26 aug

the loop ran unattended for 5 consecutive 1m rounds and played a full battle royale
(`4 → 2 → 0`) with correct compounding, elimination and ledger attribution.

### 1m books are EMPTY at window open

the resting MM does not quote immediately — there is a **~5-10 second gap** after a new 1m window
opens before any bid or ask appears. observed repeatedly:

```
15:52:04 ROUND 2 open   yesBid=- yesAsk=-
15:52:04   bram no fill on DOWN — sits out
15:52:07   dez  no fill on DOWN — sits out
15:52:10   bram DOWN @ 0.447          <- book finally appeared
```

**entry must retry across the whole window, not fire once at open.** the 1s tick loop already does
this and it is why bram and dez still got in. do not "optimise" entry to a single attempt.

consequence for the UI: the price a player sees when they pick is NOT the price they get. show the
fill price after the fact, never promise one up front.

### same-side players get different prices — FIXED, batched by side

orders were placed sequentially (one wallet, one nonce). bram and dez both picked DOWN and filled
at **0.497 and 0.741** — five seconds apart, same side, same round. honest market behaviour that
reads as rigged in a game.

now one order per side per round, split pro rata at the **average fill price**, with the last run
absorbing the rounding residual so attributed contracts equal the fill exactly. attributing more
than we hold would over-redeem at settlement. verified: `UP x2 @ 0.416` → both players identical.

### order type: 2, never 1

`ORDER_TYPE.FILL_OR_KILL = 1`, `MARKET (IOC) = 2`. the spike used **1** and got away with it only
because a 2-contract order always fills. the first batched order reverted eight times in a row with
`FillOrKillNotFillable()`, paying gas each time. `ImmediateOrCancelNoFill()` on a MARKET order is a
normal "the quote moved" event — catch it like `PostOnlyWouldCross`, do not treat it as a fault.

### size in two passes or players under-deploy

the book frequently moves **in our favour** between the read and the fill on a 1m window, so an
order sized at the touch left ~20% of the budget unspent (18.94 of a 24.28 stack). a second top-up
pass with the remainder fixes it: now 16.2337 of 16.2337 deployed, nothing left behind.

### never enter above 0.90

a 1m window that has made its mind up quotes the favourite at 0.99 — a player risks their whole
stack for a 1% gain. the executor declines above 0.90 and sits the round out instead.

### depth is thin

`cyd` could only deploy 9.12 of a 10.00 budget at the touch — the book ran out. sizing is correct;
the book is just shallow. budget-vs-deployed will diverge and the ledger must keep the remainder
(it does).

## phase 3 — PROVEN LIVE, 26 aug

`ArenaRegistry` at **`0xfb31455b05ea95b7B4cC4c1e98f03219b995456A`** settles the game by itself.
(set as `REGISTRY` in `.env`; leave it unset and the game runs exactly as before.)

```
market   0x...a49f   BTC 1m   pool 0xa763...2718 nonce 176
registered a round, entered ada UP and bram DOWN, then walked away.

REGISTRY SETTLED ITSELF        winner UP, block 471909612
  venue says   resolved=true voided=false winner=0
  ada  (UP)    16.0000  alive
  bram (DOWN)   0.0249  ELIMINATED  (undeployed remainder returned)

BinarySettlement MarketFinalized block   471909612
ArenaRegistry   elimination block        471909612
SAME BLOCK: YES
```

no keeper, no cron, no listener. `scripts/spike/reactive-e2e.ts` re-runs the whole proof.

### wired into normal play

the executor mirrors each round on-chain — `openRound`, then one `enterMany` per side, matching how
orders are already batched — and reads the registry back after settlement. live over four
consecutive rounds:

```
17:23:12  registry mirrored DOWN x2
17:23:18  registry mirrored UP x2
17:24:03  registry: already settled itself on-chain ✓
```

**registry writes are awaited inside the game loop, never queued.** the executor wallet already has
one nonce manager (the SDK's, for orders); a second concurrent one races it and both sides get
"nonce too low". one sequential writer — which is why `enterMany` exists, so a round costs three
transactions instead of one per player.

the registry is a MIRROR, never the source of truth. every write is best-effort: a failure logs and
the game carries on.

### the mirror caught a real ledger bug

`enterMany` rejected a **negative remainder** (`-95762`), which is how we found that `buy()` could
overspend: it sized quantity against the touch while being willing to pay up to `limit`, so a walk
up the book cost 22.5379 against a 22.3464 budget and drove a player's stack negative.

sizing now uses the **worst price we would accept**, so max spend is capped at the budget and a
better fill simply underspends (the top-up pass covers it). attribution also clamps: a run can
never be charged more than it staked.

### the SDK's settlement event ABI is WRONG — this cost the first attempt

`binarySettlementEventsAbi` declares:

```
MarketFinalized(uint256,address,uint64,address,uint256,bool,uint8 winningOutcome)
```

the DEPLOYED contract emits:

```
MarketFinalized(uint256,address,uint64,address,uint256,bool,uint256[] payoutNumerators)
   topic0 0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178
```

subscribing to the topic0 the published ABI implies matches **nothing, silently** — no error, no
callback, just a subscription that never fires. verify a topic0 against real logs before trusting
any ABI here.

payout numerators are better than a winner flag anyway: a win is `[full, 0]`, a void is
`[half, half]`, so one field covers both and the handler never needs a second question.

### deploys need an explicit gas limit

`forge script --broadcast` sizes each tx from its own estimate and **ignores `--gas-limit`**. two
deploys reverted with `gasUsed` exactly equal to the estimate — the out-of-gas signature. somnia's
gas schedule is far dearer than mainnet's. use `forge create --gas-limit 20000000`, and pass an
explicit `gas` on every viem write.

## phase 3 gate — 26 aug, CLEARED

the 32-SOM question is answered: **the wallet is already above it and the precompile accepts us.**

```
balance    49.8147 STT      17.81 over the claimed 32 minimum
precompile 0x0000000000000000000000000000000000000100
emitter    0x3ecC694Cef705358864a646142ac17A90E29e388   BinaryMarketsModule
subscribe  SIMULATION PASSED -> subscription id 0xd6d544
```

`scripts/spike/reactivity.ts` simulates the real `subscribe` write with `eth_call`, so a funding
rule would have rejected it for free. nothing was actually subscribed.

**caveat:** the simulation used our EOA as a placeholder handler. a deployed handler contract may
carry further requirements, so re-run this script in phase 3 against the real `ArenaRegistry`
before assuming it still passes.

### how reactivity is actually reached

`@somnia-chain/reactivity` is an **optional peer dependency** of the SDK — the `/reactivity` export
throws without it. `npm install -E @somnia-chain/reactivity@0.2.1`.

two different mechanisms, do not confuse them:

➠ `reactivity.watch(...)` — an off-chain `somnia_watch` WebSocket stream. no contract, no funding.
  delivers the matched log **plus the results of arbitrary `ethCalls` read at the same block**.
➠ `reactivity.subscribe({ handlerContractAddress, ... })` — the on-chain one. validators call a
  deployed handler. this is what phase 3 needs and what the funding rule applies to.

the handler selector is `onEvent(address,bytes32[],bytes)` = `0x53edf33d`. subscription options
must satisfy `gasLimit` in `(0, 200_000_000]`, and a non-zero `maxFeePerGas` at least 6 gwei above
`priorityFeePerGas`.

**gotcha the SDK flags:** viem unwraps the JSON-RPC envelope, so a notification payload is at
`notification.result`, NOT `notification.params.result` as upstream's README still says.

## the executor MUST be supervised — found 26 aug

the SDK owns its WebSocket and **does not reconnect** when the node drops it. observed live: the
socket died and the loop kept ticking for six minutes, every read failing, while the process looked
perfectly healthy.

```
21:52:48 tick failed: RpcError: rpc readContract markets failed: WebSocket request failed.
   ... x120, silently, for six minutes
```

a stalled executor during the recorded run would be far worse than a five-second gap, so it now
exits(1) after 10 consecutive failed ticks and `run-executor.sh` restarts it with a fresh client.
**always run the executor through the supervisor, never bare.** this is also how railway expects it.

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

**collateral is tUSDC, 6 decimals**, `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`. there is no faucet
PAGE, but the token has a faucet FUNCTION — `faucet(uint256)` on the collateral contract mints to
msg.sender. The wallet page calls it from the PLAYER's wallet (`mintTestUsdc`), so tUSDC costs the
house nothing and needs no drip endpoint racing the executor for the nonce. 10,000 is the largest
round amount it accepts (100,000 reverts `0x37583762`); the call is ~80k gas, about 0.0005 STT.
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

### the price feed works, and the strike is scaled by 100

`priceFeed: SOMNIA_TESTNET_PRICE_FEED` gives live BTC via `fetchPrice(ASSET)` and 1m candles via
`fetchPriceOHLCV`. the indexer row's `strike` is an integer scaled by **100** (`7805356` = 78053.56)
— that is the line the window settles against, and the chart draws BTC racing it.

each market row also carries `oracleQuestionId`, deep-linkable at
`prd.oracle.somnia.host/questions/{id}?view=graph` to show every price source behind the
settlement. surfaced in the footer as the provably-fair link.

### the books are NOT empty

a resting market maker quotes both sides, ~200 contracts at the touch, ~0.025 spread. observed on
1m, 15m, 60m, 240m and 1440m. **our MM is a backstop, not critical path.** most markets show
`trades = 0`, so we would be creating essentially all of the organic volume.

## the look — retro-futurism

**the surface is a desaturated slate violet (`#0b0a13`), not black.** black was legible but inert, and navy
washed the green multiplier out to near-white. violet sits opposite BOTH green and red on the wheel,
so neither semantic colour has to fight the surface — and that contrast between the two sides is the
entire read of this screen. `data-bg="void"` and `data-bg="arcade"` keep the alternates for
comparison.

held at roughly **half the chroma of a true synthwave violet** — enough hue to keep that separation
and stop the page reading as a terminal, not enough that the surface itself is something you notice.
a full-strength violet was the surface competing for attention.

it also fixed the accessibility gap: every pair clears WCAG AA — text 16.82:1, dim 5.36:1,
up 11.78:1, down 5.42:1, gold 12.85:1. `--dim` on near-black was the pair that used to fail.

semantic colours live in the base `:root`, never inside a palette override — UP is always the same
green whatever the surface is.


the logo is a candlestick whose body is a candle: green body, upper and lower wicks, the upper wick
carrying a gold flame. generated with higgsfield `nano_banana_pro`, cropped to `public/mark.png`
(header + favicon) and kept whole as `public/logo-full.png` (slides, README, social).

**one detail carries more of the arcade feel than anything else: chamfered corners.** cutting two
opposing corners off a panel moves it from "web card" to "HUD element" — `.chamfer` / `.chamfer-sm`.
the clock is an OUTLINED numeral for the same reason; a solid one reads as a dashboard.


from the ui-ux-pro-max design system, matched to "gaming / competitive / dark":

```
style        retro-futurism — neon glow, CRT scanlines, synthwave
type         Russo One (display) + Chakra Petch (body), via next/font
effects      bloom on the tape, glow on every number that matters
```

**Russo One is only for what a player shouts about** — the clock, the multiplier, the stack, the
verdict. Everything else is Chakra Petch and gets out of the way. A screen where every number wears
the display face is as flat as one where none of them do.

accessibility the style forces us to handle: `prefers-reduced-motion` kills the pulsing clock,
breathing table, sweeping buttons and screen shake; `:focus-visible` rings are gold at 2px; the
speaker toggle is an SVG, never an emoji.

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
- [x] **phase 1 — the loop (27–29 aug)** executor rolls stacks unattended at 1m cadence
- [x] **phase 2 — the table (30 aug–2 sep)** seats, pick, bank, countdown, the bell, chart, sound, live/next pools, autoplay — DONE (solo climb is the shipped product; tables parked behind the multiplayer flag, 17 forge tests green)
- [x] **phase 3 — reactive registry (3–4 sep)** eliminations land on-chain in the same block — DONE 26 aug, proven live
- [x] **phase 4 — real run** DONE 29 aug, solo with the owner's real wallet: 50 tUSDC deposited
  (5 verified txs), a death, a 2.67× two-bell comeback banked from the bankroll, WITHDRAW ALL paid
  on-chain (tx 0x30252564…f203d, block 473916370), wallet net +6.70. GIF captured; re-record at
  full framerate for the video. the 8-human table run is parked with multiplayer.
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

## why there are tables

the market's clock is infinite — a new BTC window opens every minute forever. left alone that
produces a **venue, not a tournament**: nobody ever wins, because "last one standing" needs a field
to be last in, and an always-open table never resolves to one. other seats are ambient decoration
and beating someone pays you nothing.

**a table fixes all three.** it fills, SEALS, and its roster is then frozen until one player
remains. that player is the champion and takes the pot. the next table is already accepting
arrivals, so sealing costs nobody a wait — exactly how a battle-royale queue works.

proven live:

```
TABLE 1 SEALED  4 players  pot 8.0000
TABLE 1 — wiped out, nobody left. pot 8.0000 carries forward
TABLE 2 SEALED  2 players  pot 4.0000
TABLE 3 open  (carrying 8.0000 pot)
TABLE 2 — 👑 bram LAST STANDING  10.1251 + 4.0000 pot = 14.1251
```

**a wipeout is a feature.** when the last players all pick the same side nobody wins, and the pot
rolls into the next table — table 3 opened at 16.00. the stakes escalate on their own.

## the rules, exactly

| | |
|---|---|
| round | one BTC **1m** dreamDEX market, real clock, every minute on the minute. if the venue publishes no 1m window the executor falls back to **5m** and returns to 1m by itself — nothing longer |
| buy-in | 10 tUSDC, fixed, one seat |
| pick | UP or DOWN before lock. whole stack goes in. while riding you can QUEUE the next side — the bell rolls you straight into the next window |
| win | stack × 1/p, already staked next round |
| lose | eliminated, stack gone, loss capped at buy-in |
| bank | sell mid-round at live value, run ends, multiple recorded |
| sweep | a stack under **1.00** is cashed out automatically — it cannot compound back |
| table | a cohort of up to 8. **seals** when full, or after a 2m fill window with 2+ seated |
| pot | 2 of every 10 seat price. **last one standing takes it all** |
| joining | you always join the table that is currently filling — the next one is already open, so sealing costs nobody a wait |
| wipeout | if the whole table goes out together nobody takes the pot; it **carries into the next table** |

**contrarianism pays and it is visible.** stack grows by 1/p, so a crowded side pays little and a
lonely side pays a lot. show the crowd's split on screen — that is the strategy layer, free.

## demo plan — what the judge sees, in order

1. the table: 8 seats, stacks, a countdown at 0:20
2. a player picks DOWN while the crowd is on UP — payout number jumps
3. the bell. four seats go dark at once, four stacks double
4. the on-chain elimination event, same block as settlement, explorer link
5. one player banks at 8x and walks
6. the board: real runs, real multiples

**the remembered moment:** the bell rings and half the table dies at once.

## pitch, 60 seconds, spoken

> dreamDEX just launched event contracts — bet whether bitcoin closes above or below its price
> one minute from now. it's a trading terminal. order books, position tabs. built for traders.
>
> we turned it into a battle royale.
>
> you buy a seat. every minute bitcoin decides who lives. pick wrong, you're out. pick
> right, your stack doubles and it's already in the next round. bank out any time — or push.
>
> nobody's odds are made up. the payouts come from a real order book, and there's no house taking
> a cut, so if you win, you win in full. you can never lose more than your seat.
>
> and when a round settles, somnia's on-chain reactivity eliminates the losers in the same block.
> no server, no keeper, no cron job. the chain runs the tournament.
>
> eight players, three minutes, one survivor. then it starts again.

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
➠ **killing the executor by pattern leaves ORPHANS that keep trading.** the real long-running
  process is `node --require tsx/preflight.cjs … src/executor/index.ts` — patterns like
  `pkill -f "tsx src/executor"` only kill the npm/tsx wrappers, the node child survives orphaned,
  and `run-executor.sh`'s until-loop respawns another on top. three executors ended up racing one
  wallet and one SQLite for 15 minutes: `position.create` P2002 collisions, and — because `buy`
  and `sellPosition` measure cost/proceeds off wallet-balance DELTAS — every number poisoned by
  the siblings' concurrent orders (a "20-budget" entry recorded 38.86 spent; a 28-contract sale
  recorded 43.43 proceeds). match `[e]xecutor/index` (the child's cmdline) and kill the supervisor
  bash FIRST, then verify the count is zero before restarting.
➠ **the UI's view of who is playing must never be narrower than the executor's.** `enterRound`
  plays every alive run on ANY sealed table, but `state.ts` scoped seats to ONE "active" table
  (newest sealed, else filling). The moment a second solo table sealed, the first table's player
  vanished from their own screen: join box shown, no pick controls, `sits out (no pick)` every
  round — 443 of them — and re-joining just handed back the same invisible run. Seats are now
  every alive run. A run's own table status rides on the seat (`playing`) for the ROPING UP label.
➠ **the bell is not a broadcast.** the verdict overlay, the screen shake and the toll fired on
  every settled round for EVERY viewer, so someone who had never joined got their screen shaken
  and a verdict flashed at them once a minute for a stranger's round. gate on "did this bell
  concern me" (my runId in killed/survived, or I hold a live seat) — and gate on a REF, not a
  dep, or `me` churning each poll replays the sound for the overlay's whole 3.4s.
➠ **`?? seats[0]` put a stranger's climber on your wall.** a viewer with no run saw the first
  seated player's character, name and altitude as if it were their own session. your run or
  nobody.
➠ **the post-bank sit-out was vestigial multiplayer.** banking locked a player out for 2 rounds
  while dying locked them out for none — and the sweep, which the player never chose, locked them
  out too. it only ever meant "cannot re-seat to dodge a table you were losing", which needs 2+
  players. now applied only when the table actually had a field.
➠ **`stack` is idle cash, not the player's money.** entering a round moves nearly all of it into
  contracts, and rounds OVERLAP — the next window opens and takes entries while the previous is
  still settling — so the sweep that runs after round N routinely saw a player deployed in N+1
  holding ~0.03 and cashed them out at 0.00x with their contracts still riding. a real bet,
  placed and paid for, deleted by the janitor. anything judging a run by `stack` must exclude
  runs holding an unsettled position (`positions: { none: { outcome: null } }`).
➠ **a fetch that can fail must be validated before it becomes state.** `useLedger` and the
  /api/state poll stored whatever came back, so ONE 500 with a JSON body became the ledger/state
  and the next render did `.runs.find` / `.seats.find` on undefined — the whole page died with
  "Application error: a client-side exception has occurred". check `res.ok` AND the shape, and
  keep the last good frame. on a poll running twice a second, a blip is a certainty, not an edge
  case.
➠ **/api/state was 6.6 SECONDS in production.** thirteen sequential DB round trips plus a live
  oracle call, on an endpoint every tab polls twice a second: responses piled up, the wall looked
  frozen (a placed bet just sitting there) and slow requests tipped into function timeouts — the
  500s above. the fixes, in order of payoff: batch independent reads into `Promise.all` (13 hops
  → 2), cache the oracle price for ~1s, stop fetching EVERY run ever played with joins on every
  poll (ask for the live ones; the board takes a capped top-10), and put the functions in the
  database's region (`"regions": ["lhr1"]` in vercel.json). 6.6s → 0.6s.
➠ **auto-bail must mark off DEPTH, not the touch.** the first version compared the target against
  best-bid × size; a thin book showed a touch ≥ target, fired, and the IOC sale walked the book —
  a 10.00 stake realized 1.70. `realizableProceeds` walks the resting levels for the WHOLE size
  and refuses to fire when the book can't absorb it.
➠ **the executor must use the SESSION pooler (5432), never the transaction one.** Through 6543
  with `?pgbouncer=true`, Prisma cannot keep prepared statements and issues a `DEALLOCATE ALL`
  around every statement — FOUR protocol round trips per query instead of one. Profiled live: a
  single tick made **52 round trips and took 54 seconds**, so rounds settled two to three minutes
  late and the game looked frozen. 10 reads: 30.4s via 6543 vs 6.7s via 5432. Session mode is for
  one long-lived process (the executor); transaction mode is for serverless (Vercel), which needs
  it. Getting these backwards is invisible in code review and fatal in play.
➠ **a tick that HANGS never trips a failure counter.** The supervisor's exit-after-10-failures only
  catches a loop that throws. Observed: the executor went silent mid-round and sat there twenty
  minutes with the round unsettled, the process looking perfectly healthy. Every tick is now capped
  (`TICK_TIMEOUT_MS`) and a stall is fatal on the first occurrence — a hang does not heal. Size the
  cap far above a SLOW tick: at 40s it fired on a bad network where one market read took 18s, and
  the restarts then made things worse by forcing fresh pooler connections every cycle.
➠ **latency multiplies by round trips, so count them.** At ~500ms RTT every sequential query is a
  visible second. `crownChampions` asked two questions per sealed table, and `enterRound`,
  `armAutoBails` and `processBails` each did one position lookup PER RUN. Batched into single
  `findMany`s the same tick settles rounds 8-19s after expiry instead of 2-3 minutes.
➠ **the machine sleeping stops the game.** `run-executor.sh` wraps the loop in `caffeinate -ims`
  and backs off to 30s between restarts — restarting instantly during an outage just opens fresh
  connections until the pooler refuses them.
➠ **the reactivity subscription dies silently when the house wallet drops under 32 STT — and it
  does not come back on its own.** The every-minute loop burned the gas down from ~22 STT to 0.03
  over two days. The executor kept running (orders only fail once gas is truly gone) but every
  round started printing `registry: not settled on-chain (callback missed?)` — the precompile had
  REMOVED the subscription, and `getSubscriptionInfo` on its id now reverts. Topping back up does
  not revive it; you must `npx tsx scripts/resubscribe.ts --send` (executor STOPPED — one nonce)
  once the balance is over 32. Worse: the subscription id was never written down, so finding out
  which subscription had died meant digging the `subscribe` tx out of the explorer and decoding
  `SubscriptionCreated` from its receipt. The script now records the id in `.env` as
  `REACTIVITY_SUBSCRIPTION_ID`, and `npm run doctor` flags the wallet under 2 STT — treat that
  warning as "the pitch's centrepiece is about to stop working", not as a gas nuisance.
➠ **the emitter that actually settles our markets is `0xbf4a…6ed23`, not the `0x3ecC…9388` module
  address the phase-3 notes name.** Decoded from the proven subscription's own receipt. When in
  doubt, read the receipt of the subscription that worked; never the docs.
➠ **the executor can live on Render's FREE tier — as a web service, never a worker.** Free
  workers do not exist there ($7/mo); one free web service does, but it spins down after 15 min
  with no inbound traffic. So the loop serves `/health` (only when `PORT` is set) and a free
  external pinger (cron-job.org / UptimeRobot, every 5 min) keeps it awake. `/health` answers 503
  once the last tick is older than 2 min, so the same pinger is a real monitor of a wedged loop,
  not a cheerful 200 from a process that stopped playing. `render.yaml` is the blueprint. Cutover
  rule is absolute: ONE executor at a time — stop the laptop's before Render's goes live.

➠ **a grid column's `min-width: auto` let one row of fixed-width slots widen the whole phone page.**
  the HUD grid had no explicit column on mobile, so the climber rail (8 × 56px, `shrink-0`) set the
  column's min-content to 504px and the entire /play page panned sideways at 375px — every panel
  under it was cut off, the money bar's FUND button printed over its label. `grid-cols-1` (which is
  `minmax(0,1fr)`) plus `min-w-0` on the rail's cell fixes the source; `overflow-x: clip` on body is
  the belt. Verify with `document.documentElement.scrollWidth === clientWidth` at 375, not by eye.
➠ **a hidden tab starves `requestAnimationFrame`, and every smoothed readout freezes where it was.**
  in an embedded/background browser pane the wall said 4.95×, BAIL said 1.84×, and the server said
  2.71× — three `useSmoothed` instances stranded at different moments, since the glide only advances
  on frames. Measured: 0 frames in 1.5s with `visibilityState = "hidden"`. It is NOT a ledger bug:
  a visible phone renders frames, and the first frame after an app switch has a huge `dt` and snaps
  to target. Trust `/api/state` and the walk button (raw `me.stack`), never a glided number, when
  auditing from an automated browser.

➠ **railway's Railpack builder IGNORES `railway.json`.** The first deploy auto-detected Next and ran
  `next start` on the executor box — the domain served the app's 404 page and no loop ran. What
  actually works: service variables `RAILPACK_BUILD_CMD=npx prisma generate` and
  `RAILPACK_START_CMD=bash start-prod.sh`. The service-level start command and `/health` check are
  NOT set (the CLI's token gets 403 from the GraphQL API) — set them in the dashboard if you ever
  want Railway itself to restart a wedged loop; until then `run-executor.sh` is the supervisor. Do NOT run `railway config migrate --apply`
  + `config apply`: the generated `.railway/railway.ts` declares no variables, so applying it plans
  to DELETE every secret on the service. Deleted the file; `railway.json` stays as documentation.
➠ **cutover happened 3 sep 08:04 UTC.** Railway project `the-climb`, service `the-climb`, domain
  `the-climb-production.up.railway.app` (`/health` only). The Mac executor is RETIRED — never start
  `./run-executor.sh` locally again while Railway is live. Two `railway up` in a row overlap: the
  previous deployment keeps running until the new one is healthy, so a redeploy is itself a brief
  two-executor window. Redeploy rarely, and never with the Mac loop running.
➠ **`pkill -f run-executor.sh` can leave the supervisor alive.** After the cutover two supervisor
  shells survived the first pkill (the node children died, the `until` loops did not) and would have
  respawned an executor after their 30s backoff. Kill by PID from `ps auxww | grep "[r]un-executor.sh"`
  and verify all three counts — supervisors, `[e]xecutor/index`, `caffeinate` — are ZERO.

➠ **the two-minute cadence (pick this minute, ride the next) was tried on 3 sep and REVERTED the
  same day — the owner called it weird.** a full minute of waiting with nothing happening is dead
  air. what survived from it: the wall's camera anchors to the SETTLED stack (`stack / buyIn`), so
  during the ride the only thing that moves the climber is bitcoin — bet DOWN, BTC falls, your
  climber goes down — and the bell glides the anchor to the new ledge; and `pickedForRound`, now
  used the other way round: a pick made WHILE RIDING queues for the next window (the bail bar's
  "⟳ NEXT MINUTE" buttons), so the bell rolls a survivor straight in with no dead time. a pick made
  while not riding enters the open window at once, exactly as before.
➠ **one unexplained bail (3 sep, run climber245, round 5188).** a queued pick entered at the open,
  and ten seconds later `processBails` sold it — `bailRequested` was true, `autoBailAt` was null,
  no ⚡ auto-bail line, no BAIL click in the test harness. only `POST /api/bank` can set that flag.
  it did NOT reproduce: an instrumented rerun (every POST recorded with its stack) survived a bell,
  entered the next window on its queued pick, and made zero bank calls. `/api/bank` now logs
  run + key + user-agent to the Vercel function log; if it happens again, that line names the
  caller. until then treat it as unexplained, not as fixed.

➠ **the game is called ROPES** (renamed 3 sep from THE CLIMB / LAST CANDLE — older names survive in
  comments and in this file's history). ONE thing must never be renamed with it: `depositMessage`
  still says `THE CLIMB · credit deposit …`. That exact string is signed by a depositor's wallet and
  re-derived by the server to verify the signature, so changing the text invalidates any signature
  made against the old wording. Leave it.
➠ **the live URL is now `playropes.vercel.app`** (3 sep). `ropes.vercel.app` was already taken by
  someone else, so the project keeps its Vercel name `the-climb` and the new address is attached as
  a project domain — which means every future production deploy inherits it automatically, unlike a
  bare `vercel alias set` pinned to one deployment. `climbthecandle.vercel.app` still resolves and
  is left alive on purpose: links already shared with judges must not break. `NEXT_PUBLIC_BASE_URL`
  drives `metadataBase`, so it has to move with the domain or every OG share image 404s.

➠ **the indexer's Market table can hang while the indexer itself looks perfectly healthy** (4 sep,
  ~03:43-04:30+ UTC, over 45 min). Every `listLiveBinaryMarkets` call timed out at the SDK's 30s
  ceiling, the executor burned its 10-failure budget and restarted every ~5.5 min in a loop, and
  round 6198 sat unsettled the whole time. It is NOT query cost: `limit:100` unfiltered, `limit:5`,
  and a server-side-filtered `asset:"BTC", intervalSec:60, limit:10` all failed identically at 30s,
  so narrowing the query is not a workaround. Diagnose it in two curls against `INDEXER_URL`:

    query { __typename }                 -> 200 in 0.45s   (Hasura is alive and validating)
    query { Market(limit: 1) { marketId } } -> HTTP 504 "stream timeout" after 30s

  A fast `__typename` plus a 504 on the cheapest possible Market read means THEIR data layer behind
  Hasura is wedged — nothing on our side can route around it, and the fix is to wait. The executor's
  crash-and-restart loop is correct behaviour here: it costs no gas (it fails long before any order)
  and it recovers on its own the moment they come back. Do not "fix" it by widening timeouts.

➠ **the connected wallet "disconnected itself" mid-session — it never did.** `addr` was plain
  component state in BOTH /play and /wallet, initialised to null and restored by nothing, so every
  reload and every client-side hop between those two pages dropped it and painted CONNECT again.
  The wallet authorization was intact the whole time: an approved site gets its account straight
  back from `eth_accounts` with NO popup. `useAccount()` now does that silently on mount (keyed on
  `wallets().length`, because EIP-6963 providers announce asynchronously and a cold mount has
  nothing to ask yet) and subscribes to `accountsChanged`, so switching or locking the wallet moves
  the UI instead of leaving a stale address on screen. Money was never exposed: the payout address
  is pinned SERVER-side from the deposit tx sender, so a browser forgetting the address cannot
  misdirect a withdrawal.

➠ **a phone browser injects NO wallet, and the page used to stop there.** Someone opening the link
  in mobile Safari/Chrome hit "NO WALLET DETECTED" with no way forward — the most likely reason a
  new player says "connect didn't work". Extensions do not exist on mobile; the working route is a
  universal link that REOPENS the page inside the wallet app's own browser, where a provider is
  injected. `walletDeepLinks()` builds those for MetaMask / Coinbase / Trust / Rainbow and
  `<OpenInWallet/>` renders them whenever there is no injected provider on a mobile UA.
➠ **`wallet_addEthereumChain` must NOT be the catch-all for a failed switch.** The old flow called
  add on ANY switch error, so declining the network switch raised a SECOND popup asking to add a
  chain the wallet already had — two prompts for one refusal, which reads as a broken button. Only
  an unknown-chain error should trigger add; 4001 is a final rejection and must say so. 4001 on
  `eth_requestAccounts` means declined and -32002 means a request is ALREADY open in the wallet
  (common when someone taps connect twice) — both need their own message, not a generic failure.

➠ **awaiting ANYTHING before `eth_requestAccounts` kills the MetaMask popup.** connect() probed
  `eth_accounts` first to stay silent for already-approved sites — but that awaited round trip to
  the extension SPENDS THE USER-GESTURE CONTEXT, so MetaMask can no longer raise its window. It
  queues the request behind a badge on the toolbar icon instead, and the visitor sees a dead button
  and NO POPUP. Reported 4 sep by a first-time player on desktop Chrome. It only ever bites
  strangers: anyone the site is already approved for is served by the silent path and never sees it.
  `eth_requestAccounts` must be the FIRST awaited call in a click handler — it costs nothing,
  because on an approved site it resolves instantly with no popup anyway. The silent probe belongs
  on MOUNT (`restoreConnection`), where there is no gesture to protect.

➠ **a click handler must not touch localStorage outside its try.** `connectWallet` called
  `sound.arm()` first, which reads `localStorage` — and Chrome's "block all cookies", some privacy
  extensions and a few webviews make that access THROW rather than return null. The throw escaped
  the handler before any catch, so the button did NOTHING: no popup, no error, no console line.
  All storage now goes through `safeLocal` (shared.tsx) which never throws, and both connect
  handlers run entirely inside try with a catch that ALWAYS renders something.
➠ **when a connect fails, print what was detected, not just the error.** The failure message now
  carries `wallets seen: …` and `storage: ok|blocked`, so a remote player's screenshot answers in
  one line what three rounds of guessing could not. Silent buttons are unreportable; make the
  failure self-describing.
➠ **never regex `localStorage.` → `safeLocal.` across a file that DEFINES safeLocal.** Doing exactly
  that rewrote the helper's own bodies into `safeLocal.get` calling itself — infinite recursion that
  would have stack-overflowed on the first storage read and taken the whole site down. Caught before
  shipping only because the helper was re-read afterwards. Always re-read a file a blind regex touched.

➠ **the screen filled up with EMPTY things before the player had anything.** Not-yet-seated, the
  page showed two tall money cards reading "—", a four-card rules block, and a stat panel of
  dashes, all squeezing the wall — the one thing the product is. The rules now collapse to a single
  line after the first visit (`lc.rulesSeen`) and the money bar collapses to one row until there is
  a run, a bankroll or winnings to report. That alone gave the wall ~18% more height on desktop
  (493 -> 584px) and put it above the fold on a 812px phone. Rule of thumb for this screen: a
  placeholder must never occupy more space than the number it is standing in for.

➠ **the venue can stop publishing 1m windows, and on 4 Sep it did for ~90 minutes** (13:29-14:57
  UTC; every cadence under 4h vanished). The game froze completely — the clock sat still and the
  page showed RECONNECTING, which is the worst thing a judge can open. `CADENCES = [60, 300]` in
  chain.ts is the answer: `currentMarket` takes the FIRST cadence with a tradeable window, so 1m is
  always preferred and 5m is only ever reached when 1m does not exist. It returns to 1m on its own
  the moment 1m returns — there is no mode to switch back.
  Anything timed off a round now reads `round.intervalSec` rather than assuming 60: the entry
  window is a FRACTION (35/60) of the real window so a 5m round is not locked for its first four
  minutes, and the drain bar spans the real length. Nothing longer than 300 is ever eligible —
  a 15-minute round is not this game, and playing one would be worse than showing the banner.
  **Fall back on ABSENCE, never on runway.** The first cut flattened every cadence into one list, so
  a 1m window with 9s left failed the 12s runway check and the loop fell through to a 5m market —
  opening a five-minute round while 1m was perfectly healthy (seen live, round 6575, 4 sep). Take
  the first cadence that has ANY live market and stop there; if none of its windows is enterable
  yet, return null and wait a tick. Ten seconds of waiting beats a five-minute round.

## things NOT to do

➠ do not build a per-user escrow contract. house executor, disclosed in the video.
➠ do not let the registry contract place orders. it advances game state only.
➠ do not queue registry writes in the background. the SDK owns the wallet's nonce for orders; a
  second concurrent writer races it. await them in the loop.
➠ do not size an order against the touch while accepting a worse limit — that overspends the
  budget. size against the limit.
➠ deploys need `forge create --gas-limit 80000000`. `forge script --broadcast` ignores the flag,
  and this contract needed >20M actual on somnia against a 1.4M foundry estimate.
➠ do not add ETH, other cadences, or market selection. one market: BTC 1m.
➠ do not fake players on screen. ever. four real humans narrated honestly beats eight fake ones.
➠ do not rebuild the SDK's websocket layer. it ships hooks.
➠ do not use `.js` extensions on relative imports. tsx needs them for ESM but
  next's webpack resolver cannot map `./db.js` to `./db.ts`, and every api route
  500s with "Module not found". extensionless works for both.
➠ do not label the two side prices as probabilities that sum to 100. they are
  both BUY prices (the ask on each side), so they sum to ~103. show the cost.
➠ do not let a sub-1.00 stack keep a seat. it cannot compound its way back and just sits at 0.06x
  while the table plays around it. `sweepZombies` runs after every settlement.
➠ do not label a sweep as "banked" anywhere. the player never made that choice — the feed says
  SWEPT and the run carries `bankedAuto`.
➠ do not run `next build` while `next dev` is serving — they share `.next` and the dev server
  starts 500ing on corrupted chunks. `rm -rf .next` and restart it.
➠ **after `prisma generate`, restart the next dev server.** it holds a stale client and silently
  returns the old shape — a new column reads as undefined with no error anywhere.
➠ do not run the executor bare — use `./run-executor.sh`. the SDK never reconnects a dropped
  WebSocket, so the process must die and be restarted to get a fresh client.
➠ do not trust `getMarketResolution` for prices. `openingAnswer` and `closingAnswer` come back
  **null** on these markets. the strike is on the live market row (scaled by 100), and the close is
  whatever `fetchPrice` says at settlement.
➠ do not write `color: transparent` for an outlined numeral — that makes `currentColor` transparent
  too and the stroke vanishes with it. use `-webkit-text-fill-color: transparent`.
➠ do not render a placeholder em dash in the display face at large sizes — Russo One draws it as a
  solid bar and it reads as a broken graphic. say what is happening instead ("WAITING FOR THE BOOK").
➠ do not size type for desktop and let it shrink. every display number is mobile-first with an `sm:`
  step up, or the price truncates to "78,..." and the multiplier clips on a 375px screen.
➠ do not ship audio files. every sound is synthesised from oscillators in
  `src/app/sound.ts`, so the last ten seconds of a round never wait on a fetch.
➠ browsers refuse to start an AudioContext without a user gesture. `arm()` runs
  from the speaker toggle AND from the first join/pick, or the heartbeat is
  silent for a player who never touched the toggle.
➠ do not key the chart's sampling effect on `price`. BTC sits at the same number
  for several polls, so an effect keyed on it never fires and the tape stays
  empty. sample on an interval reading a ref.
➠ do not promise a fixed multiple before a round — p is unknown until filled. show live values.
➠ do not let a run in a FILLING table enter a round. its field is not fixed yet, so it cannot be in
  a battle royale — it is seated and watching.
➠ do not add squads, insurance, or free-play mode. the table is the product.
➠ do not copy app.linera.xyz's six magnitude bands (MOON/PUMP/POP/DROP/DUMP/CRASH). dreamDEX event
  contracts are **binary UP/DOWN only** — there is no magnitude market to trade, so bands could only
  be faked off-book, which breaks the one claim that makes this project honest: every payout comes
  from a real order book. their pari-mutuel pool can price six outcomes; a binary CLOB cannot.
➠ do not restyle the table to look like linera's. they are a competing L1 whose flagship consumer
  app is also 1-minute BTC calls, somnia's judges may well know it, and "their game on somnia" is a
  much weaker pitch than elimination + compounding + same-block settlement.
➠ do not write the video script before phase 4 exists.
