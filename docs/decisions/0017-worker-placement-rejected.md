# ADR-0017: Worker placement stays at the Cloudflare default (rejected: no India gain)

- **Status:** accepted (rejected option recorded)
- **Date:** 2026-11-11 (v2.0 X4; the advisor's verdict on #89 6786924823, by the rule ROADMAP X4 set:
  adopt only if it is faster for India)

## Context

Every MaxOff page reads the staging or production Supabase database, which runs in **Mumbai** (AWS
`ap-south-1`; the owner confirmed production's region in the dashboard on 2026-11-11, the same as
staging's). By default Cloudflare runs a Worker in the data centre nearest the visitor. ROADMAP X4
asked whether **placement** (running the Worker beside the database instead) makes MaxOff faster for
the team, who are in India. It was to be adopted, with an ADR, only if India gains. The owner
approves any change to production configuration.

The experiment (`e93626aa`, removed after this verdict):
- its own Worker, `maxoff-staging-smart`, so staging (the v1.9 baseline) did not move: placement is
  a per-Worker setting;
- the same code and the same staging database as the `phase-v2` preview, so placement was the only
  difference;
- placement `{ "mode": "targeted", "region": "aws:ap-south-1" }` (variant R, pinned beside the
  database); no cron triggers, no preview URLs, the pages' secrets only (it could send nothing);
- deployed by a dispatch-only job in `preview.yml`, never by `deploy.yml`.

## Evidence

**From India (the advisor, on the owner's line, 2026-11-11):**
- `curl -D - https://maxoff-staging-smart.<subdomain>.workers.dev/login` answers
  **`Cf-Placement: local-BOM`** with `CF-RAY …-BOM`.
- The default `phase-v2` preview also answers from **`…-BOM`**.
- So from India, the targeted Worker and the default Worker run in the **same Mumbai data centre**,
  beside the database already. Placement cannot shorten an Indian visitor's database trips, because
  there is no distance left to remove. An India probe could only measure noise, so none was run.

**From the US (the CI probe, for the record):** the default Worker runs in a US data centre, and
every Worker → database trip crosses the ocean; the placed Worker makes those trips inside Mumbai
and pays the ocean once, on the visitor's request. The US numbers (Owner, 10 samples per route,
`maxoff-staging-smart` against the `phase-v2` preview) are recorded in PROGRESS.md's X4 handoff. A
gain there is real, but it is a gain for visitors outside India, and MaxOff's users are not there.

## Decision

**Placement is not adopted.** Staging and production keep Cloudflare's default placement (no
`placement` key in `wrangler.jsonc`). The experiment is removed: its env in `wrangler.jsonc`, its
job in `preview.yml` and the `maxoff-staging-smart` Worker itself (deleted by a dispatch-only job
that can name only that Worker; the job went with the last trace).

## Consequences

- No production configuration changes; nothing for the owner to approve.
- v2.0's speed work stays on the request itself (fewer and earlier database reads, a first wave of
  at most six, the shell's early read), which helps every visitor wherever they are.
- **Revisit only if users outside India become common** (a remote Crew member, a client portal),
  or if the database moves out of Mumbai. Then repeat the experiment the same way: its own Worker,
  the same code, a probe from where those users are, and adopt it only if they gain while India
  does not lose.
- The CI probe keeps running from US runners: its absolute times overstate what the team sees, and
  its before/after pairing (the same runner, the same time) stays valid. The India gate (warm p50
  ≤ 300 ms) is measured from India.
