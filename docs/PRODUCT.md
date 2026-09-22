# MaxOff: Product Spec (v2)

> **What** MaxOff does and **why**. How it's built: `ARCHITECTURE.md`. Tables: `DATA-MODEL.md`.
> States and transitions: `WORKFLOWS.md`. Who can do what: `PERMISSIONS.md`.
> Sources: `research/v2-product-context.md` + `research/v2-clarifications.md`. **Where they differ, this file wins.**
> Owner: Pixora Clips · Last updated: 21 Sep 2026

---

## 1. What MaxOff is

MaxOff is the **internal operations and control system for Pixora Clips**. It's the single reliable source of truth for how Pixora's people, client work, approvals and revenue are moving every day.

It answers these questions every day:

| Role | Questions |
|---|---|
| **Owner** | Who's working today? What are they doing? What's late? What needs my approval? How is client work progressing? What revenue is possible, and what has actually been approved? Where is the team slowing down? |
| **Admin** | Which clients am I responsible for? What client work is pending? Which staff tasks need attention or approval? What's overdue? What should happen next? |
| **Staff** | What do I need to do today? What's due soon or overdue? Have I acknowledged my tasks? What feedback do I need to address? What shoots or meetings are coming up? |

- **Internal only.** Invite-only, with no public sign-up. **Clients never log in.**
- **Timezone:** everything runs on **Asia/Kolkata (IST)**.
- **Devices:** desktop-first web app. It must work well on phones for Staff, and be installable as a PWA.
- **SaaS later is possible but isn't the goal.** Only cheap seams are kept (see ARCHITECTURE §1).

## 2. Product principles
1. **Operational visibility over feature count.** Every screen shows what needs to happen next.
2. **The Owner has final authority, over both work and configuration.** Attendance, leave, money and final completion all go through the Owner, and **every configurable element** (lists, task types, stages, thresholds, days off, fields, templates, integrations) is editable by the Owner in Settings.
3. **Admins run operations, not governance.** They have no authority over attendance or leave, and never see money.
4. **Staff focus on execution.** They see only their own work.
5. **Complexity depends on role.** The Owner interface is rich, the Admin interface is simpler, and the Staff interface is very simple. This is intentional.
6. **Customization is data.** Task types, job titles, stage presets, holidays, custom fields and templates are edited in Settings.
7. **Don't overbuild.** No dependency engines, HR policy engines, timesheets or invoicing.
8. **Never destroy history.** Changes are recorded, corrections sit alongside the original, and records are archived rather than deleted.
9. **Operational progress isn't revenue.** Revenue counts only after the Owner approves the work.
10. **Collect facts, don't judge.** MaxOff stores raw operational data for the Owner or an AI tool to analyse. It never rates employees.

---

## 3. Roles

There are exactly three system roles. **Job titles** (e.g. Video Editor) are separate, editable data, and have nothing to do with permissions.

| Role | Count | Summary |
|---|---|---|
| **Owner** | Exactly 1 | Full access to everything, including money, attendance, leave, final approvals, month closing and permanent deletion. |
| **Admin** | Any number | Runs their assigned clients and the staff work they create or approve. Also an employee: marks attendance, takes leave, and can be assigned tasks. |
| **Staff** | Any number | Does the tasks allotted to them. Marks attendance and takes leave. |

The full permission and visibility matrix is in `PERMISSIONS.md`. The key rules:
- **Each client has exactly one Admin**, assigned by the Owner. There's no fixed Staff-to-Admin hierarchy.
- **An Admin sees only their own**: assigned clients, plus tasks they created, approve or are assigned to. For everyone else they see **availability only** (task count, busy calendar blocks, approved leave), which is enough for workload and conflict warnings.
- **Staff see only tasks allotted to them.** A task can carry a **client label** (the client's name and brand basics), and that's all Staff ever see of a client.
- **Money is Owner-only**, everywhere, including in exports.
- The Owner account is created by a secure bootstrap script (Supabase Auth). Passwords are never stored in app tables.

---

## 4. Modules

### 4.1 Authentication and sessions
- Email + password through Supabase Auth, with invites only and several devices allowed.
- **First login of each IST day:** the person must choose today's status before using the app (see §4.2). Later logins that day skip this.
- **Logout is manual.** The exact time is recorded immediately.
- A deactivated person loses access immediately, and their history is kept.

### 4.2 Attendance (for Admins and Staff)
- The first-login choice is **Present / Leave / Half-Day Leave / Compensatory Leave**. Choosing a leave type also creates a leave request for today.
- MaxOff records the first-login time, the choice, logout times, and the Owner's decision with its time and reason.
- **The Owner approves**, one at a time or in bulk. **When rejecting, the Owner sets the correct status** (Absent / Leave / Half-Day / Comp Leave / Present) and gives a reason, and the employee is notified. The original choice and the correction are both kept.
- **11:59 PM IST check:** an active employee with no submission on a **working day** is marked **"Absent – pending Owner approval"**, and the Owner gets one notification listing everyone. Absence becomes official only once the Owner approves it. Anyone with **approved leave** for that date is set to their leave status automatically and is never proposed absent.
- **On an approved-leave day there's no gate.** If the person logs in anyway, a banner says "You're on approved leave today", with an optional **"I'm working today"** button that submits Present for the Owner to review. If the Owner approves it, the day is flagged **"1 day worked"** and the leave request itself is **not** altered. The attendance day is the source of truth for a date.
- **Approved half-day leave:** no gate either, but the first login, session events and logout are still recorded.
- **A leave approved later wins.** If leave for today is approved after the person already submitted Present, the day is corrected to the leave status automatically, audited as a system correction, and the person is notified.
- **An Owner correction to a leave type** (Leave / Half-Day / Comp Leave) also creates an approved leave request for that date, so the calendar and availability stay right.
- **Days off:** the Owner sets the **weekly off days** (currently Sunday) and a **holiday list** in Settings. There's no absent check on days off, but anyone who logs in is still asked, and the day is marked **"Worked on a day off"** — useful when granting compensatory leave.
- **The Owner is exempt** from the attendance gate and its reminders.
- **Forgotten logout:** around **8:30 PM IST** (configurable), anyone still logged in gets a reminder: *"You may have forgotten to log out. If you're done, log out; if you're working overtime, carry on."* If they never log out, the day is flagged **"Logout not recorded"**. A logout time is **never** made up.
- **Overtime:** a simple flag with an optional reason. No time tracking.
- No working-hours rules and no location rules.

### 4.3 Leave (for Admins and Staff)
- Types: **Leave, Half-Day Leave, Compensatory Leave**, for today or any future date or date range, with a free-text reason. There's no advance-notice rule and no leave-balance or policy engine.
- **The Owner approves or rejects** every request, including changes and cancellations.
- An employee can **request a change or cancellation**. This creates a new request linked to the original. Nothing is overwritten.
- Only the Owner can change an approved leave directly.
- Approved leave shows on the calendar and triggers warnings when someone on leave is assigned work.

### 4.4 Clients (CRM)
Each client has one central page, visible to the Owner and the client's Admin.

- **Details:** name, legal or business name, address, GSTIN, phone, email, website, requirements, notes, and **custom fields**. Only the name is required.
- **Owner-only notes** (a separate, Owner-only field).
- **Assigned Admin:** exactly one, set by the Owner. Changes are kept in history.
- **Contacts:** several per client, with one primary.
- **Google Drive link:** one link to the client's asset folder, opened in a new tab.
- **Light Brand Kit:** logo (uploaded), colour codes, font names, tone of voice, brand notes. The logo shows in client lists. Staff see these brand basics on client-labelled tasks.
- **Lifecycle:** Draft → Active → Paused → Inactive. A client becomes Active once it has a name and an Admin, and only the Owner activates, pauses or closes it.
  - **Paused:** everything stays visible, and **recurring projects stop creating new cycles**.
  - **Inactive:** stays searchable, and no new work can be added until the Owner reactivates it.
- **Page sections:** Overview · Brand · Projects · Staff tasks (labelled with this client) · Activity. Financial panels appear for the Owner only.

### 4.5 Client work: Projects → Items
**Client work is tracked separately from staff tasks.** The Admin maintains it. Staff never see it, and staff task completion **never** updates it automatically.

- **Projects belong to a client.** A project has a name, description, **recurrence** (one-time / weekly / monthly), optional **stages**, a **billing category** (set by the Owner), a status and custom fields. Projects have **no start or end dates**.
  - Internal company work can use an internal client record, e.g. "Pixora (internal)".
- **Items** are the individual pieces of work in a project, named by the Admin:
  - *Monthly Production*: "Reel 1 – Ambience", "Reel 2 – Menu", …
  - *Drone Documentation* (weekly): "Week 1", "Week 2", …
  - *Brand Film* (one-time, additional): a single item, "Make the video".
  Each item has a title, optional planned date, notes, stage ticks, custom fields and a state.
- **Stages (optional, set per project):** the Admin picks a stage preset (e.g. *Script → Shoot → Edit → Posted*) or none. Every item in the project gets those stages. Presets are edited in Settings.
- **Completion:** **the Admin ticks the item done**, which means complete operationally. **The Owner approves it**, one at a time or in bulk, which makes it final and revenue-eligible. The Owner can reject with a reason, which sends it back to the Admin. Reports always show both, e.g. **"9/12 done · 8/12 Owner-approved"**.
- **Cycles (recurring projects):**
  - At **12:00 AM IST on the 1st** (monthly) or **Monday** (weekly), MaxOff creates a new cycle for each recurring project of every **Active** client, copying the project's **item list**. The Admin then renames items with that period's themes.
  - A one-time project has a single cycle with no period.
  - The Admin or Owner can also start a cycle manually.
- **Unfinished items at the end of a cycle** are highlighted, and the **Owner decides** each one: **Carry forward** (moved into the next cycle as a carry-forward item that keeps its original period and value, so it doesn't inflate the new cycle's scope or planned revenue), **Close** (closed with a reason, never deleted; its value stays in Potential as *closed, not achieved*, so lost revenue remains visible) or **Leave pending**.
  - If the next cycle doesn't exist yet (before the 1st or Monday, or because the client is **paused**), carrying forward **creates it**.
- **Project status:** Open → In progress → Completed / Cancelled. **Completion is a manual Owner decision.** Projects never close automatically, and the Owner can reopen them.
- **Project templates:** reusable setups with a recurrence, stage preset, item list, default billing category and custom fields. Everything generated stays editable.

### 4.6 Staff tasks
Daily work allotted to people. **Only the Owner and Admins create tasks.**

- **Fields:** title, description, **task type**, optional **client label**, priority (Low / Medium / High / Urgent), **deadline (exact date and time, IST)**, assignees with one **primary owner**, reminder schedule, optional stages or checklist, custom fields, comments and files.
- **Task types** (editable list): Normal, Shoot / Site Visit, Meeting, Posting, Review / Approval, Other, Custom.
  - Event-type tasks (Shoot, Site Visit, Meeting, Posting) also have an event date, an optional time, a location and a purpose, and appear on the calendar.
  - A type can have its own custom fields and default reminders.
- **Acknowledgement:** **every assignee** must tap **"Task Noted"**, which records who and when. Unacknowledged tasks get repeated reminders, then escalate to the approving Admin (or creator) after a configurable threshold, and to the Owner after a second one. Management sees each assignee's acknowledgement status.
- **Doing the work:** assignees add timestamped comments and updates, tick stages, and upload files (optional, versioned, see §4.9). **The primary owner marks the task Done.** If a task misses its deadline, the primary owner must give a reason, and other assignees can add their own reasons in comments.
- **Approval chain:** depends on how the task was created.

  | How the task was created | Approval after Done |
  |---|---|
  | Owner assigned it directly | → **Owner** |
  | Owner assigned it through an Admin (the Owner picks the Admin) | → **that Admin** → **Owner** |
  | An Admin created it with a client label | → **the client's Admin** → **Owner** |
  | An Admin created it with no client label | → **the creating Admin** → **Owner** |
  | The approving Admin is also an assignee | Admin step **skipped** (recorded) → **Owner** |

  - The Owner can change or remove the approving Admin at any time.
  - A task is **finally complete only after Owner approval**. The Owner can approve one at a time or in bulk, and each task gets its own approval record.
  - **A rejection (by the Admin or Owner) needs a reason.** The task goes back to the assignees as *Changes requested*, and they fix it and resubmit.
  - From the moment Done is submitted, **assignees can't edit** the task (they can still comment). Editing resumes only if changes are requested.
  - **Editing, reassigning, cancelling and reopening** a task is limited to its **creator**, its **approving Admin** and the **Owner**. A reopened task goes through the **same approval route again**, and acknowledgements are kept.
- **Overdue:** a task is overdue **the moment its deadline passes** without final Owner approval. It's shown as a badge, while the task's status stays what it was. If nothing has been submitted a configurable time after the deadline (default 24 h), the approving Admin (or creator) and the Owner are notified.
- **Changes after acknowledgement:** the Owner or Admin can change assignees, deadline, scope, priority and reminders. Each change records who, when, the old value and the new value, and affected people are notified.
- **Cancel:** the Owner or Admin can cancel with a reason. Reminders stop, and the task stays in history and reports.
- **Warnings (never blocking):** when assigning, MaxOff warns about **overlapping timed work**, **heavy same-day workload** and **approved leave** on that date. If the person proceeds anyway, the override is recorded.
- **Task requests:** Staff and Admins can **suggest** a task (title, details, optional client). The Owner or Admin turns it into a real task or declines it with a reason.
- **Task templates:** type, default stages, reminders, priority and field defaults. They **never** fix the client, assignee or deadline.
- **Duration without time tracking:** MaxOff keeps these timestamps: *assigned*, *each acknowledgement*, *Done*, *Admin approved*, *Owner approved*. Rough durations are worked out from them.

### 4.7 Dashboards and daily reports
- **Owner: Today** (actions first):
  1. Today at a glance: present, on leave, pending attendance, pending leave, pending task approvals, pending item approvals, due today, overdue, upcoming events, client work progress.
  2. **Approvals inbox** with one-click Approve, Reject, Review, Reassign and Extend deadline, plus bulk actions. There's no need to open other modules.
  3. People (attendance, login and logout, logout not recorded, overtime) · Today's tasks · Overdue and risks · Calendar strip · Client progress · Revenue snapshot.
- **Admin:** My clients (cycle progress) → client work pending → staff tasks needing attention → approvals → calendar → issues.
- **Staff: My Day** (very simple): attendance status, **Pending acknowledgement**, Today, Upcoming, Overdue, **Changes requested**, Upcoming events, a request-a-task button and Logout. Nothing else.
- **Staff navigation** (decided in task 0.3): a bottom bar on phones with exactly five tabs, **My Day · Tasks · Calendar · Alerts · Me**. "Me" holds the profile, appearance (light/dark) and Logout. Staff have no Clients, People, Approvals, Reports or Settings entries. Owner and Admin use a sidebar with Today, Approvals, Clients, Tasks, Calendar, People, Reports and Settings; the Admin's Settings shows only the lists, templates and custom fields they may edit (`PERMISSIONS.md` §1).
- **Owner end-of-day report:** generated automatically each day (and viewable live). It covers attendance and leave decisions, tasks completed, pending and overdue (with reasons), Admin and Owner approvals, logout times, overtime flags, and tomorrow's events. It's an operations report, not payroll.

### 4.8 Calendar
- Day, week and month views of event tasks (shoots, site visits, meetings, postings and other timed tasks), approved leave, holidays and planned dates of client items.
- Filters: client, employee, task type, status.
- Helps spot conflicts and overloaded people. Admins see other people's work only as busy blocks.

### 4.9 Work submissions: files and Drive links
Submitting work on a task is **optional** and never required before Done. **Submissions are versioned** (v1, v2, …), nothing is replaced, and each version keeps its uploader, time, reviewer, comments and decision.

There are two ways to submit, and MaxOff picks the right one automatically:

| What | How | Limit |
|---|---|---|
| **Photos** and documents | Uploaded in MaxOff, straight from the browser to storage | **25 MB** per file |
| **Short videos** | Uploaded in MaxOff the same way | **100 MB** per file |
| **Large videos** | The person pastes a **Google Drive link** to their own file | No limit |

- If a file is too big to upload, MaxOff says so and asks for a Drive link instead. Staff never need access to the company Drive.
- **Originals are kept untouched, at full quality.** iPhone HEIC files, RAW files and large JPEGs are stored exactly as taken. For display, MaxOff makes a small JPEG **preview** so the photo opens in any browser, on any device. Reviewers can always open or download the original. Nothing is ever compressed or resized. Previews are kept even after the original leaves MaxOff (§4.10).
- The Owner and Admin can preview (images, video, PDF), download, comment, approve or request changes, always against a specific version.
- Downloads use short-lived private links. SVGs are sanitized. No transcoding.

### 4.10 Google Drive archive
Google Drive is the **permanent home** for everything submitted. MaxOff is the working copy.

- MaxOff is connected to **one company Google account** (personal Gmail, no Workspace). Only the Owner connects or reconnects it in Settings. Staff have no access to it.
- **Every uploaded file is copied to Drive.** **Every pasted video link is copied into the company Drive**, server to server through Google's own copy function, so nothing passes through MaxOff and it takes seconds. The company copy survives even if the employee later deletes theirs.
- **Folders and names are created by MaxOff.** The person filling in the task fills in nothing:
  ```
  MaxOff Archive/
    Clients/<Client>/<YYYY-MM>/Photos|Videos/
      2026-10-07_Reel-4-Ambience_v1_Rahul_01.HEIC
    Internal/<YYYY-MM>/Photos|Videos/
  ```
  Each Drive file's description holds a link back to its MaxOff task.
- **A private or unreachable link** is detected the moment it's pasted. The task shows **"Link is private – not archived"**, the employee is notified with instructions to set *anyone with the link can view*, and MaxOff keeps retrying and archives as soon as access is granted. It **doesn't block** approval, but the Owner sees the warning.
- **Storage cleanup:** MaxOff deletes its own copy of photos after **90 days** and videos after **30 days**, and **only when the Drive copy is confirmed**. The Drive archive is kept forever. Old versions are removed on the same rule. Only **originals** are subject to this rule; the small JPEG previews are kept so the task page still shows the work. Logos and avatars are not submissions and are never archived or cleaned up this way.
- If the Google connection expires (which happens with personal accounts), MaxOff shows the Owner a **"Reconnect Google Drive"** banner and queues everything until it's back. Nothing is lost and nothing is deleted while the queue is waiting.
- Settings show how much storage MaxOff and Drive are using, with a warning before either runs low.

### 4.11 Notifications
- **Mandatory.** Users can't turn them off. They go only to the **relevant** people (see WORKFLOWS §9 for who receives what).
- **Channels:** in-app (real time, with history and deep links) + **browser push** (Web Push/VAPID, PWA). **Email** is used only for **invites, escalations, the Owner's daily digest, and people with no working push**, capped per person per day (default **20**; invites and escalations bypass the cap), so the free email allowance is never the bottleneck.
- **iPhone and iPad:** Apple only delivers push to an app added to the home screen. First login on iOS shows a short "Add MaxOff to your home screen" guide, and a banner stays until push works. In-app notifications and email work regardless.
- **Reminders:** configurable per task (default: 2 days before, 1 day before, due time, overdue). Unacknowledged tasks get **repeated** reminders at controlled intervals (default every 2 h), then **escalation** to the approving Admin or creator (default after 4 h) and then the Owner (default after 8 h). A task with nothing submitted 24 h past its deadline (configurable) escalates the same way. Never spammy.
- **Email is a real second channel for the few things that matter**, not only a fallback: **task assigned**, **escalations**, **invites**, the **Owner digest**, and **an event tomorrow** (shoot, site visit, meeting). Everything else is in-app and push only. The per-person daily cap keeps this inside the free allowance.
- **Push keeps working after logout.** A device stays subscribed when someone logs out, because a person who logs off at 6 PM still needs to know about a 7 AM shoot. Those notifications are **title only** ("MaxOff: new task assigned"), with no client, task or personal detail, and opening one asks for login first. A subscription is removed only when the person chooses **"Sign out of this device"** or the Owner deactivates them (which removes all of theirs).
- **Reachability is visible to management.** Settings → Notifications shows **who isn't reachable** and why: push never allowed, permission revoked, iPhone without the app installed, or repeated delivery failures. The Owner (and each Admin, for people on their tasks) can see it, and it's part of the daily "needs attention" list. Nobody has to discover a silent phone by missing a shoot.
- **Test notification.** Anyone can send themselves one ("Send a test") and confirm it arrived. Setup is confirmed on day one instead of assumed, and it's part of onboarding a new joiner.
- WhatsApp comes later (the channel design already allows it without touching business logic).

> **Why this still works when a phone is silent:** delivery can never be guaranteed on any platform. What's guaranteed is that **nobody can quietly not know** — acknowledgement is explicit, unacknowledged work is visible to management within hours, escalation is automatic, and reachability problems are surfaced rather than hidden.

### 4.12 Revenue (Owner only)
Only **client project items** carry revenue. Staff tasks never do.

- **Billing category** for each project: **Retainer / Project / Additional Work**. It defaults from recurrence (weekly or monthly → Retainer, one-time → Project) and only the Owner can change it. A project template's default category is applied only when the **Owner** creates the project; an Admin-created project always takes the recurrence default.
- **Amounts:**
  - **Recurring project:** an amount **per cycle**, split **evenly** across the cycle's planned items unless the Owner gives **individual item values**.
  - **One-time project:** a **fixed amount**, split evenly across items unless individual values are given.
  - Carry-forward items keep their original value and period.
- **The rule:** an item's value counts as **Achieved** only when the **Owner approves** that item. A partly done or Admin-ticked item counts for nothing.
- **Potential** = the value of planned items. **Achieved** = the value of Owner-approved items. **Remaining** = Potential − Achieved. These are always reported separately from operational progress.
  - An item closed at the carry-forward decision **keeps** its value in Potential and is reported as *closed, not achieved*. Only items cancelled **before their cycle started** are excluded from Potential.
- **Owner overrides:** the Owner can override an achieved figure. The system-calculated value is kept, with the adjusted value, note, time and Owner. Reports show both.
- **Billing status** per cycle or one-time project: *Not billed / Billed*, with an optional date and note. There's no invoicing.
- Every figure can be traced back to the raw data behind it: item, category, planned value, allocation method, approval and override.

### 4.13 Reports, month close and AI export (Owner only)
- **Reports:** Potential, Achieved and Remaining revenue (by client, category and project) · client work completion (done vs approved) · project progress · Additional Work · overdue and delay patterns · **raw employee metrics** (completed, overdue, average completion time, rejections and revision loops, acknowledgement delay, attendance, overtime, workload) · trends. Available by week, month or custom range.
- **No automatic ratings or scores**, only raw facts.
- **Close month:** the Owner closes a month, which saves an **immutable snapshot**. Later changes never alter it. A mistake is fixed with an explicit **correction**, which creates a new snapshot version linked to the old one and records why.
- **Exports:** Markdown, CSV and PDF. The **Markdown export is designed for AI analysis**: an executive summary followed by dense, structured raw data (tables and IDs) that answers questions like *"Which stage takes longest?", "Who is overloaded?", "How much potential revenue wasn't achieved?"*
- Admins get operational reports for their own scope, with no money in them. These are computed live: the end-of-day reports and month snapshots contain revenue and are Owner-only.

### 4.14 Activity history
- An **append-only** log of every important action: who, what, which record, when, and old and new values. It can't be edited or deleted.
- Recorded in the same database transaction as the change. A change can't succeed without its audit record.
- The Owner can search by person, client, record, action type and date. Admins see activity within their own scope.

### 4.15 Global search
`Ctrl/Cmd + K` searches clients, people, tasks, projects, items and contacts, **only what the user is allowed to see**. Results are grouped by type and open the record directly.

### 4.16 Settings: the Owner's control centre
**Everything configurable in MaxOff is editable by the Owner, in one place, with no developer involved.** If a rule, list, threshold or label exists, the Owner can change it here. Admins get only the operational parts (lists, templates, custom fields).

- **Company:** name, logo, timezone (IST), **weekly off days** (currently Sunday), **holidays**, logout-reminder time, acknowledgement and escalation thresholds (Admin and Owner), overdue escalation, workload warning threshold, default reminder schedule, email daily cap per person.
- **Team:** invite, role, job title, name, deactivate or reactivate (Owner). **Job titles** are an editable list the Owner adds to freely (seeded with Video Editor and Graphic Designer).
- **Lists:** task types (with event behaviour, default reminders and fields), stage presets, and other lists.
- **Custom fields:** for clients, contacts, projects, items and tasks, globally or for one client. Fields on **projects and items are Owner-only** to define (there's no currency type, and this closes the "amount in a number field" loophole).
- **Templates:** project templates and task templates.
- **Google Drive (Owner only):** connect or reconnect the company account, choose the archive root folder, and see the archive queue and any failures.
- **Storage:** how much MaxOff (R2) and Google Drive are using, with warnings before either runs low.

---

## 5. Out of scope for the prototype
GST invoice generation and invoicing · client login or portal · WhatsApp · native mobile app · timesheets or time tracking · social publishing · AI features inside MaxOff · HR leave policies and balances · task dependency engine · payroll · accounting integration · leads pipeline · client-facing financial reports · custom RBAC roles · multi-tenant SaaS (billing, sign-up, org admin).

## 6. Quality bar ("production level")
| Area | Requirement |
|---|---|
| Security | RLS on every table, server-side permission checks, invite-only access, deactivation takes effect immediately, private files through expiring links, sanitized SVGs, rate limits, security headers, money unreachable for non-Owner roles at the database level |
| Integrity | Workflow state changes only through the database's own transition functions. The audit record is written atomically with each change. Immutable snapshots. Archive instead of delete |
| Reliability | Nightly backups with a tested restore, error monitoring, uptime checks, CI that blocks red builds, idempotent scheduled jobs |
| Real time | Dashboards, approvals, notifications, tasks and comments update without refreshing |
| UX | Loading, empty, error and denied states; usable from 375px up; accessible; keyboard-friendly; PWA-installable |
| Performance | Indexed and paginated lists, no N+1 queries, dashboards under 2 s |

## 7. Settings decided at launch (all editable later by the Owner)
| Setting | Value |
|---|---|
| Weekly off | **Sunday** (people may still log in and mark attendance; no absent check) |
| Holidays | None seeded. The Owner adds them in Settings |
| Job titles | **Video Editor, Graphic Designer**, and the Owner adds more freely |
| Acknowledgement reminder | Every **2 h** |
| Acknowledgement escalation to the approving Admin (or creator) | After **4 h** |
| Acknowledgement escalation to the Owner | After **8 h** |
| Overdue escalation (nothing submitted after the deadline) | After **24 h** |
| Email cap per person per day | **20** (invites and escalations bypass it) |
| Logout reminder | **8:30 PM IST** |
| Owner attendance | **Exempt.** The gate and the attendance jobs apply to Admins and Staff only |
| Google Drive archive account | `pcproductions.work@gmail.com` (Google One 2 TB, personal account) |

## 8. Open questions (not blocking the schema)
- [ ] **Admin performance metrics:** v2 lets Admins view raw metrics, but clarification #6 limits what they see. Proposed default: an Admin sees metrics calculated only from tasks visible to them. *Confirm before phase 9.*
- [ ] Existing clients, projects or people to import at launch.
