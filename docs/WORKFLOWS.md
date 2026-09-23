# MaxOff: Workflows and State Machines

> Every workflow state change goes through a **Postgres transition function** (e.g. `task_submit_done()`). The function checks the actor, the current state and the inputs, updates the record, writes `activity_log`, and queues notifications, **all in one transaction**. Direct `UPDATE`s of state columns are blocked by RLS and triggers.
> Times are `timestamptz`. "Today" means the **IST date**: `(now() at time zone 'Asia/Kolkata')::date`.

---

## 1. Daily attendance (Admins and Staff)

```
first authenticated request of the IST day
   └─► attendance_day created (state: awaiting_choice) ── app is gated until a choice is made
          │ member chooses
          ├─ Present ────────────────┐
          ├─ Leave / Half-Day / Comp ─┴─► also creates leave_request(source = attendance, date = today)
          ▼
      pending_review ──Owner approve──► approved (final_status = submitted status)
          │
          └──Owner correct(status, reason)──► corrected (final_status = Owner's status)

23:59 IST job, working day, no submission ─► pending_review, submitted = none, final_status = absent (proposed)
      └─ Owner approve ─► approved(absent) · Owner correct ─► corrected(any status)

approved full-day leave covering today ─► approved (final_status = leave type, proposed_by_system, no gate)
      └─ "I'm working today" ─► pending_review (submitted_choice = present)
            ├─ Owner approve ─► approved(present), worked_on_leave = true ("1 day worked"); the leave request is untouched
            └─ Owner correct ─► corrected(any status)

leave approved AFTER the member submitted Present for that date ─► corrected (final_status = leave type,
      actor = system, action = corrected, reason = "leave approved") · the member is notified. The leave wins.
```
- **The Owner is exempt** from the gate and from the absent, logout-reminder and logout-not-recorded jobs. The Owner's logout writes only `session_events`.
- **Approved leave comes first.** For each member with **approved leave covering the date**, the day is created as `approved`, `final_status` = the leave type, `leave_request_id` set, `proposed_by_system = true`, with an `attendance_events` row `derived_from_leave`. This happens at **first login** (`attendance_touch()`), or in the **23:59 job** for anyone who never logged in. They're never proposed absent.
- **"No submission"** means *either* no `attendance_days` row *or* a row still in `awaiting_choice` (logged in but never chose).
- **The attendance day is the source of truth for a date.** Leave requests feed it; they never replace it.
- **On a day with approved full-day leave there's no gate.** If the person logs in anyway, a banner says "You're on approved leave today" with an optional **"I'm working today"** button: `attendance_submit(present)` is allowed from `approved` **only** when `proposed_by_system = true`, and moves the day to `pending_review` keeping `leave_request_id`. If the Owner approves it, `worked_on_leave = true` ("1 day worked") and the **leave request is not altered**.
- **Approved half-day leave** sets the day to `half_day` with no gate, but `first_login_at`, `session_events` and logout are still recorded.
- **A leave approved later wins.** When `leave_decide(approve)` covers a date whose day is already `pending_review` or `approved` with a submitted choice of Present, the same transaction corrects the day to the leave type (`corrected`, `actor_id = null`, `attendance_events.action = corrected`, reason "leave approved"), and notifies the member.
- **An Owner correction to a leave type** (`leave`, `half_day`, `comp_leave`) with no leave request behind it creates `leave_requests(source = 'owner', state = approved)` for that date and links it, so calendar and availability stay right.
- A **working day** is not a weekly off day and not in `holidays`. On a day off: no absent check, but the gate **still asks** if someone logs in, and `is_day_off = true` shows as "Worked on a day off". (Pixora's current setting: Sunday off, and people do sometimes work Sundays.)
- `attendance_day` is **unique per member per IST date**. Later logins only add `session_events`.
- **Sign-in:** the login action (and a recovery link opening a session at `/auth/confirm`) calls `session_login()`, which writes `session_events(kind = login)` for the active member and refuses anyone else. A deactivated or invited person cannot sign in: the session is ended again and the form says so.
- **Logout:** `session_logout()` writes `session_events(kind = logout)` immediately (this device only; other signed-in devices stay in), then the auth session is ended. 2.1 extends it to update `attendance_days.last_logout_at`.
- **20:30 IST job** (configurable): anyone with a login today and no logout since their last login gets the forgot-to-logout reminder.
- **Nightly (after 23:59):** days with a login and no logout get `logout_not_recorded = true`. No time is made up.
- **Overtime:** the member can flag overtime with a reason on any day, which sets `overtime_flag` and `overtime_reason`. Notice only, no approval.
- **Corrections** after a decision: the Owner can correct again at any time. Each correction is another `attendance_events` row, and nothing is overwritten without history.
- **Bulk approve** = the same function called for each row, so each row gets its own audit entry.

## 1a. Team membership (task 1.3)

```
Owner invites (email, name, role, job title)
   └─► auth user created without a password (generateLink type = invite) + members row: invited
          │ the person opens the link → /auth/confirm → /set-password → password stored
          ▼
        active (joined_at) ── profile step on /me ── signs in with email + password from now on
          │
          └──Owner deactivate(reason?)──► deactivated (deactivated_at; every auth session and refresh token deleted)
                                              └──Owner reactivate──► active (joined_at kept)

invited ──Owner "Revoke invite"──► deactivated (the link opens nothing) ──Owner reactivate──► invited
```
- **Invite** = `member_invite()` after the auth user exists; the email goes out through the app's `sendEmail()` (Resend, or the log sender when no key is set) and bypasses the daily cap (§9). Only the **Owner** (`team.manage`) invites, and only as **Admin or Staff**. An email that already belongs to a member is refused (`CONFLICT`), whatever their status: reactivate instead.
- **Invite link** = `/auth/confirm?token_hash=…&type=invite`, valid for `otp_expiry` (24 h, decided 2026-09-22) and **one use**. "Copy invite link" (Owner only) calls `member_invite_refresh()` then issues a fresh link; **the previous link stops working**. The email is the same link, so this is also the "I never got the email" path. Opening a link **confirms the sign-in at GoTrue even when no password is set**, after which only recovery tokens can be issued: later links are `type=recovery`, same route, same accept step, and "Forgot password" works as the self-serve way back for someone who abandoned `/set-password`.
- **Accept** = the link opens a session for the invited member (`verifyAuthLink()` admits `invited` for either link type), `/set-password` stores the password, then `member_accept_invite()` moves `invited → active` and `session_login()` records the first login. Anything else with an invited session (a shell route) is ended as inactive.
- **Deactivate** (`active`) and **Revoke invite** (`invited`) are the same transition, `member_deactivate(member_id, reason)`, worded by state. The reason is optional and kept in the activity log. Never the caller, never the Owner. Deactivation takes effect **immediately**: RLS (no `current_member()` row), `requireMember()` on the next page load, and the deleted refresh tokens, so an open tab cannot renew its session when the JWT expires (≤ 1 h). 5.4 also deletes the person's push subscriptions.
- **Reactivate** returns a person who had joined to `active`, and someone who never accepted to `invited` (a new link is needed). `deactivated_at` is cleared; the log rows stay.
- **Edits**: the Owner changes name, role (Admin ↔ Staff; the Owner row's role never changes here) and job title as plain edits (audited by trigger). A member edits their own name and phone on /me. Email changes are not built yet (ROADMAP 1.4).
- **Notifications**: the invite email only. Nobody is notified of a deactivation or reactivation (nothing in §9 says so).

## 2. Leave requests

```
submitted ──Owner approve──► approved ──employee requests change/cancel──► (new request, supersedes_id = old)
    │                        │                                                 │ Owner approves new
    │                        │                                                 └─► old: superseded, new: approved
    │                        └──Owner edit/cancel directly──► superseded by Owner-created request / cancelled
    ├──Owner reject(reason)──► rejected
    └──employee withdraw (before decision)──► withdrawn
```
- Types: `leave`, `half_day`, `comp_leave`. Dates: `start_date` to `end_date` (half day: a single date).
- A leave request created at login is linked to that day's `attendance_day`. The Owner's attendance decision and the leave decision are made **together in one action**.
- Approved leave feeds calendar blocks, availability and assignment warnings.

## 3. Staff tasks

### 3.1 Task state
```
                    ┌──────────────── reopen (Owner/Admin) ────────────────┐
                    ▼                                                     │
 created ─► todo ─► in_progress ─► submitted ─► admin_approved ─► completed
              ▲          ▲            │  │            │
              │          │            │  └─(no admin step)────► awaiting Owner (= admin_approved state, admin_step = none|skipped)
              │          └─ changes_requested ◄── Admin reject(reason) / Owner reject(reason)
              │
 any non-final state ──cancel(reason)──► cancelled
```
| State | Meaning | Who moves it forward |
|---|---|---|
| `todo` | Assigned, not started | Any assignee → `in_progress` (optional) |
| `in_progress` | Being worked on | **Primary owner** → `submitted` (Done) |
| `submitted` | Done, waiting for the Admin | Approving Admin → `admin_approved` or `changes_requested` |
| `admin_approved` | Waiting for the Owner (Admin approved, or no Admin step) | Owner → `completed` or `changes_requested` |
| `changes_requested` | Sent back with a reason | Primary owner → `submitted` again |
| `completed` | **Final.** Owner approved | Creator / approving Admin / Owner can `reopen` → `in_progress` (reason required) |
| `cancelled` | Stopped with a reason, still reportable | Creator / approving Admin / Owner can `reopen` → `todo` (reason required) |

- **Done can be submitted from `todo` or `in_progress`.** `in_progress` is optional.
- **Done doesn't wait for acknowledgements.** If the primary owner hasn't acknowledged yet, submitting Done records their acknowledgement automatically (audited). Other assignees' acknowledgements stay tracked and still get reminders.
- **Who may edit, reassign, cancel or reopen a task:** its **creator**, its **approving Admin**, or the **Owner**. Other Admins who can see it can't change it.
- **Reopen** goes through the **same approval route again** (the Admin step is re-evaluated at the next Done). Acknowledgements are retained. The reopen reason is stored **only in `activity_log`** (`meta.reason`); there's no column for it.
- **Locking:** assignees lose edit rights from **`submitted`** onwards, in every route (with or without an Admin step). They can still comment. Editing resumes only through `changes_requested`.

- **Done skips the Admin step** (goes straight to `admin_approved`, with `admin_step` = `none`) when `approving_admin_id` is null (the Owner assigned directly). It also skips it (`admin_step` = `skipped`) when the approving Admin is an assignee. The skip reason is stored **only in `activity_log`** (`meta.reason = 'approver_is_assignee'`).
- **Locking** is described in the table above (from `submitted`).
- **Overdue** is **derived**: `now() > due_at AND state NOT IN (completed, cancelled)`. It's a badge and a filter, not a state. Moving the deadline recalculates it.
- **Overdue escalation:** `overdue_escalate_hours` (default 24) after `due_at`, if the task is still in `todo`, `in_progress` or `changes_requested` (nothing submitted), a `task_reminders(kind = overdue_escalation)` fires once to the approving Admin (or creator) **and** the Owner.
- **Late reason:** when submitting after `due_at`, `late_reason` is required from the primary owner.
- **Approving Admin** is set when the task is created (PRODUCT §4.6 table) and can be changed or removed by the Owner. Changing it while the task is `submitted` sends the review to the new approver.

### 3.2 Acknowledgement (per assignee)
```
assigned (acknowledged_at null) ──"Task Noted"──► acknowledged (timestamp)
   │ every ack_repeat_hours (default 2 h): reminder to the assignee
   ├ after ack_escalate_hours (default 4 h): escalation to the approving Admin (or creator)
   └ after ack_escalate_owner_hours (default 8 h): escalation to the Owner
```
- Each escalation fires once (`task_reminders(kind = ack_escalation)` with `escalation_level` 1 then 2). Repeats to the assignee continue until acknowledged.
- Adding an assignee later starts their own acknowledgement. Removing one keeps their row with `removed_at` set.
- Changing the deadline, scope or primary owner **after acknowledgement** notifies the affected people. Acknowledgement is kept (it recorded that they received the task), and the change shows in the task history.

### 3.3 Reviews and submissions
- Every approve or reject is a `task_reviews` row (step, decision, reason, reviewer, the submission version it refers to).
- File submissions are versioned per task (`task_submissions.version` 1, 2, …). Files are never replaced.

### 3.4 Task requests
`pending ─convert─► converted (task_id set) | ─decline(reason)─► declined | ─withdraw─► withdrawn`

## 4. Clients
```
draft ──Owner activate (needs name + admin)──► active ⇄ paused ──► inactive ──Owner reactivate──► active
```
- **Paused:** readable. No new cycles.
- **Inactive:** readable and searchable. No new projects, items or client-labelled tasks.
- Changing the Admin closes the current `client_admin_assignments` row and opens a new one. Access moves immediately.

## 5. Client work

### 5.1 Project status
`open ─► in_progress ─► completed` · `any ─► cancelled` · Owner can `reopen` a completed or cancelled project.
- **open → in_progress happens automatically** inside the transition function the first time any of the project's items has a stage ticked or is marked done.
- **completed and cancelled are Owner-only and never automatic.** A project with every item approved still stays open until the Owner closes it.

### 5.2 Cycles
- Every project has cycles. A **one-time** project gets exactly one cycle (no period) when it's created, enforced by a partial unique index on `project_cycles(project_id) where period_start is null`. **Recurring** projects get one cycle per period, and `project_create` immediately creates the **current** period's cycle (a monthly project started on the 15th gets that month at once, then the next on the 1st).
- **00:00 IST job:** on the **1st** (monthly projects) and **Monday** (weekly projects), for projects whose client is **active** and whose status is open or in_progress, `cycle_generate(project, period)` copies `project_item_blueprints` into new items. It's **idempotent**: unique `(project_id, period_start)`.
- A cycle is `open` until the next cycle exists **and** every unfinished item in it has been carried forward, closed or approved. Then it's `settled`. **`leave_pending` keeps the cycle open**, because those items are still workable, and the Owner is reminded about them until they're decided.

### 5.3 Items
```
open ──Admin tick done──► done ──Owner approve──► approved (final, revenue achieved)
  ▲                         │
  └────Owner reject(reason)───┘
open/done ──cancel(reason, Admin or Owner)──► cancelled
```
- **Stage ticks** (`project_item_stages`) are independent of item state. Ticking all stages doesn't mark the item done.
- **Carry decision** (Owner, for items not `approved` when their cycle's period has ended):
  - `carry_forward` → a **new item** in the next cycle with `carried_from_item_id` and `origin_cycle_id` = the original. The original item becomes `carried` (a final state). The new item keeps the original's value and category. **If the next cycle doesn't exist yet** (before the 1st or Monday, or because the client is **paused**), `cycle_carry_decide` creates it with `generated_by = 'carry'`, and the scheduled `cycle_generate` later finds it already there (idempotent).
  - `close` → `cancelled` with a reason (`cancelled_by`, `cancelled_at`). Its value **stays in Potential** and reports show it as *closed, not achieved* (§6).
  - `leave_pending` → stays in its original cycle, still workable. Can be decided again later.
- **Bulk approve** = the same function called for each item, so each gets its own approval record.

## 5A. Work submissions and the Google Drive archive

```
Staff submits a version
   ├─ upload (image ≤ 25 MB, video ≤ 100 MB)
   │     browser → R2 (direct, resumable) → submission_items(kind=upload, archive_state=queued)
   │     photos: a JPEG preview is generated for display; the ORIGINAL is never modified
   │     └─ drive_jobs(upload_file) ─► Drive: Clients/<Client>/<YYYY-MM>/Photos|Videos/
   │                                   └─ archived ✓ (drive_file_id, web link stored)
   └─ Drive link (anything larger)
         check access now ──ok──► drive_jobs(copy_link) ─► Google server-side copy into our Drive ─► archived ✓
                           └──private/missing──► link_state=private, archive_state=blocked
                                                  ├─ notify the submitter: "make it 'anyone with the link'"
                                                  └─ recheck_link job (backoff, up to 7 days) ─► archives itself once access is granted
```

- **Approval is never blocked** by a failed archive. The task shows the warning, and the Owner decides.
- **Only submissions are archived.** `task_submit_version` queues the `drive_jobs`. Logos, avatars and previews are ordinary `files` and are never sent to Drive.
- **Retention (`delete_local` jobs, daily):** photo originals leave R2 after **90 days**, video originals after **30 days**, and **only when `archive_state = archived`**. `local_deleted_at` is set and the original's `files.status` becomes `deleted`; the row, the JPEG **preview** (kept forever), the Drive link and the history stay. Nothing is deleted while the archive queue is blocked or the Google account needs reconnecting.
- **Folders** are created on demand and cached in `drive_folders`. Names: `YYYY-MM-DD_<task-title-slug>_v<version>_<FirstName>_<nn>.<ext>`. Each Drive file's description carries the MaxOff task URL.
- **Token expiry:** any Google call returning `invalid_grant` sets `drive_account.state = needs_reconnect`, notifies the Owner, and parks the queue. Reconnecting drains it.
- **Quota:** the account's free space is checked daily, and the Owner is warned below 10%.

## 6. Revenue calculation (Owner only)
For each item, `item_value`:
1. an explicit `item_billing.value` if set, otherwise
2. for a recurring project, `cycle_amount ÷ number of planned items in the cycle`; carry-ins are valued from their **origin** cycle; otherwise
3. for a one-time project, `fixed_amount ÷ number of planned items`.

- **Planned items** of a cycle = its items that are **not carried in** (`carried_from_item_id is null`) and **not cancelled before the cycle started** (`state <> 'cancelled' OR cancelled_at >= coalesce(period_start, cycle created_at)`). An item closed at the carry decision was cancelled after the cycle started, so it **stays planned**.
- **Potential** (cycle / project / client / category / month) = Σ item_value of planned items.
- **Achieved** = Σ item_value of items with `state = approved`, attributed to the **origin** cycle's period.
- **Closed, not achieved** = Σ item_value of planned items with `state = cancelled`, reported as its own line so lost revenue stays visible.
- **Remaining** = Potential − Achieved.
- **Overrides:** `revenue_overrides` for a cycle or one-time project store `calculated_value` (frozen when overriding), `adjusted_value`, note, Owner and time. Reports show *System calculated* and *Owner adjusted* side by side.
- This is implemented as security-invoker SQL views over Owner-only tables. Non-Owner roles can't select from them.

## 7. Month close and snapshots
```
month M (IST) open ──Owner close──► closed (snapshot v1, immutable)
                                     └──Owner correct(note)──► snapshot v2 (links v1; v1 kept)
```
- A snapshot is a JSON document holding every figure in the monthly report plus the raw rows the AI export needs (attendance, tasks, items, revenue lines, metrics).
- Closing doesn't lock operational data. It freezes the **report**. Reports for closed months read the latest snapshot version.

## 8. Scheduled jobs (all idempotent, times in IST)
**Runs in:** `pg_cron` = a SQL function inside Postgres (database-only work). `worker` = a Cloudflare Cron Trigger calling `/api/cron/<job>` with `CRON_SECRET` and the service role (anything that needs the network: Web Push signing, Google Drive, R2, Resend). `gha` = GitHub Actions.

| Job | Runs in | When | What it does |
|---|---|---|---|
| `reminders_tick` | pg_cron | every 5 min | Creates due notifications (before due, due, overdue, acknowledgement repeats, ack and overdue escalations). Records `sent_at` so nothing is sent twice |
| `logout_reminder` | pg_cron | 20:30 (setting) | Reminds anyone still logged in |
| `absent_check` | pg_cron | 23:59 | Creates leave-derived days for anyone who never logged in, then proposed-absent days for working days, and notifies the Owner |
| `logout_not_recorded` | pg_cron | 23:59 (after absent_check) | Flags days with no logout |
| `eod_report` | pg_cron | 23:59 (after the above) | Builds the Owner end-of-day report and notifies the Owner |
| `cycle_generate` | pg_cron | 00:00 on the 1st and every Monday | Creates recurring cycles (skips any already created by a carry decision) |
| `cycle_close_prompt` | pg_cron | 00:05 on the same days | Notifies the Owner about unfinished items in the cycles that just ended |
| `push_dispatch` | worker | every minute | Sends queued push and email deliveries, retrying with backoff; applies the email cap |
| `drive_archive_tick` | worker | every 2 min | Runs queued `drive_jobs` (copy link, upload file, recheck link) with backoff |
| `storage_cleanup` | worker | 03:00 | `delete_local` jobs: photo originals > 90 days, video originals > 30 days, archived only. Also clears orphaned `pending` files from R2 |
| `drive_quota_check` | worker | 03:30 | Refreshes Google quota and warns the Owner below 10% free |
| `nightly_backup` | gha | 02:00 | pg_dump to R2 |

## 9. Who gets notified
| Event | Recipients |
|---|---|
| Task assigned / assignee added | Each new assignee |
| Acknowledgement missing (repeat) | That assignee |
| Acknowledgement escalation | Level 1 (`ack_escalate_hours`): approving Admin (or creator). Level 2 (`ack_escalate_owner_hours`): Owner |
| Overdue escalation (`overdue_escalate_hours` past due, nothing submitted) | Approving Admin (or creator) + Owner |
| Task changed (deadline, scope, priority, assignee, reminders) | Affected assignees |
| Reminder: before due / due / overdue | Assignees. Overdue also goes to the approving Admin (or creator) |
| Task submitted (Done) | The approving Admin, or the Owner if there's no Admin step |
| Admin approved | Owner |
| Changes requested | Assignees |
| Task completed / cancelled / reopened | Assignees (+ creator) |
| Comment added | Other participants on the task (assignees, approving Admin, creator) |
| Task request created | Owner + the client's Admin (or all Admins if there's no client) |
| Attendance submitted | **Nobody.** The Owner's Today counts are the live digest, so no notification per person |
| Absent proposed (23:59 job) | Owner: **one** notification listing everyone proposed absent |
| Attendance decided / corrected (by the Owner or automatically when a later leave approval wins) | That member |
| Leave requested / changed | Owner |
| Leave decided | That member |
| Forgot to log out | That member |
| Item done (Admin tick) | **Nobody.** It shows in the Owner's pending-approval count |
| Item rejected | The client's Admin |
| Cycle generated / unfinished items to decide | Client's Admin / Owner |
| Submitted link is private or unreachable | The submitter (with instructions), and the approving Admin on the task card |
| Google Drive needs reconnecting, or is low on space | Owner only |
| Anything financial | Owner only |
| Upcoming event (shoot, meeting…) on task reminders | Assignees + approving Admin |

Every notification is stored in `notifications` (in-app history + deep link) and then delivered by push. **Email** is sent for **invites, escalations, task assigned, an event tomorrow, the Owner digest**, and to anyone with no working push subscription, within the per-person daily cap (invites and escalations bypass it).

## 9a. Delivery, sessions and reachability

```
notification created
   ├─ in-app (Realtime)                       always
   ├─ push → every active subscription of the recipient
   │     ├─ member has a live session → full payload (title + body + deep link)
   │     └─ member logged out         → TITLE ONLY ("MaxOff: new task assigned"), link opens login → target
   └─ email  when the kind is in the email set, or no subscription is healthy
```

**Subscription lifecycle**
| Event | What happens to the subscription |
|---|---|
| Permission granted / re-granted | Created or re-activated, with `platform`, `is_standalone`, `label` |
| Logout (normal) | **Kept.** Push continues, title-only |
| "Sign out of this device" | Deleted (`disabled_reason = 'signed_out'`) |
| Member deactivated | All of theirs deleted (`'deactivated'`) |
| Push returns 404/410 | Disabled (`'gone'`), and the member sees the banner on next visit |
| Repeated failures (≥ 5) | Disabled (`'expired'`), counted as unreachable |

**Reachability** (`member_reachability` view, refreshed on delivery results and on login):
`ok` · `no_subscription` (never allowed) · `permission_revoked` · `ios_not_installed` (iOS with no standalone subscription) · `failing`.
Shown in Settings → Notifications to the Owner for everyone, and to an Admin for people on their tasks. Anyone `no_subscription`, `permission_revoked`, `ios_not_installed` or `failing` for **48 h** raises one notification to the Owner, at most weekly per person.

**Test notification:** `notification_send_test()` sends a push to the caller's own subscriptions, records `last_test_at`, and the UI reports whether it was accepted by the push service. It's part of onboarding and is available in Settings → Notifications for everyone. Emails per person per day are capped by `org_settings.email_daily_cap_per_member` (default 20); **invites and escalations bypass the cap**.
