---
name: v2-autopilot-5nov
description: "v2.0 state at the owner's 'autopilot, see u tmrw' (5 Nov 2026 ~23:00 IST): what's done, what the advisor may do alone overnight, what waits for the owner"
metadata:
  type: project
---

Owner, 5 Nov 2026 ~23:00 IST: "do everything on autopilot. see u tmrw".

**State then:**
- **India probe on `phase-v2`:**
  - Admin passed on 49372e52.
  - Crew passed.
  - Owner passed on 9bab4144, but only round 1 was clean; the builder's CI probe overlapped the rest. The owner's Chrome tab 1856972248 is signed in as **Owner** on both previews.
- **Full CI on 9bab4144:** green, no reruns.
- **X3 step 3 (≤ 6 first-wave reads per route):**
  - /approvals: 9 → 4.
  - /today: 7, still to fold. Option A, chosen by the advisor: merge the board's two attendance reads into one role-aware function.
  - Still to do: /my-day 8, /tasks 10, templates, a task's page 16.
  - Migrations approved and pushed: cdc8f70a (own_hours), 855e88d1 (own_week).
- **Rules given to the builder:**
  - No staging probe, deploy or seed between READY TO MEASURE and the advisor's "window closed".
  - Migrations are reviewed before each push.
- **Logged for the owner, later:** at the DB level Crew can see other people's event tasks; the app filters them out. A PERMISSIONS question, after v2.0.

**What autopilot covers:**
- reviewing and approving builder work within the v2.0 plan;
- running Owner-role India probes;
- keeping the #89 watcher armed.

**Never alone:**
- merges of code PRs need full green and the owner's walk;
- `v*` tags and production approvals;
- business rules.
- **Admin and Crew probes need the owner to switch logins.**

**How to apply:** at the next session, tell the owner what happened overnight, then ask for logins if READY TO MEASURE is up. Related: [[speed-gate-every-release]], [[note-only-until-proceed]].

**6 Nov 07:30 IST update:** the builder posted READY TO MEASURE on aa30a95a (every route's first wave ≤ 6, full CI 42128821379 green first try). The Owner India probe passed (comment 6674873864). The window stays open until the Admin and Crew probes are done; those need the owner to switch logins.
**6 Nov ~08:30 IST:** the Admin and Crew India probes on aa30a95a passed (comments 6674983584 and 6675045485); window closed. The builder's next step is X3 (b): the task page, the project page, the Owner's /people and /today, the Admin's /leave and /tasks, then /me. The RLS-helper proposal and any index come to me for review first. Chrome tab 1856972248 is now signed in as Crew on both previews.
**10 Nov:** the India probe on 4c283fc6 (RLS helpers to PL/pgSQL, attendance_hours once per call, budgets lowered, INP spec) passed for all three roles (#89 comment 6757528422); the gaps closed. The builder's next step is X3 (d) (hydration splits with no visible change, the calendar lost-tap fix, prefetch and service-worker checks), then X4, X5 and X6. Watcher bug: the since filter must be recent (fixed in watch89.sh). Chrome tab ids change after a reconnect; call tabs_context first.
