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
      pending_review ──CEO approve──► approved (final_status = submitted status)
          │
          └──CEO correct(status, reason)──► corrected (final_status = CEO's status)

23:59 IST job, working day, no attendance_day ─► pending_review, submitted = none, final_status = absent (proposed)
      └─ CEO approve ─► approved(absent) · CEO correct ─► corrected(any status)
```
- A **working day** is not a weekly off day and not in `holidays`. On a day off: no gate, no absent check. If someone logs in on a day off, the gate still asks, and `is_day_off = true` shows as "Worked on a day off".
- `attendance_day` is **unique per member per IST date**. Later logins only add `session_events`.
- **Logout:** `logout()` writes `session_events(kind = logout)` immediately and updates `attendance_days.last_logout_at`.
- **20:30 IST job** (configurable): anyone with a login today and no logout since their last login gets the forgot-to-logout reminder.
- **Nightly (after 23:59):** days with a login and no logout get `logout_not_recorded = true`. No time is made up.
- **Overtime:** the member can flag overtime with a reason on any day, which sets `overtime_flag` and `overtime_reason`. Notice only, no approval.
- **Corrections** after a decision: the CEO can correct again at any time. Each correction is another `attendance_events` row, and nothing is overwritten without history.
- **Bulk approve** = the same function called for each row, so each row gets its own audit entry.

## 2. Leave requests

```
submitted ──CEO approve──► approved ──employee requests change/cancel──► (new request, supersedes_id = old)
    │                        │                                                 │ CEO approves new
    │                        │                                                 └─► old: superseded, new: approved
    │                        └──CEO edit/cancel directly──► superseded by CEO-created request / cancelled
    ├──CEO reject(reason)──► rejected
    └──employee withdraw (before decision)──► withdrawn
```
- Types: `leave`, `half_day`, `comp_leave`. Dates: `start_date` to `end_date` (half day: a single date).
- A leave request created at login is linked to that day's `attendance_day`. The CEO's attendance decision and the leave decision are made **together in one action**.
- Approved leave feeds calendar blocks, availability and assignment warnings.

## 3. Staff tasks

### 3.1 Task state
```
                    ┌──────────────── reopen (CEO/Admin) ────────────────┐
                    ▼                                                     │
 created ─► todo ─► in_progress ─► submitted ─► admin_approved ─► completed
              ▲          ▲            │  │            │
              │          │            │  └─(no admin step)────► awaiting CEO (= admin_approved state, admin_step = none|skipped)
              │          └─ changes_requested ◄── Admin reject(reason) / CEO reject(reason)
              │
 any non-final state ──cancel(reason)──► cancelled
```
| State | Meaning | Who moves it forward |
|---|---|---|
| `todo` | Assigned, not started | Any assignee → `in_progress` (optional) |
| `in_progress` | Being worked on | **Primary owner** → `submitted` (Done) |
| `submitted` | Done, waiting for the Admin | Approving Admin → `admin_approved` or `changes_requested` |
| `admin_approved` | Waiting for the CEO (Admin approved, or no Admin step) | CEO → `completed` or `changes_requested` |
| `changes_requested` | Sent back with a reason | Primary owner → `submitted` again |
| `completed` | **Final.** CEO approved | CEO/Admin can `reopen` → `in_progress` (reason required) |
| `cancelled` | Stopped with a reason, still reportable | CEO/Admin can `reopen` |

- **Done skips the Admin step** (goes straight to `admin_approved`, with `admin_step` = `none`) when `approving_admin_id` is null (the CEO assigned directly). It also skips it (`admin_step` = `skipped`, reason recorded) when the approving Admin is an assignee.
- **Locking:** from `admin_approved` onwards, assignees can only read and comment.
- **Overdue** is **derived**: `now() > due_at AND state NOT IN (completed, cancelled)`. It's a badge and a filter, not a state. Moving the deadline recalculates it.
- **Late reason:** when submitting after `due_at`, `late_reason` is required from the primary owner.
- **Approving Admin** is set when the task is created (PRODUCT §4.6 table) and can be changed or removed by the CEO. Changing it while the task is `submitted` sends the review to the new approver.

### 3.2 Acknowledgement (per assignee)
```
assigned (acknowledged_at null) ──"Task Noted"──► acknowledged (timestamp)
   │ every ack_repeat_hours: reminder to the assignee
   └ after ack_escalate_hours: escalation to the approving Admin (or creator), then the CEO
```
- Adding an assignee later starts their own acknowledgement. Removing one keeps their row with `removed_at` set.
- Changing the deadline, scope or primary owner **after acknowledgement** notifies the affected people. Acknowledgement is kept (it recorded that they received the task), and the change shows in the task history.

### 3.3 Reviews and submissions
- Every approve or reject is a `task_reviews` row (step, decision, reason, reviewer, the submission version it refers to).
- File submissions are versioned per task (`task_submissions.version` 1, 2, …). Files are never replaced.

### 3.4 Task requests
`pending ─convert─► converted (task_id set) | ─decline(reason)─► declined | ─withdraw─► withdrawn`

## 4. Clients
```
draft ──CEO activate (needs name + admin)──► active ⇄ paused ──► inactive ──CEO reactivate──► active
```
- **Paused:** readable. No new cycles.
- **Inactive:** readable and searchable. No new projects, items or client-labelled tasks.
- Changing the Admin closes the current `client_admin_assignments` row and opens a new one. Access moves immediately.

## 5. Client work

### 5.1 Project status (manual)
`open ─► in_progress ─► completed` · `any ─► cancelled` · CEO can `reopen` a completed or cancelled project. Completion and cancellation are **CEO only** and never automatic.

### 5.2 Cycles
- Every project has cycles. A **one-time** project gets one cycle (no period) when it's created. **Recurring** projects get one cycle per period.
- **00:00 IST job:** on the **1st** (monthly projects) and **Monday** (weekly projects), for projects whose client is **active** and whose status is open or in_progress, `cycle_generate(project, period)` copies `project_item_blueprints` into new items. It's **idempotent**: unique `(project_id, period_start)`.
- A cycle is `open` until the next cycle exists **and** every unfinished item in it has a CEO carry decision. Then it's `settled`.

### 5.3 Items
```
open ──Admin tick done──► done ──CEO approve──► approved (final, revenue achieved)
  ▲                         │
  └────CEO reject(reason)───┘
open/done ──cancel(reason, Admin or CEO)──► cancelled
```
- **Stage ticks** (`project_item_stages`) are independent of item state. Ticking all stages doesn't mark the item done.
- **Carry decision** (CEO, for items not `approved` when their cycle's period has ended):
  - `carry_forward` → a **new item** in the next cycle with `carried_from_item_id` and `origin_cycle_id` = the original. The original item becomes `carried` (a final state). The new item keeps the original's value and category.
  - `close` → `cancelled` with a reason.
  - `leave_pending` → stays in its original cycle, still workable. Can be decided again later.
- **Bulk approve** = the same function called for each item, so each gets its own approval record.

## 6. Revenue calculation (CEO only)
For each item, `item_value`:
1. an explicit `item_billing.value` if set, otherwise
2. for a recurring project, `cycle_amount ÷ number of planned items in the cycle`, where planned items = non-carried-in items, not cancelled at creation; carry-ins are valued from their **origin** cycle; otherwise
3. for a one-time project, `fixed_amount ÷ number of planned items`.

- **Potential** (cycle / project / client / category / month) = Σ item_value of planned items.
- **Achieved** = Σ item_value of items with `state = approved`, attributed to the **origin** cycle's period.
- **Remaining** = Potential − Achieved.
- **Overrides:** `revenue_overrides` for a cycle or one-time project store `calculated_value` (frozen when overriding), `adjusted_value`, note, CEO and time. Reports show *System calculated* and *CEO adjusted* side by side.
- This is implemented as security-invoker SQL views over CEO-only tables. Non-CEO roles can't select from them.

## 7. Month close and snapshots
```
month M (IST) open ──CEO close──► closed (snapshot v1, immutable)
                                     └──CEO correct(note)──► snapshot v2 (links v1; v1 kept)
```
- A snapshot is a JSON document holding every figure in the monthly report plus the raw rows the AI export needs (attendance, tasks, items, revenue lines, metrics).
- Closing doesn't lock operational data. It freezes the **report**. Reports for closed months read the latest snapshot version.

## 8. Scheduled jobs (pg_cron, all idempotent, times in IST)
| Job | When | What it does |
|---|---|---|
| `reminders_tick` | every 5 min | Sends due reminders (before due, due, overdue, acknowledgement repeats) and escalations. Records `sent_at` so nothing is sent twice |
| `logout_reminder` | 20:30 (setting) | Reminds anyone still logged in |
| `absent_check` | 23:59 | Creates proposed-absent days for working days, notifies the CEO |
| `logout_not_recorded` | 23:59 (after absent_check) | Flags days with no logout |
| `eod_report` | 23:59 (after the above) | Builds the CEO end-of-day report and notifies the CEO |
| `cycle_generate` | 00:00 on the 1st and every Monday | Creates recurring cycles |
| `cycle_close_prompt` | 00:05 on the same days | Notifies the CEO about unfinished items in the ended cycles |
| `push_dispatch` | every minute (or triggered) | Sends queued push and email deliveries, retrying with backoff |
| `nightly_backup` | 02:00 (GitHub Action) | pg_dump to R2 |

## 9. Who gets notified
| Event | Recipients |
|---|---|
| Task assigned / assignee added | Each new assignee |
| Acknowledgement missing (repeat) | That assignee |
| Acknowledgement escalation | Approving Admin (or creator), then the CEO |
| Task changed (deadline, scope, priority, assignee, reminders) | Affected assignees |
| Reminder: before due / due / overdue | Assignees. Overdue also goes to the approving Admin (or creator) |
| Task submitted (Done) | The approving Admin, or the CEO if there's no Admin step |
| Admin approved | CEO |
| Changes requested | Assignees |
| Task completed / cancelled / reopened | Assignees (+ creator) |
| Comment added | Other participants on the task (assignees, approving Admin, creator) |
| Task request created | CEO + the client's Admin (or all Admins if there's no client) |
| Attendance submitted / absent proposed | CEO (as a digest, not one per person) |
| Attendance decided / corrected | That member |
| Leave requested / changed | CEO |
| Leave decided | That member |
| Forgot to log out | That member |
| Item done (Admin tick) | CEO (digest) |
| Item rejected | The client's Admin |
| Cycle generated / unfinished items to decide | Client's Admin / CEO |
| Anything financial | CEO only |
| Upcoming event (shoot, meeting…) on task reminders | Assignees + approving Admin |

Every notification is stored in `notifications` (in-app history + deep link) and then delivered by push. **Email** is used when a recipient has no working push subscription, and always for escalations.
