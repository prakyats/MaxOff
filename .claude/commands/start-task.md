---
description: Start the next roadmap task (or the one given) with a plan, waiting for approval
argument-hint: "[task id, e.g. 4.2]"
---
Start a MaxOff build task. Task requested: "$ARGUMENTS" (if empty, use the "Next task" in docs/PROGRESS.md).

1. Read `docs/PROGRESS.md` in full. If there's an **In-progress handoff**, resume from it instead of starting fresh.
2. Find the task in `docs/ROADMAP.md` and note its model tier ([H]/[C]/[Q]). If the tier is [H] and the current model isn't the highest-capability one listed in BUILD-GUIDE.md, tell me before continuing.
3. Read only the relevant sections of PRODUCT, PERMISSIONS, WORKFLOWS, DATA-MODEL, ARCHITECTURE and any ADRs that affect this task.
4. Run `git status` and check the branch. For the first task of a phase, create the branch `phase-<N>` from `main` (`git switch -c phase-<N>`). If the working tree isn't clean, stop and tell me.
5. Look at the existing code this task touches. Use an Explore subagent for wide searches.
6. Present a **plan**, then stop and wait for my approval:
   - goal and scope boundary (what is NOT in this task)
   - files and migrations to create or change, and any change to DATA-MODEL / WORKFLOWS / PERMISSIONS needed first
   - permission keys, RLS policies, transition functions, audit and notifications involved
   - tests: unit, pgTAP (each role and each transition path), e2e
   - **Back and gestures** (every plan that adds or changes UI): each new screen's and overlay's place in the back stack (ARCHITECTURE §14.2): what one back closes or where it lands, which controls are view controls (`ViewLink` / replace), and the installed-mode spec that proves it at 375px and 430px
   - risks, and any business rule not covered by the docs (ask, don't invent)
Don't edit any files until I approve.
