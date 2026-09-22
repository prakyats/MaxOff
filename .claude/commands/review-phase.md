---
description: End-of-phase review, fixes, merge and tag
argument-hint: "[phase number]"
---
Review phase $ARGUMENTS of MaxOff before merging it. (Use the highest-capability model for this.)

1. Confirm that every task for this phase in `docs/ROADMAP.md` is ticked, and that the phase's exit criteria are actually met. Check by running the app or the e2e tests where you can.
2. Use the `architecture-reviewer` subagent on `git diff main...HEAD`. Separately, review security: RLS on every new table, the permission and scope checks in every transition function, money isolation, file access, input validation, IST handling in jobs.
3. Show me the findings grouped as **must fix / should fix / later**. Fix the must-fix items (committing each fix), then run `pnpm check` and `pnpm test:e2e`.
4. Add anything "later" to PROGRESS.md under Ideas / tech debt.
5. After I confirm, merge **through a pull request** (`main` is protected: PR required, and the three CI jobs must be green):
   - `git push -u origin phase-<N>` and wait for CI to pass on the branch.
   - `gh pr create --base main --head phase-<N> --title "Phase <N>: <name>" --body "<what the phase delivered, and the review findings that were fixed>"`
   - `gh pr checks --watch` until all three are green, then `gh pr merge --merge --delete-branch=false`.
   - `git switch main && git pull`, then tag the merge commit **`phase-<N>-done`** (never the branch name, and never `v*`, which triggers the production deploy): `git tag -a phase-<N>-done -m "Phase <N>: <name>" && git push origin phase-<N>-done`.
   - Update PROGRESS.md for the next phase. The merge to `main` triggers the staging deploy; report the URL it prints.
