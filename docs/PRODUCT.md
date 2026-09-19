# MaxOff: Product Spec (v2)

> **What** MaxOff does and **why**. How it's built: `ARCHITECTURE.md`. Tables: `DATA-MODEL.md`.
> States and transitions: `WORKFLOWS.md`. Who can do what: `PERMISSIONS.md`.
> Sources: `research/v2-product-context.md` + `research/v2-clarifications.md`. **Where they differ, this file wins.**
> Owner: Pixora Clips · Last updated: 20 Sep 2026

---

## 1. What MaxOff is

MaxOff is the **internal operations and control system for Pixora Clips**. It's the single reliable source of truth for how Pixora's people, client work, approvals and revenue are moving every day.

It answers these questions every day:

| Role | Questions |
|---|---|
| **CEO** | Who's working today? What are they doing? What's late? What needs my approval? How is client work progressing? What revenue is possible, and what has actually been approved? Where is the team slowing down? |
| **Admin** | Which clients am I responsible for? What client work is pending? Which staff tasks need attention or approval? What's overdue? What should happen next? |
| **Staff** | What do I need to do today? What's due soon or overdue? Have I acknowledged my tasks? What feedback do I need to address? What shoots or meetings are coming up? |

- **Internal only.** Invite-only, with no public sign-up. **Clients never log in.**
- **Timezone:** everything runs on **Asia/Kolkata (IST)**.
- **Devices:** desktop-first web app. It must work well on phones for Staff, and be installable as a PWA.
- **SaaS later is possible but isn't the goal.** Only cheap seams are kept (see ARCHITECTURE §1).

## 2. Product principles
1. **Operational visibility over feature count.** Every screen shows what needs to happen next.
2. **The CEO has final authority.** Attendance, leave, money and final completion all go through the CEO.
3. **Admins run operations, not governance.** They have no authority over attendance or leave, and never see money.
4. **Staff focus on execution.** They see only their own work.
5. **Complexity depends on role.** The CEO interface is rich, the Admin interface is simpler, and the Staff interface is very simple. This is intentional.
6. **Customization is data.** Task types, job titles, stage presets, holidays, custom fields and templates are edited in Settings.
7. **Don't overbuild.** No dependency engines, HR policy engines, timesheets or invoicing.
8. **Never destroy history.** Changes are recorded, corrections sit alongside the original, and records are archived rather than deleted.
9. **Operational progress isn't revenue.** Revenue counts only after the CEO approves the work.
10. **Collect facts, don't judge.** MaxOff stores raw operational data for the CEO or an AI tool to analyse. It never rates employees.

---

## 3. Roles

There are exactly three system roles. **Job titles** (e.g. Video Editor) are separate, editable data, and have nothing to do with permissions.

| Role | Count | Summary |
|---|---|---|
| **CEO** | Exactly 1 | Full access to everything, including money, attendance, leave, final approvals, month closing and permanent deletion. |
| **Admin** | Any number | Runs their assigned clients and the staff work they create or approve. Also an employee: marks attendance, takes leave, and can be assigned tasks. |
| **Staff** | Any number | Does the tasks allotted to them. Marks attendance and takes leave. |

The full permission and visibility matrix is in `PERMISSIONS.md`. The key rules:
- **Each client has exactly one Admin**, assigned by the CEO. There's no fixed Staff-to-Admin hierarchy.
- **An Admin sees only their own**: assigned clients, plus tasks they created, approve or are assigned to. For everyone else they see **availability only** (task count, busy calendar blocks, approved leave), which is enough for workload and conflict warnings.
- **Staff see only tasks allotted to them.** A task can carry a **client label** (the client's name and brand basics), and that's all Staff ever see of a client.
- **Money is CEO-only**, everywhere, including in exports.
- The CEO account is created by a secure bootstrap script (Supabase Auth). Passwords are never stored in app tables.

---

## 4. Modules

### 4.1 Authentication and sessions
- Email + password through Supabase Auth, with invites only and several devices allowed.
- **First login of each IST day:** the person must choose today's status before using the app (see §4.2). Later logins that day skip this.
- **Logout is manual.** The exact time is recorded immediately.
- A deactivated person loses access immediately, and their history is kept.

### 4.2 Attendance (for Admins and Staff)
- The first-login choice is **Present / Leave / Half-Day Leave / Compensatory Leave**. Choosing a leave type also creates a leave request for today.
- MaxOff records the first-login time, the choice, logout times, and the CEO's decision with its time and reason.
- **The CEO approves**, one at a time or in bulk. **When rejecting, the CEO sets the correct status** (Absent / Leave / Half-Day / Comp Leave / Present) and gives a reason, and the employee is notified. The original choice and the correction are both kept.
- **11:59 PM IST check:** an active employee with no submission on a **working day** is marked **"Absent – pending CEO approval"**, and the CEO is notified. Absence becomes official only once the CEO approves it.
- **Days off:** the CEO sets the company's **weekly off days** and a **holiday list** in Settings. There's no absent check on days off. A login on a day off records attendance marked **"Worked on a day off"**.
- **Forgotten logout:** around **8:30 PM IST** (configurable), anyone still logged in gets a reminder: *"You may have forgotten to log out. If you're done, log out; if you're working overtime, carry on."* If they never log out, the day is flagged **"Logout not recorded"**. A logout time is **never** made up.
- **Overtime:** a simple flag with an optional reason. No time tracking.
- No working-hours rules and no location rules.

### 4.3 Leave (for Admins and Staff)
- Types: **Leave, Half-Day Leave, Compensatory Leave**, for today or any future date or date range, with a free-text reason. There's no advance-notice rule and no leave-balance or policy engine.
- **The CEO approves or rejects** every request, including changes and cancellations.
- An employee can **request a change or cancellation**. This creates a new request linked to the original. Nothing is overwritten.
- Only the CEO can change an approved leave directly.
- Approved leave shows on the calendar and triggers warnings when someone on leave is assigned work.

### 4.4 Clients (CRM)
Each client has one central page, visible to the CEO and the client's Admin.

- **Details:** name, legal or business name, address, GSTIN, phone, email, website, requirements, notes, and **custom fields**. Only the name is required.
- **CEO-only notes** (a separate, CEO-only field).
- **Assigned Admin:** exactly one, set by the CEO. Changes are kept in history.
- **Contacts:** several per client, with one primary.
- **Google Drive link:** one link to the client's asset folder, opened in a new tab.
- **Light Brand Kit:** logo (uploaded), colour codes, font names, tone of voice, brand notes. The logo shows in client lists. Staff see these brand basics on client-labelled tasks.
- **Lifecycle:** Draft → Active → Paused → Inactive. A client becomes Active once it has a name and an Admin, and only the CEO activates, pauses or closes it.
  - **Paused:** everything stays visible, and **recurring projects stop creating new cycles**.
  - **Inactive:** stays searchable, and no new work can be added until the CEO reactivates it.
- **Page sections:** Overview · Brand · Projects · Staff tasks (labelled with this client) · Activity. Financial panels appear for the CEO only.

### 4.5 Client work: Projects → Items
**Client work is tracked separately from staff tasks.** The Admin maintains it. Staff never see it, and staff task completion **never** updates it automatically.

- **Projects belong to a client.** A project has a name, description, **recurrence** (one-time / weekly / monthly), optional **stages**, a **billing category** (set by the CEO), a status and custom fields. Projects have **no start or end dates**.
  - Internal company work can use an internal client record, e.g. "Pixora (internal)".
- **Items** are the individual pieces of work in a project, named by the Admin:
  - *Monthly Production*: "Reel 1 – Ambience", "Reel 2 – Menu", …
  - *Drone Documentation* (weekly): "Week 1", "Week 2", …
  - *Brand Film* (one-time, additional): a single item, "Make the video".
  Each item has a title, optional planned date, notes, stage ticks, custom fields and a state.
- **Stages (optional, set per project):** the Admin picks a stage preset (e.g. *Script → Shoot → Edit → Posted*) or none. Every item in the project gets those stages. Presets are edited in Settings.
- **Completion:** **the Admin ticks the item done**, which means complete operationally. **The CEO approves it**, one at a time or in bulk, which makes it final and revenue-eligible. The CEO can reject with a reason, which sends it back to the Admin. Reports always show both, e.g. **"9/12 done · 8/12 CEO-approved"**.
- **Cycles (recurring projects):**
  - At **12:00 AM IST on the 1st** (monthly) or **Monday** (weekly), MaxOff creates a new cycle for each recurring project of every **Active** client, copying the project's **item list**. The Admin then renames items with that period's themes.
  - A one-time project has a single cycle with no period.
  - The Admin or CEO can also start a cycle manually.
- **Unfinished items at the end of a cycle** are highlighted, and the **CEO decides** each one: **Carry forward** (moved into the next cycle as a carry-forward item that keeps its original period and value, so it doesn't inflate the new cycle's scope or planned revenue), **Close** (closed with a reason, never deleted) or **Leave pending**.
- **Project status:** Open → In progress → Completed / Cancelled. **Completion is a manual CEO decision.** Projects never close automatically, and the CEO can reopen them.
- **Project templates:** reusable setups with a recurrence, stage preset, item list, default billing category and custom fields. Everything generated stays editable.

### 4.6 Staff tasks
Daily work allotted to people. **Only the CEO and Admins create tasks.**

- **Fields:** title, description, **task type**, optional **client label**, priority (Low / Medium / High / Urgent), **deadline (exact date and time, IST)**, assignees with one **primary owner**, reminder schedule, optional stages or checklist, custom fields, comments and files.
- **Task types** (editable list): Normal, Shoot / Site Visit, Meeting, Posting, Review / Approval, Other, Custom.
  - Event-type tasks (Shoot, Site Visit, Meeting, Posting) also have an event date, an optional time, a location and a purpose, and appear on the calendar.
  - A type can have its own custom fields and default reminders.
- **Acknowledgement:** **every assignee** must tap **"Task Noted"**, which records who and when. Unacknowledged tasks get repeated reminders, then escalate to management after a configurable threshold. Management sees each assignee's acknowledgement status.
- **Doing the work:** assignees add timestamped comments and updates, tick stages, and upload files (optional, versioned, see §4.9). **The primary owner marks the task Done.** If a task misses its deadline, the primary owner must give a reason, and other assignees can add their own reasons in comments.
- **Approval chain:** depends on how the task was created.

  | How the task was created | Approval after Done |
  |---|---|
  | CEO assigned it directly | → **CEO** |
  | CEO assigned it through an Admin (the CEO picks the Admin) | → **that Admin** → **CEO** |
  | An Admin created it with a client label | → **the client's Admin** → **CEO** |
  | An Admin created it with no client label | → **the creating Admin** → **CEO** |
  | The approving Admin is also an assignee | Admin step **skipped** (recorded) → **CEO** |

  - The CEO can change or remove the approving Admin at any time.
  - A task is **finally complete only after CEO approval**. The CEO can approve one at a time or in bulk, and each task gets its own approval record.
  - **A rejection (by the Admin or CEO) needs a reason.** The task goes back to the assignees as *Changes requested*, and they fix it and resubmit.
  - Once the Admin approves, **assignees can't edit** the task. Only the CEO or Admin can reopen it.
- **Overdue:** a task is overdue **the moment its deadline passes** without final CEO approval. It's shown as a badge, while the task's status stays what it was.
- **Changes after acknowledgement:** the CEO or Admin can change assignees, deadline, scope, priority and reminders. Each change records who, when, the old value and the new value, and affected people are notified.
- **Cancel:** the CEO or Admin can cancel with a reason. Reminders stop, and the task stays in history and reports.
- **Warnings (never blocking):** when assigning, MaxOff warns about **overlapping timed work**, **heavy same-day workload** and **approved leave** on that date. If the person proceeds anyway, the override is recorded.
- **Task requests:** Staff can **suggest** a task (title, details, optional client). The CEO or Admin turns it into a real task or declines it with a reason.
- **Task templates:** type, default stages, reminders, priority and field defaults. They **never** fix the client, assignee or deadline.
- **Duration without time tracking:** MaxOff keeps these timestamps: *assigned*, *each acknowledgement*, *Done*, *Admin approved*, *CEO approved*. Rough durations are worked out from them.

### 4.7 Dashboards and daily reports
- **CEO: Today** (actions first):
  1. Today at a glance: present, on leave, pending attendance, pending leave, pending task approvals, pending item approvals, due today, overdue, upcoming events, client work progress.
  2. **Approvals inbox** with one-click Approve, Reject, Review, Reassign and Extend deadline, plus bulk actions. There's no need to open other modules.
  3. People (attendance, login and logout, logout not recorded, overtime) · Today's tasks · Overdue and risks · Calendar strip · Client progress · Revenue snapshot.
- **Admin:** My clients (cycle progress) → client work pending → staff tasks needing attention → approvals → calendar → issues.
- **Staff: My Day** (very simple): attendance status, **Pending acknowledgement**, Today, Upcoming, Overdue, **Changes requested**, Upcoming events, a request-a-task button and Logout. Nothing else.
- **CEO end-of-day report:** generated automatically each day (and viewable live). It covers attendance and leave decisions, tasks completed, pending and overdue (with reasons), Admin and CEO approvals, logout times, overtime flags, and tomorrow's events. It's an operations report, not payroll.

### 4.8 Calendar
- Day, week and month views of event tasks (shoots, site visits, meetings, postings and other timed tasks), approved leave, holidays and planned dates of client items.
- Filters: client, employee, task type, status.
- Helps spot conflicts and overloaded people. Admins see other people's work only as busy blocks.

### 4.9 Files and versioned submissions
- Uploading work to a task is **optional** and never required before Done.
- Files up to about **2 GB** go **straight from the browser to storage** (resumable, in parts), never through the app server. MaxOff stores the metadata.
- **Submissions are versioned** (v1, v2, …). Nothing is deleted when a new version arrives. Each version keeps its uploader, time, reviewer, comments and decision.
- The CEO and Admin can preview (images, video, PDF), download, comment, approve or request changes.
- Supported: images, video, audio, PDFs, office documents and common design files. No transcoding.
- Downloads use short-lived private links. SVGs are sanitized.

### 4.10 Notifications
- **Mandatory.** Users can't turn them off. They go only to the **relevant** people (see WORKFLOWS §9 for who receives what).
- **Channels:** in-app (real time, with history and deep links) + **browser push** (Web Push/VAPID, PWA). **Email** is the fallback when push isn't available, and for escalations.
- **Reminders:** configurable per task (default: 2 days before, 1 day before, due time, overdue). Unacknowledged tasks get **repeated** reminders at controlled intervals, then **escalation** to the approving Admin or creator and then the CEO. Never spammy.
- WhatsApp comes later.

### 4.11 Revenue (CEO only)
Only **client project items** carry revenue. Staff tasks never do.

- **Billing category** for each project: **Retainer / Project / Additional Work**. It defaults from recurrence (weekly or monthly → Retainer, one-time → Project) and only the CEO can change it.
- **Amounts:**
  - **Recurring project:** an amount **per cycle**, split **evenly** across the cycle's planned items unless the CEO gives **individual item values**.
  - **One-time project:** a **fixed amount**, split evenly across items unless individual values are given.
  - Carry-forward items keep their original value and period.
- **The rule:** an item's value counts as **Achieved** only when the **CEO approves** that item. A partly done or Admin-ticked item counts for nothing.
- **Potential** = the value of planned items. **Achieved** = the value of CEO-approved items. **Remaining** = Potential − Achieved. These are always reported separately from operational progress.
- **CEO overrides:** the CEO can override an achieved figure. The system-calculated value is kept, with the adjusted value, note, time and CEO. Reports show both.
- **Billing status** per cycle or one-time project: *Not billed / Billed*, with an optional date and note. There's no invoicing.
- Every figure can be traced back to the raw data behind it: item, category, planned value, allocation method, approval and override.

### 4.12 Reports, month close and AI export (CEO only)
- **Reports:** Potential, Achieved and Remaining revenue (by client, category and project) · client work completion (done vs approved) · project progress · Additional Work · overdue and delay patterns · **raw employee metrics** (completed, overdue, average completion time, rejections and revision loops, acknowledgement delay, attendance, overtime, workload) · trends. Available by week, month or custom range.
- **No automatic ratings or scores**, only raw facts.
- **Close month:** the CEO closes a month, which saves an **immutable snapshot**. Later changes never alter it. A mistake is fixed with an explicit **correction**, which creates a new snapshot version linked to the old one and records why.
- **Exports:** Markdown, CSV and PDF. The **Markdown export is designed for AI analysis**: an executive summary followed by dense, structured raw data (tables and IDs) that answers questions like *"Which stage takes longest?", "Who is overloaded?", "How much potential revenue wasn't achieved?"*
- Admins get operational reports for their own scope, with no money in them.

### 4.13 Activity history
- An **append-only** log of every important action: who, what, which record, when, and old and new values. It can't be edited or deleted.
- Recorded in the same database transaction as the change. A change can't succeed without its audit record.
- The CEO can search by person, client, record, action type and date. Admins see activity within their own scope.

### 4.14 Global search
`Ctrl/Cmd + K` searches clients, people, tasks, projects, items and contacts, **only what the user is allowed to see**. Results are grouped by type and open the record directly.

### 4.15 Settings
- **Company:** name, logo, timezone (IST), weekly off days, holidays, logout-reminder time, acknowledgement and escalation thresholds, default reminders.
- **Team:** invite, role, job title, name, deactivate or reactivate (CEO). Job titles list.
- **Lists:** task types (with event behaviour, default reminders and fields), stage presets, and other lists.
- **Custom fields:** for clients, contacts, projects, items and tasks, globally or for one client.
- **Templates:** project templates and task templates.

---

## 5. Out of scope for the prototype
GST invoice generation and invoicing · client login or portal · WhatsApp · native mobile app · timesheets or time tracking · social publishing · AI features inside MaxOff · HR leave policies and balances · task dependency engine · payroll · accounting integration · leads pipeline · client-facing financial reports · custom RBAC roles · multi-tenant SaaS (billing, sign-up, org admin).

## 6. Quality bar ("production level")
| Area | Requirement |
|---|---|
| Security | RLS on every table, server-side permission checks, invite-only access, deactivation takes effect immediately, private files through expiring links, sanitized SVGs, rate limits, security headers, money unreachable for non-CEO roles at the database level |
| Integrity | Workflow state changes only through the database's own transition functions. The audit record is written atomically with each change. Immutable snapshots. Archive instead of delete |
| Reliability | Nightly backups with a tested restore, error monitoring, uptime checks, CI that blocks red builds, idempotent scheduled jobs |
| Real time | Dashboards, approvals, notifications, tasks and comments update without refreshing |
| UX | Loading, empty, error and denied states; usable from 375px up; accessible; keyboard-friendly; PWA-installable |
| Performance | Indexed and paginated lists, no N+1 queries, dashboards under 2 s |

## 7. Open questions (not blocking the schema)
- [ ] **Admin performance metrics:** v2 lets Admins view raw metrics, but #6 limits what they see. Proposed default: an Admin sees metrics calculated only from tasks visible to them. *Confirm before phase 9.*
- [ ] Default thresholds: acknowledgement reminder every **2 h**, escalation after **4 h**, logout reminder at **8:30 PM**. *Confirm or change (these are Settings values).*
- [ ] **CEO attendance:** assumed the CEO does **not** go through the daily attendance gate (only Admins and Staff do). *Confirm before phase 2.*
- [ ] Team job titles and any existing clients or projects to import at launch.
