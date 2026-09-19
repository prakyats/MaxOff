---
description: End-of-phase review, fixes, merge and tag
argument-hint: "[phase number]"
---
Review phase $ARGUMENTS of MaxOff before merging it.

1. Confirm that every task for this phase in `docs/ROADMAP.md` is ticked, and that the phase's exit criteria are actually met. Check by running the app or the e2e tests where you can.
2. Use the `architecture-reviewer` subagent on the diff `main...HEAD`. Separately, review security: RLS on all new tables, permission checks in every server action, file access, and input validation.
3. Show me the findings grouped as **must fix / should fix / later**. Fix the must-fix items (committing each fix), then run `pnpm check` and `pnpm test:e2e`.
4. Add anything "later" to PROGRESS.md under Ideas / tech debt.
5. After I confirm: merge the phase branch into `main` (no fast-forward), tag it `phase-<N>`, and update PROGRESS.md for the next phase. Pushing will deploy to staging.
