---
description: Start the next roadmap unit (or the unit or task given) with a plan; wait only when the kickoff left a question open
argument-hint: "[unit or task id, e.g. 4B or 4.2]"
---
Start a MaxOff build unit. Requested: "$ARGUMENTS" (a unit like `4B` or a single task like `4.2`; if empty, use the "Next task" in docs/PROGRESS.md).

1. Read `docs/PROGRESS.md` in full. If there's an **In-progress handoff**, resume from it instead of starting fresh.
2. Find the unit (its `Units:` line) or task in `docs/ROADMAP.md` and note its model tier ([H]/[C]/[Q]; a unit's is the highest of its tasks). If the tier is [H] and the current model isn't the highest-capability one in the "Model tiers" table of `BUILD-GUIDE.md` (at the **repo root**, not in `docs/`), tell me before continuing.
3. Read only the relevant sections of PRODUCT, PERMISSIONS, WORKFLOWS, DATA-MODEL, ARCHITECTURE and any ADRs that affect this task.
4. Run `git status` and check the branch. For the first task of a phase, create the branch `phase-<N>` from `main` (`git switch -c phase-<N>`). If the working tree isn't clean, stop and tell me.
5. Look at the existing code this task touches. Use an Explore subagent for wide searches.
6. Present a **plan**. Then: if the phase's **"Kickoff <N> decisions"** block in PROGRESS.md settles every business question the plan raises, **proceed without waiting** (CLAUDE.md "How to work"), stopping only on its stop conditions; otherwise stop and wait for my approval. The plan:
   - goal and scope boundary (what is NOT in this task)
   - files and migrations to create or change, and any change to DATA-MODEL / WORKFLOWS / PERMISSIONS needed first
   - permission keys, RLS policies, transition functions, audit and notifications involved
   - tests: unit, pgTAP (each role and each transition path), e2e
   - **Back and gestures** (every plan that adds or changes UI): each new screen's and overlay's place in the back stack (ARCHITECTURE §14.2): what one back closes or where it lands, which controls are view controls (`ViewLink` / replace), and the installed-mode spec that proves it at 375px and 430px
   - **First glance** (every plan that adds or changes UI, PRODUCT §2 "First glance, then depth"): what the first screen shows (only what answers the role's question and what needs action now), what moves one tap deeper (sub-page or sheet), and confirmation that no daily action got deeper and nothing is more than two taps from its tab
   - risks, and any business rule not covered by the docs (ask, don't invent)
Don't edit any files before the plan is presented, nor, when a question is open, before I approve.
