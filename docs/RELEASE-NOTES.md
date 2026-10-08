# MaxOff release notes

Newest first. Each entry says what ships, what the Crew will notice, and what happens on its own after the
release. A release is a `v*` tag on a `main` commit with green CI, approved by the Owner (CLAUDE.md). Earlier
releases (v1.0.0 to v1.3.0) are recorded in their tag messages and in `PROGRESS.md`.

## v1.5.1: the owner's phone-walk fixes (phase 6)

**Draft, not released.** On `phase-6` after v1.5.0; the advisor opens its PR once the walk fixes have
one green full run, then the Owner's `v1.5.1` tag. No migrations.

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
