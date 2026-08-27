# THE CLIMB — build plan

supersedes the game-design half of `SCOPE.md`. everything in `SCOPE.md` about the market, the
executor, the registry and the gotchas still stands — none of that changes.

**27 aug → submit 7 sep.** deadline 8 sep 18:00. eleven days.

---

## what the game is now

the chart becomes a cliff. your character's **height is your live position value**, second by
second. pick a side and you start climbing or slipping.

everyone moves at a different rate, honestly: buy UP at 0.30 and you are levered 3.3x, so BTC ticks
up and you rocket past someone who bought the favourite at 0.85 and is barely inching. **the
contrarian visibly outruns the crowd, because that is exactly what the payout does.** no speed is
invented.

**BAIL** at any second and your character leaps clear, keeping the height they reached. ride longer,
climb higher — but the bell is coming, and anyone below the line when it rings falls off the screen.
survivors carry their height into the next round. last one on the cliff takes the pot.

---

## what does NOT change

**do not touch these.** they are proven on-chain and they are the whole technical claim.

```
services/executor    the loop: open → enter → settle → redeem → roll
contracts/           ArenaRegistry + reactivity, same-block settlement
src/lib/chain|market|orders|registry    SDK integration and every gotcha in it
prisma               the ledger (additive changes only)
```

the pivot is a **presentation layer**. the money, the market and the chain stay exactly as they are.
any change in that layer risks the one thing that is definitely working.

reused as-is: the palette, the fonts, the sound engine, the logo, the bell, the feed, the near-miss.

---

## day 0 — 27 aug — MOTION SPIKE, PASSED ✓

the cliff reads. `scripts/spike/climb.ts` sampled four live BTC 1m windows every second.

```
round 2  entry 0.450   prob 0.208 → 0.914   ▅▅▅▅▅▅▅▅▅▃▃▂▂▂▂▂▂▁▁▁▁▁▁▆▆█
round 3  entry 0.203   prob 0.013 → 0.313   ▆▆▆███▆▆▄▄▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
round 4  entry 0.820   prob 0.762 → 0.984   ▃▃▃▃▄▄▄▄▁▁▁▁▂▂▃▃▅███████
```

**round 2 is the whole game in one line**: a long slide toward death, twenty seconds hanging near
the floor, then a last-second save. that arc is real and it happens on its own.

### the mapping, measured not guessed

height is `0.5 + 0.5·tanh(k · ln(live/entry))` — your position as a multiple of what you paid, log
scaled so a doubling and a halving are equal distances, and bounded so it can never explode.

the first attempt, `(live−entry)/(1−entry)`, produced spans of **3.14 on a 0–1 scale** because it
blows up when a player enters near certainty. discarded.

`k` was chosen by sweeping it across the real rounds:

```
k=1.0   avg span 0.485   favourite-buyer travels 0.127 of the wall — invisible
k=1.8   avg span 0.640   that becomes 0.224, and the dramatic round still pins 0%   ← chosen
k=2.6   avg span 0.726   but the dramatic round pins 12% at the floor, flattening its save
```

**k = 1.8.** the last gain before the good round starts clipping.

### what the spike also settled

➠ **the dead tail is real and must be handled in animation, not maths.** round 3 sat on the floor
  for 25 seconds because its position was worth 6% of cost. that is honest — but round 2 proves you
  can come back from there, so a climber must never be dropped early. a low climber gets a
  scrabbling **HANGING ON** state; the stillness is covered by the animation, not removed.
➠ **buying the favourite is meant to be dull.** small climb, small payout. that is the strategy
  layer working, not a bug to tune away.
➠ sampling itself needed fixing twice: re-resolving the market every tick cost three network calls
  a second and cut the sample rate to a third; and `currentMarket` gates on status `Trading`, so a
  window drops out the moment it locks and the original spike never saw the last seconds at all —
  which is exactly where the drama is. resolve the window once, then watch it through expiry.

## day 0 — the spike as originally planned ⚑

**the whole plan rests on one unanswered question: does the climb actually read?**

a character's height is `contracts × live probability`. probability barely moves early in a window
and then swings violently near expiry. if that means a character sits still for forty seconds and
then teleports, the cliff is worse than the chart and we need to know today.

- [ ] `scripts/spike/climb.ts` — for a real BTC 1m round, sample every second: live probability,
      a notional position's value, and the implied character height as a 0-1 fraction
- [ ] run it across **five consecutive rounds** and dump a CSV
- [ ] plot it. eyeball the shape

**pass** = height moves visibly and continuously through the round, with the last fifteen seconds
being the most dramatic. that is a good climb.

**fail** = flat then a cliff-edge jump. then the fix is the MAPPING, not the concept: try a log or
tanh curve on the value, or scale height by *distance from the strike* rather than raw position
value. decide it here, on real numbers, before any UI exists.

**hard fallback if the shape is unusable:** keep the chart and put the characters *beside* it on a
side rail rather than replacing it. costs half a day, keeps the concept, loses some of the drama.

---

## days 1–2 — 28–29 aug — the cliff, one climber ⚑

- [ ] `src/app/Cliff.tsx` replaces `Chart.tsx` as the hero. the wall, the strike as a lit ledge,
      the bell countdown draining
- [ ] ONE character, real sprite, driven by a real position from the live executor
- [ ] climb / slip states switching on direction of travel

**done when** a single character climbs and slips in time with an actual position we hold on-chain.
do not add a second character until one is right.

## days 3–4 FINDING — the wall cannot differentiate same-side climbers ⚑

**checked with eight on the wall before building ghost lines against the same
coordinates. good thing.** four climbers, all reading `1.30×`, in a perfectly straight
horizontal line.

the cause is a collision between two things already built:

➠ the executor **batches by side at one average fill price** (phase 1, deliberately: same-side
  players filling at 0.497 and 0.741 "reads as rigged in a game")
➠ so every UP player has an identical entry, an identical multiple, and an identical height
➠ and every survivor of a round is on the winning side — so from round 2 the whole field is one
  correlated bloc

measured over the last 40 settled rounds with 2+ players:

```
everyone on ONE side     7 of 8
whole table wiped        3
field actually thinned   1
```

**the field almost never thins. it wipes.** a battle royale whose players are perfectly correlated
cannot shrink 8 → 4 → 2 → 1; it goes 8 → 0.

### what this retracts

"the contrarian visibly outruns the crowd" is **only true across sides, never within one**. two UP
players are the same climber at the same height, always. that claim has to come out of the pitch.

### the options

1. **the bail becomes the differentiator.** everyone climbs as one or two blocs; the whole game is
   who jumps and who rides. survivors differ by WHEN THEY JUMPED, not by entry. already built —
   costs nothing, but the wall shows blocs, not eight individuals.
2. **variable stake sizing.** commit 25/50/100% each round. a player who sizes small survives a
   wrong call with something left, so the field thins instead of wiping — and it restores the
   sizing decision cut earlier. changes "wrong side = dead" and needs executor work.
3. **stagger entries by pick time.** humans picking at different moments genuinely get different
   entries. real, but it only spreads a side slightly, and it does nothing about correlation.

**recommendation: 2, with 1.** sizing is the only one that fixes correlation, and correlation is
what stops the tournament working at all.

## days 3–4 — 30–31 aug — the cast and the jump

- [ ] cut the pose sheets into sprites. `remove_background` on each sheet, then crop the five poses.
      **five more characters** to generate — 8 total × 5 poses
- [ ] all eight on the wall, each seat its own climber, names attached
- [ ] **BAIL becomes the leap.** the existing bank endpoint already does the money; this is the
      animation plus instant feedback. it must feel like a decision, so: one tap, no confirm dialog
- [ ] the bell: everyone below the line falls off the bottom of the screen

## day 5 — 1 sep — ghost lines and overtaking

- [ ] **ghost lines**: your personal best height painted faintly on the wall, the all-time record in
      gold near the top. crossing your own best flashes and repaints it above you
- [ ] **overtaking**: who is directly above you, by name. passing them is an event — flash, sound,
      "PASSED BRAM"

these two are why the minute is tense rather than idle. both are free data.

## day 6 — 2 sep — cohorts and the champion

- [ ] finish `src/executor/tables.ts` (written, not wired) and call `manageTables()` from the tick
- [ ] runs only climb once their table is **sealed**; a filling table watches
- [ ] the pot on screen, growing as people fall
- [ ] the champion moment: last climber on the wall, takes the pot, permanent record

## day 7 — DONE 27 aug — the last five seconds

- [ ] camera pushes in on whoever is nearest the line, audio drops out, one character dangles
- [ ] polish pass, mobile pass at 375px, reduced-motion pass

**this is the remembered moment.** it is free because the price genuinely oscillates around the
strike — the near-miss is real, not staged.

## day 8 — 4 sep — FREEZE

no new features. bugs only. rehearse the run end to end at least twice.

## day 9 — 5 sep — the real run ⚑

- [ ] 8 humans, one full recorded run. fund their wallets the day before
- [ ] capture a bail, a multi-player fall, and the champion
- [ ] keep the raw recording as the fallback

## days 10–11 — 6–7 sep — submission

- [ ] README rewritten around the climb (the proof section survives unchanged)
- [ ] four slides, video under 3 minutes, built around the bell and the last five seconds
- [ ] rename `CLAUDE.md` → `AGENTS.md`, delete the working docs, verify git identity on every commit
- [ ] **submit on the 7th.** do not wait for the 8th

---

## cut list — do NOT build these

they are good ideas and they are not affordable in eleven days.

➠ unlockable characters (progression gate — additive later)
➠ spectating after death (keeps dead players engaged — additive later)
➠ the hourly gauntlet
➠ tethers / co-op rescue
➠ per-round generated video. the art is pre-made; the animation is real-time. nothing is generated
  during a round

if days 5–7 come in early, take them in that order.

---

## kill criteria

decide at the boundary, not on the 7th.

| if | then |
|---|---|
| motion spike says the climb does not read | remap first; if still bad, characters beside the chart, not replacing it |
| sprite cutting eats more than a day | ship with 3 characters, not 8 |
| cohorts not working by **2 sep EOD** | ship without them — the game plays fine, there is just no champion |
| anything at all slips past **4 sep** | it does not ship. the freeze is the freeze |

**the cliff with one climber that actually works beats eight characters and a broken table.** the
existing game is complete and proven; every day of this pivot has to earn its place against that.
