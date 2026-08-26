# hackathon workflow

the standing process for entering any hackathon. protocol-agnostic. drop this anywhere and it still works.

trigger phrase: "entering [hackathon]" or "build for [protocol]".

---

## the shape of it

seven steps. steps 1 and 2 happen before a single file exists, and they decide whether the build is worth doing at all. steps 3 and 4 produce the documents and the prompts. steps 5 through 7 are submission-day work.

```
1  understand the rules
2  ideate and stress-test
3  write the three documents
4  build with the session prompts
5  README, cleanup, proof
6  slides and video script
7  competitive intelligence
```

steps 6 and 7 are day-3 artifacts. writing a demo script for a thing that doesn't exist yet is wasted motion, so hold them until the loop actually closes.

---

## step 1 — understand the rules

read the rules page, the judging criteria, and the sponsor docs before designing anything. pull out:

➠ deadline, timezone, submission format
➠ judging criteria with weights, if published
➠ which sponsor products qualify, and which ones stack
➠ hard constraints (chain, testnet, language, team size, AI-tool disclosure)
➠ what disqualifies a submission

the qualification angle usually lives in this step, not in ideation. finding that only one team is using both sponsor products is worth more than a better idea.

## step 2 — ideate and stress-test

three ideas minimum, then attack them. for each one:

➠ can this be demoed in 90 seconds without narration
➠ what's the single moment a judge remembers
➠ what breaks live, and can that dependency be removed
➠ is there real on-chain action, or just a form that says "submitted"
➠ has the sponsor already shipped this as an example repo

kill the ambitious one. small and complete beats large and half-built, every time.

## step 3 — the three documents

### CLAUDE.md

```
write a CLAUDE.md for [PROJECT NAME]. this is the project brain for claude code.

include:
➠ one-line project description
➠ what we are building and why it qualifies for [HACKATHON]
➠ full tech stack with versions
➠ repo structure with folder descriptions
➠ build phases as numbered checkboxes
➠ all terminal commands we'll need
➠ demo plan — what the judge sees and in what order
➠ pitch script, 60 seconds, spoken out loud
➠ things that burned us (errors and bad patterns to avoid)
➠ things NOT to do

no fluff. claude code reads this every session.
```

### PHASE_0_CHECKLIST.md

```
write a PHASE_0_CHECKLIST.md for [PROJECT NAME]. everything i need before opening claude code:
➠ accounts and API keys to create, with links and exact steps
➠ wallets or credentials to set up, with safety warnings
➠ tools to install with exact commands and versions
➠ documentation and repos to read before starting
➠ risk parameters to decide before writing any code
➠ system prompts or content to pre-write
➠ demo target to visualize
➠ final sanity check

checkbox list. every item specific enough to check off with certainty.
```

### BUILD_GUIDE.md

```
write a BUILD_GUIDE.md for [PROJECT NAME]. building solo in [X] days using claude code. simple language.

format:
➠ one section per day
➠ one numbered step per action
➠ for each step: what to do, what prompt to paste into claude code, what success looks like, what to do if it fails
➠ flag critical path steps
➠ include a fallback for each hard step
➠ end with demo checklist, submission checklist, pitch script

one thing at a time. commit after every phase.
```

when the build is complex enough to need it, add a fourth: EXECUTION_PLAN.md, every prompt written out in full, labelled by phase and step, so a session is paste-and-go.

### how the files relate

```
CLAUDE.md            project brain, read every session, rename to AGENTS.md before submitting
PHASE_0_CHECKLIST.md pre-build prep, delete before submission
BUILD_GUIDE.md       day-by-day execution, delete before submission
EXECUTION_PLAN.md    optional, paste-ready prompts per phase, delete before submission
```

## step 4 — the build prompts

**new session start**
```
read CLAUDE.md. summarize what we're building, what phase we're on, and what the current goal is. do not write any code yet.
```

**starting a new phase**
```
phase [X] is complete. starting phase [X+1]: [name]. here is what needs to happen: [paste from BUILD_GUIDE]. write a plan before touching any code. show me the plan and wait for my approval.
```

**when stuck**
```
i am stuck. here is what happened: [paste error]. explain in simple words what went wrong. break the fix into 3 smaller steps and do only the first one.
```

**after each phase works**
```
this phase is working. commit everything with a specific technical message describing exactly what changed. update the phase status in CLAUDE.md. tell me what phase comes next.
```

**code review after each major phase**
```
review everything written in this phase. flag anything half-finished, any placeholder, any silent failure, anything that only works on my machine.
```

## step 5 — README, cleanup, proof

the README is the product page, not documentation. pitch at the top, architecture diagram, live results with real values, AI tools used and how.

cleanup pass:

➠ rename CLAUDE.md to AGENTS.md, and never commit the original filename
➠ no console.log, no TODOs, no commented-out blocks
➠ .gitignore covers keys, .env, wallet files
➠ git identity configured before the first commit, not after

that last one cost a submission once. commit attribution to an AI account got the project marked down at ETHGlobal Open Agents. configure it first, always.

qualification proof: the exact terminal commands a judge can run, plus screenshots of the tx hashes or explorer links that prove the thing actually happened on-chain.

## step 6 — slides and video script

four slides, no more.

➠ cover
➠ problem against solution, with sponsor brand cards
➠ architecture, with one technical insight box
➠ demo slide, logo on black

video script order: personal intro, market context, sponsor differentiator, where the idea came from, slides, interface walkthrough, the payoff moment, the autonomous feature, future vision, closing line. under three minutes.

## step 7 — competitive intelligence

```
here is what another team is building: [paste their description]. compare it to [PROJECT NAME] unbiasedly:
➠ rate both on technical depth, use case clarity, sponsor depth, completion, wow factor, demo reliability
➠ where they beat us
➠ where we beat them
➠ what this means for our pitch strategy
```

---

## variables to swap per project

| variable | fill in |
|---|---|
| [HACKATHON NAME] | |
| [PROJECT NAME] | |
| [X] days | |
| [platform / sponsor stack] | |
| [killer differentiator] | |
| [closing line] | |

---

## lessons that keep proving true

➠ small is a strategy. three nodes, one use case, one confirmed transaction beats an ambitious half-built thing.
➠ close the autonomous loop. every feature should tighten it, not widen the surface area.
➠ use both sponsor products. being the only team doing that is a category of its own.
➠ real on-chain action wins. a demo without stakes reads as a mockup.
➠ the demo cannot fail. run locally, no external API in the critical path, pre-generate fallback assets.
➠ the files are memory. update CLAUDE.md every session or the same mistake comes back on day three.
➠ configure git identity before the first commit.
