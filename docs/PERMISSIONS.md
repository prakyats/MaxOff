# MaxOff: Roles, Permissions and Visibility

> This is the source of truth for **who can see and do what**. It's enforced in Postgres (RLS + transition functions) and checked again in server actions. The UI only hides controls.
> Roles are fixed: `owner`, `admin`, `staff`. Permission keys are stored as data (`role_permissions`) and seeded by migration, so custom roles can be added later without code changes (not in the prototype).

## 1. Permission keys and default grants

| Key | What it allows | Owner | Admin | Staff |
|---|---|:-:|:-:|:-:|
| `team.manage` | Invite, change role or job title, deactivate, edit names; **add a freelancer and set or change their coordinator** (ADR-0013) | ✅ | | |
| `team.view` | See the member list (names, job titles, roles) and open a person's **Profile** tab on `/people/[id]` (kickoff 3; the Attendance tab stays `attendance.view_all`) | ✅ | ✅ | |
| `availability.view` | See anyone's availability: task counts, busy blocks, approved leave, today's presence | ✅ | ✅ | |
| `settings.manage` | Company settings, days off, holidays, thresholds | ✅ | | |
| `drive.manage` | Connect or reconnect the company Google account, set the archive root, retry failed archives | ✅ | | |
| `drive.view_status` | See archive status on a submission ("Archived ✓", "Link is private") | ✅ | ✅ | ✅ (own tasks) |
| `notifications.reachability` | See who isn't reachable by push and why | ✅ (everyone) | ✅ (people on their tasks) | own devices only |
| `lists.manage` | Task types, stage presets, job titles, other lists, custom field definitions ² | ✅ | ✅ ¹ | |
| `templates.manage` | Project and task templates | ✅ | ✅ | |
| `clients.manage` | Create clients, assign the Admin, activate / pause / close | ✅ | | |
| `clients.edit_assigned` | Edit details, contacts, brand and custom fields of **their** clients | ✅ | ✅ | |
| `clients.private_notes` | Owner-only client notes | ✅ | | |
| `projects.manage` | Create and edit projects and items on **their** clients, start cycles manually | ✅ | ✅ | |
| `items.tick` | Tick stages and mark items done (operational) | ✅ | ✅ | |
| `items.approve` | Final approval or rejection of items | ✅ | | |
| `cycles.carry_decide` | Carry forward / close / leave pending | ✅ | | |
| `projects.complete` | Complete, cancel or reopen projects | ✅ | | |
| `tasks.create` | Create, assign, edit, reassign and cancel tasks within their scope | ✅ | ✅ | |
| `tasks.approve_admin` | The Admin approval step (only as the task's approving Admin) | | ✅ | |
| `tasks.approve_final` | The final approval step | ✅ | | |
| `tasks.work` | Acknowledge, comment, tick stages, upload, mark done (as an assignee, **or as the current coordinator of a freelancer assignee, on that freelancer's tasks only**, ADR-0013) | ✅ | ✅ | ✅ |
| `task_requests.create` | Suggest a task | | ✅ | ✅ |
| `task_requests.decide` | Convert or decline a task request | ✅ | ✅ | |
| `attendance.self` | Start and end own day, choose own leave for today, request own leave (2.x: submit own attendance and logout) | | ✅ | ✅ |
| `attendance.decide` | Approve or correct attendance, decide leave, edit approved leave; decide extra work notes, grant and revoke comp leave (3b.2) | ✅ | | |
| `attendance.view_all` | Full attendance and leave history of everyone | ✅ | | |
| `expenses.decide` | Read everyone's expense claims and their receipts, approve, reject, mark paid; edit the expense categories; the month summary's expense line (the receipt amount is an org setting: `settings.manage`, also the Owner's) (3b.3, ADR-0007 amendment 2026-09-27). **Own claims need no key beyond `attendance.self`** | ✅ | | |
| `finance.view` / `finance.edit` | Amounts, overrides, billing status, revenue (the billing **category** is set by the Owner but visible to Admins, see §2) | ✅ | | |
| `reports.all` | Company reports, metrics, AI export | ✅ | | |
| `reports.scoped` | Operational **work** reports on their own scope (PRODUCT §4.13): delivery, cycle progress, rework, their own approval turnaround, overdue, acknowledgement lag, workload per person from visible tasks. Never money, attendance, leave, snapshots or the AI export | | ✅ | |
| `months.close` | Close a month, make corrections | ✅ | | |
| `activity.view_all` | The full activity log | ✅ | | |
| `records.hard_delete` | Permanent deletion (exceptional) | ✅ | | |

¹ Admins can edit lists and field definitions except company-level settings, and except **custom field definitions on `project` and `item`**, which are Owner-only (this closes the "amount in a number field" loophole, since there's no currency type). *Adjustable: it's just a row in `role_permissions`.*

² **Custom field definitions (owner decision 2026-09-27, kickoff 3):** global `client` and `contact` fields are **Owner-only**; an Admin may add or archive a field **scoped to one of their assigned clients** only; `project` and `item` fields stay Owner-only (¹); `task` fields arrive with 4.1.

³ **Task types and templates (owner decision 2026-09-28, kickoff 4):** **task types are the Owner's**. Like the expense categories, a guard refuses an insert, update, move or archive of a `task_types` row without `settings.manage`, although Admins hold `lists.manage`. Admins only pick from them. `task` custom fields stay `lists.manage` (DATA-MODEL §2). **Task templates** (`templates.manage`) are shared by the whole company: an Admin edits and archives only the templates they created (`created_by`), and the Owner edits any.

**The Owner doesn't mark attendance.** The Start-day prompt, Start day and End day (3b.1; the first-login gate before it) apply to Admins and Staff only.

**Screens (2.4):** `/approvals` opens for `attendance.decide`, `tasks.approve_final` or `tasks.approve_admin`; each group shows only when the viewer holds its key (Attendance and Leave: `attendance.decide`), so an Admin never sees them. The Approvals badge counts what the viewer may decide. `/people/[id]/leave` and `/people/[id]/attendance` (a person's leave and attendance history, with correct, edit and cancel) and the Owner's today card and people board need `attendance.view_all`.

**Screens (3b):** `/leave/extra-work` (a member's extra work notes and comp leave credits, `attendance.self`), Add note from the Extra work tab, the attendance history's last 7 days, the strip on a day off and the End-day confirmation (`attendance.self`); Approvals → **Extra work** (decide a note), **Grant comp leave** and **Revoke** on `/people/[id]/leave` (`attendance.decide`); the comp leave balance and credits of a person are `attendance.view_all` (own: `attendance.self`). The Start-day prompt, the strip's Start day / End day and "Sign out of this device" on /me are 3b.1 (WORKFLOWS §1 "Settled in 3b.1").

**Screens (3b.3, 3b.4):** `/leave/expenses` (a member's own claims, Add expense, Withdraw) and End day's "Any expenses to claim today?" are `attendance.self`; Approvals → **Expenses**, Settings → **Expenses** (the categories; its receipt amount saves under `settings.manage`) and Mark paid are `expenses.decide`; the month summary (`/people/[id]/month`, **More → Reports → Month** at `/reports/month`) is `attendance.view_all`, its expense line `expenses.decide`. The Reports list itself stays `reports.all` / `reports.scoped` (an Admin still gets the placeholder). A receipt is served by `/api/files/<id>` to its uploader and `expenses.decide` only.

**Screens (3.4):** `/people/[id]` is every member's **Profile** for `team.view` (the Owner and Admins; the Owner's own id redirects to /me); its Edit and ⋯ actions are `team.manage`; the Leave and Attendance tabs show only with `attendance.view_all`, for someone who has joined and is not the Owner, and their routes answer 404 otherwise. `/clients` and a client's pages open for `clients.manage` or `clients.edit_assigned` (Staff are sent to /forbidden; another Admin's client is a 404, RLS decides); New client, the Admin assignment and the lifecycle are `clients.manage`; details, contacts, brand and the logo are `clients.edit_assigned`; the Owner's notes are read only for `clients.private_notes`, so they are never in an Admin's payload. The Activity view reads `activity_log` under RLS (an Admin never gets `client_private` entries); **the close reason is the Owner's**: the Activity view shows it to `clients.manage` only (owner decision 2026-09-27; since the phase 3 review the database enforces it: the reason lives in the Owner-only `client_close_reasons`, and the `closed` entry an Admin reads carries only `from_state`). The Owner's own details are edited on /me only.

**Screens (4B):** **New task** on Tasks is `tasks.create` (the Owner and Admins); the task page `/tasks/[id]` opens for `tasks.work`, and RLS decides the rest: a task the viewer may not see (a Staff member who is not on it, an Admin outside it) is the not-found screen. On the page, "Task Noted", Start, the stage ticks and comments are `tasks.work` as an assignee or as a freelancer assignee's current coordinator; Mark done the primary owner's (or their coordinator's); Approve / Request changes the step's reviewer (`tasks.approve_admin` as the approving Admin, `tasks.approve_final`); Edit, Cancel, Reopen and the stages' add / remove the task's creator, approving Admin or the Owner (`tasks.create`); Change approver and "Decide it yourself" the Owner's. The dialog's warning check reads `member_availability()` (`availability.view`). Settings → Custom fields → **Tasks** (company-wide task fields) is `lists.manage` (the Owner and Admins); the workload warning on Settings → Thresholds is `settings.manage`.

## 2. Visibility rules (RLS)

| Data | Owner | Admin | Staff |
|---|---|---|---|
| Members | All | Everyone's name, job title, role, status and **phone** (a work contact), through the `member_directory` view. **Email is Owner-only**: it's the login identity | Own profile. Names, job titles and roles of **everyone who was on or acted on a task they can see** (Kickoff 4 decision 21, 4C): its creator, current and past approvers, current and removed assignees, reviewers, whoever commented, ticked, handed in or changed it, and the current coordinator of a freelancer assignee (through `member_directory`; **no phone**), plus their own freelancers with phone when they coordinate one (ADR-0013). Who coordinates a freelancer they may name comes from `freelancer_coordinators` (current rows, never the reason) |
| Attendance / leave | All | **Own**. Others only through `availability` (present or on leave today, approved leave dates) | Own |
| Clients (full record) | All | **Assigned clients only**, and only while they hold `clients.edit_assigned` (phase 3 review: a role change never leaves access behind) | ❌ Never |
| Client label (name, logo, colours, fonts, tone, brand notes) | All | Assigned clients + labels on visible tasks | Only for clients on their **own** tasks (through `client_labels` view) |
| Owner-only client notes | ✅ | ❌ | ❌ |
| Projects / cycles / items | All | Projects of assigned clients | ❌ Never |
| Staff tasks | All | Tasks they **created**, **approve**, are **assigned to**, or labelled with **their clients** | Tasks they're **assigned to** |
| Task comments / files / submissions | All | Same as the task | Same as the task |
| Task requests | All | Their own + requests labelled with their clients + requests with no client | Their own |
| Availability of others | Full detail | **Counts and busy blocks only** (`member_availability()` function) | ❌ |
| Money (any amount, override, billing status, revenue) | ✅ | ❌ (not even in exports) | ❌ |
| Expense claims (3b.3) | All (`expenses.decide`) | **Own only**: never anyone else's, not even their team's | Own only |
| Month summary (3b.4) | All | ❌ | ❌ |
| A project's billing **category** (Retainer / Project / Additional Work) | ✅ set and see | See only (it's operational context, not an amount) | ❌ |
| Reports / snapshots | All | Scoped operational reports, **computed live**. `eod_reports` and `month_snapshots` hold revenue and are Owner-only tables | ❌ |
| Activity log | All | Entries about records they can see | Entries about their own tasks, attendance and leave |
| Notifications | Own | Own | Own |

**Names on a task (Kickoff 4 decision 21, owner 2026-09-29, built in 4C):** ADR-0013 says every screen that names "who" shows both, so a Staff member reads the **names** of everyone on or acting on a task they can see (the Members row above), never a stranger's, and never a phone (the phone stays `team.view`'s, the person's own and a freelancer's current coordinator's). `app.directory_visible_ids()` computes the set once per read; `member_directory` keeps its columns.

**Task warnings (4A review, 2026-09-29):** a `task_warnings` row and its `warning_overridden` activity entry name another person's leave or workload, so they are read only with `availability.view` (the Owner and Admins) on a task the reader can see; a Staff co-assignee or coordinator never reads them, although they see the task.

**A person's own member row in the activity log:** every role reads the entries about their own `members` row (edits, the invite, a reactivation) **except the deactivation entry**: the Owner's reason is a management note and is never shown to the person, even after reactivation (phase 1 review, 2026-09-23).

**Scope changes are live:** if the Owner reassigns a client to another Admin, the old Admin loses access immediately and the new Admin gains it.

## 3. Rules enforced by transition functions (not just RLS)
- **Clients and custom fields (kickoff 3, 2026-09-27):** a client's name is unique (case-insensitive) among clients not Inactive; exactly one primary contact once any contact exists; a field definition's `type` is immutable once any record holds a value for it; a per-client definition is written only by the Owner or that client's current Admin; a required custom field is checked only by the form that saves it, never by a lifecycle or task transition; `/api/files/<id>` serves a preview only after the same permission check the record needs (a client logo to whoever may see the client or its label; an avatar to `team.view` and the person).
- **Freelancers (ADR-0013, built in 4A):** only the Owner (`team.manage`) adds a freelancer (`member_add_freelancer()`) or sets their coordinator (`member_set_coordinator()`, an active **permanent** Admin or Staff, never the freelancer themselves). **Acting on behalf** is allowed only to the freelancer's **current** coordinator (`app.coordinator_of()` at the moment of the action), only within `tasks.work` on tasks the freelancer is assigned to, and always recorded as actor = coordinator, `on_behalf_of` = freelancer; a former coordinator, any other member and the Owner-as-coordinator shortcut are refused. A freelancer is never a task creator, approving Admin or reviewer, and their id is never an actor (`app.task_actor()` refuses a `freelance` caller). **Attendance, leave, the day gate and the attendance jobs act on `permanent` members only:** `app.attendance_require_self()` refuses a freelance caller (`FORBIDDEN`), so `attendance_start_day()`, `attendance_submit()`, `leave_submit()`, `leave_submit_comp()`, `extra_work_note_submit()`, `expense_claim_submit()` and the rest do; `comp_leave_grant()` refuses a freelance member; `absent_check()`, `end_day_reminder_due()`, `attendance_today_detail()` and `month_summary()` select permanent members. **Only the Owner** (`team.manage`) turns a freelancer into an employee (`member_invite_employee()`), and a deactivated freelancer is reactivated only after a coordinator is set again (`member_set_coordinator()` then `member_reactivate()`), and only while that coordinator is still an active permanent Admin or Staff (4A review: a coordinator's deactivation also closes the rows of deactivated freelancers still pointing at them). A Staff coordinator's visibility grows by exactly the freelancer's tasks (a client label at most, ADR-0005), never by a client record. **A coordinator-change reason (owner decision 2026-09-29, after the 4A review) is readable by the Owner and Admins only (`team.view`), like a deactivation reason:** `member_coordinators` and its activity entries are `team.view`'s; a coordinator, current or former, sees which freelancers they coordinate through the `coordinated_freelancers` view (their own rows, current and past, without the reason) and never reads the reason.
- Only the task's **approving Admin** can do the Admin approval step, and never on a task they're assigned to (#3). The Owner does not decide at that step (`task_review` refuses; `task_set_approver` changes or removes the approver instead).
- Only the **primary owner** can mark a task Done. From `submitted` onwards, assignees can't edit (they can still comment).
- **Settled at kickoff 4 (owner decision 2026-09-28):**
  - **The Owner is never a task assignee.** Also refused in `task_update_assignment`.
  - **The Owner is never a coordinator** (`member_set_coordinator()`). One coordinator may have many freelancers.
  - **An Admin creator may set a client label only for their own assigned clients** (`task_create`, and any label change by an Admin), so the task always routes to that Admin. The Owner may set any label. The rule is checked only when an Admin sets or changes the label: the approving Admin of an Owner task labelled with another Admin's client still edits its other fields (4A review).
  - **A client label is an Active or Paused client** (Kickoff 4 decision 22, owner 2026-09-29, built in 4C): `task_create` and `task_update_assignment` refuse a **Draft** client (a draft may have no Admin, and a labelled task routes to the client's Admin) and an **Inactive** one (WORKFLOWS §4) when the label is set or changed, the Owner's too; a task labelled before keeps its label and stays editable.
  - When the Owner assigns through an Admin, **any active Admin** may be chosen as the approving Admin.
  - **Bulk review approves only**; a rejection is always one task with a reason.
  - **A freelancer becomes an employee** only through the Owner (`team.manage`): the invite attaches to the same member id and closes the coordinator row (WORKFLOWS §1b). No tasks-only login exists in phase 4.
  - **Freelancer payments**, when they come, are Owner-only money in `modules/revenue` tables, never on `members` or `tasks` (ADR-0007, ADR-0013).
- A task may be **edited, reassigned, cancelled or reopened** only by its **creator**, its **approving Admin** or the **Owner**. Other Admins who can see it can't change it.
- Only the Owner can move money fields, approve items, approve tasks finally, decide attendance and leave, and close months.
- Only the Owner can change `projects.billing_category`, `projects.client_id` and `projects.recurrence` (guard trigger, like state columns). An Admin-created project takes its billing category from its recurrence; a template's default category applies only when the Owner creates the project.
- Custom field definitions for `project` and `item` are Owner-only (footnote ¹).
- The single-Owner rule is enforced by a unique partial index on `members(role) where role = 'owner'`.
- A member edits their **own** name, phone and avatar (plain edit, audited). Role, job title and status are `team.manage` only. **Email is never self-edited**: it's the login identity, and changing it goes through the Owner (`member_change_email()`, 1.4, WORKFLOWS §1a — active, invited or the Owner's own row, and never onto an address another member already has). `members.status` and its timestamps change only through transition functions (`app.protect_columns()` guard).
