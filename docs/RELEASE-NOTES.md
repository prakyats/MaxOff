# MaxOff release notes

Newest first. Each entry says what ships, what the Crew will notice, and what happens on its own after the
release. A release is a `v*` tag on a `main` commit with green CI, approved by the Owner (CLAUDE.md). Earlier
releases (v1.0.0 to v1.3.0) are recorded in their tag messages and in `PROGRESS.md`.

## v2.0: fast and settled

**Released Sat 14 Nov 2026, about 12:40 IST** (tag `v2.0` on `main` 6e9f19cc, PR #143; the Owner approved the production deploy, run 43569568961: 14 migrations applied, smoke checks passed). The tag is `v2.0`, not `v2.0.0`.

RC: `phase-v2`, the head named in #89's READY FOR OWNER post: 1533d987 (measured in CI and from India) plus the
held stages' dimming (a class change; CI and the paired CI probes re-run on it).

No new feature in this release: the app is faster, and a handful of rough edges are fixed.

### What the Owner will notice
- **Screens open faster.** Most of all a task, Tasks, a client, a project and Templates.
- **Today's "Needs you" stays still.** The list no longer shows an empty box and then pushes the page down. The
  rows keep their place from the start.
- **A client's page and a project's page load without a jump.**
- **A project on hold says "On hold" everywhere.** On the client's Overview and Projects tab the row shows an amber
  "On hold", never "Open". Open one of its deliverables and the sheet says at the top: "The project is on hold:
  ticks and Mark done wait until it is resumed." Its stages are greyed out.
- **A held project's stages are easier to read.** They are greyed once instead of twice, so their names stay clear
  while they wait (they still cannot be ticked).
- **A task on hold explains itself to you too.** The amber line now also says "Start, Done and the stage ticks wait
  until the task is resumed."
- **More → Appearance (phone).** The row now opens a small sheet. Tap Light, Dark or System. The sheet closes and
  the row shows your choice, for example "Appearance · Dark". Back then closes More.
- **Phone menus look even.** "Put on hold…", "Resume" and a few items in the project and deliverable ⋯ menus were
  smaller than the rest. They are the same size now.
- **Tap a chip, open the task.** A tap on a task row's chip ("2 days late", "Note it", "On hold"…) used to do
  nothing. Now the whole row opens the task.
- **The calendar keeps an early tap.** Tap a day while the calendar is still loading and it opens as soon as it is
  ready.

### What Admins will notice
- Everything in the Owner's list above, on their own clients and tasks.
- **A project the Owner put on hold is now plain to see.** Its row on the client's page reads "On hold", and its
  deliverables say why the ticks wait. Before, an Admin found out only when a tick was refused.
- **Today's "Client work" stays still** while it loads.
- **End day is ready sooner.**

### What the Crew will notice
- **Screens open faster**, My Day most of all on a phone.
- **My Day shows "On hold · 1".** A task on hold used to disappear from My Day. Now a line under the lists says how
  many are on hold. Tap it to see them.
- **Tap a chip, open the task.** The whole task row opens the task, chips included.
- **The calendar keeps an early tap.** Tap a day (or the handle) while it is still loading and it answers as soon
  as it is ready.
- **End day is ready sooner.**
- Nothing else changes in how the Crew work. Their Appearance setting is still on Me.

### Everyone, signed out
- On the sign-in page, if the phone switches between light and dark, the colours now fade in instead of snapping.
  Signed in, nothing changed.

### Speed
The finished page (the last byte, median of warm samples), v1.9 → v2.0, measured on the release candidate beside
a preview of `main` (v1.9.0) at the same time. The gate: no screen slower than v1.9 in two runs in a row, and every
first byte under its cap. **Passed for every role.**

**From India** (the Owner's Chrome, 12 Nov, about 07:15–07:45 IST, 10 warm samples per screen; the advisor, #89
6812225408). Every first byte was at most 260 ms in every clean round (cap 300 ms).

| Screen | Owner | Admin | Crew |
|---|---|---|---|
| Today / My Day | 372 → 259 | 458 → 331 | 165 → 157, 166 → 153 |
| Tasks | 208 → 188 | 201 → 157 | 186 → 183 |
| Calendar | 177 → 232, 203 → 241 | 218 → 256 | 199 → 209 |
| Clients | 160 → 258, 134 → 141 | 206 → 159 | · |
| Approvals | · | 173 → 154 | · |
| Reports | · | 228 → 204 | · |
| Me | · | 184 → 132 | 140 → 132, 124 → 136 |
| Leave / Attendance | · | 171 → 148 | 206 → 183 |
| A project | 226 → 191 | 268 → 189 | · |

Two numbers in a cell are two rounds. A screen slower in one round only was probed again (the rule); none was
slower twice. The Crew's second round was disturbed (My Day's samples ran from 534 to 3073 ms, while Tasks in the
same run held at 138), and the owner ruled rounds 3 and 4 settle it. **To watch in v2.1:** the calendar finishes
about 40 ms later than v1.9 for the Owner and an Admin, within the rule; it is on the v2.1 list.

**From CI** (US runners, 10 samples, runs 43119734374, 43124126059 and 43128397499; the paired probe, preview of
`main` beside the release candidate). Farther from the database than the team, so every number is larger; the
comparison is what counts.

| Screen | Owner | Admin | Crew |
|---|---|---|---|
| Today / My Day | 1080 → 999 | 1816 → 1297 | 1021 → 586 |
| Approvals | 550 → 316 | 764 → 403 | · |
| Tasks | 983 → 636 | 1236 → 681 | 844 → 442 |
| Calendar | 1096 → 1046 | 1576 → 1500 | 969 → 921 |
| Clients | 505 → 323 | 739 → 559 | · |
| People | 566 → 323 | 618 → 659 | · |
| Reports | 578 → 612 | 1317 → 1222 | · |
| Leave | · | 714 → 553 | 618 → 452 |
| Settings → Templates | 741 → 388 | 891 → 386 | · |
| Me | 518 → 299 | 1003 → 636 | 582 → 358 |
| A task | 1208 → 741 | 1449 → 942 | 1449 → 913 |
| A client | 882 → 650 | 1054 → 731 | · |
| A project | 1491 → 1089 | 1897 → 1319 | · |

**Taps on a phone** (CPU slowed 4×, 375 px; 5 to 15 runs each): no tap is slower than v1.9, and every tap's median
is at most 168 ms (the web's "good" is 200 ms; #89 6808590041).

### Under the hood
1. Each screen now asks the database for everything it needs in one or two trips, and never more than six at once.
2. The first thing a screen sends already has its content, and the likely next screens are fetched ahead for every
   role.
3. The database's permission checks were rewritten to run faster; they give exactly the same answers (tests compare
   old and new).
4. Fourteen database changes, all additions. Nothing is removed or rewritten, so rolling back to v1.9 needs no
   extra step.
5. Flaky tests were fixed at their causes, and the speed checks now run on every change.
6. A task tapped on Today, My Day, Tasks or Approvals opens with its skeleton at once, even right after the
   app reopens or a live update arrives; before, the old screen stayed up until the server answered (v1.9 too).

### Known issue
- **Settings → Thresholds:** if you press Save and type a new edit straight away, that new edit can be thrown away.
  Wait a moment after Save before typing again. A fix is planned in v2.1.

### Deploying
- **Any time of day.** No migration changes a rule, a setting or a row: every v2.0 migration only adds functions
  or re-creates existing ones with the same results. The old Worker keeps working on the new database during the
  deploy window (it never calls the new functions).
- **No new secret, variable, cron or Worker setting** (`wrangler.jsonc` is unchanged from v1.9.0 for staging and
  production; the placement experiment left nothing behind).

### Migrations (expand-only, in order)
1. `20261105123636_session_early` (the shell's one early read)
2. `20261105170715_session_early_own_hours`
3. `20261105180000_own_week`
4. `20261105190000_attendance_board_today`
5. `20261105200000_x3_my_day_folds`
6. `20261105210000_own_week_tasks_counts`
7. `20261105220000_templates_library`
8. `20261105230000_task_page`
9. `20261106000000_leave_folds`
10. `20261106010000_client_overview`
11. `20261106020000_project_page`
12. `20261106030000_rls_helpers_plpgsql` (15 RLS helpers re-written in PL/pgSQL, the same bodies and results)
13. `20261106040000_attendance_hours_once` (the attendance settings read once per call; same columns)
14. `20261111030554_requests_to_decide_admin_rule` (v2.0's new count follows `task_request_visible`)

All expand-only: `create function` / `create or replace function`, grants and comments; no `drop`, `alter
table`, policy change, index or data write (checked over the 14 files, 11 Nov). `session_bundle()` is unchanged.

### Rolling back to v1.9
The v2.0 database stays; only the Worker goes back, and **nothing needs switching off first.** Checked against
`v1.9.0`'s code (11 Nov, static, by reading and diffing every re-created object against its v1.9.0 definition):
- **The new functions** (`session_early`, `own_week`, `task_page`, `project_page`, `client_overview`,
  `templates_library`, the leave and attendance folds, `app.requests_to_decide_count`) are never called by v1.9.0;
  they stay unused (security invoker under RLS, except the count helper, which returns a number by the same rule).
- **The 15 re-written RLS helpers** keep their names, arguments, return types, `strict` / `security definer`
  attributes and bodies; only the language changed (pgTAP 141 compares each with its old SQL body). The one
  behavioural difference of PL/pgSQL (an error on more than one row) cannot arise: `coordinator_of`'s only
  multi-row case is ruled out by the unique index on current coordinators.
- **`app.attendance_hours` and `attendance_hours_today()`** keep their signatures and columns; v1.9.0's call
  (`modules/attendance/data/hours.ts`, `rpc("attendance_hours_today")`) is unchanged.
- **The requests count:** v1.9.0 counts with its own query under `task_request_visible`, which already had the
  rule v2.0's new function now follows; nothing a v1.9.0 user sees changes.

### The Owner's phone walk (installed app at 375 and 430, then the laptop)
1. **Speed:** open Today, Tasks, a task, Clients, a client, a project and Approvals; each arrives with its content,
   without a grey outline that jumps.
2. **On hold:** hold a project; as an Admin of that client, open the client (its row reads On hold) and a
   deliverable (the sheet says why it waits; stages greyed). As a Crew member with a held task, My Day shows
   "On hold · 1".
3. **More → Appearance → Dark, then back twice:** the first back closes More, the second leaves the screen; the
   More row reads "Appearance · Dark".
4. **A ⋯ menu on a task and on a deliverable:** every item the same size.
5. **A task row's chip:** tap "Note it" or a state chip; the task opens.
6. **The calendar on a slow connection:** tap a day at once; it opens as soon as the calendar is ready.
7. **The guide:** Me → How MaxOff works → the On hold and Appearance topics for each role.

### The team message (WhatsApp, after the deploy)
> MaxOff is updated (v2.0). Screens open faster. If a task of yours is on hold, My Day now shows "On hold" with the
> count, so nothing goes missing. Tapping anywhere on a task row, its labels too, opens the task. Nothing else
> changes in how you work. Everything is in Me → How MaxOff works.

## v1.9.0: working hours, On hold, two kinds of Close, approval reminders, the calendar's day row

**Not released yet** (branch `claude/lucid-turing-sfdv10` → `phase-6b-r4` → `main`; the Owner tags after his walk).
Written in W6 (2 Nov 2026); the speed-probe table and the CI run are added by the integrator in the READY post.

### What ships
- **Working hours (W0, W4), on from the release:** work starts 10:00, ends 18:00, 15 minutes' grace (Settings →
  Thresholds → Working day). A Start day after the grace is **Late** and asks for one line for the Owner (never
  blocks); the strip says "Your day ends at 6:00 pm" (later on a shoot day or with the Owner's **Stay until**).
  Before the end time End day becomes **Ask to leave early**: the Owner approves or says stay; no answer in the
  wait (30 min) lets the person end the day as "Left early, not answered" for the Owner to approve or correct.
  **Half days are Morning off / Afternoon off** (a morning half is never Late, an afternoon one never an early
  leave). Late and early leaves show on the Owner's Today, the end-of-day report, the Month report and a person's
  Month tab (all from the one recorded figure, set at the start).
- **Approval reminders and the email policy (W3):** the Owner gets reminders for tasks waiting for approval
  (urgent hourly in working hours; high at 11, 14 and 17; medium and low at 11, grouped), in-app and push, never
  email. Early-leave requests count on the Approvals badge and lead Today's "Needs you".
- **Two kinds of Close (W1):** closing a deliverable asks why: "Not needed this month/week" (the client dropped
  or moved it) or "Not delivered" (we didn't). The Owner can set the kind later on older closes. "Also add to
  this period?" when a recurring deliverable is added mid-period.
- **On hold (W7, W8):** a task (its creator, or the Owner) or a project (the Owner, or the client's Admin) can be
  put **On hold** with a reason. While held: no overdue, reminders or escalations, no new cycles; amber "On hold"
  chips everywhere; Resume asks for a new deadline or dates when they passed (and the carry choices for a month
  that ended). Reports show "On hold · n deliverables" (a count, no money).
- **Calendar (W5, W9, W10):** "+ New task on ‹day›" (Crew: "+ Suggest a task on ‹day›") pinned at the foot of a
  day, never on a past day; a narrowed view (Tasks or Client work only, or filters on) is outlined red so hidden
  work is never a surprise; one ellipsis at most on a month chip.
- **The guide** ("How MaxOff works") covers every change for each role; every picture re-shot for v1.9.

### What the Owner will notice
- Today: amber "N started late today", a quiet "N ended after the end time", and "Leaving early" / "Left early"
  first in Needs you; Approvals has the two early-leave groups (Approve / Stay; Approve / Correct…).
- ⋯ on Everyone today: **Stay until** for one person today.
- Thresholds: the Working day group (switch, times, grace, the early-leave wait) and an Approvals group (reminders).
- The end-of-day report and the Month report: Late and Left early columns.
- Hold / Resume in a task's and a project's ⋯; "On hold" lines on Tasks and in Reports.
- Close asks the kind; older closes can be given one ("Set close kind").
- Reminders about tasks waiting for approval.

### What Admins will notice
- Their own day follows the same working hours (Late, Ask to leave early) as the Crew's.
- Hold / Resume on tasks they created and on their clients' projects; held work leaves Overdue and Needs you.
- Close asks the kind; the carry screen's Close too.
- The calendar's pinned "+ New task on ‹day›" row and the red outline on a narrowed view.

### What the Crew will notice
- **Late:** starting more than 15 minutes after 10:00 asks "You're starting N minutes late" for one line for the
  Owner; it never stops them working. The strip shows "Late N min".
- **Ask to leave early:** before 6:00 pm End day is "Ask to leave early" with a reason; the Owner approves or asks
  them to stay; with no answer in 30 minutes they can end their day.
- **Half days:** "Morning off" or "Afternoon off" when asking for a half day.
- **On hold:** a task can show an amber "On hold" line with the reason; Start, Done and the stage ticks wait until
  it is resumed.
- **The calendar row:** "+ Suggest a task on ‹day›" at the foot of a day (not on past days).

### Deploying
- **Deploy outside 10:00–18:00 IST.** The release's migrations switch the working hours on (`working_hours_on`):
  a deploy during the working day would change Start day and End day under people who are mid-day.
- **During the deploy window** (database migrated, the old Worker still serving): with the hours on, a v1.8 End day
  tapped before 6:00 pm is refused inside its confirmation, which stays open and shows the database's words in its
  red error line ("Your day ends at 6:00 pm. Ask to leave early instead."); nothing crashes and the day is not
  ended (checked against `origin/main`: `endDay` → `action()` → `mapPostgresError` maps `app.fail`'s INVALID_STATE
  detail to the message; `EndDayButton` keeps the dialog open with it). v1.8 has no Ask to leave early, which is why
  the deploy is outside working hours. Start day is not refused (Late never blocks).

### Migrations (expand-only, in order)
1. `20261022085108_approval_reminders` (W3)
2. `20261022090443_working_hours` (W0; every rule behind `working_hours_on`, off)
3. `20261022090843_decision_emails_owner_answer` (W3 follow-up)
4. `20261022091951_w1_close_kinds` (W1)
5. `20261022121645_w0_test_clock` (W0 review: one clock, `app.now()`)
6. `20261022124744_month_summary_hours_counts` (month counts per person)
7. `20261102124015_working_hours_on` (W4: the switch on, every organisation, audited)
8. `20261102144808_session_bundle_early_leaves` (W4 Q2: the badge counts early leaves)
9. `20261102171704_on_hold` (W7)

All expand-only: new nullable columns, tables with RLS, re-created functions with defaulted new arguments; no
drop, rename or rewrite of data (`working_hours_on` flips a setting per organisation, audited).

### Rolling back to v1.8
The v1.9 database stays (every migration is expand-only); only the Worker goes back. With the working hours ON,
v1.8's End day would be refused before the day's end time ("Your day ends at 6:00 pm. Ask to leave early
instead.") and v1.8 has no "Ask to leave early", so **before rolling the Worker back, the Owner turns the working
hours OFF in v1.9's Settings → Thresholds** (Working day). The switch is stored in the database, so it stays off
under v1.8, and v1.8 then behaves exactly as today. Verified against the code (builder, 2 Nov):
- **End day:** v1.8 calls `attendance_end_day(overtime_note, overtime_minutes)`, the same signature v1.9 re-created.
  With the switch off, `app.attendance_hours()` reports no rules (`early_applies` false), so End day ends the day at
  once, as in v1.8; a request still waiting is closed as `lapsed` (nobody is told).
- **Start day:** `attendance_start_day()` marks Late only while the rules apply; off, nothing is marked.
- **The v1.9 jobs:** `attendance_hours_tick` (the "Start your day" and end-time reminders) runs only for an
  organisation with the switch on, so it sends nothing.
- **Independent of the switch, harmless under v1.8:** the approval reminders (`app.approval_reminders`, W3) keep
  reaching the Owner in-app and by push (the rows carry their own title and body, which v1.8's Alerts shows; the
  kind is neither actionable nor always-emailed, so `email_claim()` never emails it); the decision-email policy
  (`notifications.no_email`, set by `app.notify()` and read by `email_claim()`) is in the database, which v1.8
  calls the same way.
- **The functions v1.9 re-created with a new last argument** (`leave_submit`, `leave_submit_comp`,
  `attendance_submit`, `attendance_choose_leave_today` with `half`; `item_cancel`, `cycle_carry_decide` with
  `close_kind`) default it to null, so v1.8's calls resolve; `session_bundle()` gained a last column
  (`pending_early_leaves`), which v1.8 does not read.
- **Fix forward, not rollback, for one thing:** early-leave requests already "Left early, not answered" when the
  Worker goes back stay undecided until v1.9 returns (v1.8 has no screen for them and does not count them on its
  badge); the attendance day itself is unaffected and the Owner can still correct it from the person's history.

### The Owner's phone walk (installed app at 375 and 430, then the laptop)
Signed in as each role on the phase preview (never production); the Crew and Admin parts with the test people.
1. **Crew, morning, before 10:15:** Start day → the strip: "Started … · Your day ends at 6:00 pm". After 10:15 (or
   with the start time moved in Thresholds): Start day → "You're starting N minutes late" → one line → the strip's
   amber "Late N min · reason". Back closes the sheet.
2. **Crew, before 6:00 pm:** the strip's **Ask to leave early** → reason → "Waiting for the Owner". Then, as the
   Owner: Approvals → "Leaving early" → Approve (and once, Stay). Back on the Crew phone: "The Owner approved. Your
   day ended at …" and "Any expenses to claim today?".
3. **Owner:** Today → the Late line and "Leaving early" first in Needs you; ⋯ on Everyone today → **Stay until**;
   Settings → Thresholds → Working day and Approvals groups (Save sticks at the foot).
4. **Owner:** Reports → End of day (Late / Left early) and Month (the counts); a person's Month tab.
5. **Crew:** Request leave → Half day → **Morning off / Afternoon off**; the Owner's leave row says the half.
6. **On hold:** a task's ⋯ → Put on hold… → reason; the amber line and the chip on Tasks, My Day (Crew sees "On
   hold" and no Start/Done); Resume (with a new deadline once it passed). A project's ⋯ → Put on hold… → the
   banner; Resume… → the one sheet (New date / Carry forward / Close / Leave). Reports → "On hold · n".
7. **Close kinds:** a deliverable's sheet → Close deliverable… → the two kinds → reason → closed label; the carry
   screen's Close…; an older close → Set close kind.
8. **Calendar:** open a future day → "+ New task on ‹day›" pinned at the foot (Crew: "+ Suggest a task on ‹day›");
   a past day has none; All ▾ → Tasks → the red outline; Filters with a filter → "Filters · 1" red. Back order:
   the day sheet closes first.
9. **Laptop (1280):** the same Today, Approvals, Thresholds, a task's ⋯ hold and the calendar's Day footer.
10. **The guide:** Me → How MaxOff works → open, for the role walked: Starting late, Leaving before your end time,
    Start / End your day, Request leave, On hold (task, project), the calendar's day, Close a deliverable; the
    Owner's Today, Approvals' early leaves, Stay until, Thresholds, the reports. Each says what the screen shows.

### The team message (WhatsApp, after the deploy)
> MaxOff update (v1.9), live tonight:
> • **Working hours are on:** work starts 10:00 and ends 6:00 pm. If you start more than 15 minutes late, MaxOff
>   asks for one line for me. It never stops you working.
> • **Leaving early?** Before 6:00 pm, the End day button is "Ask to leave early". Give a reason; I'll approve or
>   ask you to stay. If I don't answer in 30 minutes, you can end your day.
> • **Half days** are now "Morning off" or "Afternoon off".
> • **On hold:** a paused task shows an amber "On hold" line. Don't start or finish it until it's resumed.
> • **Calendar:** tap a day to "Suggest a task" for that day.
> Everything is in Me → How MaxOff works.

## v1.7.1: projects polish, Owner tasks, fresh data, drag reorder, faster pages, in-app guide (phase 6b, Release 2)

**Released 2026-10-16 ~19:30 IST** (the owner's tag `v1.7.1` on `36b4b95`; production Deploy green, eight expand-only migrations applied in order).

**Not released yet** (PR `phase-6b-r2` → `main`; the Owner tags after his staging walk). Eight expand-only
migrations; nothing is removed or rewritten. Money is not part of this release. Build log: issue #89.

### What ships
- **6b.2 Tasks for the Owner:** the Owner can be assigned a task; Done on a task he owns completes it at once;
  **Remind ‹names›** on a task page (the Owner, its creator, its approving Admin; once an hour); "My tasks"
  on the Owner's Today; the Owner shows as Busy to Admins on his shoots.
- **6b.12 fixes:** the back control always lands (a drill-down opened from an undeclared screen goes to its
  labelled parent); back from a task returns to the exact calendar view and date.
- **6b.18 drag to reorder** a staff task's stages, task templates and stage presets (long press on phones;
  ⋯ Move up / Move down). **Only the Owner, Admins within the task's scope and the task's creator reorder a
  task's stages; Crew never** (owner decision 2026-10-15).
- **6b.16 deliverable templates and project tools:** save a project or a deliverable as a template; Start
  from a template with search and preview; **+ Another revision round**; the month-end **"Keep ‹Month›'s extra
  deliverables next month?"** card; **Select** with **Mark N done**, **Tick ‹stage› on N** and **Edit N** (set or
  move planned dates, add a stage group, rename with `{n}`); **Copy schedule as text**.
- **6b.11 the project page:** a progress ring per cycle; one line per stage group; tap a stage to tick it
  from the list (with Undo); **Next: ‹stage›** on each deliverable; Mark done on the row only once every
  stage is ticked; the whole row opens the deliverable; "Done and closed (N)" folded.
- **"Say what it does":** worded buttons, tooltips, empty-state hints and toasts that say what just
  happened, on the project page, the deliverable sheet, Select, templates, My tasks and Remind; a task
  template's Archive is no longer red.
- **6b.17a fresh data:** going back to a screen seen 30 s or more ago re-reads it; Settings' forms show
  their saved values.
- **6b.19 faster pages (P2):** one database trip for every screen's shell; with the app installed, a tapped
  screen's outline appears at once (the service worker keeps only data-free outlines, per build and role,
  dropped on sign-out); a tiny warm-up when the app comes back into view; a lighter server start; pg_cron's
  own run log trimmed daily and two idle jobs run only in their send windows.
- **6b.14 "How MaxOff works":** an in-app guide by role (Me → Help & troubleshooting; Settings → Help and
  troubleshooting), with numbered steps and real screenshots from the local seed.

### What happens on its own after the release
- `cron_history_trim` runs daily at 03:45 IST and keeps pg_cron's run log to 7 days (system data only).
  `client_work_alerts` runs only 08:00–08:30 IST and `digest_weekly` 07:30–00:25 IST (they never sent
  outside those windows).
- On the first open after the deploy, the installed app's service worker updates (v10) and drops every
  saved outline once.

### Speed (perf-probe on the branch preview vs staging = v1.7.0, same run, US runner, TTFB p50)
- Warm, signed in: Today 940 → 357 ms, Tasks 915 → 373, Clients 670 → 383, a client 918 → 342, a project
  921 → 354, Templates 919 → 351. From India each database hop is about 5× shorter.
- A tapped screen's outline (installed): about 3.2 s → 154–228 ms when the server is slow.

### What the Owner will notice
- Everything Admins notice below, plus: tasks can be assigned to him; "My tasks" on Today; Remind.
- Pages open noticeably faster, and the outline of a screen appears as soon as he taps.

### What Admins will notice
- The project page reads differently: a progress line per stage group, "Next:", tick from the list with
  Undo, Mark done only when everything is ticked, Select for bulk actions.
- Templates can be made from a project or a deliverable, and previewed before use.
- They can drag a task's stages into order (on tasks they manage).
- The month-end question about extra deliverables, on monthly projects.

### What the Crew will notice
- The drag handle and ⋯ Move up / Move down are gone from their task checklists (only managers reorder).
- "How MaxOff works" under Me → Help & troubleshooting, with only their own topics.
- Faster screens, and the outline appearing at once on a tap.

### Migrations (expand-only, in order; all already on staging)
`20261015045552_tasks_for_owner`, `20261015092234_task_stage_move`, `20261015113241_deliverable_templates`,
`20261015155412_task_stage_move_managers`, `20261015174021_client_work_bulk_and_rounds`,
`20261015182915_p2_session_bundle`, `20261016032240_p2_db_memory`, `20261016090349_r2_review_fixes`.

### Open for the Owner's walk
- "Save as template" on a project copies its description and custom-field values into a shared template
  every Admin can read (keep, or copy the structure only?).
- The builders' choices under PROGRESS Ideas: "Unit D2", "Unit E+" and "Unit U part A builder decisions"
  (e.g. the weekly keep-extras window is its last 2 days to 2 days after).

## v1.7.0: deliverables with stage groups, and templates that hold them (phase 6b, Release 1)

**Released 2026-10-15 ~12:01 IST** (the owner's tag `v1.7.0` on `af22adb`; production Deploy green, four expand-only migrations applied in order; owner decisions 2026-10-12/13, pre-authorised). Client work gets stage groups, project
templates that hold deliverables, a live preview and a stage limit of 100. Three expand-only migrations;
nothing is removed or rewritten. Money is not part of this release.

### What ships
- **6b.0:** Playwright runs in four CI shards (`ci.yml` matrix 1 to 4, one worker each); owner-bulk and
  push-cron run alone after shard 4. Job names are unchanged.
- **The stage limit is 100** (was 12) in presets, templates, a project's default stages, item-list lines
  and a deliverable's stages. Deliverables per cycle stay at most 100.
- **Deliverables and stage groups.** Screens say Deliverables for items. A deliverable's stages come in
  groups, each from a stage preset or typed, under its heading with its own "n/m" count.
- **Project templates hold deliverables,** each with its own stage groups. A new project from a template
  fills its Item list; the first cycle starts with them and every new cycle copies them.
- **× N and a live preview** in New project and Add a project template.
- **Drag to reorder** stages and groups on the client-work stage lists.
- **Fixes:** an item's status no longer reads twice ("Open Open", PR #72).

### What happens on its own after the release
- Nothing runs differently. The nightly cycle job copies the deliverables and groups a project has.

### What the Owner will notice
- Everything Admins notice below, in every client's projects and in Settings.
- The four CI shards are invisible to him; a full run is just faster.

### What Admins will notice
- "Deliverables" instead of "Items" on the client-work screens. An empty project says "Add deliverables
  to see their stages."
- Stages sit in groups under headings, each with its own "n/m". The same stage name in two groups shows
  as "Group · Stage".
- **Fill from a preset adds a group** named after the preset (rename it if you like); it no longer
  replaces the list. Groups can be typed, renamed and removed.
- **Drag to reorder** stages and groups: a handle on each; long press on a phone. Move up / Move down stay
  for keyboards.
- **Project templates hold deliverables,** each with its own stage groups. Creating a project from one
  fills its Item list. A template is copied, never linked: editing it never changes a project.
- **"× N":** a typed name × 4 makes "Name 1" to "Name 4". Presets can be chosen per deliverable.
- **A live preview** (beside the form on a laptop, a Preview step on a phone) shows what will be created:
  a pinned summary of three figures (deliverables, groups, stages), then one card per deliverable with its
  groups as headings and its stages as a row of step chips; identical deliverables in a numbered run
  ("Item 1–4") collapse into one card, and each card says "Default stages" or "Own stages". Nothing is
  saved until Create. In the builder, a deliverable row says "Uses the default stages" or "Own stages ·
  2 groups · 7 stages", and the ⌄ opens that deliverable's own stage groups (owner feedback, 15 Oct).
- Up to 100 stages per list.
- Nothing is pre-filled. With no presets or templates yet, the screen says "No stage presets yet: make
  one for steps you repeat." Make your own, or copy the Owner's; you edit only your own.

### What the Crew will notice
- Nothing: client work is not theirs.

### Your existing templates and projects work as they are
Every existing stage list shows as one untitled group, with no heading, until someone adds a second group
or names it. Nothing is rewritten or re-created, and every tick, date, note and history row stays. An old
template opens in the new builder with its stages applied to each deliverable; saving it stores the new
shape alongside the old.

### Migrations
Three, expand-only, applied in order by `scripts/production-migrations.sh`:
- `client_work_stage_groups`: stage groups for a project's default stages and a deliverable's stages, the
  deliverables and stage groups on project templates (the old `stages` and `items` kept as flattened
  copies), the 100-stage limit in every check and function, and the functions `project_stage_group_*`,
  `item_stage_group_*` and `project_create_grouped`.
- `client_work_stage_groups_fixes` (the review): a deliverable added to a cycle keeps the groups; the
  project's history names the stage on group changes; an old-shape template write wins after a Worker
  rollback to v1.6; a group key that never runs out; one grant narrowed.
- `client_work_stage_meta_group`: a single stage's tick, rename, move or removal names its group in the
  history.
Nothing is dropped or edited in place. **Rolling back the Worker to v1.6 is safe:** the old screens read
the old columns, which the new ones keep in step; grouped stage lists then show flat, in group order.

### Not in this release (v1.7.1 follows)
- **Speed (unit P, measured 15–16 Oct):** every screen felt slow after v1.7.0; the measurements (ARCHITECTURE §19
  "Measuring the Worker") show the Worker's cold start (2.5–4.7 s on a first request after idle, on every release
  since v1.6) rather than the screens' own reads. v1.7.1 carries the measuring tools and one small fix (the layout's
  push read in parallel); the cold-start fix is a bundle diet of its own, decided on #89. **P2 (owner 15 Oct: "make it faster for free"), done 16 Oct for v1.7.1:**
  on the installed app a tap on Tasks, Calendar, Approvals, a task, or Clients / People / Settings / Me / Alerts shows
  that screen's outline at once (names and numbers still come fresh from the server); coming back to the app wakes the
  server first; every signed-in screen answers in one database wave and about twice as fast once the server is awake;
  with the phone's data saver on nothing is fetched ahead of a tap. Today, My Day, Reports, client and person pages,
  Leave and reloads still wait for the server, and a server that has gone fully cold still takes about a second.
- The calendar fixes (6b.12 items 1 and 2).
- 6b.2, the rest of 6b.16 (other things saved as templates), 6b.11, 6b.17a (correct data on every screen; live
  updates later), 6b.18 on staff task stages, task templates and stage presets (never a
  deliverable's: client work stays invisible to Crew, invariant 4), and 6b.14.

## v1.6.0: client work (phase 7) and the Owner's Today refresh, with v1.5.1's walk fixes

**Released 2026-10-09** (tag `v1.6.0` on `a3f7932`; Deploy 37923367516 applied the migrations in order
and every smoke check passed; the Owner's phone walk passed first). Fourteen expand-only migrations
(`client_work_schema` to `client_work_rework_fixes`); nothing is removed or rewritten. Money stays
Owner-only and is not part of this release: amounts and billing come in phase 9.

### What ships
- **Everything in v1.5.1 below** (never released on its own, owner 2026-10-09): the phone calendar's
  single scroll, the laptop keyboard rules, the installed launch screen and the first-day guide on one
  page.
- **Client work (Owner and Admins only; the Crew never see it):** a client's page has Overview, Projects,
  Brand and Activity. A project is one-time, weekly or monthly; a weekly or monthly project starts a new
  cycle each period (Monday to Sunday, or the calendar month, IST) from its item list, and ⋯ Start begins
  the next one up to 7 days early. Each item can carry its own optional stages (Script, Shoot, Edit,
  Posted…), ticked one by one; a project's stages are only the defaults new items start with.
- **Mark done = approved:** the client's Admin (or the Owner) marks an item done and it counts at once;
  there are no client items in Approvals. The Owner can **Send back…** and the client's Admin can
  **Reopen…** a done item, each with a reason.
- **Ended cycles:** unfinished items are carried forward, closed with a reason, or left pending.
- **The project's Activity panel** (from the header): every change, 20 at a time, filtered by Items,
  Stages or Project; an item shows its last change with a link to its history.
- **Admins run their own clients:** an Admin can add a client (Active and theirs at once; the Owner is
  told) and create, run, complete, cancel and reopen projects on the clients they run. The Owner sees and
  can do everything.
- **The 08:00 client-work alerts:** "cycle ready" and "unfinished items to decide" to the client's Admin;
  overdue items to the Admin, then to the Owner if still open; a cycle left undecided and a one-time
  project past its delivery date to the Owner. Every scheduled client-work notice goes between 08:00 and
  08:30 IST, never around midnight.
- **Also on the screens:** the cross-client item list (Clients → Client items, and Overdue), client items on the
  calendar, Today's Client work (the Owner's overdue count; the Admin's Needs you and My clients' cycle
  progress), the end-of-day report's and the weekly digest's client work, the Admin report's item
  figures, Settings → Stage presets and project templates.
- **The Owner's Today, refreshed** (ROADMAP 6b.7, owner 2026-10-09; no migrations): the Owner's Today opens on **Needs you**: every waiting approval as one compact row
  (Attendance, Leave, Extra work, Expense or Task, then the name or title) with two short lines under it:
  what and when ("Absent (proposed) · Thu 8 Oct", "Present · today, started 10:12", "₹385 · Food · Thu 8
  Oct · No receipt"), never cut short, and how long it has waited ("Waiting 11 h", amber from a day, red
  from three). One outlined button per row, the same in every row: Approve (the same 6-second Undo) or
  Review where the decision needs the review (extra work and expense claims, as on Approvals). A tap on a
  row opens its review. "See all N" shows only when more than five wait; "Nothing needs you." when none do.
  Then **Attendance** as one row of four numbers (Not started · Waiting · Present · On leave, same taps and
  colours); yesterday's unended days are one red line under it ("1 didn't end their day yesterday ›"), and
  decided absences the same ("2 are absent today ›"), each only above zero. Then Today's tasks, **Client work** (the overdue client items line, red), **Overdue
  and risks** (each row one signal: the red or amber line with its dot, "PShetty · overdue by 7 days"; no
  icon, no chip) and **This week** as at most five labelled lines ("Today · 3 due · Shoot 11:49",
  "Tomorrow · 1 due", "Prakyat on leave · Wed 14 – Thu 15", then "See the week"; "Calendar ›" in the
  header; an event with no time counts as due). A task waiting for the Owner after an Admin's check reads
  **"Admin approved · needs you"** (no Admin step: "Needs you") on Today, Approvals, the Tasks lists and the
  task's page, instead of "Checked".
- **Bottom sheets and phone dialogs sit above the on-screen keyboard** (app-wide): the field being
  typed in is no longer hidden behind the keyboard. Production (v1.5.0) has this bug in every sheet with
  a field.

### What happens on its own after the release
- From the first night (00:00 IST), every weekly or monthly project of an Active client gets its cycle for
  the current period; the first "cycle ready" notices go at 08:00.
- Nothing changes for existing tasks, attendance, leave or expense claims.
- Installed apps pick up v1.5.1's new start address as described under v1.5.1.

### What the Owner will notice
- Clients → a client → Projects: projects, cycles and items for every client; Send back… on a done item.
- "‹Admin› added the client ‹name›" when an Admin adds a client.
- Today's "N client items overdue", and 08:00 escalations about overdue items, undecided cycles and
  missed delivery dates.
- The refreshed Today: approvals first and shorter, each with its date and its wait in full; no solid
  white buttons down the list; the attendance card a single line, unended days as one red line; risks with
  their icon and one red or amber line each; the week as a block per day, each row a time and its words
  (a holiday, a person's leave as one row, an event opening its task, "N tasks due").
- Tapping a tab the moment Today appears, on a slow phone or connection, now always keeps the bar on
  until the screen is there, with "Still loading" and Retry after 8 s (before, the bar could vanish after
  0.6 s with the screen still on its way).
- A notice when an Admin creates a project. It says "Set the amount and billing category."; there is
  nowhere to set either until phase 9, which brings the billing screen (the Owner keeps the wording).
- Settings → Stage presets, and project templates beside task templates; Thresholds has the two
  escalation settings.

### What Admins will notice
- New client, and projects on the clients they run: Mark done, Reopen…, stage ticks, the item list, the
  carry screen for ended cycles, and the Activity panel.
- Today's Client work (Needs you, My clients' progress) and the 08:00 "cycle ready" and "items to decide"
  notices.
- Bottom sheets and dialogs stay above the keyboard while typing.
- Today's Issues rows lose the icon and the chip and keep one red or amber line with its dot, as the
  Owner's; a task waiting for the Owner still reads "Checked" to them.

### What the Crew will notice
- Bottom sheets and phone dialogs with a field (Request leave, Add expense, the reason dialogs, and the
  rest) now sit above the on-screen keyboard instead of behind it.
- Nothing else: client work is for the Owner and Admins only. v1.5.1's changes below reach them too.

### Before the tag (the Owner's checks)
- **The phone walk on the phase-7 preview** (375 and 430, installed, gesture back): a client's Projects,
  a project page, an item's sheet (Edit, stages, History), the Item list, the Activity panel and the carry
  screen, as the Owner and as an Admin.
- **The keyboard:** on the phone, Request leave and Add expense, a reason dialog and the Item list: the
  sheet sits above the keyboard and the field stays visible.
- **The new Today** at 375 and 430 px (installed, gesture back from a row's review; approved on the
  `today-refresh` preview 2026-10-09).
- **v1.5.1's checks** below (the calendar, the laptop keys, the installed launch).

## v1.5.1: the owner's phone-walk fixes (phase 6)

**Not released (owner 2026-10-09).** Merged to `main` (PR #59) but never tagged: its fixes ship in
**v1.6.0** with phase 7. No migrations.

### What ships
- **The calendar on a phone fits the screen:** in the week and the compact month the page stays still and
  only the day's timeline scrolls, down to the bottom bar; the header, the calendar, the handle, the day's
  title and its all-day chips stay put. The timeline opens on a whole hour with its label whole. A swipe on
  the timeline scrolls it; one on the calendar or the handle resizes. The full month fits with no timeline.
  "Due", "Who's free" and "+ New task on <day>" now follow the timeline's hours; the New-task pill never
  runs past the screen's edge.
- **Keys on a laptop:** in a task's chat Enter sends and Shift+Enter makes a new line (on a phone Enter
  stays a new line and Send sends); Enter in a form's one-line field submits it, Ctrl+Enter (⌘+Enter on a
  Mac) in a note or a reason (never on a cancel or a reject, where the key only moves to the named
  button); Escape closes the top sheet or dialog, and cancels an edit (asking "Discard changes?" when
  something changed); a dialog opens with its first field ready; Escape clears a search box. Quiet hints
  show on a laptop only. On a phone nothing opens the keyboard by itself any more (a dialog, Edit).
- **The first-day guide fits one page again:** `docs/guide/first-day.html` printed on two after v1.5.0's
  additions; its lines are slightly tighter and three notification items are merged, with nothing a new
  joiner needs dropped.
- **Never a blank window at launch:** when the installed app opens (on a computer or a phone) and the
  server is slow to answer, the MaxOff launch screen shows at once, then home; a fast launch looks the
  same as today. The installed app now starts at `/?source=pwa` (the service worker, v8, recognises the
  launch by it); it never shows stale or anyone's data, adds nothing to the back history (one back from
  home still exits), and signed-out and offline launches land on sign-in and the offline page as before.

### What happens on its own after the release
- Installed apps pick up the new start address when the browser refreshes the app's manifest (on use,
  about once a day on a computer); until then a launch behaves as before. An iPhone install probably
  keeps the old start address until it is added to the home screen again.

### What the Owner and Admins will notice
- The phone calendar no longer scrolls away; only the day's hours scroll.
- On the laptop: Enter sends a chat comment, Escape closes sheets and dialogs (back afterwards leaves the
  page), and dialogs open ready to type.

### What the Crew will notice
- On a laptop, Enter sends a chat comment (Shift+Enter for a new line); on the phone, tapping Edit or
  opening a form no longer brings the keyboard up until they tap a field.
- The phone calendar stays still; only the day's hours scroll.
- Opening the installed app after a while shows the MaxOff mark straight away instead of an empty window.

### Before the tag (the Owner's checks)
- **Calendar on the phone:** only the timeline scrolls; the first hour's label is whole; the week and the
  compact month keep the header, the calendar, the handle, the day's title and its all-day chips in place;
  a swipe on the timeline scrolls it, one on the calendar or the handle resizes; the full month fits.
- **Keys:** on the laptop, Enter sends a task chat comment and Shift+Enter makes a new line (the hint under
  the box says so); Escape closes a sheet or dialog, and back afterwards leaves the page; Escape while
  editing your profile with a change asks "Discard changes?"; a dialog opens with its first field ready to
  type in. On the phone, Enter in the chat makes a new line (Send sends), and no dialog or Edit opens the
  keyboard by itself.
- **Installed launch on the MacBook and the phone:** the MaxOff launch screen, never a blank window, then
  home; one back from home still exits. Check it after the app has been idle for a while (a cold start);
  if a blank window still shows, reinstall the app once so it takes the new start address.
- **Guide PDFs rebuilt on the laptop** (`docs/guide/build-pdf.ps1`, Edge): `first-day.pdf` is one page.

## v1.5.0: My Day, Today, the calendar and the end-of-day report (phase 6)

**Draft, not released.** Not merged and not tagged: the branch `phase-6` waits for the Owner's phone walk on
its preview, then the merge to `main`, then the Owner's `v1.5.0` tag. Six expand-only migrations
(`dashboards_today`, `eod_report_weekly_digest`, `eod_reports_grants`, `digest_since_last`,
`end_not_recorded_yesterday`, `task_type_colors`); nothing is removed or rewritten.

### What ships
- **My Day (Crew):** under the attendance strip, only what needs you: Not noted, Changes requested, Overdue,
  Due today, then one line for the next seven days; today's and tomorrow's shoots and meetings; a quiet
  line for a holiday or your own leave this week; "Suggest a task". Empty: "Nothing needs you today."
- **The Owner's Today:** exceptions only. The attendance card's counts (Not started, Waiting for a
  decision, Present, On leave, and Absent or End of day not recorded when above zero) each open the board
  on that group; amber means "have a look", red a problem. Then the oldest approvals (Approve with Undo,
  or Review), one line for today's tasks, Overdue and risks (overdue, not noted, an assignee on leave or
  can't be reached, emails held back by the daily limit) and the week's events. Empty sections are
  hidden: "Nothing else needs you today."
- **End of day not recorded (yesterday):** the red count on the Owner's Today lists the people who started
  yesterday and never ended it, from the End-day cutoff (05:00 by default) until the Owner decides the day.
- **The Admin's Today:** Needs you, My tasks, My clients (open and overdue task counts per client), the
  week's events and Issues (an assignee on leave or can't be reached on the Admin's tasks); the Admin's
  work report under Reports (rework, turnaround, overdue now, how long people take to tap Task Noted, who
  is loaded this week).
- **The calendar:** on a phone one calendar that grows from a week to a compact month to the full month
  by a swipe or the handle; on a computer Month, Week and Day. Shoots, site visits and meetings in their
  task type's colour, leave, holidays, due and overdue counts; filters (client, person, type, status; type
  only for the Crew). A day shows its events, Due, and for the Owner and Admins "Who's free"; the Owner
  and Admins get "+ New task on <day>" with the date filled in (today and later only), the Crew
  "Suggest a task". Admins see others' work as "Busy" only; the Crew see only their own.
- **Task type colours:** Settings → Task types (Owner) gives each type a colour from a palette with no
  red; the seven launch types get theirs at the release.
- **The end-of-day report:** Reports → End of day (Owner): attendance, decisions, tasks, approvals and
  tomorrow's events for each day, live for today and for yesterday until the cutoff, then saved and never
  rewritten. "Yesterday's report is ready" arrives after the cutoff (held by quiet hours; skipped on an
  empty day). No money, ever.
- **The daily digest becomes a weekly digest:** one email at 08:00 on the Owner's chosen day (Settings →
  Thresholds → the weekly summary's day, Monday by default), built from the saved end-of-day reports, then
  what's waiting now and the week ahead. Changing the day never skips a week.
- **The bell:** its unread count sits on the bell itself, inside the tap area.
- **The iPhone app follows the phone's text size** (up to twice the normal size); above that, pinch-zoom
  stays on.
- **"Can't reach the server. You're still signed in.":** Try again now really asks the server again (it
  only redrew the page before), and an expired sign-in token on a page now lands on this screen instead of
  "This page couldn't load".
- **Push onboarding steps:** the go-live runbook's "every person, every phone" checklist and the first-day
  guide (install on iPhone or Android, allow notifications, Send a test, "Did it arrive?").
- **Behind the scenes:** readable stack traces in Sentry for server errors (staging first; production once
  its Sentry token is set); a phone's own network drops are no longer reported as errors.

### What happens on its own after the release
- **The 08:00 daily digest stops;** the first weekly digest goes on the next digest day (Monday unless the
  Owner changes it).
- **The end-of-day job catches up the last seven days** on its first run after the cutoff and saves one
  report a day from then on. In those first catch-up reports "handed in" and "overdue" are counted as of
  the save, not as of each day.

### What the Owner will notice
- Today shows only what needs a look; the counts open the board, and an empty Today says "Nothing else
  needs you today."
- A red "End of day not recorded" count about yesterday, from 05:00 until the day is decided.
- The calendar, with "+ New task" on a day and "Who's free".
- Reports → End of day, and each morning "Yesterday's report is ready" instead of the 08:00 email; the
  weekly digest instead, on the day set in Settings → Thresholds.
- Settings → Task types has a colour for each type.

### What Admins will notice
- Their Today: Needs you, My tasks, My clients, the week's events and Issues.
- Their work report under Reports.
- The calendar: full detail on the tasks they can see, others' work as "Busy", others' leave as "On
  leave" or "Half day", "Who's free" and "+ New task" on a day.

### What the Crew will notice
- My Day lists only what needs them, with their next shoots and meetings and "Suggest a task".
- The calendar shows their own shoots, meetings, leave and the holidays; "Suggest a task" on a day.
- On an iPhone the app follows the phone's text size.
- "Can't reach the server. You're still signed in." recovers with Try again.

### Before the tag (the Owner's checks)
- **The phone walk** on the phase-6 preview (375 and 430, installed, gesture back) and the laptop calendar.
- **Task type colours on staging:** after the merge, the seven launch task types have their colours, and
  `activity_log` has seven rows with action `backfilled` for them (the backfill has never met real rows
  before).
- **The staging Sentry source-map check after the merge** (README → "Confirming the Sentry pipeline" →
  "The first check on staging"): the deploy log's debug id, the artifact bundle in Sentry,
  `/diagnostics/sentry` reading `src/core/observability/diagnostic.ts`.
- **The guide PDFs rebuilt on the laptop** (`docs/guide/build-pdf.ps1`, Edge), and `first-day.pdf` still
  one page.

## v1.4.0: reminders, the Owner's digest, reachability and the Crew navigation (phase 5B)

Not yet tagged. Everything merged to `main` since v1.3.0: PRs #41 and #43 (no surprise reloads, the view's
address), #44 (phase 5B), #45 (test fixes), and the release switches below.

### What ships
- **The Crew navigation:** the bar is My Day · Tasks · Calendar · Leave · Me; Alerts moved to the bell. Leave
  has two tabs (Leave requests, Attendance); Extra work & expenses moved under Me; Me has Help &
  troubleshooting with the app version.
- **Alerts:** grouped by day, All | Unread, repeated rows for the same record collapsed with a count.
- **Task reminders (5.3):** before due, due now, overdue, the event "tomorrow" email, acknowledgement repeats,
  the 4 h / 8 h not-noted escalations and the 24 h overdue escalation; leave, comp leave and holidays hold a
  reminder to the person's next working day; reminders set per task, template, task type or organisation.
- **The Owner's 08:00 digest:** one email a day, counts only, never an amount.
- **Reachability (5.4):** Settings → Notifications shows who push can reach; the Owner gets one weekly
  "can't be reached" alert per person; each person's 48 h clock starts at the release.
- **Onboarding (5.5):** a walkthrough for new joiners; Me lists your devices (Remove is confirmed and
  sticks); "Did it arrive?" after a test, with troubleshooting for each platform.
- **Settings → Thresholds:** the quiet-hours editor (Owner only).
- **Email:** task assigned is emailed only when push can't reach; escalations are the last thing the daily
  limit drops; one combined email per person per run.
- **Fixes:** no surprise reloads on a view switch; a background call never holds a page open; a failing
  reminder row never costs the rest of a run.

### The release switches (owner decisions 2026-10-06)
- **Reminders for the tasks already open.** Until now only tasks created after the reminders shipped had
  them. The migration `reminders_backfill_release` arms every open task once, at the release, with only the
  reminders still ahead (an already overdue task's escalation counts from the release). The deploy log
  records the counts in a NOTICE: tasks armed, reminders created, and the acknowledgement messages it
  starts. **Expect a wave after the release:** every assignee who has not noted an old task gets the
  repeat at +2 h, the lead's escalation follows at +4 h and the Owner's at +8 h (one combined email per
  person per run; quiet hours hold pushes). Staging's dry run counted 3 tasks, 7 reminders, 3 repeats,
  3 lead escalations (naming 3) and 2 Owner escalations (naming 2); production's numbers will differ.
- **The 90-day removal of read alerts.** Migration `notifications_read_removal_schedule` schedules it daily
  at 03:30 IST, after the 03:00 storage clean-up. **Unread alerts are never removed**; tasks, comments,
  activity and every business record are kept. Production went live on 2026-10-01, so nothing is old
  enough to remove before the end of December 2026.

### What the Crew will notice
- Alerts are under the bell; Leave has its own tab; Extra work & expenses are under Me.
- Old tasks they haven't noted start asking to be noted, two hours after the release.
- The band asks for a test until a push has actually arrived on one of their devices.
- A device removed from Me stays off until it is turned on again on that device.
- A new joiner's sign-ins land on the walkthrough until they finish it or tap Later.
