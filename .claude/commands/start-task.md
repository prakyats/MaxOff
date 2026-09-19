---
description: Start the next roadmap task (or the one given) with a plan, waiting for approval
argument-hint: "[task id, e.g. 3.2]"
---
Start a MaxOff build task. Task requested: "$ARGUMENTS" (if empty, use the "Next task" in docs/PROGRESS.md).

1. Read `docs/PROGRESS.md` in full. If there's an **In-progress handoff**, resume from it instead of starting fresh.
2. Find the task in `docs/ROADMAP.md`. Read only the relevant sections of `docs/PRODUCT.md` and `docs/ARCHITECTURE.md`, plus any ADRs that affect this task.
3. Check `git status` and the current branch. If this is the first task of a phase, create the branch `phase-<N>` from `main`. If the working tree isn't clean, stop and tell me.
4. Look at the existing code this task touches. Use an Explore subagent if it means searching widely.
5. Present a **plan**, then stop and wait for my approval:
   - the goal and the scope boundary (what is NOT part of this task)
   - the files and migrations to create or change
   - the permission keys, RLS policies and custom-field hooks involved
   - the tests to write (unit / pgTAP / e2e)
   - risks, open questions and any business rule you need me to confirm
Don't edit any files until I approve.
