---
description: Verify, review, document and commit the current task
---
Finish the current MaxOff task.

1. Run `pnpm check`, plus `pnpm test:e2e` if a user flow changed. Fix every failure and run them again until they're green. Never skip or weaken a test to make it pass.
2. Go through the **Definition of Done** in CLAUDE.md item by item, and report each one as ✅ or ❌ with a reason. Fix anything marked ❌.
3. Self-review `git diff` against the CLAUDE.md business invariants and engineering rules. In particular check: money leaking outside `modules/revenue`, state changed without a transition function, missing RLS or pgTAP, non-IST date logic, module boundary violations, hard-coded business lists, missing UI states, debug leftovers, secrets.
4. Update the docs: tick the task in `docs/ROADMAP.md`. In `docs/PROGRESS.md`, update "Current state" and "Next task" (with its model tier), clear the handoff, add a session-log line, and record ideas, tech debt and gotchas. Update DATA-MODEL / WORKFLOWS / PERMISSIONS / ARCHITECTURE or add an ADR if anything changed.
5. `git add -A` and commit with a Conventional Commit message like `feat(tasks): 4.2 task transition functions`, ending with the attribution trailer. Then `git push` (the first push of a new branch: `git push -u origin <branch>`).
6. Tell me the task is done, summarize it in 3–5 lines, name the next task and its model tier, and remind me to run `/clear` before `/start-task`.
