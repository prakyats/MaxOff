---
description: End-of-phase review, fixes, merge and tag
argument-hint: "[phase number]"
---
Review phase $ARGUMENTS of MaxOff before merging it. (Use the highest-capability model for this.)

1. Confirm that every task for this phase in `docs/ROADMAP.md` is ticked, and that the phase's exit criteria are actually met. Check by running the app or the e2e tests where you can.
2. Use the `architecture-reviewer` subagent on `git diff main...HEAD`. Separately, review security: RLS on every new table, the permission and scope checks in every transition function, money isolation, file access, input validation, IST handling in jobs.
3. Show me the findings grouped as **must fix / should fix / later**. Fix the must-fix items (committing each fix), then run `pnpm check` and `pnpm test:e2e`.
4. Add anything "later" to PROGRESS.md under Ideas / tech debt.
5. After I confirm: `git switch main`, `git merge --no-ff phase-<N>`, `git tag phase-<N>`, `git push --follow-tags`. Update PROGRESS.md for the next phase. Pushing `main` deploys to staging.
