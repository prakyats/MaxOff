# MaxOff advisor handoff, 22 Oct 2026 ~13:20 IST

Advisor session (local, laptop) orchestrating the **"MaxOff integrator"** cloud session for **v1.8 "Settings and colours"**. Owner = Prishit (GitHub `prakyats`). Read this first after compaction.

## How the loop works
- Builder reports land as comments on **GitHub issue #89** ("Phase 6b build log"): `REPORT (…)`. Advisor answers with `ADVISOR:` comments there **and** a `SendMessage` to "MaxOff integrator" (one-way; cloud can't reply).
- Watcher: `bash <scratchpad>/watch89.sh <last_comment_id>` in the background (uses `filter89.py`; wakes only on `REPORT (…): DONE|BLOCKED|PAUSED|QUESTION`, `QUESTION`, `READY FOR OWNER`). Scratchpad = `C:\Users\ASUS\AppData\Local\Temp\claude\C--Users-ASUS-Desktop-MaxOff\8b868806-9783-4b1b-99ee-1c631b0ca40c\scratchpad\`. **Re-arm it after compaction** with the latest #89 comment id (last seen: 6334877899).
- Full CI on the branch (free, GitHub runners): `gh workflow run CI --repo prakyats/MaxOff --ref phase-6b-r3 -f full=true`, then watch the run; per-shard failures via `gh api --allow-escape-sequences repos/prakyats/MaxOff/actions/jobs/<id>/logs`.
- Preview (auto-deploys each push): https://phase-6b-r3-maxoff-staging.pixoraclips.workers.dev
- Docs-only PRs to main: advisor merges after checks (normal merge, tag `archive/<branch>`, delete branch). Never `--admin`. Never tag `v*` or approve prod deploys (owner only). Local git commands were once blocked by the auto-mode classifier; `gh api` works.

## Where v1.8 stands (branch `phase-6b-r3`, head f9fe131 at handoff)
Done and merged: V0 (13 bugs), V1 (foundations, ADR-0015), V2 (components), V3 (screens 1 incl. project page), V4 (screens 2), V5a (colour plan with Forest `approve`, B7 fallback, month tabs, Details fields, consistency sweep/History clock), calendar work (revert to full grid + day dialog, PP-calendar-1..15, leave stripes, ‹ month › Today, neutral today tint, +N more, hover +), V5c (35 CI fixes at root: client History loads on open, etc.), owner's deploy.yml B11 line (3ba8429, staging only), **Owner Delete** (templates/presets/holidays: soft delete, any time, "(deleted)" label, task-template reminders copied first; migration `v5_owner_delete`), **Delete of never-used kinds** (task types, job titles, expense categories, custom fields, draft clients, contacts; real delete; migration in 6c).
Full CI on 9151eec: everything green except `calendar.spec.ts:970` [mobile] "+N more" ("+4" vs "+3").

**In progress: V5b-0 by builder A** (not pushed at handoff): calendar:970 fix; owner decision "own history never blocks Delete" (new migration `v5_owner_delete_own_history`); **"Archived (n)" section** on every list with Archive (Restore; Owner Delete when unused) — owner found archiving had no way back; DESIGN.md §Decisions; shared foundations (light-theme depth, row anatomy, detail header, slim top bar + bell, date labels, dismiss/sheets, empty rows). Then builders **B** (client work, Templates, Settings, People, Reports) and **C** (light theme, phone, Me, Alerts, empty/no-access) in parallel; A continues Today/Tasks/Approvals/forms. Scope file: `docs/reviews/v18-polish/SCOPE.md` on the branch.

## Remaining steps to release
1. V5b-0 report → advisor review → full CI dispatch.
2. V5b A/B/C → full CI → **speed check #1** (perf-probe vs staging).
3. Guide text + `guide:screenshots`, release review.
4. **Advisor final design gate** on the polished preview: Impeccable critique (two isolated reviewers + detector on the branch + browser overlay), design:accessibility-review, design:ux-copy, design:design-system; every role × laptop/phone × light/dark. Owner signs in on the preview in Chrome (Claude in Chrome drives; never type passwords). Below the bar → back to builders.
5. **Speed check #2**, full CI green (incl. instant-skeleton, the old flaky calendar tap test).
6. READY FOR OWNER (walk script, probe table, team message drafts) → owner phone walk → advisor merges phase-6b-r3 to main → owner tags v1.8.0 + approves deploy → team WhatsApp message.
7. After v1.8: **backup restore drill first** (6b.20 a, local Docker), then 6b.20 (b), then v1.9.

## Owner decisions this session (all recorded on #89; key comment ids)
- UX review report: claude.ai/artifact/9wxAFfKFos56Ue61ETYZHH; findings in `docs/reviews/2026-10-21-ux-review.md`.
- Colour plan (Forest #15803D approve; red final/irreversible incl. Close deliverable; Cancelled red): sample claude.ai/artifact/DE5WJ8qrfN7q8QQQKVvw3Z.
- FINAL UI DECISIONS rulebook: 6322652532. Truncation rule (ellipsis only where a tap opens full text): 6322342277. Me restructure (sign out last, red outline): 6322378452.
- 9 major changes sample (before/after): claude.ai/artifact/VhArkz9hbRDhWieKQgWZ4Q, in `docs/design/v18-major-changes-sample.html` (PR #111). All approved; conditions 6331819942 (Today "This week" ≤25–30 % width, drops below "Overdue and risks" under 1200 px; light-theme depth everywhere, warm cream page, no pure white; bell badge offset outside the glyph). Change 6 = option C labelling only ("Thu 22 Oct", "6:00 pm"), native pickers, no quick picks: 6331870421.
- Calendar: keep full grid + day dialog (side panel reverted); leave = striped neutral; no side-stripe chips.
- Template Delete final rule: 6332392194. Never-used kinds: any *other* record counts as used; own history never blocks (6334861993). Holidays: only before their date.
- Open questions answered: B7 fallback before "Posted"; Remind not in Chat; B11 approved (staging only).
- Samples before major UI shifts (memory `samples-before-major-ui`). Speed gate before every release (CLAUDE.md DoD, PR #112; memory `speed-gate-every-release`). Premium gate before READY (memory `premium-every-screen-gate`).

## Polish list
~75 PP items on #89 (21–22 Oct): PP-today, PP-tasks, PP-task, PP-project, PP-client(s), PP-people, PP-settings, PP-templates, PP-reports, PP-alerts, PP-person (1–4), PP-light (1–4), PP-phone (5 withdrawn), PP-admin 1–13, PP-crew 1–10, PP-forms 1–9 (2 dropped), PP-sheet 1–4, PP-approvals 1–2, PP-calendar (done). All in SCOPE.md.

## Usage
Weekly reset Thu 22 Oct 07:30 IST; at handoff 7 % used (resets Thu 29 Oct 07:30 IST). Opus 5.5 only for every session/subagent. Parallel builders allowed for V5b (owner).
