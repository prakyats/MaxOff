---
name: production-is-live
description: app.maxoff.in is in daily use by the Pixora Clips team since 2026-10-01; treat every change as touching a running business
metadata:
  node_type: memory
  type: project
  originSessionId: 32c30ced-e55d-4ca9-a13b-95a331bea045
  modified: 2026-10-01T09:22:37.799Z
---

Since **2026-10-01** `https://app.maxoff.in` is used every working day by the Pixora Clips team (Owner, Admins, Crew) with real attendance, leave, expense, task and client data. Prishit asked (2026-10-01) that this be stated clearly across the codebase and docs (PR #37: CLAUDE.md "Production is live", banners in README/PROGRESS/ROADMAP/OPERATING-MANUAL/BUILD-GUIDE/ARCHITECTURE/DATA-MODEL, the slash commands, seed.sql, .env.example).

**Why:** real people and real records now depend on it; a careless migration or release costs the business a working day.

**How to apply:** expand-only migrations across releases; nothing reaches production except a `v*` tag on a green `main` commit that the Owner approves (in this app's sessions, merging to main, tagging and approving are the Owner's clicks: the safety layer blocks Claude from doing them); never run seeds, resets, repairs or hand-written SQL against production; phone check before user-visible releases; fix a bad release the same day. See [[launch-deadline-nov-2026]] and [[secrets-never-through-session]].
