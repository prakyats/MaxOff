# MaxOff advisor handoff — 2026-10-09 (evening, paused by the owner)

Read first: CLAUDE.md, docs/PROGRESS.md (top bullet), docs/ROADMAP.md (Launch order, Phase 6b). The previous handoff is MaxOff-Advisor-Handoff-2026-10-08.md.

## Where things stand
- **Production = v1.6.0, live since 2026-10-09 ~16:55 IST** (tag on `a3f7932`): phase 7 (client projects, PR #67), the Owner's Today refresh (6b.7, PR #68), v1.5.1's walk fixes (never released on their own), and the app-wide fix for sheets under the phone keyboard. Deploy 37923367516: the 14 phase 7 migrations applied in order, every smoke check passed, Sentry source maps uploaded on production. app.maxoff.in health and login return 200.
- Tags: `phase-6-done` (ddb11ed), `phase-7-done` (a3f7932). Build logs #49 and #56 are closed. All build and diag branches are archived (`archive/…`) and deleted, except `phase-6`, which holds the paused WIP of the pinned New-task row (6b.4).
- `main` = 6a71a88 (+ PR #70 if merged: ROADMAP 6b.0). The release is recorded in PROGRESS and RELEASE-NOTES (PR #69).
- No watch loop is running (cron deleted at the pause). No builder is working.

## Next: phase 6b (the order the owner set: 7 → 6b → 8 → 9 → 10)
ROADMAP 6b now holds:
- **6b.0** Playwright in 4 shards (owner yes, 2026-10-09). First, because it speeds up every later run.
- 6b.1 working hours and leaving early; 6b.2 tasks for the Owner; 6b.3 profile photos.
- **6b.4** deferred follow-ups: the pinned "+ New task on ‹day›" row (WIP on `phase-6`, PAUSED note on #49), D4's "Also add to ‹period›?" prompt, D5 two kinds of Close (+ the Owner setting the kind on older closes), D6 Settings lists with Edit · Delete (Delete = archive), D7 the activity clock app-wide.
- 6b.5 approval reminders to the Owner by task priority; 6b.6 Thresholds regrouped; 6b.7 done (Today refresh); 6b.8 one colour code across the app (option A: red = urgent or destructive only, the commit button neutral; needs an ADR); **6b.9** approvals never emailed (rejections and corrections email only as a fallback), and the Due row reads "2 tasks due".
- Phase 6b needs a `/kickoff-phase 6b` first (6b.5, 6b.6 and 6b.8 carry the advisor's proposals for the owner to confirm).
- The kickoff PRs #36 (phase 8) and #42 (phase 9, with decision 24 added: a "Not needed" close is left out of Potential) stay drafts until their phases.

## Owner items
- Send the team the v1.4 → v1.6 update message (his edited version; add the closing line and, optionally, the keyboard line).
- Optional staging checks: Settings → Task types colours; /diagnostics/sentry shows `src/…` frames.
- After v1.6.0: a 10-second check on the MacBook that Enter sends in a task chat (his ASUS is a touchscreen laptop, so Enter makes a new line there by design; owner: keep it).

## Lessons from today
- Two flaky e2e failures came from measuring React's hidden streamed copy (`.first()` + `?? 0`). The pattern now is: `:visible`, `toBeVisible()`, fail on a null box.
- A real app race: the nav-progress driver hydrated after the shell. Fixed in 78daac3, with a guard spec.
- Cloud builders sometimes take 15–20 min to pick up a message; check the branch before doing their work yourself.

## Addendum, 10–12 Oct 2026 (all recorded in ROADMAP 6b; note-only mode: nothing is built until the owner says "proceed")
- Website (MaxOff-Website PR #11, content/v1.6): copy for app v1.6, the bento grid, role tabs, lock screen, day timeline, credit "MaxOff is developed by 3not8studios.", title "MaxOff — Your studio, in one place". Green, waiting for the owner's "merge the site".
- App: PR #72 (the doubled "Open Open" status) is fixed and parked as a draft for the next release.
- ROADMAP 6b now: 6b.0 4 Playwright shards · 6b.1–6b.3 · 6b.4 deferred · 6b.5 approval reminders by priority · 6b.6 Thresholds regrouped · 6b.7 done · 6b.8 colour code (A) · 6b.9 approvals never emailed, "2 tasks due" · 6b.10 3not8studios in the app · 6b.11 project page (keep "Planned", premium motivating progress) · 6b.12 next-update fixes (calendar preponed due, Back from calendar, stages 12→100, #72) · 6b.13 layered templates (presets → deliverable templates with stage groups → project templates; team-confirmed) · 6b.14 in-app "How MaxOff works" by role, PDFs retired · 6b.15 Admin full control of own clients (money and permanent delete never) · 6b.16 "save as template" everywhere + owner-picked ideas (live preview, ×N, revision round, keep extras, bulk edits, library search/preview, copy schedule).
- The owner's usage was 78% weekly (reset Thursday 7:30 AM IST). Proposed slicing of the project work: S1 quick unblock → S2 core templates + preview → S3 conveniences + project page → S4 Admin access → S5 in-app guide.

## Owner note, 12 Oct 2026
- Instagram reel to keep in mind: https://www.instagram.com/reel/DdyqycEINNe/ (shared by the owner with "make note of this"; what it relates to: ask him).
