# BUILD_GUIDE — LAST CANDLE

solo, 13 days, claude code. one thing at a time. **commit after every phase.**
delete before submission.

> revise this after the day-0 spike. the spike is what tells us whether the books are alive, and
> that changes phase 1.

⚑ = critical path. everything downstream stops if this breaks.

---

## day 0 — 26 aug — the spike ⚑

work through `PHASE_0_CHECKLIST.md` top to bottom first. then:

**1. prove the loop.** ⚑

```
read CLAUDE.md and PHASE_0_CHECKLIST.md. write ONE throwaway script at
scripts/spike/loop.ts that does exactly this and nothing more:
1. list live BTC 15m markets, gate on getMarketOnchain status === 1
2. buy UP on one with >5 minutes left, print the tx hash and the fill
3. print the book depth on BOTH sides before buying
4. poll until the market is Finalized
5. find it via listBinaryMarkets({ status: "Finalized" }), NOT loadMarkets()
6. redeem with an explicit outcome index, print the tx hash and the balance change

no abstractions, no framework, no error handling beyond printing. read the gotchas
doc first and tell me which ones apply before you write any code.
```

success: three tx hashes in one transcript. paste it into CLAUDE.md under `## spike proof`.

if it fails: fix only the first failing step. do not move on. the whole build sits on this.

**2. record what the books look like.** note depth on both sides. if both are empty, the market
maker becomes the single most important thing in the project and phase 1 reorders around it.

---

## days 1–3 — 27–29 aug — the loop and the market maker ⚑

no UI at all this phase. the game must work headless before it is worth drawing.

**3. game state.** ⚑

```
phase 1 starting. build services/executor with prisma + sqlite. schema only for now:
Player (wallet, displayName), Run (playerId, buyIn, status: alive|banked|eliminated),
Round (marketId, startedAt, resolvedAt, winningOutcome), Position (runId, roundId,
side, price, contracts, stackBefore, stackAfter).

key everything by marketId, never by pool address — pools are recycled between windows.
write the plan before touching code. show me and wait.
```

**4. the executor loop.** ⚑

```
build the executor loop in services/executor. every cycle:
- resolve the current live BTC 15m market, gate on on-chain status === 1
- for each alive run with a pick, place the order (IOC near lock, post-only earlier)
- on settlement: redeem winners, mark losers eliminated, roll winner stacks forward

apply these gotchas explicitly and comment where each one applies:
expireTimestampNs in nanoseconds; check balance before signing; read receipt from
order.info; catch PostOnlyWouldCross as normal; a voided market is a PUSH — nobody
dies, stacks carry.
```

success: a fake run with 2 players survives 3 real rounds unattended, stacks move correctly.

**5. the market maker.** ⚑

```
build services/mm. quote BOTH sides of the live BTC 15m market around fair value with
a configurable spread and an inventory cap.

fair value is a driftless digital option: p = N(d2), d2 = ln(St/S0)/(sigma*sqrt(tau))
- sigma*sqrt(tau)/2. estimate sigma from the historical tape via getCandles scoped to
the market's own window. put this in packages/shared — the UI needs the same numbers.

mint-a-pair means a resting Buy Up at p crosses a Buy Down at 1-p with no seller, so
quoting both sides needs zero inventory.
```

success: **every player order fills, every round, both sides.** this is the gate — if players
cannot fill, there is no game.

fallback if the MM cannot hold the book: widen the spread hard, drop to quoting only the last 5
minutes of each window, and cap seats at 4.

**6. commit and review.**

```
review everything in phase 1. flag anything half-finished, any placeholder, any silent
failure, anything that only works on my machine. then commit with a specific technical
message and tick phase 1 in CLAUDE.md.
```

---

## days 4–7 — 30 aug–2 sep — the table

this is the product. spend the time here.

**7. the table.** the whole game on one screen.

```
phase 2. build the table in apps/web: 8 seats around a dark surface, each showing name,
stack, and current pick. a countdown to the next round. a live BTC price against the
strike line. UP and DOWN buttons showing the LIVE payout multiple (1/p), not a promise.

use the SDK's react hooks and realtime watches. do not build a websocket layer.
```

**8. pick and bank.**

```
wire the two player actions: PICK (choose a side, whole stack goes in, locks at round
lock) and BANK (sell the position at live value, run ends, multiple recorded).

bank must be reachable in one tap at any moment during a round. it is the tense decision
in the game — never bury it behind a confirm dialog with a spinner.
```

**9. the bell.** ⚑ *the remembered moment — do not rush this*

```
build the resolution moment. when a round settles: losing seats go dark simultaneously,
winning stacks count up to their new value, the field count drops. one animation, ~2
seconds, no modal.

this is the frame the whole video is built around. make it feel like a guillotine.
```

**10. the crowd split.** show how many players are on each side, live. this is the strategy layer —
a crowded side pays little, a lonely side pays a lot, and seeing it is what makes the pick a
decision instead of a coin flip.

**11. the board.** finished runs, real multiples, real names. no fake entries, ever.

**12. commit and review.** same review prompt as step 6.

---

## days 8–9 — 3–4 sep — reactivity

**13. ArenaRegistry.sol.**

```
phase 3. write contracts/ArenaRegistry.sol. it subscribes to BinaryMarketsModule
resolution events via the somnia reactivity precompile. the handler advances or
eliminates each run and emits RunAdvanced / RunEliminated.

it does NOT place orders and does NOT hold funds. game state only. read the somnia
reactivity tutorial first and show me the plan before writing solidity.
```

**14. wire it up.** registry is the public verifiable mirror; sqlite stays the executor's private
bookkeeping. they coexist — that is not duplicated state.

**15. prove it.** one explorer link showing an elimination event in the **same block** as the
market's settlement. screenshot it. that link goes in the README and on a slide.

⚑ **kill criterion: not working by 4 sep EOD → ship 1+2+4, delete the reactivity slide, move on.**
do not let this eat phase 4. the table is the product.

---

## day 10 — 5 sep — the real run ⚑

**16. eight humans, one full run, recorded.**

message them the day before with an exact time. fund their wallets in advance — do not spend the
session debugging faucets while eight people wait.

- [ ] screen-record the entire run, start to finish
- [ ] capture every tx hash and explorer link as it happens
- [ ] capture at least one **bank-out** and one **multi-seat elimination**
- [ ] keep the raw recording — it is the fallback if anything breaks later

fallback: four real players, narrated honestly. **never fake players on screen.**

**17. bug pass.** fix only what broke during the real run. do not add features on day 10.

---

## days 11–12 — 6–7 sep — submission

**18. README as product page, not documentation.**

pitch at the top, architecture diagram, live results with real values, the spike transcript, the
same-block elimination explorer link, AI tools used and how.

**19. cleanup.** ⚑

```
cleanup pass: rename CLAUDE.md to AGENTS.md. remove every console.log, TODO, and
commented-out block. verify .gitignore covers .env, keys and wallet files. confirm no
key ever entered git history. delete SCOPE.md, PHASE_0_CHECKLIST.md and BUILD_GUIDE.md.
```

**20. four slides.** cover · problem vs solution with sponsor cards · architecture with one
technical insight box · demo slide, logo on black.

**21. video, under 3 minutes.** personal intro → what event contracts are → why a terminal is not
a game → the table → **the bell** → the same-block elimination → future vision → closing line.

lead the demo with the bell. cut the 45-minute run to ~50 seconds with timestamps visible.

**22. submit.** repo link, video, deck. **do not wait for 8 sep.**

---

## day 13 — 8 sep — buffer

submission is already in. use the day for the optional SDK feedback report (the guidelines ask for
it and almost nobody will bother), and competitive intelligence per step 7 of the workflow.

hard deadline **18:00**.

---

## demo checklist

- [ ] runs locally with no external API in the critical path
- [ ] recorded run saved as fallback
- [ ] a real run live during judging, linked from the README
- [ ] every claim in the video has an explorer link behind it
- [ ] the bell reads clearly at video compression

## submission checklist

- [ ] working prototype on testnet
- [ ] public github repo, `AGENTS.md` not `CLAUDE.md`
- [ ] 2–3 minute demo video
- [ ] deck (optional, do it)
- [ ] SDK feedback report (optional, do it — cheap points, nobody else will)
- [ ] git identity correct on **every** commit
- [ ] no keys in history
