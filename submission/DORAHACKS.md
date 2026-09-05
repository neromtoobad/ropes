# ROPES — DoraHacks submission sheet

Every field ready to paste. Figures verified 5 Sep 2026.
Judging weights: technical 25 · innovation 20 · UX 20 · ecosystem 20 · presentation 15.

---

## 1. BUIDL name

```
ROPES
```

## 2. Logo

`submission/logo/ropes-logo-1024.png` — square knot, brand background.

## 3. One-liner

```
Every sixty seconds, Bitcoin decides whether you live. ROPES plays a dreamDEX
event contract as a survival game — and the chain itself does the killing, in the
same block the market settles.
```

*Alternates, if the form wants something shorter:*

```
A one-minute Bitcoin market, played as a survival game. The chain eliminates you
in the block it settles.
```

```
Bitcoin decides who lives, every sixty seconds.
```

## 4. Links

| Field | Value |
|---|---|
| Live demo | `https://playropes.vercel.app` |
| Source code | `https://github.com/neromtoobad/ropes` |
| Demo video | **← upload `ropes-demo.mp4` to YouTube (unlisted is fine), paste URL** |
| Network | Somnia Shannon testnet, chain 50312 |

## 5. Track

**Somnia × dreamDEX Event Contracts.** Say plainly in the form that the project
ships **both** sponsor products, not one:

- **dreamDEX Event Contracts** — every round is a real order on the BTC 1-minute
  binary market. No simulation anywhere in the loop.
- **Somnia on-chain reactivity** — the precompile calls our `ArenaRegistry`
  handler *inside* the settlement block. No keeper, no cron, no listener.

## 6. Tech stack (tags)

```
Next.js 15 · React 19 · TypeScript · Tailwind · viem · Prisma + Postgres ·
Solidity 0.8.28 · Foundry · @somnia-chain/markets-sdk 0.28.1 ·
@somnia-chain/reactivity 0.2.1 · Somnia Shannon testnet
```

---

## 7. Description

*(paste everything below this line)*

---

## ROPES

**Every sixty seconds, Bitcoin decides whether you live.**

You take a seat for 10 tUSDC — or a free one on the house, no wallet needed. You
pick UP or DOWN before the window locks, and your whole stack goes in. Then a
character on a rope becomes your position: Bitcoin ticks up and they climb, ticks
down and they sink. Bet DOWN and you are willing them to fall.

At the bell, the market settles on-chain. Right side, and your stack multiplies by
1/p — the price you actually filled at — and it is *already staked* in the next
minute. Wrong side, and you fall, for no more than your seat.

That is the whole game, and it runs every minute, forever.

### In thirty seconds

- **A real trade, every round.** Every entry is an order on a live dreamDEX CLOB.
  The payouts are 1/p from the order book, not a house line. There is no edge and
  no cut, because dreamDEX sets all fees to zero.
- **The chain ends the round.** Somnia's reactivity precompile calls our registry
  contract from inside the block that finalises the market. Eliminations are not
  something our server decides and then reports.
- **7,320 windows settled**, 0 voided, 49.9% UP / 50.1% DOWN. The coin is fair and
  we print that on screen instead of hiding it.
- **Free to try, instantly.** No wallet, no funds, no signature — one click seats
  you in the next live round, and the trade behind it is still real.
- **Every claim below is a hash or a block number you can check without us.**

### Why this isn't a chart with a skin on it

dreamDEX ships a fine trading terminal — order book, position tabs, funding
history. Built for traders, and a venue structurally can't be anything else: it
must stay neutral, and it expires.

That last part is the opening. **A market will never hold your position into the
next one.** It cannot compound you, it cannot remember you, and it cannot decide
you are out. Those are exactly the things a game needs, and exactly the gap ROPES
fills:

| A venue can't | ROPES does |
|---|---|
| Carry a position past expiry | Winnings are staked into the next minute automatically |
| Remember you across windows | A run has an altitude, a best, a record, a ledger |
| Eliminate anyone | Losing a window ends the run — recorded on-chain |
| Be watched | Height is `ln(value / cost)`, so the price *is* the picture |

Height is a real log scale, not decoration: equal relative moves are equal metres
whether it's your first round or your fifth, so a 2× and a 0.5× are the same
distance in opposite directions.

### The technical claim: same-block settlement

`ArenaRegistry` (`0xfb31455b05ea95b7B4cC4c1e98f03219b995456A`) mirrors every round
and entry. Somnia's reactivity precompile calls its handler from *inside the block
that finalises the market*:

```
BinarySettlement  MarketFinalized   block 471965999
ArenaRegistry     elimination       block 471965999
SAME BLOCK: YES
```

Two different transactions, none of our code running between them. No keeper. No
cron job. No listener polling for changes. `scripts/spike/reactive-e2e.ts` re-runs
the whole proof from scratch, and 17 Foundry tests cover the contract.

This is what turns a custodial executor from *trust us* into *check it yourself* —
and it is why the project uses both sponsor products rather than one.

### Verify it — no wallet, no funds, no gas

**1. The contract's rules, offline.**

```bash
git clone --recurse-submodules https://github.com/neromtoobad/ropes
cd ropes && forge test        # 17 passed, 0 failed
```

**2. The elimination, inside the settlement block.** Somnia's public RPC is
archival, so `cast` alone is enough:

```bash
RPC=https://api.infra.testnet.somnia.network
B=471965999

# our registry: the run that died
cast logs --address 0xfb31455b05ea95b7B4cC4c1e98f03219b995456A \
  --from-block $B --to-block $B --rpc-url $RPC

# the venue finalising the market, same block
cast logs --address 0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23 \
  --from-block $B --to-block $B --rpc-url $RPC
```

Don't take our word for what those logs are — hash the signatures:

```bash
cast keccak "RunEliminated(bytes32,bytes32,uint128)"
# 0x33cf708dbb6705ca1167f2e4355c87a16ca80ddb2035bd09351d1fbf046e1b8d — ours

cast keccak "MarketFinalized(uint256,address,uint64,address,uint256,bool,uint256[])"
# 0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178 — the venue's
```

Registry tx `0x492e7bcd…`, venue tx `0xaabefabd…`, one block: **471965999**.

*(If you compare against the SDK: `binarySettlementEventsAbi` declares a trailing
`uint8 winningOutcome`, but the deployed contract emits `uint256[]
payoutNumerators` — which is why the signature above is the one that actually
hashes to the on-chain topic0. We reported it.)*

**3. The money went out, not just in.** Withdrawal `0x30252564…f203d`, block
473916370 — a real tUSDC transfer from the house wallet back to a player's own
address.

**4. The game.** playropes.vercel.app, phone or laptop. The free seat needs no
wallet, no funds and no signature — and the round it plays is still a real order on
a real book.

### Proof, not adjectives

- **Buy → settle → redeem** on a 1-minute market: 2 contracts @ 0.871 IOC,
  redeemed for 2.0000 tUSDC, net +0.2640 — tx `0xd122da72…f819a3`. Settlement
  landed **0.2s after expiry**; the redeem-and-roll took 2.7s, comfortably inside a
  60-second window.
- **A full money round-trip with a real wallet:** 50 tUSDC deposited across five
  verified transfers, a seat lost at the bell, a re-seat from the bankroll with no
  wallet popup, two winning bells compounding 10 → 19.39 → 26.69 (2.67×), banked,
  then **WITHDRAW ALL** paid back on-chain. Net **+6.70** through a death and a
  comeback.
- **The verdicts are the chain's verdicts.** After three straight losses looked
  suspicious, we audited the last six settled positions against the venue's own
  on-chain resolution: 6 of 6 agreed.

### What 7,320 windows taught us

The executor has run 24/7 since 26 August:

- **0 voided.** Not one.
- **49.9% UP / 50.1% DOWN** (3,655 / 3,665). The coin is fair, and the game says so
  on screen.
- Books are **empty for the first 5–10 seconds** of a new 1m window, so entry has
  to retry across the window instead of firing once at the open.
- Depth is thin — a 10.00 budget often can't be filled at the touch — so orders
  size against the *worst* price they'd accept and top up on a second pass. Getting
  this backwards overspends the budget, which we found the hard way.
- Settlement really is near-instant: 0.2s and 1.2s after expiry across runs, with
  no keeper anywhere.

### Ecosystem impact

Most Event Contract markets show `trades = 0`. ROPES is built so that **one seat
becomes an order every single minute it survives** — bought once, compounded by the
game. Orders are batched one-per-side-per-round and split pro rata at the average
fill, so everyone on a side pays exactly the same price.

Volume is honest hackathon scale — 34 on-chain orders across 30 runs, 417.21 tUSDC
staked, 16 players. The shape is the point: a consumer product whose *normal*
operation is continuous trading on the thinnest markets the venue has.

We also filed a concrete integration report of ~10 SDK and documentation issues
found the hard way, including:

1. `binarySettlementEventsAbi` declares a trailing `uint8 winningOutcome`; the
   deployed contract emits `uint256[] payoutNumerators`. Subscribing to the topic0
   the published ABI implies matches **nothing, silently**.
2. `ORDER_TYPE` 1 is FillOrKill and 2 is IOC — using 1 reverts
   `FillOrKillNotFillable()` and burns gas on every retry.
3. `forge script --broadcast` ignores `--gas-limit`; this contract needed >20M
   actual against a 1.4M estimate.
4. Testnet runs 1m/5m/15m/60m/240m/1440m cadences — the docs list only 15m and 1h.
   The 1-minute window is the entire reason this game works.
5. `fetchOrderBook(symbol)` hangs without `loadMarkets()`; `watchMarket(pool)` +
   `getLiveBinaryOrderBook(pool)` is sub-second and needs no symbol.
6. `getOutcomeBalance` takes an object, not positional args; there is no
   `getCollateralBalance` at all.
7. A reactivity subscription is **removed**, not paused, when the owner's balance
   falls under 32 STT — and topping back up does not revive it. We found this by
   watching same-block settlement quietly stop.

### Honest limits

We would rather say these than have you find them.

- **Custodial, on testnet.** One house wallet holds every stack and places every
  order. The on-chain registry is precisely what makes that auditable instead of
  trusted. Per-user escrow is the production design and was deliberately out of
  scope for a hackathon.
- **Prices are indicative until filled.** The 1-minute book is empty at the open,
  so the UI never promises a price it hasn't got — it shows the fill after the
  fact.
- **Entries above 0.90 are declined.** Risking a whole stack for a 1% gain is a bad
  trade, so the executor sits the round out.
- **The venue's short cadences can vanish.** On 4 Sep every window under 4h
  disappeared for ~90 minutes and the game froze. It now falls back to a 5-minute
  window when no 1-minute window exists, and returns to 1m by itself.
- **Multiplayer is built and tested but parked behind a flag.** Tables, pots and a
  last-one-standing champion all work — we've run a 4 → 2 → 0 wipeout end to end —
  but one player's minute had to be great first, and we don't put fake players on
  screen to look busier than we are.

---

## 8. Before you hit submit

- [ ] **Upload `ropes-demo.mp4` to YouTube** and paste the URL. Only blocking item
      — DoraHacks wants a link, not a file.
- [ ] Upload `submission/logo/ropes-logo-1024.png` as the logo.
- [ ] Open `playropes.vercel.app` and check the clock is counting down.
- [ ] Run `npm run doctor` — the house wallet must be **above 32 STT** or
      same-block settlement, the centrepiece of the pitch, silently stops.
- [ ] Deadline: **8 Sep 2026, 19:00 UTC**.
