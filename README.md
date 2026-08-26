# LAST CANDLE

**A battle royale on Bitcoin. Every minute, half the players die.**

Buy a seat for 10 tUSDC. Every minute a round runs on a real dreamDEX BTC event contract. Pick UP
or DOWN — your whole stack goes in. Wrong side and you're out. Right side and your stack multiplies
and is *already staked* in the next round. Bank out any time and walk with what you've got, or push.

Eight players, three minutes, one survivor. Then it starts again.

> Built for the Somnia × dreamDEX Event Contracts Hackathon.
> Live on Somnia Shannon testnet (chain 50312).

---

## Why this isn't a trading terminal with a skin on it

dreamDEX already ships a fine terminal — order book, position tabs, funding history. It's built for
traders, and a venue structurally *cannot* be anything else: it has to stay neutral, and it will
never hold your position across windows.

So we didn't rebuild it. We took the one thing a venue can't do — **compose consecutive windows into
a single run** — and found the game that was already hiding inside the mechanics:

**The tournament is not simulated.** Winners take losers' money, the field concentrates, survivors
compound. That is simply what happens when a crowd repeatedly trades one market. We just drew it.

Three consequences fall straight out of the order book, none of them invented:

| | |
|---|---|
| **Your stack grows by 1/p** | Buy at 0.42, redeem at 1.00. That IS the multiplier. |
| **Contrarianism pays, visibly** | Crowd piles onto UP → UP costs 0.8 and pays 1.25×, DOWN costs 0.2 and pays 5×. The crowd split is on screen, so the pick is a decision, not a coin flip. |
| **There is no house edge** | dreamDEX sets maker, taker and settlement fees to zero, and we take no cut. If you win, you win in full. You can never lose more than your seat. |

---

## Proof it's real

### The loop — buy → settle → redeem, on a 1-minute market

```
MARKET      BTC 1m
BUY_YES     2 contracts @ ~0.871 IOC       paid      1.7360 tUSDC
SETTLED     resolved, winner = UP          landed    0.2s after expiry
REDEEM      redeemed 2.0000 tUSDC          net      +0.2640 tUSDC

settle → redeemed        2.7s
```

Redeem tx [`0xd122da72…f819a3`](https://shannon-explorer.somnia.network/tx/0xd122da7260adb81096a1597f836f3aa005d3a15d8889813b3c4d7fbf79f819a3).
An earlier losing run ([`0x451b1140…d70ed0`](https://shannon-explorer.somnia.network/tx/0x451b114029c7d45d7c20520a1a0328d1c23622a3112842cdce88cdc30ad70ed0))
proved the other branch: redeeming a losing position is correctly a no-op, not a revert.

**That 2.7 seconds is why a round is one minute.** It's what makes an 8 → 4 → 2 → 1 battle royale
take three minutes instead of forty-five, which is why the whole game fits in a demo video, live and
uncut.

### Eliminations land on-chain, in the settlement block

`ArenaRegistry` — [`0xfb31455b…95456A`](https://shannon-explorer.somnia.network/address/0xfb31455b05ea95b7B4cC4c1e98f03219b995456A)

Somnia's reactivity precompile calls the contract's handler from *inside* the block that finalises
the market. We registered a round, entered two runs, and walked away:

```
REGISTRY SETTLED ITSELF                    block 471965999
  venue says   resolved=true voided=false winner=1 (DOWN)
  ada  (UP)     0.0000  ELIMINATED
  bram (DOWN)  19.0249  alive

BinarySettlement MarketFinalized   block 471965999
ArenaRegistry   elimination        block 471965999
SAME BLOCK: YES
```

No keeper. No cron. No listener. **The chain runs the tournament.**

Re-run it yourself: `REGISTRY=0xfb31455b05ea95b7B4cC4c1e98f03219b995456A npx tsx scripts/spike/reactive-e2e.ts`

### A real unattended run

Four bot players, four consecutive live rounds, nobody watching:

```
r1  UP x2 @ 0.086   DOWN x2         UP wins    ada 10.00 → 116.80  (11.68×)   bram ☠  dez ☠
r2  UP x2                           UP wins    ada       → 578.29  (57.83×)
r3  UP x2 @ 0.588                   UP wins    ada       → 860.22  (86.02×)

registry: already settled itself on-chain ✓   × 3
```

Real orders, real settlement, real compounding. *(Bot players picking blind — the 86× is a genuine
longshot streak, not a typical run.)*

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
   browser  ◄──────►│  Next 15 · the table                    │
                    │  countdown · BTC vs the line · seats     │
                    │  pick · bank · the bell · sound          │
                    └────────────────┬────────────────────────┘
                                     │  /api/state · /api/pick · /api/bank
                    ┌────────────────▼────────────────────────┐
                    │  SQLite (Prisma) — the ledger            │
                    │  whose money is whose in a pooled wallet │
                    └────────────────▲────────────────────────┘
                                     │
                    ┌────────────────┴────────────────────────┐
                    │  Executor — one 1s tick loop             │
                    │  open → enter (batched by side) →        │
                    │  settle → redeem → roll                  │
                    └───┬──────────────────────────────┬──────┘
                        │ @somnia-chain/markets-sdk    │ viem
                        ▼                              ▼
          ┌─────────────────────────┐    ┌──────────────────────────┐
          │  dreamDEX event         │    │  ArenaRegistry.sol       │
          │  contracts (BTC 1m)     │    │  the public scoreboard   │
          │  on-chain CLOB          │    │  holds nothing, trades   │
          └───────────┬─────────────┘    │  nothing                 │
                      │                  └──────────▲───────────────┘
                      │ MarketFinalized             │ onEvent()
                      ▼                             │ SAME BLOCK
          ┌─────────────────────────────────────────┴───────────────┐
          │  Somnia reactivity precompile  0x…0100                   │
          │  validators call the handler — no keeper, no cron        │
          └──────────────────────────────────────────────────────────┘
```

**Both sponsor products, stacked.** dreamDEX event contracts are every round; Somnia's on-chain
reactivity is what ends them.

### The technical insight

The registry is a **mirror, never the source of truth** — and that's what makes a custodial executor
auditable. You don't have to trust our database: every round, entry, advance and elimination is an
event, so the whole game can be replayed from the chain.

It also caught a real bug. `enterMany` rejected a negative remainder, which is how we discovered the
executor could *overspend a player's budget*: it sized orders against the touch while being willing
to pay up to the limit, so walking the book cost 22.5379 against a 22.3464 stack. A `uint128`
on-chain refused what SQLite had happily stored.

---

## Honest disclosures

- **The executor is custodial on testnet.** One house wallet holds every stack and places every
  order. The registry is what makes that auditable rather than something you have to take on faith.
  Per-user escrow is the right production design and was deliberately out of scope.
- **Prices shown are indicative.** The 1m book is empty for the first 5–10 seconds of a window, so
  your fill is whatever the market gives you when it appears. The UI never promises a price.
- **The executor declines any entry above 0.90.** A window that has made its mind up quotes the
  favourite at 0.99 — risking a full stack for a 1% gain. It sits the round out instead.
- **No wallet needed to play.** Identity is a local key plus a name, because the executor holds the
  collateral anyway and eight people need to sit down inside three minutes.

## Provably fair

Every market carries an `oracleQuestionId`, deep-linked from the footer to
`prd.oracle.somnia.host/questions/{id}?view=graph` — every price source behind that round's
settlement, the median, and how many sources had to agree. Not a claim; a link.

---

## Run it

```bash
npm install
cp .env.example .env          # add a THROWAWAY testnet key
npx prisma db push            # create the ledger
npm run dev                   # the table on :3000
npm run executor              # the game loop (separate terminal)
```

Fund the wallet with testnet STT for gas. tUSDC mints itself — `exchange.trader.faucet()` gives
10,000 per call, and the executor does it automatically.

```bash
npm run seed 4                # seat 4 bot players, for testing with no humans
npm run spike                 # the day-0 buy → settle → redeem proof
forge test                    # 17 tests on ArenaRegistry
```

To deploy your own registry:

```bash
forge create contracts/src/ArenaRegistry.sol:ArenaRegistry \
  --rpc-url somnia_testnet --private-key $PK --broadcast --gas-limit 80000000 \
  --constructor-args 0x0000000000000000000000000000000000000100 0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23
REGISTRY=0x… npx tsx scripts/subscribe.ts
```

Set `REGISTRY` in `.env` and the executor mirrors every round on-chain. Leave it unset and the game
runs exactly as before.

## Stack

Next 15 · React 19 · Tailwind 4 · TypeScript · `@somnia-chain/markets-sdk` 0.28.1 ·
`@somnia-chain/reactivity` 0.2.1 · viem 2 · Prisma 6 + SQLite · Foundry · Solidity 0.8.28

```
src/app/          the table, the chart, the sound, the API routes
src/executor/     the tick loop and the game rules
src/lib/          chain, market, orders, registry, state
contracts/        ArenaRegistry.sol + 17 tests
scripts/spike/    day-0 proofs, kept as evidence
```

## Three traps, if you're building on this

Each of these cost us hours and none is in the docs.

1. **The SDK's `binarySettlementEventsAbi` is wrong.** It declares a trailing `uint8
   winningOutcome`; the deployed contract emits `uint256[] payoutNumerators`. Subscribing to the
   topic0 that ABI implies matches **nothing, silently** — no error, no callback, just a
   subscription that never fires. Verify a topic0 against real logs before trusting any ABI.
2. **`ORDER_TYPE` 1 is FillOrKill, 2 is IOC.** Using 1 works fine until an order is big enough to be
   unfillable, then it reverts and pays gas every retry.
3. **`forge script --broadcast` ignores `--gas-limit`.** Two deploys reverted with `gasUsed` exactly
   equal to the estimate. Somnia's gas schedule is far dearer than mainnet's — use `forge create`
   with an explicit limit, and pass explicit `gas` on every viem write.

Testnet also runs **1m and 5m** markets, not just the 15m/1h the docs list — that's mainnet. The
1-minute window is the entire reason this game works.

## AI tools

Built with Claude Code (Claude Opus). It wrote the executor, the contract and its tests, and the
table, and — more usefully — found the wrong settlement ABI by dumping live logs and brute-forcing
the event signature against the observed topic0 when the subscription silently never fired.
Every claim in this README is a transaction hash or a block number, not a model's word for it.
