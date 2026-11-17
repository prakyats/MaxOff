---
name: v21-reliable-anywhere
description: "Owner 2026-11-11 — after v2.0 comes v2.1 \"Reliable anywhere\"; ops safety nets done now in parallel (PR ops/safety-nets)"
metadata:
  node_type: memory
  type: project
  originSessionId: ea770483-9990-482d-8bc8-b4cbf9e4045e
  modified: 2026-11-14T14:21:29.112Z
---

On 2026-11-11 the owner asked whether MaxOff matches world-class apps (reliable, fast, weak network, notifications). He chose: **v2.0 ships unchanged; invisible ops safety nets now; then v2.1 "Reliable anywhere".**

**Ops now:** advisor subagent PR `ops/safety-nets` to main, covering:
- a backup-failure alert and a daily ops check;
- Dependabot;
- runbooks: incident, secrets register (names only), SLO proposal, Sentry alert rules, Cloudflare login rate-limit rule.

The owner still has to do the dashboard steps (Sentry rules, the Cloudflare rule, secret expiry dates).

**v2.1 units** (note only until "proceed"; #89 comment):
1. real-user web-vitals to Sentry;
2. a Slow-4G Playwright project, fetch timeout, idempotency keys;
3. a WebKit/iPhone project;
4. axe in CI;
5. optimistic locking;
6. a 10:00 IST load test;
7. an uploaded-files backup (owner decision);
8. the restore drill, then quarterly, on the owner's laptop.

**Started 2026-11-11 ~23:05 IST:** the owner said "Proceed full on autopilot till tomorrow morning 7:30… continue with any other work" (goal: use the weekly credits before the 07:30 IST reset, on Fable). Units 3, 4 and part of 2 went to the integrator on branch `phase-v21` (cut from phase-v2 bafd6f45; #89 comment 6802825415); unit 1 to the main builder after READY TO MEASURE. Units 5–8 and the idempotency/offline queue still wait for the owner. No merge or release of v2.1 without the usual bar.

**Night of 11 Nov (advisor hit the usage limit ~23:55 IST):**
- Seven final v2.0 reviews: no code must-fix.
- Reports, release-notes draft, walk script, and the v2.1 and phase 8 decision sheets are on branch `docs/v2-release-drafts` (5a614bde).
- The builder was fixing A–D plus 3 CI reds on bafd6f45 (CI install step changed in bafd6f45 because the runners couldn't resolve *.ubuntu.com).
- B1 open: the honest INP spec reads 224–560 ms on some taps, pending a v1.9 comparison. If it's not a regression, it's the owner's call.

**12 Nov evening (handoff):**
- **v2.0 release PR #143** (phase-v2 @ 9e61a2ea → main) was waiting on the owner's one-off re-run of CI 43220640676, an exception he granted for a pre-existing race that v1.9 also has.
  - If green: merge (repo auto-merge is disabled), then the owner tags v2.0.0.
  - If red: fix first. v2.1's first unit is the live-refresh → cold-tap skeleton race; the fix is (b), the task page draws its own skeleton.
- **Also noted for v2.1:**
  - "Stay until ahead of time from the person's page" (#89 comment 6815077432);
  - the Faster still unit;
  - Appearance choosers worded the same.
- **Done:** walk passed, guide ok, India pass all roles; CLAUDE.md option A merged (#142).

**13 Nov, owner decision for v2.1 (note only; sample first):** "Crew busy" view (#89 comments 6847557591 and 6847560985).
- Admins see others' bookings as "Crew1 · Shoot · 2–4 pm · booked by Admin1": type, time and creator only, never title, client or location. This widens `member_availability()`, so it needs PERMISSIONS and pgTAP.
- Shown in the Calendar day sheet, replacing "Everyone is available", in the Day view, and in the assign picker.
- Owner answers (#89 6847654724): date-only event = busy all day, and it now clashes in overlap warnings. The Owner's own bookings show the same way (type + time + "booked by Owner"). On the phone it's part of the Day view.

**14 Nov, more v2.1 scope** (#89 6874042506, 6874350719, 6874389662):
- **Calendar for Admins approved:** Month stays; Day becomes a Crew panel; Week becomes rows per day; the assign picker splits Free/Busy. Sample: https://claude.ai/artifact/EgFYQUCuF6f6eEX8Ex9px3
- **Admin ideas board** https://claude.ai/artifact/WMdFpTnpveWEm4JCVzfxRF:
  - **Approved:** the Team today card on Today (Owner too); Tasks "Upcoming shoots and visits".
  - **Also approved 14 Nov:** New task type-dropdown-first (Settings order, event done-by = end of event); People Admin-only Today + Next booked (photos kept; Owner's People unchanged).
  - The Admin scope is complete (#89 summary comment).

**14 Nov, decisions and priority:**
- **Decision sheet answered:** units 5, 7 and 8 out of v2.1. Q2 is a note plus the Owner's one-tap Clear Late.
- **Order (owner):** Phase 9 Revenue → Phase 8 Drive (8.3 and 8.5 brought back) → v2.1, which is on hold, fully planned.
- **Next:** refresh the phase 9 kickoff (PR #42, Oct answers predate v1.6–v2.0).

Open business question: should offline Start day / End day be queued?

**Why:** the 6b.20 (b) gap audit (docs/reviews/6b20b-gap-audit.md, 23 Oct) was never actioned, and none of the v2.1 checks exist yet. Related: [[speed-gate-every-release]], [[note-only-until-proceed]].

**14 Nov, RENUMBERED (owner):** small releases with gaps, per docs/handoff/release-plan.md (main 37c74bd3):
- **v2.1–v3.5:** Revenue (Money in / Revenue every day / Reports / Month close).
- **v4.0–v5.5:** Drive (connect / upload link / hand in work / Drive links).
- **v6.0 / v6.5 / v7.0:** this note's former "v2.1" work.
- **v7.5–v8.0:** phase 10.

Next: the owner's "proceed v2.1" (Money in).
