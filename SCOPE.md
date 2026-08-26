# scope — LAST CANDLE

somnia × dreamdex event contracts hackathon. solo, frontend-led, 13 days.
deadline **8 sep 2026, 18:00**. target submit **7 sep**.

---

## the game

**a battle royale on bitcoin. every minute, half the players die.**

you buy a seat for 10 tUSDC. every minute a round runs on a real dreamDEX BTC 1m market.
pick UP or DOWN. wrong side, you are out and your stack is gone. right side, your stack grows
and it is *already* in the next round.

```
round 1    8 alive     your stack  10
round 2    4 alive                 20
round 3    2 alive                 40
round 4    1 alive                 80
```

**bank out any time.** sell your position mid-round and walk with what it is worth right now.
your run ends, your final multiple goes on the board. four players left, you are up 8x, forty
seconds on the clock — take it or push.

that decision, once a minute, is the product.

### the strategy layer, which the market gives us for free

your stack grows by **1/p**, where p is the price you paid. if the crowd piles onto UP, UP gets
expensive (p = 0.8, you gain 25%) and DOWN gets cheap (p = 0.2, you 5x).

**being contrarian pays, and you can see the crowd's positions on screen.** that is a real
strategy layer and we did not have to invent any of it — it falls out of the order book.

### why 8 seats beats 100

5–10 players is the realistic number and it is also the *better* number. eight named seats at a
poker table, every stack visible and moving, is more legible and more personal than a hundred
anonymous dots. lean into small and intense. build the table for 8, overflow to a list.

---

## why this wins

judging is technical 25 · innovation 20 · UX 20 · ecosystem 20 · presentation 15.

➠ **both sponsor products stack.** dreamDEX event contracts for the rounds, somnia on-chain
  reactivity to advance the game the instant a market settles. the workflow doc is right that
  being the only team doing that is its own category — and somnia's 2026 roadmap is literally
  reactive features + prediction markets + AI.
➠ **not a reskin of their app.** app.dreamdex.io is a desktop trading terminal — order book,
  open orders, funding history. it is built for traders. a venue structurally cannot run a
  tournament on its own book, and it will never hold your position across windows.
➠ **the tournament is not simulated.** winners take losers' money, the field concentrates, the
  survivors compound. that is just what happens when a crowd repeatedly trades one market. we
  draw the battle royale that is already inside the mechanics.
➠ **we create the volume.** a resting MM quotes the books, but almost every market shows
  `trades = 0` — there is essentially no organic flow. one seat fires an order every single
  minute. verifiable ecosystem impact, not a claim.
➠ **the whole game fits in the demo, live.** `8 → 4 → 2 → 1` at 1m rounds is three minutes.

---

## rules, exactly

| | |
|---|---|
| round | one BTC **1m** dreamDEX market, on the real clock (every minute, on the minute) |
| buy-in | 10 tUSDC, fixed. one seat |
| pick | UP or DOWN before the round locks. your **whole stack** goes in |
| win | stack × 1/p, already staked in the next round |
| lose | eliminated, stack gone, capped at what you put in |
| bank | sell mid-round at live value, run ends, multiple recorded |
| run ends | eliminated, banked, or last standing |
| joining | no lobbies. rounds run on the global clock; whoever is in when the bell rings, plays |

**no lobby waiting.** tying rounds to the real 1m market clock means the game is always on and
never blocks on filling a lobby. a permanent "next round in 0:23" countdown is the heartbeat.

---

## the one hard problem: the roll must fit inside a round

a 1m round leaves seconds, not minutes, to settle → redeem → re-enter. **the day-0 spike measures
exactly this**, and the measured number picks the cadence:

```
settle -> redeemed   < 25s   ->  1m rounds        three-minute battle royale
                     < 90s   ->  5m rounds        still filmable
                     else    ->  15m rounds       the original plan
```

fill risk is largely handled for us — a resting MM already quotes ~200 contracts at ~0.025 on
every cadence, so players fill against it even when lopsided. ours is a backstop.

fair value is computable in closed form, which is unusual and worth saying out loud: settlement
here is purely mechanical (close vs open), so a round is a driftless digital option —
`p = N(d₂)`, `d₂ = ln(Sₜ/S₀)/(σ√τ) − σ√τ/2`, with σ from the historical tape. ~20 lines, and it
prices both the MM's quotes and the payout numbers on screen.

---

## scope cuts

**1. house executor wallet, disclosed.** the executor holds stacks and does the rolling. for a
*game* this is natural — you buy into an arena. a per-user escrow contract is the right production
design and the wrong hackathon design. saves ~4 days. the video says it plainly.

**2. reactivity advances the game, it does not trade.** `ArenaRegistry.sol` subscribes to market
resolution and eliminates/advances players on-chain in the same block. it does **not** place
orders — driving the CLOB from a contract means custody and a much bigger contract. ~150 lines,
the floor for a frontend-led solo dev. honest line for the video: *"eliminations land on-chain in
the same block as settlement, with no keeper. execution is off-chain."*

**3. one market only: BTC 1m.** no ETH, no other cadence, no market selection. one clock, one table.

**4. the MM is a backstop, not critical path.** a resting market maker already quotes ~200
contracts at a ~0.025 spread on every cadence. build ours only if players fail to fill.

---

## phases

| phase | dates | output |
|---|---|---|
| 0 — spike | 26 aug | buy→settle→redeem transcript, 3 tx hashes |
| 1 — the loop | 27–29 aug | executor rolls stacks unattended at the chosen cadence |
| 2 — the table | 30 aug–2 sep | 8 seats, live stacks, pick, bank, countdown |
| 3 — reactive registry | 3–4 sep | eliminations land on-chain in-block |
| 4 — real run | 5 sep | 8 friends, one full recorded run |
| 5 — submission | 6–7 sep | README, 4 slides, <3min video |
| buffer | 8 sep | submit before 18:00 |

---

## kill criteria

decide at the phase boundary, not on 7 sep.

| if | then |
|---|---|
| settle→redeem is slower than 90s | fall back to 15m rounds and edit the demo video |
| faucet cannot fund the 32 SOM reactivity subscription | drop reactivity, use an event listener, make no reactivity claim |
| phase 3 not working by **4 sep EOD** | ship 1+2+4, delete the reactivity slide |
| cannot gather 8 humans for the real run | run 4 real + narrate honestly; never fake players on screen |

**the table is the product.** if it comes to a choice, ship phases 1, 2 and 4 polished and drop
phase 3 entirely. small and complete beats large and half-built.

---

## the demo

at 1m rounds a full run is ~3 minutes, so it can be shown **live and uncut**. that is a large
presentation win — no editing, no time-lapse, nothing a judge has to take on trust.

➠ **5 sep**: run one genuine 8-player run with real people, screen-record all of it
➠ it should fit the video almost uncut, timestamps and tx hashes visible throughout
➠ show **one live elimination** in real time so the reactive handler fires on camera
➠ keep a real run going during judging, linked from the README

**the moment a judge remembers:** the bell rings, four stacks go dark at once, four stacks double.

---

## open

➠ name — **LAST CANDLE** (candlestick + last one standing). backup: SUDDEN DEATH
➠ closing line for the video
➠ whether banked runs re-enter with a fresh 10 tUSDC buy-in or sit out a round
