---
name: merge-own-docs-prs
description: "Claude handles every merge to main itself, the correct way; only choices, phone walks and production releases go to the owner"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 8b868806-9783-4b1b-99ee-1c631b0ca40c
  modified: 2026-10-08T15:56:26.091Z
---

The owner said on 2026-10-07: "Do all merge related things on your own based on the correct way. Leave only the choices that need my intervention to me. Keep everything on auto mode." (Earlier the same day: "You can merge on your own when time is right.")

**Claude merges, once the bar for that PR is met** (normal merge commit, then tag `archive/<branch>` and delete the branch; local `main` pulled):
- Docs-only PRs: required checks pass, merge state CLEAN.
- Kickoff PRs: just before their phase; `origin/main` merged in, conflicts resolved keeping both sides, re-checked against what shipped; any contradiction goes to the owner first.
- Feature, fix and phase PRs: a full CI run with the Playwright shards actually run and green (not skipped), `/review-phase` must-fix items fixed, and for a phase the owner's phone walk passed.
- Merging `origin/main` into a branch nobody is writing (one writer per branch).

**Wider rule (owner, 2026-10-07, later the same day):** "Anything that touches the live database and production should go through me. Everything else, day-to-day updates and changes to the staging app, can be done directly by you, without asking. It should run continuously even when I'm away: errors checked, pull requests done." So Claude also: reads failing CI, diagnoses it and sends the fix to the builder session (SendMessage to the cloud session; it can't reply, so watch GitHub for the result); answers builder questions that the kickoff decisions or the docs already settle; merges as below. Still waits for the owner on: new business rules, money, roles and permissions.

**Still the owner's:** anything touching production or the live database (`v*` tags, the production Deploy approval, production secrets or settings, a production backfill); new business rules; the phone walk. Claude prepares a release (main green, staging deployed, what's in it, a safe time window) and says when it is ready.

**Trap (2026-10-08, PR #38):** a docs-only push skips the unit job, but `tests/permissions-drift.test.ts` checks PERMISSIONS.md §1 against `ROLE_GRANTS` and the seed. A docs PR that changes §1 (or other tested docs) ahead of the code turns `main` red unseen. Before merging any docs PR touching PERMISSIONS.md/DATA-MODEL.md, run `pnpm test` locally (or dispatch CI with full tests); planned rows go in a "Planned for phase N" list, never the §1 table.
**Never:** `--admin` / "Bypass rules", merging with a red or skipped e2e gate on a code PR, merging two migration branches at once (shared staging DB).

**Why:** the owner wants only real decisions to reach them; main needs 0 approving reviews, so the checks and these bars are the gate.
**CLAUDE.md now says the same** (owner's yes 2026-10-08, PR #53): the advisor session merges to `main` once a PR meets its bar; only the Owner tags `v*` and approves production deploys. If PR #53 is somehow not merged, merge it first (docs bar).
**How to apply:** before every merge, name the bar it meets; if a PR fits none, ask. Overrides the "never merge" line in [[local-test-runs]]. Related: [[production-is-live]].
