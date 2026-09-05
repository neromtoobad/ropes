# ROPES — DoraHacks submission sheet

Everything the form asks for, ready to paste. Figures verified 5 Sep 2026.

---

## 1. BUIDL name

```
ROPES
```

## 2. Logo

Upload `submission/logo/ropes-logo-1024.png` (square knot, brand background).

## 3. One-liner

```
A dreamDEX Event Contract is one binary, one minute. ROPES makes it something you
can feel — your climber hangs on a rope and is your live position — and when the
window settles, Somnia's on-chain reactivity ends the round inside the same block.
```

## 4. Links

| Field | Value |
|---|---|
| Live demo | `https://playropes.vercel.app` |
| Source code | `https://github.com/neromtoobad/ropes` |
| Demo video | **← upload `ropes-demo.mp4` to YouTube (unlisted is fine) and paste the URL** |
| Network | Somnia Shannon testnet, chain 50312 |

## 5. Tracks / bounties

Submit to the **Somnia × dreamDEX Event Contracts** track. The project uses
**both** sponsor products, which is worth stating explicitly in the form:

- **dreamDEX Event Contracts** — every round is a real order on the BTC 1-minute
  binary market.
- **Somnia on-chain reactivity** — the reactivity precompile calls our
  `ArenaRegistry` handler inside the settlement block.

## 6. Tech stack (tags)

```
Next.js 15 · React 19 · TypeScript · Tailwind · viem · Prisma + Postgres ·
Solidity 0.8.28 · Foundry · @somnia-chain/markets-sdk 0.28.1 ·
@somnia-chain/reactivity 0.2.1 · Somnia Shannon testnet
```

## 7. Description

*(paste the whole block below)*

---

### One binary, one minute

Every dreamDEX Event Contract asks the same question: does BTC close at or above
where this window opened? It's a genuine on-chain CLOB, and dreamDEX ships a fine
terminal for it — order book, position tabs, funding history. Built for traders,
and a venue structurally can't be anything else.

ROPES is what that primitive looks like when you stop drawing it as a chart.

You buy a seat for 10 tUSDC — or take a free one on the house, no wallet needed —
and pick UP or DOWN before the window locks. Your whole stack goes in. From then
on a character on a rope *is* your position: BTC ticks up, they climb; ticks down,
they sink. Bet DOWN and you're willing them to fall. Height is `ln(value / cost)`,
so equal relative moves are equal metres whether it's your first round or your
fifth.

At the bell the window settles on-chain. Right side and your stack multiplies by
1/p — the price you actually filled at — and it is *already staked* in the next
minute. Wrong side and you fall, for no more than the seat. BAIL is always one tap
away and sells your position back to the book at the live mark, so leaving early
costs you real slippage and nothing else.

One minute is short, so the game removes the scramble rather than the pressure.
While riding you can queue the next side, and the bell rolls a survivor straight
into the following window with no dead time. Auto-bail does the same for the exit:
name a multiple and the executor sells the moment the book can actually pay it,
marking against real depth rather than the touch.

### The part that isn't a skin: same-block settlement

`ArenaRegistry` (`0xfb31455b05ea95b7B4cC4c1e98f03219b995456A`) mirrors every round
and entry, and Somnia's reactivity precompile calls its handler from *inside the
block that finalises the market*:

```
BinarySettlement  MarketFinalized   block 471965999
ArenaRegistry     elimination       block 471965999
SAME BLOCK: YES
```

No keeper. No cron job. No listener polling for changes. The chain ends the round
itself, and `scripts/spike/reactive-e2e.ts` re-runs the whole proof from scratch.
17 Foundry tests cover the contract.

This is what makes a custodial executor auditable rather than taken on faith — and
it's why the project uses **both** sponsor products rather than one.

### Proof, not adjectives

- **Buy → settle → redeem** on a 1-minute market: 2 contracts @ 0.871 IOC,
  redeemed for 2.0000 tUSDC, net +0.2640 — tx `0xd122da72…f819a3`. Settlement
  landed **0.2s after expiry**; the redeem-and-roll took 2.7s, inside a 60-second
  window.
- **A full money round-trip with a real wallet:** 50 tUSDC deposited across five
  verified transfers, one seat lost at the bell, a re-seat from the bankroll with
  no wallet popup, two winning bells compounding 10 → 19.39 → 26.69 (2.67×),
  banked, then **WITHDRAW ALL** paying the balance back on-chain — tx
  `0x30252564…f203d`, block 473916370. Net **+6.70** through a death and a
  comeback.
- **The verdicts are the chain's verdicts.** After three straight losses looked
  suspicious, the last six settled positions were audited against the venue's own
  on-chain resolution: 6 of 6 agreed.

### Verify it yourself — no wallet, no funds, no gas

**1. The contract's rules, offline.**

```bash
git clone --recurse-submodules https://github.com/neromtoobad/ropes
cd ropes && forge test        # 17 passed, 0 failed
```

**2. The elimination, on-chain, inside the settlement block.** Somnia's public RPC
is archival, so `cast` alone is enough:

```bash
RPC=https://api.infra.testnet.somnia.network
B=471965999

# our registry: the run that died
cast logs --address 0xfb31455b05ea95b7B4cC4c1e98f03219b995456A \
  --from-block $B --to-block $B --rpc-url $RPC

# the venue finalising the market, in that same block
cast logs --address 0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23 \
  --from-block $B --to-block $B --rpc-url $RPC
```

Confirm both topic0 values rather than taking our word:

```bash
cast keccak "RunEliminated(bytes32,bytes32,uint128)"
# 0x33cf708dbb6705ca1167f2e4355c87a16ca80ddb2035bd09351d1fbf046e1b8d — ours

cast keccak "MarketFinalized(uint256,address,uint64,address,uint256,bool,uint256[])"
# 0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178 — the venue's
```

Registry tx `0x492e7bcd…`, venue tx `0xaabefabd…`, one block: **471965999**. No
code of ours ran between them.

*(Note for anyone comparing against the SDK: the published
`binarySettlementEventsAbi` declares a trailing `uint8 winningOutcome`, but the
deployed contract emits `uint256[] payoutNumerators` — which is why the signature
above is the one that actually hashes to the on-chain topic0.)*

**3. The money.** The withdrawal is `0x30252564…f203d` at block 473916370 — a real
tUSDC transfer out of the house wallet back to a player's own address.

**4. The game.** Play it at playropes.vercel.app, on a phone or a laptop. The free
seat needs no wallet, no funds and no signature, and every round it plays is a real
order on a real book.

### Measured while building

The executor has tracked **7,320 settled BTC 1-minute windows** on Shannon (as of
5 Sep, still counting — it runs 24/7):

- **0 voided.** Not one, across every window observed.
- **49.9% UP / 50.1% DOWN** (3,655 / 3,665) — the coin is fair, and the game says
  so on screen rather than hiding it.
- Books are **empty for the first 5–10 seconds** of a new 1m window, so entry has
  to retry across the window rather than fire once at open.
- Depth is thin: a 10.00 budget frequently can't be deployed at the touch, so
  orders size against the *worst* price they'd accept and top up on a second pass.
- Settlement is genuinely near-instant: 0.2s and 1.2s after expiry across runs,
  with no keeper involved.

### Ecosystem impact

Most Event Contract markets show `trades = 0`. ROPES is built so that **one seat
becomes an order every single minute it survives** — the seat is bought once, and
the compounding does the rest. Orders are batched one-per-side-per-round and split
pro rata at the average fill, so every player on a side pays exactly the same
price.

Volume so far is honest hackathon scale — 34 on-chain orders across 30 runs, 417.21
tUSDC staked, 16 players — but the shape is what matters: this is a consumer
product whose *normal* operation is continuous trading on the thinnest markets the
venue has.

We also filed a concrete integration report of ~10 SDK and documentation issues
found the hard way, including:

1. `binarySettlementEventsAbi` declares a trailing `uint8 winningOutcome`; the
   deployed contract emits `uint256[] payoutNumerators`. Subscribing to the topic0
   the published ABI implies matches **nothing, silently**.
2. `ORDER_TYPE` 1 is FillOrKill and 2 is IOC — using 1 reverts
   `FillOrKillNotFillable()` and pays gas on every retry.
3. `forge script --broadcast` ignores `--gas-limit`; Somnia's gas schedule needed
   >20M against a 1.4M estimate.
4. Testnet runs 1m/5m/15m/60m/240m/1440m cadences — the docs list only 15m and 1h.
   The 1-minute window is the entire reason this game works.
5. `fetchOrderBook(symbol)` hangs without `loadMarkets()`; `watchMarket(pool)` +
   `getLiveBinaryOrderBook(pool)` is sub-second and needs no symbol.
6. `getOutcomeBalance` takes an object, not positional args; there is no
   `getCollateralBalance` at all.
7. A reactivity subscription is **removed**, not paused, when the owner's balance
   falls under 32 STT — and topping back up does not revive it. We learned this by
   watching same-block settlement quietly stop.

### Honest limits

- **Custodial, on testnet.** One house wallet holds every stack and places every
  order; the on-chain registry is what makes that auditable. Per-user escrow is the
  production design and was deliberately out of scope.
- **Prices are indicative until filled.** The UI never promises a price it hasn't
  got.
- **Entries above 0.90 are declined** — risking a whole stack for a 1% gain is a
  bad trade, so the executor sits the round out.
- **No house edge, and we take no cut.** dreamDEX sets maker, taker and settlement
  fees to zero. Slippage on a bail is the only cost anywhere in the game, and you
  can never lose more than your seat.
- **The venue's short cadences can disappear.** On 4 Sep every window under 4h
  vanished for ~90 minutes and the game froze. It now falls back to a 5-minute
  window when no 1-minute window exists, and returns to 1m by itself.
- Tables, pots and a last-one-standing champion are built and tested but parked
  behind a multiplayer flag: one climber's minute had to be great first, and we
  don't put fake players on screen.

---

## 8. Before you hit submit

- [ ] **Upload `ropes-demo.mp4` to YouTube** and paste the URL into the video
      field. This is the only blocking item — DoraHacks wants a link, not a file.
- [ ] Upload `submission/logo/ropes-logo-1024.png` as the logo.
- [ ] Check the live URL loads and the clock is counting: `playropes.vercel.app`.
- [ ] Confirm the house wallet is above **32 STT**, or same-block settlement —
      the centrepiece of the pitch — will silently stop. Run `npm run doctor`.
- [ ] Deadline: **8 Sep 2026, 19:00 UTC**.
