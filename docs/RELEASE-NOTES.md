# MaxOff release notes

Newest first. Each entry says what ships, what the Crew will notice, and what happens on its own after the
release. A release is a `v*` tag on a `main` commit with green CI, approved by the Owner (CLAUDE.md). Earlier
releases (v1.0.0 to v1.3.0) are recorded in their tag messages and in `PROGRESS.md`.

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
