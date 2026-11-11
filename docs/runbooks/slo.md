# Service targets (SLO)

> **Proposal, the Owner decides.** Nothing here is agreed until the Owner says so. Once agreed, copy the
> table into ARCHITECTURE §18 (gap audit 2) and change this banner to the date of the decision.

Gap audit 2 (`docs/reviews/6b20b-gap-audit.md`): MaxOff has a speed gate for releases, but no written
target that production is watched against. These targets are sized for one organisation of about 15–20
people on free plans. Each one names what measures it, so a miss is seen, not guessed.

## The targets

| Target | Proposed level | Measured by | When it is missed |
|---|---|---|---|
| **Uptime** | **99.5 % per calendar month** (about 3 h 40 min of downtime a month at most) | UptimeRobot on `https://app.maxoff.in/api/health`, every 5 minutes (README "Production runbook"). The route reaches the database, so "up" means people can work | `incident.md` → "The site is down"; a postmortem when the month falls below the target |
| **Speed** | The release speed gate, **as amended 2026-11-11** (owner, option A "judge finished page too"): the **finished page (last byte) is not slower than the live release** on any route, by the two-run rule (paired against a preview of `main`, which matches the live release; slower only if slower in two consecutive runs). **TTFB** is judged only against the caps: **≤ 300 ms warm p50 from the India probe, ≤ 600 ms from the CI probe** (the CI runner is in the US; its 450 ms cap was retired by the advisor on 2026-11-11 because it measured distance to Mumbai) | `scripts/perf-probe.mjs` (the Preview workflow's `perf-probe`), before every release, signed in as Owner, Admin and Crew (CLAUDE.md Definition of Done) | The release is blocked until it is fixed at the cause (CLAUDE.md) |
| **Backups** | **A green backup every night** (02:00 IST), 31 days kept | `backup.yml`; its failure step and `ops-check.yml` open the "Backup failed" issue | `incident.md` → "A backup failed": fixed the same day; two missed nights running is an incident |
| **Restore drill** | **Once a quarter**, on a recent production backup, timed, with a known recent record checked | `backup-restore.md` → "Drills done" (a row per drill) | The month's usage-check issue asks; the next drill is due by the end of December 2026 (the last row) |

## What these targets are not

- Not a promise to anyone outside Pixora Clips: MaxOff is internal and clients never log in.
- Not a reason to add paid tools. Every measure above already exists in the repository or on a free plan.
- The speed figure in CLAUDE.md's Definition of Done (600 ms TTFB for any release) stays the floor; the
  v2.0 gate and its 2026-11-11 amendment (ROADMAP, phase v2) are stricter and win where they apply.

## Questions for the Owner

1. Is 99.5 % per month right? (99.9 % would allow only about 43 minutes a month, which free plans and a
   single region cannot promise.)
2. Should the speed target also be watched on production between releases (for example a monthly perf
   probe against `https://app.maxoff.in`), or stay a release gate only?
3. Who besides the Owner should get the alerts (gap audit 2: only the Owner's email today)?
