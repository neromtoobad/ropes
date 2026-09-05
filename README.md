<p align="center">
  <img src="public/logo-full.png" alt="ROPES" width="220" />
</p>

# ROPES

**One rope, one minute of Bitcoin. A prediction market you can feel.**

Buy a seat for 10 tUSDC. Pick UP or DOWN on a real Bitcoin 1-minute event contract — and instead of
watching a chart, watch your climber on the wall. Their height **is** your position's live value,
second by second. The camera follows them; milestone ledges (1.5×, 2×, 3×, 5×…) slide past as you
gain; the all-time record flies as a gold flag above you.

**BAIL** at any second — your climber leaps clear and the executor *sells your position back to the
order book at live price*, and you keep what the market pays. Ride longer, climb higher. But the
bell comes every sixty seconds, and if your side is wrong when it rings, you fall.

Survive, and your winnings are already staked in the next round — your climber starts the next
minute at the height they earned. Every metre of that wall is real money on a real order book.

> **Play it: [playropes.vercel.app](https://playropes.vercel.app)** — free seat on the
> house, every trade real, on Somnia Shannon testnet (chain 50312).
> **Code: [github.com/neromtoobad/ropes](https://github.com/neromtoobad/ropes)**
> Built for the Somnia × dreamDEX Event Contracts Hackathon.

---

## Why this isn't a trading terminal with a skin on it

dreamDEX ships a fine terminal — order book, position tabs, funding history. Built for traders, and
a venue structurally can't be anything else: it must stay neutral, and it will never hold your
position across windows.

ROPES does the things a venue can't:

| | |
|---|---|
| **Composition across windows** | A winning round's proceeds are already staked in the next. Your climber's altitude is the *cumulative* multiple of a run, not one bet. |
| **A body instead of a chart** | Direction of travel picks the pose: climbing, slipping, scrabbling at the hold below 0.35×, leaping on a bail, falling at the bell. Nothing is invented — height is `ln(value/cost)`, so equal relative moves are equal metres at any altitude, a scale **measured on live rounds**, not styled. |
| **A decision every second** | BAIL is always one tap away, and its number is the live mark — sell now and that is what you keep. The market's whipsaw becomes a game of nerve. |
| **No house edge** | dreamDEX sets maker, taker and settlement fees to zero and we take no cut. The only cost of leaving early is real slippage on a real book. You can never lose more than your seat. |

The strategy layer comes free from the market: enter cheap (contrarian) and every tick moves you
far; buy the favourite and you inch. The wall makes leverage *visible*.

---

## Proof it's real

Every claim below is a transaction hash or a block number.

### The loop — buy → settle → redeem on a 1-minute market

```
BUY_YES     2 contracts @ ~0.871 IOC       paid      1.7360 tUSDC
SETTLED     winner = UP                    landed    0.2s after expiry
REDEEM      redeemed 2.0000 tUSDC          net      +0.2640 tUSDC
settle → redeemed        2.7s
```

Redeem tx [`0xd122da72…f819a3`](https://shannon-explorer.somnia.network/tx/0xd122da7260adb81096a1597f836f3aa005d3a15d8889813b3c4d7fbf79f819a3).
That 2.7 seconds inside a 60-second window is why a round is one minute.

### BAIL is an on-chain sale, not a database edit

From a live rehearsal, six seconds from tap to banked:

```
16:29:11  filled   26.42 contracts @ 0.325 (9.98 tUSDC)
16:29:17  🪂 sold  26.42 contracts back to the book for 4.4384
16:29:19  💰 banked at 0.59×  (kept 5.86 of 10 instead of riding to zero)
```

The market had collapsed against the position; the player jumped and kept what was left. That is
the game working: bail keeps the height you have.

### The full money loop, recorded, with a real wallet

One session, no cuts: 50 tUSDC deposited into a bankroll across five verified txs, a seat that
died at the bell (loss capped at the 10-tUSDC seat), a re-seat from the bankroll with no wallet
popup, two winning bells compounding 10 → 19.39 → 26.69 (2.67×), banked, then **WITHDRAW ALL**
paying the whole balance back on-chain —
[`0x30252564…f203d`](https://shannon-explorer.somnia.network/tx/0x30252564ca60859a534c6ed61c77bd0e691adaa0fcc37198141fe813a6af203d),
block 473916370. Wallet before 963.09, after 1,019.79: net **+6.70** through a death and a comeback,
every leg an on-chain transfer or a ledger row the doctor script re-audits.

### Settlement lands on-chain, in the settlement block

`ArenaRegistry` — [`0xfb31455b…95456A`](https://shannon-explorer.somnia.network/address/0xfb31455b05ea95b7B4cC4c1e98f03219b995456A)
— mirrors every round and entry, and Somnia's reactivity precompile calls its handler from *inside*
the block that finalises the market:

```
BinarySettlement MarketFinalized   block 471965999
ArenaRegistry    elimination       block 471965999
SAME BLOCK: YES
```

No keeper. No cron. No listener. Re-run it yourself:
`REGISTRY=0xfb31455b05ea95b7B4cC4c1e98f03219b995456A npx tsx scripts/spike/reactive-e2e.ts`

### 7,320 windows, and the coin is fair

The executor has run 24/7 since 26 August. As of 5 September:

```
settled windows   7,320        voided        0
UP  3,655 (49.9%)              DOWN  3,665 (50.1%)
```

Ten days of continuous minutes and not one voided window. The split is printed on
the board in-app rather than buried here — a game that pays 1/p has to show you the
coin is straight.

### The verdicts are the chain's verdicts

After three straight test-run deaths looked suspicious, the last six settled positions were audited
against the venue's own on-chain resolution: **6 of 6 agree**. The streak was market luck
(~0.6% combined odds), and the audit is a script anyone can rerun.

---

## What a minute actually gives you

Beyond picking a side, the round is built so a one-minute cadence never feels like a scramble:

| | |
|---|---|
| **Queue the next side while riding** | Tap UP or DOWN mid-round and the bell rolls a survivor straight into the next window — no dead air, no re-clicking under a countdown. |
| **Auto-bail at a target** | Name a multiple and the executor sells the moment the book can *actually* pay it. It marks against real resting depth for the whole position, not the touch — a thin book that shows 3× but can only fill 1.7× does not trigger it. |
| **Mint your own test money** | The wallet page mints 10,000 tUSDC from your own wallet in one tap. No faucet page exists for this token; the contract mints to whoever calls it. |
| **Plays on a phone** | Controls pin to the bottom of the screen under your thumb, the wall takes the top half, and the roster scrolls. Verified at 375px. |
| **Falls back rather than freezing** | If the venue stops publishing 1-minute windows — it did for 90 minutes on 4 Sep — the game drops to the 5-minute market and returns to 1m by itself. It never plays anything longer. |

---

## Architecture

```
                 ┌──────────────────────────────────────────────┐
   browser ◄────►│  Next 15 · the wall                          │
                 │  climber (camera-follow) · milestone ledges  │
                 │  record flag · BAIL bar · the bell · sound   │
                 └───────────────┬──────────────────────────────┘
                                 │ /api/state · /join · /pick · /bank
                 ┌───────────────▼──────────────────────────────┐
                 │  Postgres (Prisma) — the ledger              │
                 │  whose money is whose in a pooled wallet     │
                 └───────────────▲──────────────────────────────┘
                                 │
                 ┌───────────────┴──────────────────────────────┐
                 │  Executor — one 1s tick loop                 │
                 │  open → enter → sell bails → settle →        │
                 │  redeem → roll                               │
                 └───┬──────────────────────────────────┬───────┘
                     │ @somnia-chain/markets-sdk        │ viem
                     ▼                                  ▼
       ┌─────────────────────────┐       ┌──────────────────────────┐
       │  dreamDEX event         │       │  ArenaRegistry.sol       │
       │  contracts (BTC 1m)     │       │  public scoreboard —     │
       │  on-chain CLOB          │       │  holds nothing, trades   │
       └───────────┬─────────────┘       │  nothing                 │
                   │ MarketFinalized     └──────────▲───────────────┘
                   ▼                                │ onEvent()
       ┌────────────────────────────────────────────┴──────────────┐
       │  Somnia reactivity precompile  0x…0100                    │
       │  validators call the handler — SAME BLOCK as settlement   │
       └───────────────────────────────────────────────────────────┘
```

**Both sponsor products, stacked.** dreamDEX event contracts are every round; Somnia's on-chain
reactivity is what ends them.

**The one-nonce rule shapes the design.** The executor wallet has a single nonce manager (the
SDK's), so *every* order — entries and bail sales — goes through the executor's tick. The BAIL
button only raises a flag; the leap plays instantly and the sale lands one tick behind it. If the
book can't fill, the flag survives to the next tick; if the bell wins the race, settlement resolves
the player instead — whichever reaches them first.

**The registry is a mirror, never the source of truth** — and that's what makes a custodial
executor auditable. It also caught a real bug: a `uint128` rejected a negative remainder the
ledger had happily stored, exposing an order-sizing overspend.

---

## Honest disclosures

- **Custodial, on testnet.** One house wallet holds every stack and places every order; the
  on-chain registry is what makes that auditable rather than taken on faith. Per-user escrow is
  the production design and was deliberately out of scope.
- **Prices are indicative until filled.** The 1m book is empty for the first 5–10 seconds of a
  window; your fill is what the market gives when it appears. The UI never promises a price.
- **Entries above 0.90 are declined.** Risking a full stack for a 1% gain is a bad trade; the
  executor sits the round out instead.
- **Bail pays what the book pays.** The sale is IOC at the floor — an exit, not a negotiation.
  Slippage is the fee for leaving, and it is the only fee anywhere in the game.
- **Solo by design, today.** Tables, pots and the last-one-standing champion are built, tested
  (17 Foundry tests) and parked behind the multiplayer flag — one climber's minute had to be
  great first.
- **Fund a bankroll, or don't.** Deposit tUSDC once on the wallet page (verified by receipt,
  replay-proof — each tx credits exactly once). Seats debit the bankroll with no popup, a run's
  proceeds credit it back the moment the run ends, and **WITHDRAW ALL** sends the whole balance
  on-chain on the executor's next tick. The withdrawal address is *derived from the first
  deposit's sender*, never taken from the browser — claiming someone else's tx just pays them.
  No wallet still works: free play on the house bankroll, every trade still real, and free-play
  proceeds never credit a balance (no faucet leak). In-round trading is custodial either way —
  one sequential writer is what makes a 1-minute cadence possible.

## Provably fair

Every market carries an `oracleQuestionId`, deep-linked from the app to
`prd.oracle.somnia.host/questions/{id}?view=graph` — every price source behind that round's
settlement, the median, and how many sources had to agree. Not a claim; a link.

---

## Run it

```bash
npm install
cp .env.example .env          # add a THROWAWAY testnet key
npx prisma db push            # create the ledger
npm run dev                   # the wall on :3000
npm run executor              # the game loop (separate terminal — always via the supervisor)
```

Fund the wallet with testnet STT for gas. tUSDC needs no faucet page: `faucet(uint256)` on the
collateral contract mints to whoever calls it, so the wallet page mints straight from the player's
own wallet (10,000 per call, ~0.0005 STT of gas). The house funds none of it.

```bash
npm run doctor                # does the money add up? (--fix repairs the safe ones)
npm run spike                 # day-0 buy → settle → redeem proof
npx tsx scripts/spike/climb.ts   # the motion study behind the height curve
forge test                    # 17 tests on ArenaRegistry
```

Set `REGISTRY` in `.env` and the executor mirrors every round on-chain; leave it unset and the game
runs exactly the same without the public log.

## Stack

Next 15 · React 19 · Tailwind 4 · TypeScript · `@somnia-chain/markets-sdk` 0.28.1 ·
`@somnia-chain/reactivity` 0.2.1 · viem 2 · Prisma 6 + Postgres · Foundry · Solidity 0.8.28

```
src/app/          the wall, the climber, sound, API routes
src/executor/     the tick loop, game rules, tables (multiplayer, parked)
src/lib/          chain, market, orders (buy/sell/redeem), registry, state
contracts/        ArenaRegistry.sol + 17 tests
scripts/          doctor, sprites pipeline, day-0 proofs kept as evidence
public/climbers/  8 characters × 5 poses + 6-frame climb cycles, generated and auto-cut
```

## Three traps, if you're building on this

Each cost us hours and none is in the docs.

1. **The SDK's `binarySettlementEventsAbi` is wrong.** It declares a trailing `uint8
   winningOutcome`; the deployed contract emits `uint256[] payoutNumerators`. Subscribing to the
   topic0 that ABI implies matches **nothing, silently**. Verify topic0 against real logs.
2. **`ORDER_TYPE` 1 is FillOrKill, 2 is IOC.** Using 1 works until an order is big enough to be
   unfillable, then it reverts and pays gas on every retry.
3. **`forge script --broadcast` ignores `--gas-limit`.** Somnia's gas schedule is far dearer than
   mainnet's — this contract needed >20M actual against a 1.4M estimate. Use `forge create
   --gas-limit 80000000`, and explicit `gas` on every viem write.

Also: testnet runs **1m and 5m** markets, not just the 15m/1h the docs list. The one-minute window
is the entire reason this game works — and it can vanish. Every cadence under four hours
disappeared for ~90 minutes on 4 September, which froze the game completely until we taught it to
fall back. If you build on these markets, assume the window you depend on will go away.

## AI tools

The eight climbers (five poses and a six-frame rope-climb cycle each) and both logos were
generated with Higgsfield
(`nano_banana_pro`), then auto-cut into sprites by a pipeline that splits pose sheets on
column-density valleys and keeps the largest connected blob per frame. The height curve was not
designed — it was **measured**, by sampling live rounds every second and sweeping the gain until
the smallest climbs became visible without clipping the dramatic ones.
