---
description: Verify, review, document and commit the current task
---
Finish the current MaxOff task.

1. Run `pnpm check`, plus `pnpm test:e2e` if the task changed a user flow. Fix every failure and run them again until they're green. Never skip or weaken a test to make it pass.
2. Go through the **Definition of Done** in CLAUDE.md item by item, and report each one as ✅ or ❌ with a reason. Fix anything marked ❌.
3. Self-review `git diff`: module boundary violations, missing RLS, missing activity logging, hard-coded business lists, missing loading/empty/error states, leftover debug code, secrets.
4. Update the docs:
   - `docs/ROADMAP.md`: tick the task.
   - `docs/PROGRESS.md`: update "Current state" and "Next task", clear "In-progress handoff", add a line to the session log, and record new ideas or tech debt and anything the next session must know.
   - `docs/ARCHITECTURE.md` or a new ADR, if a pattern or decision changed.
5. Commit with a Conventional Commit message like `feat(clients): 3.2 client list with filters`, ending with the attribution trailer.
6. Tell me the task is done, summarize it in 3–5 lines, name the next task and its suggested model, and remind me to run `/clear` before `/start-task`.
