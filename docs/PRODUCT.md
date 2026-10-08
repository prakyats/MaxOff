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
- **Devices: mobile is a first-class layout for every role, not a narrow version of the desktop one** (decided 2026-09-23). The phone is how the Owner approves on the way to a shoot and how Staff work all day; the desktop is where long lists and reports get read. A screen that only works by shrinking its desktop layout is not finished (ARCHITECTURE §14.1). Installable as a PWA.
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
11. **First glance, then depth** (owner decision 2026-09-24, CLAUDE.md engineering rule 12). Each screen's first view shows only what answers that role's question (§1 table) and what needs action now; details and occasional actions live one level deeper, on sub-pages or sheets. Guardrails: **daily actions stay on the first screen** (Approve, Log out, the gate); **nothing is more than two taps from its tab**; **every count or summary is tappable** and opens the filtered detail behind it; **exceptions get rows, the normal case collapses to a count.** Every plan that adds or changes UI says what the first screen shows, what moves one tap deeper, and that no daily action got deeper (`/start-task`).
12. **Red means commit** (owner decision 2026-09-26, the action colour rule; spec in ARCHITECTURE §14.1). Solid brand red is the **one** action that commits a change on a screen, dialog, sheet or sticky bar (Save, Submit, Request leave, the confirmation's button). A destructive action is a red outline until it is confirmed, and its confirmation's one red button names what it does ("Deactivate Ravi"), never "OK" or "Yes". Backing out (Cancel, Keep editing, Review) is a neutral outline anyone can see. A button that only opens a form or a confirmation is neutral solid ("Request leave", "Approve", "Approve all 3"): the red is inside, where the change happens. Red is never decoration: selected tabs and navigation stay neutral, focus is a neutral ring, and red otherwise appears only as error text with an icon and as the count badge that asks for attention.

---

## 3. Roles

There are exactly three system roles. **Job titles** (e.g. Video Editor) are separate, editable data, and have nothing to do with permissions.

| Role | Count | Summary |
|---|---|---|
| **Owner** | Exactly 1 | Full access to everything, including money, attendance, leave, final approvals, month closing and permanent deletion. |
| **Admin** | Any number | Runs their assigned clients and the staff work they create or approve. Also an employee: marks attendance, takes leave, and can be assigned tasks. |
| **Staff** | Any number | Does the tasks allotted to them. Marks attendance and takes leave. |

**The Staff role is shown to people as "Crew"** (owner decision 2026-09-30): the app, the app guide and the first-day page say Crew ("Owner · Admin · Crew"). Only the name on screen changed. The role, its value `staff`, its permissions and every rule here are the same, and these documents keep saying Staff.

The full permission and visibility matrix is in `PERMISSIONS.md`. The key rules:
- **Each client has exactly one Admin**, assigned by the Owner. There's no fixed Staff-to-Admin hierarchy.
- **An Admin sees only their own**: assigned clients, plus tasks they created, approve or are assigned to. For everyone else they see **availability only** (task count, busy calendar blocks, approved leave), which is enough for workload and conflict warnings.
- **Staff see only tasks allotted to them.** A task can carry a **client label** (the client's name and brand basics), and that's all Staff ever see of a client.
- **Money is Owner-only**, everywhere, including in exports.
- The Owner account is created by a secure bootstrap script (Supabase Auth). Passwords are never stored in app tables.
- **Freelancers are people without a login** (owner decision 2026-09-27, ADR-0013): a person record of engagement type *freelance*, looked after by one **coordinator** (an Admin or Staff employee) who acts on their behalf from their own account. Engagement is data, not a role. See §4.17.

---

## 4. Modules

### 4.1 Authentication and sessions
- Email + password through Supabase Auth, with invites only and several devices allowed.
- **People stay signed in** (since phase 3b, 2026-09-27): signing in and out is not attendance. The working day is **Start day** and **End day** (§4.2); the 2.x first-login day gate is gone from the app. **"Sign out of this device"** (under Me) is for a lost or shared device; it records the time in the security log only.
- A deactivated person loses access immediately, and their history is kept.

### 4.2 Attendance (for Admins and Staff)
> **Reworked 2026-09-27 (owner, phase 3b; "Kickoff 3b decisions" in PROGRESS):** people stay signed in, and the working day is **Start day** and **End day**, separate from signing in and out. Until phase 3b is built, the app still works the 2.x way (a blocking day gate on first open, logout = end of day).

- **People stay signed in**, so tasks and notifications reach them in the evening and on days off too. The app never signs anyone out on its own; **"Sign out of this device"** (under Me) is only for a lost or shared device. Opening the app is not attendance.
- **Start day.** On a working day the app opens freely. Until the person starts their day or chooses leave, an in-app prompt asks *"Started working? Start your day to record it."* with **Start day**, **On leave today? Choose leave** (Leave / Half-Day Leave) and **Just looking**. It comes back when the app is opened or returned to, **at most every 30 minutes**, until answered, and My Day (an Admin's Today) shows *"Not started · Start day"*. **The start time is the moment they tap Start day.** Working hours are flexible, so there's no time gate.
- **End day** records the end time. It's **final for that day** (no resume), and the app stays fully usable afterwards (checking tomorrow's tasks at 9 PM isn't work). Its confirmation offers an optional **overtime note** (§4.3a) and asks **"Any expenses to claim today?"** (§4.18). Work done after ending the day is recorded with an overtime note.
- MaxOff records the choice, the start and end times, and the Owner's decision with its time and reason.
- **The Owner approves**, one at a time or in bulk. **When rejecting, the Owner sets the correct status** (Absent / Leave / Half-Day / Comp Leave / Present) and gives a reason, and the employee is notified. The original choice and the correction are both kept.
- **11:59 PM IST check:** an active employee with no Start day and no leave on a **working day** is marked **"Absent – pending Owner approval"**, and the Owner gets one notification listing everyone. Absence becomes official only once the Owner approves it. Anyone with **approved leave** for that date is set to their leave status automatically and is never proposed absent.
- **On an approved-leave day there's no prompt.** A banner says "You're on approved leave today", with an optional **"I'm working today"** button that submits Present for the Owner to review. If the Owner approves it, the day is flagged **"1 day worked"** and the leave request itself is **not** altered. The attendance day is the source of truth for a date.
- **Approved half-day leave:** no prompt either; Start day and End day stay available and are recorded.
- **A leave approved later wins** over a day not yet decided (WORKFLOWS §1), and **a day the Owner already decided stays**.
- **An Owner correction to a leave type** (Leave / Half-Day / Comp Leave) also creates an approved leave request for that date, so the calendar and availability stay right (Comp Leave uses one of the person's credits; grant one first).
- **Days off:** the Owner sets the **weekly off days** (currently Sunday) and a **holiday list** in Settings. On a day off there's **no prompt and no absent check**. Someone who worked adds an **"I worked today"** note, and the Owner decides whether the day counts as worked and whether it earns comp leave (§4.3a).
- **The Owner is exempt** from Start day, End day and their reminders.
- **Forgotten End day:** around **8:30 PM IST** (configurable), anyone who started and hasn't ended gets *"You haven't ended your day. If you're done, end it; if you're working late, carry on."* If they never end it, the day is flagged **"End of day not recorded"**. An end time is **never** made up; an End day after midnight lands on the previous day, **only until 05:00 IST** (a setting, Settings → Thresholds) and never once today's Start day exists. After that the previous day stays "End of day not recorded" and the late work goes in an overtime note (owner decision 2026-09-28, `/review-phase 3b`).
- No working-hours rules and no location rules.

### 4.3 Leave (for Admins and Staff)
- Types: **Leave, Half-Day Leave, Compensatory Leave**, for today or any future date or date range, with a free-text reason. **Compensatory Leave is offered only while the person has an available comp leave credit** (§4.3a). There's no advance-notice rule and **no general leave balance or policy engine**: the only balance is Owner-granted comp leave.
- **The Owner approves or rejects** every request, including changes and cancellations.
- An employee can **request a change or cancellation**. This creates a new request linked to the original. Nothing is overwritten.
- Only the Owner can change an approved leave directly.
- Approved leave shows on the calendar and triggers warnings when someone on leave is assigned work.

### 4.3a Extra work and compensatory leave (decided 2026-09-27, phase 3b)
- **Overtime note:** which day (up to **7 days back**), roughly how long (optional) and **what they worked on** (required). Added from Extra work & expenses (Attendance & leave until 5B) or when ending the day.
- **"I worked today" on a day off** (up to 7 days back): a note about the work (required).
- Both appear in the Owner's **Approvals → Extra work** group (after Leave). For each: **Grant comp leave** (½ or 1 day) or **No comp leave**. For day-off work the Owner also decides whether to **mark the day as worked** ("Worked on a day off"). **Nothing is automatic**: extra work caused by the person's own mistake, for example, earns nothing unless the Owner says so.
- The person sees the outcome on their note: *"1 comp leave granted · use by 31 Oct"* or *"Reviewed by the Owner"*.
- **The Owner can grant comp leave at any time, for any reason**, independent of any note: ½ or 1 day, with an optional note the person sees.
- **A credit expires at the end of the calendar month (IST) it was granted in**, however close that is. Expired credits stay in the history as expired.
- **Using it:** only through the leave form (Request leave → Compensatory Leave), as a full day (1) or a half day (½), showing the balance and the use-by date. **The leave date must be on or before the credit's expiry.** **It is still a leave request the Owner approves or rejects**, like any other: a credit makes the option available, it doesn't guarantee the day (there may be a shoot). A waiting request holds its credit; approval uses it (oldest first); a rejected, withdrawn or cancelled request gives it back unless it has expired.
- The Owner can **revoke an unused grant** with a reason the person sees.

### 4.4 Clients (CRM)
Each client has one central page, visible to the Owner and the client's Admin.

- **Details:** name, legal or business name, address, GSTIN, phone, email, website, requirements, notes, and **custom fields**. Only the name is required. **The name is unique** among clients that are not Inactive, case-insensitively (owner decision 2026-09-27, kickoff 3); a GSTIN must match the 15-character format when given; website and Drive link must be `https://` URLs and nothing more (the Drive access check is 8.4's).
- **Owner-only notes** (a separate, Owner-only field).
- **Assigned Admin:** exactly one, set by the Owner. Changes are kept in history.
- **Contacts:** several per client, with one primary: **exactly one primary is required once any contact exists**, and archiving the primary asks for the next; no uniqueness on a contact's email or phone (owner decision 2026-09-27, kickoff 3).
- **Google Drive link:** one link to the client's asset folder, opened in a new tab.
- **Light Brand Kit:** logo (uploaded), colour codes, font names, tone of voice, brand notes. The logo shows in client lists. Staff see these brand basics on client-labelled tasks. **Logo upload** (owner decision 2026-09-27, kickoff 3): ≤ 5 MB, PNG / JPEG / WebP / SVG (SVG sanitised, never shown inline); the original is kept and the browser makes a small JPEG preview for lists, exactly as work submissions do. Replacing a logo keeps the old file for 30 days, then only its record; an upload that was never attached is cleaned up after 7 days (owner decision 2026-09-27, 3B review). **Colours are a swatch list** (a colour chip, a name and the hex; tapping a row copies the hex) and **fonts a simple list** (a name and an optional note); both are edited as rows — a colour picker plus a hex field, add, remove and reorder — with the same Edit, Save and named-change confirmation as every record (owner decision 2026-09-27, 3B review).
- **Lifecycle:** Draft → Active → Paused → Inactive. A client becomes Active once it has a name and an Admin, and only the Owner activates, pauses or closes it (activation waits for an Admin, accepted as built in the 3B review). **The close reason is the Owner's**: only the Owner sees it (owner decision 2026-09-27, 3B review, accepted as built).
  - **Paused:** everything stays visible, and **recurring projects stop creating new cycles**.
  - **Inactive:** stays searchable, and no new work can be added until the Owner reactivates it. **Inactive is the end state**: there is no separate archive action (owner decision 2026-09-27, kickoff 3; `archived_at` stays reserved for a later "hide from lists", never deletion).
  - **A Paused or Inactive client stays fully editable** (details, contacts, brand, custom fields); only the "no new work" rules apply, and a banner names the state and who can change it (owner decision 2026-09-27, kickoff 3).
  - **Changing the Admin notifies** the new Admin ("You now run Sharma Weddings") and, if still active, the previous one (owner decision 2026-09-27, kickoff 3).
- **Page sections:** Overview · Brand · Projects · Staff tasks (labelled with this client) · Activity. Financial panels appear for the Owner only.
- **The list** (owner decision 2026-09-27, kickoff 3): cards on a phone (logo, name, state, Admin), search by name, state and Admin filters as view controls, the list **defaults to Active** for the Owner and for an Admin (the Admin's by owner decision 2026-09-27, 3B review) with "All states" one tap away; lifecycle actions behind ⋯ for the Owner. As built (3.4, accepted in the 3B review): a client's page has the tabs **Overview · Brand · Activity** (Projects and Staff tasks join with phases 7 and 4).

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
- **Settled at kickoff 4 (owner decision 2026-09-28, kickoff 4; "Kickoff 4 decisions" in PROGRESS):**
  - **The Owner is never an assignee.** The Owner approves the work, so a task the Owner did would approve itself. The assignee picker offers active Admins, Staff and freelancers only.
  - **An Admin labels a task only with their own assigned clients.** So an Admin-created task always routes to the creating Admin (the route table's "client's Admin" row is that same Admin). When the Owner assigns **through an Admin**, the Owner picks any active Admin; choosing a client label pre-selects that client's Admin.
  - **Deadline and priority:** the deadline is required (IST date and time); picking a date sets the time to **6:00 PM**; a deadline already in the past is refused when the task is created. Priority defaults to **Medium**.
  - **Bulk is approve only**, at both the Admin and the Owner step. A rejection always needs a reason, so it lives behind Review (§4.7), one task at a time.
  - **No file uploads on tasks until phase 8** (work submissions). **Done carries an optional note, and the note may contain links (http or https)**, shown to the reviewer as tappable links, so work can be handed in as a Drive link until phase 8. A brief's links go in the description as text.
  - **Warnings** (never blocking, override recorded):
    - **Workload:** the person already has **4 or more open tasks due that same IST day**. The number is Owner-editable in Settings → Thresholds, and freelancers count.
    - **Overlap:** two event tasks of the same person whose times overlap. An event with a start time and no end counts as **1 hour**, and a date-only event never overlaps (it only adds to that day's workload).
    - **Leave:** approved leave, half day or comp leave on the deadline date or the event date, and also a **pending** request, shown as "Leave requested". A freelancer never triggers it.
  - **Reminders:** the create dialog has **no reminder editor** in phase 4; a task takes its type's default reminders, and the editor arrives with 5.3.
  - **Task types are the Owner's to edit** (like expense categories), because they drive the calendar, event fields and custom fields for everyone; Admins pick from them.
  - **Templates are shared by the whole company.** An Admin edits and archives the templates they created; the Owner edits any. A task's stages are typed on the task or come from a template; **there are no stage presets for tasks** (presets stay for projects, 7.4).
  - **Tasks tab, first glance:**
    - **Owner and Admins:** **"Needs you"** comes first: overdue, not noted past the escalation time, and waiting for your approval (which opens Approvals). Open tasks by deadline follow. The full list with filters is one tap deeper.
    - **Staff, "My tasks":** Not noted · Changes requested · Overdue · Due today · Upcoming (Kickoff 4 decision 25, owner 2026-09-30: Overdue moved up from last). A coordinator's freelancers' tasks are mixed in, labelled "for Asha".
  - **The task page (owner review, 2026-09-30, Kickoff 4 decisions 26–32):** first glance = the title, one line with the state, priority and a relative deadline (red once overdue), what is needed from you, and **only the next step** (Task Noted → Start work → Mark done, one at a time; Approve or Request changes for a reviewer; a sticky bar on a phone); everything else under ⋯. Below it, views that never add history: **Work** (brief, stages, the hand-in), **Chat** (comments; a full-height sheet on a phone, with an unread count per member, "Chat · 2 new"), **Activity** (newest five, then Show all; a run of ticks by one person is one line) and **Details** (people and their Task Noted, client, type, approval route, created by, fields; the right-hand panel on a desktop). Task rows in every list show unread comments. Every member is named by their **full name** everywhere (decision 30).
  - **Before phase 5 (notifications):** phase 4 is released first, so its notifications are rows and recipients named in the function comments, and delivery arrives with 5.1. Until then, the **Tasks tab badge** counts tasks not yet noted plus changes requested, and the **Approvals badge** includes tasks.

### 4.7 Dashboards and daily reports
- **Owner: Today** (actions first):
  1. Today at a glance: present, on leave, pending attendance, pending leave, pending task approvals, pending item approvals, due today, overdue, upcoming events, client work progress.
  2. **Approvals inbox** with one-click Approve, Reject, Review, Reassign and Extend deadline, plus bulk actions. There's no need to open other modules.
  3. People (attendance, login and logout, logout not recorded, overtime) · Today's tasks · Overdue and risks · Calendar strip · Client progress · Revenue snapshot.
     Tapping a person on the people board opens **their attendance and leave history** directly (People lives in the More sheet; looking someone up shouldn't take three taps while they're standing in front of you).
  - **First glance, then depth on Owner Today** (§2 principle 11's first application, decided 2026-09-24, **built in 6.2**): order is **counts → approvals inbox → "Needs you" → the rest of 6.2.** The attendance card's counts stay, and **tapping a count opens the full people board filtered to that group** ("Waiting" opens Approvals). Under it, **"Needs you"** lists only the people who need attention today: waiting for a decision, not chosen yet, absent, logout not recorded, overtime flagged; when nobody does, it says **"Everyone's in."** The full board (everyone expected today, 2.4) moves to its own drill-down screen behind **"See all N people"**, with the ARCHITECTURE §14.2 k back control. Tapping a person anywhere still opens their history directly.
- **The Approvals screen** (built across 2.4 and 4.5 — **one screen, not one per module**): everything waiting on the Owner's decision, in **one scroll, grouped, no tabs**. Tabs create a mode ("am I seeing everything?"); groups don't.
  - **Fixed group order: Attendance · Leave · Staff tasks · Client items.** Attendance and leave first because someone's day depends on them; work can wait an hour. Oldest first inside each group.
  - **Each group header carries a bulk action** ("Approve all 7"), because the Owner's real intent is usually *"attendance today, all fine"* — one tap, not seven. Bulk confirms with the count.
  - **Two actions per row, never more:** **Approve** (primary) and **Review**. Everything that needs thought — correcting, rejecting, a reason — lives behind Review and opens a sheet. A correction always asks for a reason; an approval never does.
  - **A single approve is instant with a 6-second Undo** rather than a confirmation; a mis-tap is recoverable and the common case stays fast.
  - **Filter chips appear only above ~20 waiting items.** Below that they are a mode to learn for no gain.
  - **Approve is a button, never swipe-only** (a gesture can't be the only route to the main action); status is a dot plus a word, never colour alone; an approved row fades in place without reshuffling the list, and the count is announced politely.
  - **Empty state is the reward:** "Nothing waiting. You're clear."
  - The **bottom-nav badge** shows the total waiting, so the bar answers "does anything need me?" without a tap.
  - The Admin's Approvals screen is the same component, scoped to what they may decide (the Admin step on their tasks).
- **Admin:** My clients (cycle progress) → client work pending → staff tasks needing attention → approvals → calendar → issues.
- **Staff: My Day** (very simple): attendance status, **Pending acknowledgement**, Today, Upcoming, Overdue, **Changes requested**, Upcoming events, a request-a-task button and Logout. Nothing else. (Kickoff 6: "Suggest a task"; the daily log out is End day in the strip, and "Sign out of this device" lives on Me, decision 3.)
- **Staff navigation** (decided in task 0.3): a bottom bar on phones with exactly five tabs, **My Day · Tasks · Calendar · Alerts · Me** until 5B; **built in 5B (2026-10-02): My Day · Tasks · Calendar · Leave · Me**, as below. **Updated by the owner 2026-10-01 for 5B (built after `v1.3.0`; PROGRESS "5B decisions"):** the Crew bar becomes **My Day · Tasks · Calendar · Leave · Me**; Alerts moves to the **bell in the top bar** with its unread count (as for the Owner and Admins); **Leave** opens Attendance & leave with two tabs ("Leave requests" | "Attendance", a comp-leave balance line when there is a credit); Me's "Attendance & leave" row becomes **"Extra work & expenses"** (two tabs, "Extra work" | "Expenses"); Me ends with a quiet **"Help & troubleshooting"** section (Send a test notification, Reload app, the app version). The Crew desktop sidebar: My Day · Tasks · Calendar · Attendance & leave · Extra work & expenses · Me, the bell at the top. Owner and Admin navigation is unchanged. "Me" holds the profile, appearance (light/dark) and **"Sign out of this device"**. Staff have no Clients, People, Approvals, Reports or Settings entries. Owner and Admin use a sidebar with Today, Approvals, Clients, Tasks, Calendar, People, Reports and Settings; the Admin's Settings shows only the lists, templates and custom fields they may edit (`PERMISSIONS.md` §1).
- **Owner end-of-day report:** generated automatically each day (and viewable live). It covers attendance and leave decisions, tasks completed, pending and overdue (with reasons), Admin and Owner approvals, logout times, overtime flags, and tomorrow's events. It's an operations report, not payroll.

- **Settled at kickoff 6 (owner decisions 2026-10-01, kickoff 6; "Kickoff 6 decisions" in PROGRESS; built in 6.1–6.3 and 6.5).** The third role reads **"Crew"** on every screen (`ROLE_LABELS`, PR #31); the role underneath stays `staff`.
  - **Crew: My Day (6.1).** Under the attendance strip: the **exception rows** in the Tasks tab's order (Kickoff 4 decision 25): **Not noted · Changes requested · Overdue · Due today**, a coordinator's freelancers' tasks mixed in "for Asha"; these never collapse to counts. Then **Upcoming as one line**, "N more in the next 7 days", opening Tasks. Then **events**: today's and tomorrow's event tasks as rows (time, title, location), then "N more this week" opening Calendar, and one quiet line for a holiday or the person's own approved leave in the next 7 days. Never anyone else's events. A neutral **"Suggest a task"** (the 4.6 dialog). **No sign-out row on My Day:** the daily "log out" is End day in the strip (since 3b) and "Sign out of this device" stays on Me. Empty: **"Nothing needs you today."**
  - **Owner: Today (6.2; changed by kickoff 6 decision 24, owner 2026-10-07, built in 6B).** **The attendance card, then exceptions only.** The card's counts: **Not started** (the old "Not chosen yet"), **Waiting for a decision**, **Present**, **On leave**, plus **Absent** and **End of day not recorded** only above zero; every count opens the full board on that group ("Waiting" opens Approvals) and the card's title opens the whole board. Colour by urgency: amber number and dot for "have a look" (Not started, Waiting) above zero, red number and dot for a problem (Absent, End of day not recorded) above zero, muted grey at zero, Present and On leave neutral; never colour alone. **There is no "Needs you" section and no "See all N people" row** (the Admin's Needs you, decision 9, stands). Every section after the card (Approvals, Today's tasks, Overdue and risks, This week) renders only with something in it; with nothing to show, one muted line: **"Nothing else needs you today."** On a risk row the "overdue by …" text is red as well as its dot. **The rule for every later addition to the Owner's Today:** *exceptions only (what's overdue, waiting or wrong); a count rather than a list where possible, one tap to the list; hidden when empty.* 6b's late count and My tasks, phase 7's client work and phase 9's revenue follow it. **Amended by the owner 2026-10-08 (unit 6B2):** the red **"End of day not recorded"** count is about **yesterday**: the days with a Start day and no End day, shown from the End-day cutoff (`org_settings.end_day_cutoff_time`, default 05:00 IST) through the rest of today; a person drops off once the Owner has decided that day (approved or corrected it); tapping it opens the people board filtered to those people **with yesterday's state** ("Yesterday, Wed 7 Oct: started, End day not recorded, not decided yet."). Today's own days never carry the flag (the 00:00 job sets it on the day that ended), which is why the count read only today and never showed. (As first built, before decision 24: counts → approvals inbox → "Needs you" → the rest, as above.) **Not shown until their data exists** (no "coming soon" tiles): item approvals and client work progress (added in 7.4), the revenue snapshot (phase 9). **The approvals inbox on Today** is a preview: the **oldest 5** waiting items in the Approvals group order, each with the same **two actions** (Approve with the 6-second Undo, and Review; Reject, Reassign and Extend deadline live behind Review), then **"See all N"** to /approvals; **no bulk on Today** (bulk stays on Approvals). **Today's tasks** is one line, "N due today · M handed in", opening All tasks filtered to today. **Overdue and risks** are rows (up to 5, then "See all"): overdue tasks; tasks not noted past the Owner escalation (`ack_escalate_owner_hours`, 8 h); an open task due today or tomorrow whose assignee is on approved leave that day; an assignee on open work who isn't reachable (5.4's **48-hour** status, never the live one; a freelancer through their coordinator); and **"N emails held back today by the daily limit"** when above 0, opening Settings → Thresholds (it leaves the digest when the digest turns weekly). The row **names the limit that held them**: the per-person cap (editable in Thresholds) or the org-wide one, which it states plainly is **the email plan's daily limit and can't be changed in Settings** (owner decision 2026-10-07; no new setting). "Not noted" counts on 5.3's Owner-escalation clock, so the row and the escalation agree. No scoring and no "risk level". Empty: **"Nothing overdue."** **The events strip:** today and the next 6 days, event tasks and holidays, up to 5 rows then "Open calendar", plus "N on leave" per day for the Owner. **A person's today line** above the tabs on `/people/[id]` (state, start and end times, overtime) is the **Owner's only**; an Admin sees no line.
  - **Admin: Today (6.3), before projects exist.** In order: the attendance strip → **Needs you** (the Tasks tab's definition: tasks to approve, suggestions to decide, overdue and not noted past the escalation on tasks they manage) → **My tasks** (the Admin's own assigned work, exception rows only) → **My clients** (each assigned client with its open and overdue labelled-task counts; cycle progress arrives in 7.3) → the **calendar strip** (as the Owner's, without the leave count) → **Issues**. **Issues** are rows for problems on their tasks that no other section shows: an assignee on approved leave on an open task's due or event date, and an assignee who isn't reachable (5.4's 48-hour status, on tasks the Admin created or approves; a freelancer through their coordinator); the section is hidden when empty. Needs you empty: **"Nothing needs you right now."**
  - **The Admin's work report (6.3)** is built now from the **task KPIs only**: Rework, My turnaround, Overdue now (tasks) and Acknowledgement lag, plus **Who is loaded this week**, each split by engagement (Kickoff 4 decision 18). On time, Cycle progress and "where items sit longest" are added in phase 7, when items exist.
  - **Live updates:** Today (Owner and Admin) and My Day update live through the bell's Realtime connection (ARCHITECTURE §10); other screens keep refresh-on-return.
  - **The end-of-day report (6.5)** covers the IST day that just ended: **attendance** (each person's start and end times, leave, proposed absences, end of day not recorded, overtime flags); **decisions made that day** (attendance, leave, comp leave, and expense claims as a **count**); **tasks** (completed = Owner-approved, handed in and waiting, overdue with the primary owner's late reason, cancelled, created); **approvals** (a count per approver at each step); and **tomorrow's events**; freelancers shown separately (§4.13). **It never carries money**, not even later (the table stays Owner-only; ADR-0007 amendment 2026-10-01). It is **saved at the End-day cutoff** (`end_day_cutoff_time`, default 05:00, Owner-editable; owner decision 2026-10-07: before it a late End day for yesterday is still allowed) **and never rewritten**; until then yesterday shows live with "Saves at 5:00 AM" (the setting's time); today is live; a past day shows only its saved copy. History under **Reports → End of day**, kept forever, one report for every day including days off. The Owner gets one notification, **"Yesterday's report is ready"**, when it is saved (quiet hours hold it until they end; WORKFLOWS §9).
  - **The weekly Owner digest (owner decision 2026-10-07, built in 6.5; until then the daily 08:00 digest stays exactly as built in 5B).** 08:00 IST on an Owner-set day (default **Monday**, Settings → Thresholds), or straight after the End-day cutoff saves the last day's report if that is later, covering the seven IST days before it; email only, Owner only, no money. The week's numbers come **only from the seven saved end-of-day reports**, each day linking to its report; then **now** (waiting requests, overdue, can't be reached) and **the week ahead** (approved and pending leave, event tasks, holidays). Skipped when every count is zero. "Emails held back" moves to the Owner's Today (Overdue and risks). "Yesterday's report is ready" stays the Owner's daily signal. **Amended by the owner 2026-10-08 (unit 6B2):** "one per week" is **"since the last digest sent, capped at seven days"**, so changing the digest day never skips a week: the digest covers the days from the last one's day to yesterday (at most seven), and goes on the first occurrence of the new day whether it moved earlier or later.

- **As built (6A, 2026-10-07; the details the kickoff left to the build).** **My Day:** a coordinator's freelancers' event tasks show with "For Asha", as their task rows do; "N more this week" counts the rest of the next seven days; the quiet line is the earliest of a holiday or the person's own approved leave in that week ("Holiday Fri 9 Oct: Dussehra", "Your leave tomorrow – Fri 9 Oct"); "Nothing needs you today." stands in for the exception rows only (Upcoming and events still show); the Owner has no My Day (/forbidden) and a Crew member who types /today is taken to My Day. **The Owner's Today:** "N due today · M handed in" counts the open tasks due today and those of them handed in (waiting for a decision), and opens All tasks on a new **Due today** deadline filter; an overdue task handed in waits in Approvals, not in the risks (as on Tasks); the risks read overdue → not noted → on leave → can't be reached, the first five then an in-place "See all N" (no new screen), with the held-emails row after them, outside the five; a "can't be reached" row says "No notification has reached them for 2 days" and opens Settings → Notifications; the approvals preview shows the groups' own rows (their headings, Approve with Undo and Review, no Approve all) and "See all N"; the full board has a group filter (Everyone, Waiting, Not chosen yet, Present, On leave, Absent; a view control); the events strip draws each holiday and event as a row under its day, the day carrying "N on leave" for the Owner, and says "Nothing on the calendar in the next 7 days." when empty; a person not expected today reads "Not expected today" on their line. **The Admin's Today:** Needs you holds what they answer for on the tasks they manage (to approve, suggestions, overdue, not noted past the escalation); their own notes and fixes are under My tasks, which leaves out a row Needs you already shows; My tasks and My clients (the clients they run, not closed) are hidden when empty; Issues use 5.4's scope (the open tasks they created or approve) for both kinds, the leave rows covering a deadline or event day from today to 62 days ahead (approved leave, half day or comp leave; never a pending request). **The work report:** Week (Monday–Sunday, IST) by default, Month, or Custom (up to 92 days, never past today), with a pager; Rework = changes requested ÷ hand-ins in the period, by the primary owner's engagement; My turnaround = the median hours from the reviewed hand-in to this Admin's own approval; Acknowledgement lag = the median hours to Task Noted for the notes tapped in the period, by the assignee's engagement; Overdue now opens All tasks on Overdue; Who is loaded this week = each person's open tasks due by Sunday (overdue included) and how many are overdue. **Live:** the day screens re-read on an insert or update (a delete is never listened to), not on the first join.

- **As built (6B, 2026-10-07): the end-of-day report and the weekly digest.** Reports → **End of day** lists today ("Live, so far"), yesterday ("Live · saves at 5:00 AM" until the cutoff, then "Saved 7 Oct, 5:00 am"), then every saved day newest first, 31 a page; a row opens the day. A day's report reads, in order: a holiday or weekly off line; **Attendance** (one line of counts: "6 present · 1 on leave · 1 absent (1 proposed) · 1 end not recorded · 1 overtime", then each employee's row: the status dot and word (Present, Leave, Absent (proposed), Leave · waiting), the Start and End day times, "End of day not recorded", "Overtime: <reason>"; a row opens their attendance history); **Decisions that day** as lines ("2 attendance decisions", "1 leave request approved", "1 comp leave taken back", "2 expense claims decided": counts, never an amount); **Tasks** as groups, each only when it has something (Completed, Handed in waiting, Overdue with "Late: <reason>" or "No late reason yet", Cancelled with its reason, Created; "3 · 1 freelance" when a freelancer's is among them; a row opens the task); **Approvals** per approver and step ("Approved 3 · Changes requested 1"); **Tomorrow's events** (the time, the place, the people). A day with nothing says "Nothing happened on this day."; a past day the job never saved says "Not saved yet". The live note under today reads "Live: today so far. It saves tomorrow morning." The notification "Yesterday's report is ready" opens the saved report with the list beneath. **The weekly digest email** ("Your week · 5 – 11 Oct"): one line per day of the week with its counts, each opening its saved report ("Wed 7 Oct: no report saved" for a missing day); the week's totals; **Now** (tasks waiting for your approval, attendance waiting for a decision, leave requests, extra work notes, expense claims, overdue now, can't be reached, each opening its screen); **The week ahead** (holidays, who is on or has asked for leave and when, the events with their time and place, opening the calendar's day or the task); "Nothing needs you this week." when empty (the job skips it then). **Settings → Thresholds** gains "Weekly summary · Sent on" (a weekday, Monday by default) under Quiet hours.

### 4.8 Calendar
- Day, week and month views of event tasks (shoots, site visits, meetings, postings and other timed tasks), approved leave, holidays and planned dates of client items.
- Filters: client, employee, task type, status.
- Helps spot conflicts and overloaded people. Admins see other people's work only as busy blocks.
- **Settled at kickoff 6 (owner decisions 2026-10-01, kickoff 6; built in 6.4; visibility in PERMISSIONS §2):**
  - **What each role sees.** **Crew:** their own event tasks (and those of freelancers they coordinate), their own leave (a pending request marked as requested), holidays and weekly offs; nobody else's. **Admin:** full detail for the tasks they can see; everyone else's events as **"Busy"** blocks with the person's name and the time only (no title, client or location; freelancers included); others' approved leave as **"On leave"** or **"Half day"** (no leave type, no pending requests); holidays. **Owner:** everything, leave by type and pending requests marked.
  - **Which tasks.** Event-type tasks (`task_types.shows_on_calendar`) at their event date and time. Ordinary deadlines appear only as a **"Due"** list in the day view and as a count in the week and month views, never as blocks. Cancelled tasks are hidden; completed ones are muted. The planned dates of client items are added in 7.3.
  - **Views and filters.** A phone opens on **Day** with a week strip; a desktop on **Week**; in **Month** a tap on a day opens that day. Filters: client, person, type and status for the Owner and Admins; **type only** for Crew. Changing the view, the day or a filter is view state and never adds history (ARCHITECTURE §14.2). An empty day: **"Nothing on this day."**
  - **The weekly digest's "week ahead"** (6.5) lists the same calendar data for the Owner: approved and pending leave, event tasks and holidays of the next seven days.
- **As built (6B, 2026-10-07; the details the kickoff left to the build).** The address carries the view, the day and the filters (`/calendar?view=day|week|month&date=…&client=…&person=…&type=…&status=…`); with no view in it a phone draws the Day and a desktop the Week from the same week's data (the width decides, nothing sniffs the device). **Day** = the chosen day's heading, then its rows: a holiday or weekly off, leave ("You · Half day", "Ravi · Leave", "· requested" while pending; an Admin's others "On leave" / "Half day"), the events in time order (the time or "All day", the title, the location, the client label, the people; a completed one muted and struck through), an Admin's **Busy** rows (the time and the name), then **Due** (every other open task due that day: the time, the title, its primary owner). **Week** = the seven days as sections, each with the same rows and its Due as a count ("3 due", opening the day). **Month** = a Monday-to-Sunday grid; a cell holds the date, the holiday's name and counts ("2 events", "1 on leave", "3 due") and opens its day. The **week strip** (Mon–Sun chips, today ringed, the chosen day filled, a dot under a day with something on it) sits above Day and Week; the pager steps a day, a week or a month by the view, with a "Today" link when away from it. **Which tasks are events:** a task with an event date whose type has `shows_on_calendar`; a date-only event reads "All day". **Status** filter: open and completed (default), open, completed (the Due list hides on "Completed"). An Admin's Busy blocks are `member_availability()`'s timed events (a date-only event of someone else has no block, as the 4.3 warnings) less any that match a task the Admin can see, so nothing shows twice; the Owner reads `leave_requests` in full and needs no blocks. Empty day: "Nothing on this day." A holiday or weekly off is never "nothing".

- **Settled at kickoff 6, decision 25 (owner-approved 2026-10-08, relayed by the advisor; supersedes decision 15's defaults and the parts of 14 it changes; built in 6.4b "Calendar rework", unit 6B2, after 6B and before 6C; reference: the owner's Samsung Calendar).**
  - A. PHONE (below 768 px): one swipeable calendar, no Day/Week/Month control.
    - Three snap sizes, changed by a vertical swipe on the calendar area or by tapping a visible handle bar under it:
    (1) Week: the week strip on top; the selected day's detail fills the rest.
    (2) Compact month: the month grid about half the screen, each day box showing only thin coloured bars (one per kind present), no text; the selected day's detail below.
    (3) Full month: the month grid fills the screen, with labelled strips (section C).
    Swipe down grows 1→2→3, swipe up shrinks. It opens in size (2), with today selected.
    - Tapping a day in (1) or (2) selects it, and the detail below changes. Tapping a day in (3) opens the day sheet (section D). Swiping left or right on the grid or strip moves a week or month.
    - Pull-to-refresh is disabled on /calendar (it keeps refresh on return and Realtime). Size changes and day selection are view state and never add history (§14.2). Back leaves the screen, or closes the day sheet. Reduced motion means instant size changes. The handle is a 44 px button with a label ("Show more of the month" / "Show less"), keyboard reachable.
    - Header row: the month name (e.g. "October 2026"), a Today button (a small calendar icon showing today's date number, which jumps to today) and a Filters button.
  - B. LAPTOP (768 px and up): keep the Day / Week / Month control; it opens on Month. Week becomes a 7-column hour timeline. Day is a one-column hour timeline. No subtitle under the title.
  - C. Inside each day box (month), Samsung-style strips, at most 3 then "+N", in this priority:
  - 1. Holiday: a green strip with its name.
  - 2. Shoots and site visits, then meetings (event-type tasks): a strip in the task type's colour, text = the task title. Laptop: "10:00 Brand reel · Client".
  - 3. Others' events, for Admins: a grey dotted strip "Ravi busy" (decision 13).
  - 4. Leave: a neutral grey strip "Asha off" ("½" for a half day), or "2 off" when several.
  - Tasks due get no strips: a small amber "3 due" in the corner, or a red "1 overdue" for a past day with open tasks. No shading for weekly offs or holidays; the weekly off's date number gets a distinct, non-red colour. Today has an outlined box. Strips never use red (red stays for overdue and commit actions, §14.1). Text never overflows its box.
    - Task type colours are DATA: a new task_types.color (expand-only migration, a curated palette with no red, defaults for the seeded types), edited in Settings → Task types (Owner), with pgTAP and RLS as usual. [Orchestrator note: DATA-MODEL already lists a `color` column on task_types — the builder checks whether it exists in the migrations and what it holds before adding anything.]
  - D. The day detail (phone sizes 1–2) and the day sheet (phone size 3; a popover or dialog on the laptop) show:
    - the holiday and leave line;
    - events with time, place and people (a row opens the task);
    - "Due · N" with the task list;
    - "Who's free" for the Owner and Admins: "Free: … · Busy 10–1: … · On leave: …", over the people they can see (team.view scope; freelancers through their coordinator, as in 4.x);
    - a "+ New task on 8 Oct" pill (Owner and Admins, tasks.create) that opens the task form with the date prefilled (an event type's event date, otherwise due on that date at 18:00 IST);
    - for Crew, "Suggest a task" (4.6) with the date prefilled instead.
  - The sheet has "Open day" on the laptop. Back closes the sheet.
  - E. Timelines (phone day detail, laptop Week and Day): hours 08:00–22:00 visible, the rest one scroll away, scrolled to now on today; a "now" line; event blocks at their times (no end time = a one-hour block; no start time = in the all-day row). The all-day row above the hours holds the holiday, leave and "Due · N".
  - F. Filters: one "Filters" button opens a sheet (client, person, type, status) and shows "Filters · N" when any are on. They're view state, never history.
  - G. Crew: the same calendar with only their own items (decision 13). No Busy strips, no "Who's free", "Suggest a task" instead of the pill.
  - H. Still fix the earlier bugs if they survive the rework: the phone Day header showing the week range, overflowing cells, "1 due" with "Nothing on this day.", the truncated Status filter.
  - Budget: /calendar's first load must stay within budget. Load the gesture and sheet code after the page if needed. Tests: unit tests for the strip priority and the "who's free" logic; e2e for the three sizes by drag and by handle, the day sheet's back gesture (installed mode, 375 and 430), the New-task prefill, Crew visibility and the filters sheet. No loosened tests.

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
> **Deferred past the launch** (owner, 2026-09-27; ROADMAP 8.3 and 8.4b). Until it lands, a pasted Drive link points at the person's **own** file (if they delete or unshare it, that version's content is gone), and uploaded originals stay in MaxOff storage with no retention cleanup; nothing is deleted before a Drive copy exists.

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
- **iPhone and iPad:** Apple only delivers push to an app added to the home screen. First login on iOS shows a short "Add MaxOff to your home screen" guide, and a banner stays until push works. In-app notifications and email work regardless. **As built (5.5, owner decisions 2026-10-03):** every new joiner's welcome screen has a short step card (on an iPhone in Safari: install, with pictures; then turn on notifications; then send a test and "Did it arrive?"), with **Later**; the installed iPhone app resumes it at "Turn on" when they sign in there. The band stays until a push has actually reached one of their devices and returns whenever they can't be reached, its words saying why. People who joined before see only the band. Me lists each device in plain words with its last notification, and **Remove** for the others.
- **Reminders:** configurable per task (default: 2 days before, 1 day before, due time, overdue). Unacknowledged tasks get **repeated** reminders at controlled intervals (default every 2 h), then **escalation** to the approving Admin or creator (default after 4 h) and then the Owner (default after 8 h). A task with nothing submitted 24 h past its deadline (configurable) escalates the same way. Never spammy.
- **Email is a real second channel for the few things that matter**, not only a fallback: **task assigned**, **escalations**, **invites**, the **Owner digest**, and **an event tomorrow** (shoot, site visit, meeting). Everything else is in-app and push only. The per-person daily cap keeps this inside the free allowance.
- **People stay signed in** (§4.2, owner decision 2026-09-27), so a device keeps receiving push in the evening and on days off, and a notification carries the **full detail** on the lock screen for Admins and Staff (they never hold money) and opens the record directly. **Amounts never appear in a notification's text**, not even the Owner's. A subscription is removed only when the person chooses **"Sign out of this device"** or the Owner deactivates them (which removes all of theirs).
- **Reachability is visible to management.** Settings → Notifications shows **who isn't reachable** and why: push never allowed, permission revoked, iPhone without the app installed, or repeated delivery failures. The Owner (and each Admin, for people on their tasks) can see it; anyone not reachable for 48 hours is flagged to the Owner by email (at most weekly per person) and counted in the Owner's morning summary. Nobody has to discover a silent phone by missing a shoot.
- **Test notification.** Anyone can send themselves one ("Send a test") and confirm it arrived. Setup is confirmed on day one instead of assumed, and it's part of onboarding a new joiner.
- **Owner decisions 2026-09-29 (kickoff 5; rules in WORKFLOWS "Settled at kickoff 5"):** push carries the full text always (no title-only); **quiet hours** 22:00-07:00 IST hold push and send one "N updates while you were away" summary at 07:00; email fallback only for actionable kinds, under a per-person cap of 20 and an **org-wide daily ceiling of 90**; a daily **Owner digest email at 08:00 IST** (no money; **weekly from 6.5**, owner decision 2026-10-07, §4.7); the enable-notifications banner is per member (one working device is enough), with a quiet "Turn them on here too" row on other devices; the bell counts unread and nothing is purged.
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
- **Exports** *(deferred past the launch, owner 2026-09-27)*: Markdown, CSV and PDF. The **Markdown export is designed for AI analysis**: an executive summary followed by dense, structured raw data (tables and IDs) that answers questions like *"Which stage takes longest?", "Who is overloaded?", "How much potential revenue wasn't achieved?"*
- **Freelancer work is shown separately** (ADR-0013): every count, duration and list that is per person carries the engagement type, and totals split employees from freelancers, so employee metrics are not diluted and freelancer output is visible on its own. **The split numbers** (owner decision 2026-09-28, kickoff 4), in the Admin reports (6.3) and the Owner's reports (9.3): **tasks completed, on-time %, acknowledgement lag, turnaround and rework count**, by engagement. The management task list filters by engagement; the month summary already leaves freelancers out (§4.18).
- Admins get operational reports for their own scope, with no money in them. These are computed live: the end-of-day reports and month snapshots contain revenue and are Owner-only.

**The Admin's report answers one question: is the work getting done?** (decided 2026-09-23). Six numbers and two lists — no more, or it stops being read. Each is for their assigned clients and the tasks they created, approve or are assigned to. Week, month or custom range, with last period beside it.

| KPI | Definition | What it tells the Admin to do |
|---|---|---|
| **On time** | Items approved on or before their planned date ÷ items with a planned date | Falling → the plan is wrong or the team is stretched |
| **Cycle progress** | Items done ÷ planned, and approved ÷ done, for the current cycle | A wide done-vs-approved gap means work is waiting on the Owner |
| **Rework** | Submissions sent back as *changes requested* ÷ submissions | Rising → briefs are unclear, not that people are careless |
| **My turnaround** | Median hours from a task's Done to **their own** approval | This is the Admin's own bottleneck, and the only KPI about them |
| **Overdue now** | Tasks past deadline + items past planned date, still open | The act-today number. Tap through to the list |
| **Acknowledgement lag** | Median hours from assignment to "Task Noted" | Rising → people aren't seeing work, check reachability (§4.11) |

Plus two lists: **who is loaded this week** (open and overdue tasks per person, from visible tasks only — workload, never a rating) and **where items sit longest** (the slowest stage, e.g. "8 reels waiting at Edit").

**Not in an Admin's report, ever:** money, attendance, leave, anyone's history outside their scope, saved snapshots, and the AI export. An Admin sees **work**; the Owner sees **people and money**. Attendance and leave are the Owner's decision, so handing an Admin that record would give them a judgement they have no authority over.

### 4.14 Activity history
> The **search screen** is deferred past the launch (owner, 2026-09-27); every action is still recorded exactly as below.

- An **append-only** log of every important action: who, what, which record, when, and old and new values. It can't be edited or deleted.
- Recorded in the same database transaction as the change. A change can't succeed without its audit record.
- The Owner can search by person, client, record, action type and date. Admins see activity within their own scope.

### 4.15 Global search
> **Deferred past the launch** (owner, 2026-09-27).

`Ctrl/Cmd + K` searches clients, people, tasks, projects, items and contacts, **only what the user is allowed to see**. Results are grouped by type and open the record directly.

### 4.16 Settings: the Owner's control centre
**Everything configurable in MaxOff is editable by the Owner, in one place, with no developer involved.** If a rule, list, threshold or label exists, the Owner can change it here. Admins get only the operational parts (lists, templates, custom fields).

- **Company:** name, logo, timezone (IST), **weekly off days** (currently Sunday), **holidays**, logout-reminder time, acknowledgement and escalation thresholds (Admin and Owner), overdue escalation, workload warning threshold, default reminder schedule, the **per-person** email daily cap (Settings → Thresholds), quiet hours. **The org-wide email cap** (`email_daily_cap_org`, 90, kept below the email plan's 100 a day) **is not on any screen, and Settings doesn't change it** (as built; owner 2026-10-07).
- **Team:** **Add person** chooses **Employee** (an invite by email) or **Freelancer** (no invite; pick the coordinator, §4.17); role, job title, name, coordinator, deactivate or reactivate (Owner). **Every member has a person page** (`/people/[id]`, owner decision 2026-09-27, kickoff 3): a **Profile** tab (name, role, job title, phone, avatar; Edit for the Owner with the edit pattern, ⋯ → Deactivate / Reactivate / Copy invite link) that anyone with `team.view` opens, and an **Attendance** tab (Owner only) once the person has joined and is not the Owner. The Owner edits their own row on /me only. **Avatars**: ≤ 5 MB, PNG / JPEG / WebP, original kept, a small preview made in the browser. **Job titles** are an editable list the Owner adds to freely (seeded with Video Editor and Graphic Designer).
- **Lists:** task types (with event behaviour, default reminders and fields), stage presets, and other lists.
- **Custom fields:** for clients, contacts, projects, items and tasks, globally or for one client. **Global client and contact fields are Owner-only; an Admin adds or archives fields scoped to one of their assigned clients only** (owner decision 2026-09-27, kickoff 3). A **required** field is enforced only when the form that shows it is saved (an older record shows "—" and saves once filled; no transition is ever blocked by a custom field). **Archiving** a field keeps its values, removes it from forms and shows it read-only under "Archived fields". **A field's type never changes once it holds a value** (archive it and add a new one); label, help, section, position and select options stay editable, and a select stores the option's key, so renaming an option rewrites nothing. Task and task-type fields arrive with 4.1. Fields on **projects and items are Owner-only** to define (there's no currency type, and this closes the "amount in a number field" loophole). **Number fields stay allowed on clients and contacts** (owner decision 2026-09-27, phase 3 review): the Owner is reminded instead. The field form shows "Admins can see this field. Amounts belong in project billing (Owner only)." whenever the type is number or the field is a client or contact field. The database checks every stored value against its field (type, options, size), so the API holds the same rules as the form.
- **Templates:** project templates and task templates.
- **Google Drive (Owner only):** connect or reconnect the company account, choose the archive root folder, and see the archive queue and any failures.
- **Storage:** how much MaxOff (R2) and Google Drive are using, with warnings before either runs low.

### 4.17 Freelancers
**A freelancer is a person without a login** (owner decision 2026-09-27, ADR-0013). Pixora gives work to editors and designers who are not employees, may never open MaxOff and must still be assigned, reminded, approved and reported like anyone else, with a true record of who did what.

- **Add person** in Team offers **Employee** (invite by email, as today) or **Freelancer**: name, job title, optional phone, and the **coordinator** instead of an email. No invite, no password, no session, ever, unless the Owner later decides to offer a tasks-only login (not in phase 4: kickoff 4, below); the record is designed so that would attach to it without moving any history.
- **Exactly one coordinator**, an active employee (Admin or Staff), chosen and changeable by the Owner; every change is kept with who, when and why. Deactivating a coordinator first asks where their freelancers go.
- **The coordinator acts on the freelancer's behalf from their own account**, only on the freelancer's tasks: "Task Noted", comments, stage ticks, uploads and links, Done (with the late reason), resubmit after changes. Screens say so wherever a person is named: **"Done by Ravi for Asha"**, "Noted by Ravi for Asha".
- **Assigning:** a freelancer is offered in the assignee picker like anyone else, marked *Freelancer* with the coordinator's name. The approval route is unchanged (§4.6); a freelancer is never an approving Admin and never a task creator.
- **Notifications** meant for the freelancer go to the coordinator, worded for them ("Asha's task *Reel edit* is due tomorrow").
- **No attendance, no leave, no day gate**, and the nightly attendance jobs never look at them (enforced in the database). They never appear on the Owner's people board.
- **A Staff coordinator still never sees client records**: the freelancer's tasks carry a client *label* at most, exactly like the coordinator's own.
- **Reports** show freelancer work separately (§4.13). **Payments** are out of scope for the pilot (§5).
- **Settled at kickoff 4 (owner decision 2026-09-28):**
  - **No tasks-only login in phase 4.** The record stays login-ready (ADR-0013 §7), and it is revisited after the full launch. If one is ever offered, a freelancer sees **their own tasks only**: Task Noted, comments and Done. They never see attendance, leave, clients or People.
  - **A freelancer can become an employee.** The Owner invites them, and the login attaches to the **same person record**, so their task history stays theirs. They become a permanent employee, their coordinator link is closed, and attendance starts the day after they join. An employee never becomes a freelancer: the Owner deactivates them and adds a new freelancer record.
  - **Coordinators:** any active permanent Admin or Staff. **One coordinator can look after many freelancers.** **The Owner can't coordinate**, because the Owner approves the work.
  - **Payments later** (phase 9 or later): a per-task amount or rate lives in an **Owner-only table read through `modules/revenue`**, never on the person record or the task. Nothing is built in phase 4.

---

### 4.18 Month summary and expense claims (Owner; decided 2026-09-27, phase 3b)
**Month summary.** For each person and each IST month, **live at any time** and as a **month report for the whole team**:

| Line | Meaning |
|---|---|
| Working days | Days in the month minus weekly off days and holidays |
| Days worked | Present days + ½ for each half day |
| Leave · Half days · Absent | Approved leave days · half-day leaves (½ each) · approved absences |
| Comp leave used | Days taken as comp leave (they never count against the person) |
| **Additional leave** | **Full leave days + ½ × half days + absent days**: the figure that can reduce pay |
| Days off worked | Its own line, never added to days worked |
| Overtime | Notes that month, and how many earned comp leave |
| Comp leave credits | Granted · used · expired |
| Expenses | Approved and not yet paid: total and count |

There's **no monthly paid-leave allowance** and **no salary in MaxOff**: the Owner works out pay from these figures. Admins never see the summary; freelancers are not in it.

**Expense claims (reimbursements).**
- Ending the day asks **"Any expenses to claim today?"** **No** ends the day; **Yes** asks for the **amount (₹)**, a **category** (an Owner-edited list, seeded Travel, Food, Materials, Other), a note and the date, several per day. Claims can also be added later from Extra work & expenses (Attendance & leave until 5B).
- A **receipt photo** is optional, **required above an amount the Owner sets** (default ₹500). Receipts are private and kept as taken.
- **Claim window:** an expense dated in the current month, or in the previous month during the **first 5 days** of the new one.
- The Owner **approves** or **rejects** (with a reason the person sees) each claim, and marks it **Paid** when it's paid with the salary. The person can withdraw a claim until it's decided.
- **Who sees claims:** the person sees their own; the Owner sees everyone's; **Admins never see anyone's**, not even their team's (ADR-0007 amendment 2026-09-27). Freelancers don't claim expenses in the pilot.

## 5. Out of scope for the prototype
**Freelancer payments** (owner decision 2026-09-27: out of scope for the pilot; when they come they are Owner-only money through `modules/revenue`, never on the person record) · GST invoice generation and invoicing · client login or portal · WhatsApp · native mobile app · timesheets or time tracking · social publishing · AI features inside MaxOff · HR leave policies and general leave balances (the only balance is Owner-granted comp leave, §4.3a) · task dependency engine · payroll and salary records (the Owner works out pay from the month summary, §4.18) · accounting integration · leads pipeline · client-facing financial reports · custom RBAC roles · multi-tenant SaaS (billing, sign-up, org admin).

**Deferred past the launch** (owner decision 2026-09-27; ROADMAP "Deferred past the launch"): the Google Drive archive (§4.10) with the Drive half of link submissions, exports (§4.13), the activity-history search screen (§4.14) and global search (§4.15). Nothing is dropped: they follow the launch, in that order.

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
- [x] **Admin reports: settled 2026-09-23** (§4.13). Six KPIs plus two lists, computed only from their assigned clients and visible tasks; work only, never money, attendance or leave.
- [ ] Existing clients, projects or people to import at launch.
