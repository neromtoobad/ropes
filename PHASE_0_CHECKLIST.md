# PHASE_0_CHECKLIST — LAST CANDLE

everything before opening claude code to build. **today, 26 aug.** delete before submission.

do these in order. the spike at the end is the gate — nothing else matters until it passes.

---

## 1. accounts and access

- [ ] register as hacker on the hackathon page
      → https://dorahacks.io/hackathon/event-contracts/detail
- [ ] join the dev telegram (hackathon updates + where to ask when stuck)
      → https://t.me/+XHq0F0JXMyhmMzM0
- [ ] github repo created, **private until submission day**
- [ ] railway account (executor + MM deploy later)

## 2. wallets — read the warnings

- [ ] create a **fresh** wallet for this project. never reuse a personal one
- [ ] private key in `.env` only. `.env` in `.gitignore` **before the first commit**
- [ ] second fresh wallet for the market maker (separate from the executor)
- [ ] third fresh wallet for testing as a player
- [ ] confirm somnia shannon testnet in the wallet — **chain 50312**

⚠ testnet keys still leak into git history permanently. add `.gitignore` first, commit second.

## 3. git identity — do this before the first commit

```bash
git config user.name "<your real name>"
git config user.email "dimejikeji5@gmail.com"
git config user.email          # verify it stuck
```

- [ ] verified. **this cost a submission once at ETHGlobal Open Agents.** not optional.

## 4. funding

- [ ] request testnet STT from the hackathon faucet link
- [ ] get USDso faucet tokens for all three wallets
- [ ] **check the faucet can supply 32 SOM** — that is the minimum balance a reactivity
      subscription needs. if it cannot, phase 3 is dead on arrival and we drop the reactivity
      claim entirely rather than fudge it. find this out today, not on 3 sep
- [ ] note the collateral decimals on testnet (**6**, not 18) somewhere you will see it again

## 5. tools

```bash
node --version          # 20+
pnpm --version          # 9+
forge --version         # foundry, phase 3 only
```

- [ ] `pnpm add @somnia-chain/markets-sdk` — **confirm it resolves >= 0.28.0**, pin it exactly
- [ ] clone the bot kit for reference and its six event-contract strategies
      → https://github.com/somnia-chain/dreamdex-bot-kit

## 6. read before writing code

non-negotiable, in this order. all four are short.

- [ ] gotchas — https://docs.dreamdex.io/developers/event-contracts/gotchas
- [ ] recipes — https://docs.dreamdex.io/developers/event-contracts/recipes
- [ ] market structure & lifecycle — https://docs.dreamdex.io/developers/event-contracts/market-structure
- [ ] somnia reactivity — https://docs.somnia.network/developer/reactivity

then open https://app.dreamdex.io/event-contracts/WBTC:USDso/15m and watch **one full 15-minute
round** without trading. watch the price move against the strike line. that is our round.

## 7. decide before writing code

- [ ] **buy-in**: 10 USDso fixed (confirm, or change now and never again)
- [ ] **MM inventory cap** — max USDso the market maker may have at risk at once. it *will* lose
      money on bad rounds and that is fine, but it must not drain
- [ ] **MM spread** around fair value. start wide (±0.05), tighten later
- [ ] **max seats** shown at the table: 8, overflow to a list
- [ ] **min players for a round to run**: 2. below that, round is a no-op
- [ ] what happens to a **banked** player — fresh 10 USDso buy-in to rejoin, or sit out
- [ ] **8 humans for the 5 sep run** — line them up now. this is the demo and it needs real people

## 8. the spike — the actual gate

one throwaway script in `scripts/spike/`. no UI, no framework, no abstractions.

- [ ] list live BTC 15m markets, gate on `getMarketOnchain` status `1`
- [ ] buy UP on one with >5 min left, confirm the fill
- [ ] wait for it to settle
- [ ] find it via `listBinaryMarkets({ status: "Finalized" })` — **not `loadMarkets()`**
- [ ] redeem with an explicit outcome index, confirm USDso lands back in the wallet
- [ ] **check book depth on both sides.** if UP and DOWN are both empty, the MM is not polish,
      it is the whole game working or not

**pass = one terminal transcript with three tx hashes: buy, settle, redeem.**

paste that transcript into `CLAUDE.md` under a `## spike proof` heading. it is the first piece of
qualification evidence and the README will reuse it.

if it does not pass today, stop and fix it tomorrow. **nothing downstream matters until it does.**

## 9. visualise the demo target

before building, write one sentence describing the frame you want in the video.

> eight seats on a dark table, a countdown at 0:03, and the instant it hits zero four stacks go
> dark and four double.

- [ ] written down. every build decision serves that frame

## 10. final sanity check

- [ ] `.gitignore` covers `.env`, `*.key`, wallet files — **verified by `git status`**
- [ ] git identity correct
- [ ] three funded wallets on chain 50312
- [ ] SDK pinned >= 0.28.0
- [ ] spike transcript exists with three tx hashes
- [ ] 8 humans provisionally booked for 5 sep
- [ ] `CLAUDE.md` read end to end

when all ten are checked, start phase 1.
