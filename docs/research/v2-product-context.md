# MaxOff — Consolidated Product Context & Prototype Specification (v2)

**Purpose:** This document consolidates the complete MaxOff discovery discussion between the product owner and senior-SDE review into one implementation-ready context for Claude Code. It supersedes conflicting assumptions in the original `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and earlier planning notes where this document explicitly differs.

**Product:** MaxOff  
**Company:** Pixora Clips  
**Initial deployment:** Internal-only operating system  
**Future possibility:** SaaS product for other agencies/companies, but NOT the current product goal  
**Organization timezone:** `Asia/Kolkata` / IST  
**Prototype posture:** Desktop-first responsive web app, PWA-ready, mobile-friendly for staff  
**Clients:** Internal records only; clients do not log in in the prototype

---

# 1. Core Product Vision

MaxOff is an **internal operations and control system for Pixora Clips**.

It is not primarily a generic project-management tool. Its main purpose is to give the CEO and team a reliable operational picture:

- Who is present, on leave, or has not submitted attendance.
- What each person is working on today.
- Which tasks are pending, due soon, overdue, or awaiting acknowledgement.
- Which client work is progressing or delayed.
- What shoots, site visits, meetings, and other time-sensitive activities are coming up.
- What work has been completed and approved.
- What Monthly Work, Projects, and Additional Work has been completed.
- What revenue is potentially achievable and what revenue has actually been achieved after CEO approval.
- How employees, roles, workflows, and work types are performing over time.

The software can become complex internally, but the complexity must be **role-specific**:

| Role | Interface philosophy |
|---|---|
| CEO | Full operational, financial, performance, approval and analytical control. Most complex interface. |
| Admin | Operationally powerful but simpler than CEO. No attendance/leave authority and no financial visibility. |
| Staff | Very simple. Focused almost entirely on assigned work, acknowledgement, updates, deadlines, reminders, submissions and logout. |

The product should collect rich backend data so the CEO can later export it and analyze it with AI tools such as Claude.

---

# 2. Product Principles

1. **Internal-first, SaaS-ready architecture.** Do not overbuild multi-tenancy now, but maintain a clean organization/workspace boundary in the data model.
2. **Operational visibility over feature quantity.** Every screen should help the team know what needs to happen next.
3. **CEO has final authority.** Attendance, leave, financial values and final task completion all require CEO control.
4. **Admin owns operations, not governance.** Admins manage clients and operational work but do not control attendance, leave or finances.
5. **Staff are execution-focused.** Give staff only the information/actions necessary to complete their work.
6. **Customization is data, not code.** Editable business lists, task types, deliverable types, job titles, fields, stages and templates belong in configurable data.
7. **Do not overcomplicate simple workflows.** Avoid unnecessary dependency engines, HR policy engines, time-tracking systems, or elaborate approval trees.
8. **Never silently destroy history.** Historical decisions and important actions remain traceable.
9. **Revenue is not operational progress.** Operational progress can exist before financial achievement; Achieved Revenue only occurs after final CEO approval.
10. **The same work can appear in different operational contexts, but billing categories remain distinct.** Monthly Work, Projects and Additional Work must remain separately identifiable.

---

# 3. Roles & Authority

## 3.1 Fixed prototype roles

Exactly three system permission roles exist in the prototype:

- `CEO`
- `Admin`
- `Staff`

Do not build custom RBAC roles in the prototype.

However, **job/designation titles are editable data** and are independent of the RBAC role.

Example:

- System role: `Staff`
- Job title: `Video Editor`

The CEO can edit a staff member's name and job title.

## 3.2 CEO

There is exactly **one CEO account** in the prototype.

CEO has complete access to:

- all clients
- all Admins
- all Staff
- all tasks
- all projects
- all Monthly Work
- all Additional Work
- all reports
- all financial information
- all attendance
- all leave
- final task approval
- client assignment to Admins
- user roles
- client Monthly Scope
- permanent deletion
- historical corrections
- performance data
- exports

CEO-only authorities:

- Attendance approval/rejection/finalization.
- Leave approval/rejection/modification/cancellation.
- Financial values and billing reference.
- Final approval of every task.
- Approval of Monthly Work deliverables for revenue eligibility.
- Manual revenue overrides.
- Permanent deletion.
- Final Project completion decision.
- Closed-month correction.

### Security correction

The CEO is one account and can be operationally managed directly by the owner, but **do not store a plaintext password in the database**. Use Supabase Auth/password hashing and a secure seed/bootstrap mechanism. If the owner wants to change it outside the UI, the change should be done through the secure authentication mechanism, not by storing a raw password in a normal application table.

## 3.3 Admin

Admin can:

- manage assigned clients
- manage client operational information
- manage Monthly Work deliverables for assigned clients
- create/assign/reassign tasks
- create/manage projects
- approve staff task completion before CEO approval
- change deadlines/reminders/scope/priority as permitted
- manage operational work
- view operational employee/task data
- view performance metrics available to management

Admin cannot:

- approve/reject/finalize attendance
- approve/reject/finalize leave
- see financial/billing amounts
- edit CEO-only notes
- override CEO approvals
- permanently delete records

Future state: There may be multiple Admins.

## 3.4 Staff

Staff can:

- log in from multiple devices
- trigger first-login attendance workflow once per IST day
- submit Present / Leave / Half-Day Leave / Compensatory Leave
- view assigned tasks
- explicitly acknowledge tasks as `Task Noted`
- add multiple comments/updates
- update task progress/status
- provide reasons when work is delayed/not completed
- upload optional work/proof files
- upload revised submission versions
- respond to revision feedback
- mark tasks Done
- manually log out
- respond to reminders
- request additional work

Staff cannot:

- create or assign actual tasks
- change assignee
- change deadline
- approve tasks
- approve leave
- approve attendance
- see financial amounts
- see unrelated client details
- see management performance analytics/ratings

---

# 4. Client ↔ Admin Relationship

Exactly **one Admin is assigned to each client**.

The CEO controls this assignment.

There may be many Admins across the company, but a client has only one current assigned Admin.

There is **no fixed Staff-to-Admin reporting hierarchy**.

Staff can be assigned work by CEO/Admin regardless of a strict staff-owner relationship.

The model is therefore:

```text
CEO
 ├── many Admins
 ├── many Staff
 └── many Clients
       └── exactly one current Admin

Staff ↔ Tasks ↔ Client (optional)
```

A Staff member may work on tasks belonging to clients managed by different Admins.

---

# 5. Authentication & Session Rules

- Invite-only system.
- No public signup.
- Clients never log in.
- Supabase Auth should be used.
- Initial authentication can use email + password.
- Multiple devices/sessions are allowed.
- Organization timezone is IST.

## First-login attendance trigger

On the employee's **first successful authenticated login of each IST calendar day**:

1. Create the daily attendance record if one does not exist.
2. Present the employee with the mandatory daily attendance choice.
3. The first choice must be completed before they can access the rest of the application.

Options:

- Present
- Leave
- Half-Day Leave
- Compensatory Leave

This is a first-login daily action, not a recurring action on every login.

Subsequent logins on the same day do not create another attendance record.

---

# 6. Attendance

Attendance has no working-hours restriction.

No office location restriction exists.

No fixed start/end work schedule exists.

The system records:

- first login timestamp of the day
- selected attendance state
- CEO approval state
- CEO approval/rejection timestamp
- any CEO feedback/correction
- logout timestamps separately

## Attendance state lifecycle

```text
First login
   ↓
Attendance submission
   ↓
Pending CEO approval
   ↓
Approved / Rejected
```

Only CEO can approve/reject/finalize attendance.

CEO may approve individual records or bulk-approve records.

### No login for the entire day

At **11:59 PM IST**, MaxOff checks active employees.

If there is no attendance/leave/compensatory-leave submission for that date:

```text
Absent — Pending CEO Approval
```

The CEO is notified.

Absence becomes official only after CEO approval.

### Attendance history

Never silently overwrite attendance history.

Any correction creates an auditable change record.

---

# 7. Logout & Overtime

Logout is manual.

When the employee clicks Logout:

- record the exact logout timestamp immediately
- do not wait for CEO approval to store the timestamp
- notify/review through the relevant workflow

If the user remains logged in unusually late, MaxOff should send a reminder around **8–9 PM IST**:

> You may have forgotten to log out. If you are done, log out; if you are working overtime, continue as required.

There is no fixed working-hours system.

Overtime should be handled as a simple flag/reason flow, not as a complex time-tracking module.

Do not invent a logout timestamp if the employee forgot to log out.

If necessary, flag:

`Logout Not Recorded`

for management follow-up.

---

# 8. Leave

Leave is intentionally simple.

Staff can submit:

- Leave
- Half-Day Leave
- Compensatory Leave

The employee provides the relevant reason/details as free text.

Do not build a complex HR leave-policy engine in the prototype.

CEO approval is required for:

- current leave
- future leave
- compensatory leave
- half-day leave
- leave modifications
- leave cancellations/removals

Employees may request changes.

Changes do not overwrite history.

An approved leave can only be changed through CEO intervention.

### Important simplification

Do not enforce a “must request one day prior” rule. Leave requests remain open and may be submitted even for the current day, subject to CEO approval.

---

# 9. Core Daily Workflow

The central CEO operational flow is:

```text
TODAY
│
├── PEOPLE
│   ├── Present
│   ├── Leave
│   ├── Compensatory Leave
│   ├── Absent / Pending approval
│   └── Login / Logout information
│
├── TASKS
│   ├── Pending acknowledgement
│   ├── Today's tasks
│   ├── Due soon
│   ├── Overdue
│   ├── Awaiting Admin approval
│   └── Awaiting CEO approval
│
├── CLIENT WORK
│   ├── Monthly deliverables progress
│   ├── Projects
│   └── Additional Work
│
├── CALENDAR
│   ├── Shoots
│   ├── Site visits
│   ├── Meetings
│   └── Other dated work
│
└── ALERTS / APPROVALS
```

CEO dashboard must be action-oriented.

Actions can include:

- Approve
- Reject
- Review
- Reassign
- Extend Deadline
- Give Feedback
- View Details

---

# 10. CEO Dashboard

CEO gets a centralized Daily Operations Dashboard.

## Top section: Today at a Glance

Show compact summaries such as:

- Present
- On Leave
- Pending Attendance Approvals
- Pending Leave Approvals
- Pending Task Approvals
- Tasks Due Today
- Overdue Tasks
- Upcoming Events
- Client Work Progress

## Actionable sections

Follow the summary with items requiring direct attention.

CEO should not need to navigate through multiple modules for common approval actions.

---

# 11. End-of-Day Report

MaxOff should automatically produce a CEO End-of-Day Operations Report covering:

- attendance/leave decisions
- task completion
- pending tasks
- Admin approvals
- CEO approvals
- overdue tasks
- delayed tasks + employee reasons
- logout times
- overtime flags
- next-day important events/reminders

The report is an operational report, not a payroll system.

---

# 12. Task System

Only CEO and Admin can create actual tasks.

Staff can request a new task, but a request is not itself a task until approved/created by management.

Tasks can be:

- client-linked
- independent/internal

When created from a client page, the client is automatically selected.

## Required task assignment information

A task can include:

- title
- description
- client (optional)
- work classification
- task type
- project (optional)
- assignee(s)
- primary owner (when multiple assignees)
- deadline date/time
- priority
- reminder schedule
- optional stages/subtasks
- comments
- optional files
- notes/custom fields

## Work classification

Task/project work must be distinguishable as:

- Monthly Work
- Project Work
- Additional Work

Monthly Work = within agreed recurring client scope.

Project Work = separately billed project work.

Additional Work = outside agreed monthly scope and tracked separately.

These remain distinct for billing/reporting.

---

# 13. Task Types

Prototype task types should include:

- Normal Task
- Shoot / Site Visit
- Meeting
- Posting
- Review / Approval
- Other
- Custom Task

The list should remain configurable as data.

Custom Task allows additional fields when necessary.

## Shoot / Site Visit fields

Support:

- client
- date
- optional time
- location/address
- assigned staff
- purpose/notes
- configurable reminders

Typical reminder example:

- 2 days before
- 1 day before
- event day

---

# 14. Task Status

Use a simple common status system:

- Pending
- In Progress
- Done
- Overdue
- Cancelled

Specialized stages exist only where appropriate.

Do not build task-to-task dependency graphs.

Optional subtasks/stages are allowed.

Example:

```text
Script → Shoot → Edit → Review → Post
```

Subtasks/dependent steps should remain optional.

---

# 15. Task Priority

CEO/Admin can choose:

- Low
- Medium
- High
- Urgent

High/Urgent can receive stronger reminders/visual emphasis.

---

# 16. Task Deadlines

Task deadlines use **exact date + time**.

No date-only task deadlines are required for the prototype.

All deadline logic uses IST.

A task becomes **Overdue immediately after the exact deadline passes** if it has not received final CEO approval.

Example:

`20 Sep, 6:00 PM` → overdue beginning after 6:00 PM if not finally approved.

---

# 17. Task Acknowledgement

Every assigned employee must explicitly acknowledge the task.

Button/action:

`Task Noted`

This is a deliberate acknowledgement and must record:

- employee
- timestamp
- task

If a task has multiple employees, **every assigned employee must mark it as noted**.

Management sees acknowledgement status for each assigned employee.

Unacknowledged tasks trigger repeated reminders.

If an employee does not acknowledge within the configured threshold, the issue escalates to management.

---

# 18. Multiple Assignees

Tasks support multiple assigned employees.

One person is the **Primary Owner**.

Other assignees are Participants/Collaborators.

Every assigned employee receives the task and reminders.

Every assigned employee must acknowledge it.

The primary owner is responsible for overall task completion/submission.

---

# 19. Task Progress & Updates

Employees are responsible for:

- updating progress
- adding comments/updates
- marking the task Done
- responding to feedback

Employees can add **multiple timestamped comments** throughout the task lifecycle.

Comments are visible to CEO and Admin.

Comments remain part of task history.

If the employee does not complete a task by the deadline, they must provide a reason/feedback explaining why it was not completed.

---

# 20. Task Completion Approval

Every completed task follows the same approval chain:

```text
Staff
  ↓
Marks Done
  ↓
Admin Approval
  ↓
CEO Approval
  ↓
FINAL COMPLETION
```

No task is finally considered completed until CEO approval.

This rule applies to **every task**.

There are no approval exceptions in the prototype.

## Admin rejection

If Admin rejects a Done submission:

```text
Admin rejects
   ↓
Changes Required / Not Approved
   ↓
Employee receives reason
   ↓
Employee addresses feedback
   ↓
Employee resubmits
   ↓
Admin Approval
   ↓
CEO Approval
```

Admin rejection must include a reason.

## After Admin Approval

Employee is locked from editing the task.

Only CEO/Admin can reopen/correct it.

---

# 21. CEO Task Approval

CEO supports both:

1. Individual detailed review/approval.
2. Bulk approval for straightforward completed tasks.

Bulk approvals still create separate audit/approval records for every task.

CEO may approve or reject.

A rejection must include a reason.

---

# 22. Task Changes After Acknowledgement

CEO/Admin may change:

- assignee
- deadline
- scope
- priority
- reminders

after a task has been acknowledged.

Every change records:

- who changed it
- when
- old value
- new value

Affected employees receive notification explaining the change.

---

# 23. Task Cancellation

CEO/Admin can cancel a task.

Cancellation requires a reason.

Cancelled tasks:

- stop future reminders
- remain in history
- remain reportable
- retain who cancelled it and when

No permanent deletion through normal task workflows.

Permanent deletion is CEO-only and should be exceptional.

---

# 24. Task Timing / Duration

Do NOT build a complicated time-tracking module.

Retain useful timestamps:

- Assigned At
- Acknowledged At
- Done At
- Admin Approved At
- CEO Approved At

For a task where “time taken” is useful, a rough duration can be derived from the relevant context, such as login-to-task-done for a day-specific event/work item.

The system should favor **simple elapsed-time estimates** over a stopwatch/timesheet product.

---

# 25. Task Templates

CEO/Admin can create reusable Task Templates.

Templates may include:

- default stages
- default reminders
- default priority
- default fields
- task type

When used, generated tasks remain editable.

Templates must not lock:

- client
- assignee
- deadline
- billing classification

---

# 26. Project System

Projects are a separate first-class work type.

A Project can be:

- client-linked
- independent/internal

The client field is optional.

Projects contain Tasks only.

Projects can also exist independently without client attachment.

## Project hierarchy

Allowed structure:

```text
Monthly Work
   └── Project
         └── Task
```

and:

```text
Independent Project
   └── Task
```

Also:

```text
Standalone Task
```

No Project under a Task.

No Task containing a Project.

No task-to-task dependency engine.

## Project fields

Project should support:

- name
- client (optional)
- description/notes
- status
- progress
- tasks
- optional CEO-only billing amount
- template reference (optional)

No project-level dates are required.

## Project statuses

- Open
- In Progress
- Completed
- Cancelled

Project completion is a **manual CEO decision**.

It must not automatically close because all tasks are done.

CEO can keep it open, complete it, or reopen it.

---

# 27. Project Templates

CEO/Admin can create reusable Project Templates.

Templates can contain:

- predefined tasks
- stages
- reminders
- default settings

Generated project remains editable before activation.

---

# 28. Monthly Work

Monthly Work is the recurring work agreed with the client.

Example:

```text
Client A
12 Reels
4 Posts
```

Monthly Work is separate from Projects and Additional Work.

Monthly Work should not depend on employee task assignments.

## Critical separation

The client’s Monthly Work tracker is maintained independently from the Staff task system.

Example:

```text
CLIENT MONTHLY TRACKER
12 Reels
8 completed
4 pending

STAFF TASK SYSTEM
Rahul → Edit Reel 4
Sneha → Shoot Reel 5
```

Staff task completion must **not automatically update** the client Monthly Work tracker.

The assigned Admin maintains the client tracker.

CEO has complete visibility and can correct/override it.

---

# 29. Monthly Scope

Each active client has a configurable Monthly Scope.

Example:

- 12 Reels
- 4 Posts
- other recurring deliverables

Scope may have:

- deliverable type
- quantity
- recurring behavior
- optional dates
- stage structure
- relevant configuration

The CEO owns the recurring Monthly Scope.

Admin manages generated monthly deliverables but cannot change the underlying recurring scope.

Changes to scope are effective from a selected month onward.

Past/current already-created monthly data should not be silently rewritten by a future scope change.

---

# 30. Monthly Scope Change History

Only a **summary** is required.

Show:

- effective month
- brief change summary
- date
- CEO responsible

Do not build a complicated full version-history UI for scope in the prototype.

Underlying audit history can still preserve important changes.

---

# 31. Monthly Deliverables

Every monthly deliverable is an individual item.

Example:

```text
Reel 1
Reel 2
...
Reel 12

Post 1
...
Post 4
```

Do not track only aggregate values.

The system may summarize them:

`8/12 Reels complete`

but each Reel/Post is an individual record.

Each individual deliverable can have:

- planned date/deadline (optional)
- status
- progress
- stages
- notes
- relevant metadata

---

# 32. Monthly Deliverable Stages

Stages should be configurable based on deliverable type.

For video example:

```text
Script
Shoot
Editing
Posted
```

Each stage has a selectable completion/status state.

For image deliverables:

```text
Shoot
Editing
Posted
```

No Script stage.

The stage list is customizable.

Do not force the same workflow on every deliverable type.

---

# 33. Monthly Deliverable Administration

Assigned Admin directly updates each client monthly deliverable.

No Admin approval workflow is required for client deliverables.

CEO has:

- full visibility
- ability to correct/override
- approval authority for revenue eligibility

Important distinction:

```text
Admin completion = operationally complete
CEO approval = final complete / revenue eligible
```

---

# 34. Monthly Recurrence

For Active clients, recurring Monthly Work is generated automatically:

**1st of every month at 12:00 AM IST**

based on the client’s current recurring Monthly Scope.

Paused/Inactive/Completed clients generate no new recurring Monthly Work.

CEO/Admin can manually generate/regenerate a month when needed.

---

# 35. Monthly Carry-Forward

At month-end, any Monthly Work not finally approved by CEO is highlighted.

CEO can choose:

- Carry Forward to Next Month
- Close/Drop
- Leave Pending

Carried-forward work:

- remains a separate Carry-Forward item
- does not inflate the new month’s normal scope
- does not inflate the new month’s normal planned revenue
- retains its original month/history/billing context

Dropped work is closed rather than silently deleted.

---

# 36. Revenue Model

Financial information is **CEO-only**.

No Admin or Staff role can see:

- billing amounts
- billable values
- revenue reports
- financial totals

## Work categories

There are three major categories:

1. Monthly Work
2. Project Work
3. Additional Work

Each category can have a CEO-entered billing value.

---

# 37. Monthly Work Revenue

CEO can define either:

### Option A — individual deliverable values

Example:

- Reel = ₹X
- Post = ₹Y

MaxOff calculates achieved revenue from individually approved deliverables.

### Option B — one total monthly amount

Example:

`₹60,000` for the whole monthly package.

If no individual values are provided, MaxOff proportionally/evenly allocates the total across the planned deliverables using a simple rule.

Example:

12 Reels, 4 Posts = 16 deliverables.

If 6 of 12 Reels are completed and the Reel allocation is half of the total, achieved revenue reflects 50% of the Reel allocation.

The CEO can override this calculation.

---

# 38. Project Revenue

CEO can define:

- fixed Project amount, OR
- individual task/deliverable amounts

If individual amounts exist, use those values.

If only total amount exists, proportionally allocate across project work items.

Show CEO-only:

- Potential Revenue
- Achieved Revenue
- Remaining Revenue

Project revenue is counted only after CEO approval of the relevant work items.

---

# 39. Additional Work Revenue

Additional Work uses **manual CEO billable amounts**.

No proportional automatic calculation is needed.

CEO can enter/edit an amount at any time.

The amount is reference information unless/finally tied to approved work.

Additional Work revenue becomes Achieved Revenue only after final CEO approval.

---

# 40. Revenue Recognition Rule

This is the central financial rule:

```text
Staff Done
   ↓
Admin Approved
   ↓
CEO Approved
   ↓
Revenue Eligible / Achieved
```

Employee Done alone does not generate revenue.

Admin approval alone does not generate revenue.

Partial stage completion does not generate partial revenue.

For the prototype, revenue is recognized at the individual work-item level only after final CEO approval.

Operational progress may be 70%, but financial achievement remains zero until the qualifying work item is CEO-approved.

---

# 41. CEO Revenue Override

CEO can manually override system-calculated Achieved Revenue.

Store:

- original calculated value
- CEO-adjusted value
- optional note
- date/time
- CEO

Reports must distinguish:

- System Calculated
- CEO Adjusted

Do not erase the original calculation.

---

# 42. Billing Status

MaxOff is **not an invoicing system** in the prototype.

CEO may maintain simple internal billing status such as:

- Not Billed
- Billed

Optionally:

- billing date
- note

Do not generate/send invoices yet.

---

# 43. Additional Work Reporting

CEO should be able to view an Additional Work report containing:

- client
- task/work item
- assigned employee(s)
- work completed
- assigned timeline/deadline
- actual days/time taken (rough/simple estimate)
- notes
- optional billable amount

The billable amount is visible only to CEO.

No automatic invoice total is required.

---

# 44. Client Overview

Each client gets one central overview page.

Sections should include:

- Client Details
- Assigned Admin
- Client Contacts
- Google Drive Assets Link
- Monthly Scope
- Monthly Deliverables
- Projects
- Additional Work
- Reports/History
- Activity

Financial information is CEO-only.

Staff should not receive the complete client record.

---

# 45. Client Details

At minimum support:

- name
- legal/business details where needed
- address
- GST/GSTIN
- contact details
- website
- notes
- assigned Admin
- requirements
- custom fields

Client can have **multiple contacts**.

Only the minimum required fields should be mandatory.

A single Google Drive asset link should be available in the client record.

Clicking the link should open the client’s external Google Drive location.

No requirement to integrate deeply with Google Drive in the prototype.

---

# 46. Client Custom Fields

Client custom fields are supported.

Do not create ad-hoc hard-coded columns for every possible client-specific field.

Use the existing customization engine.

Examples:

- industry
- custom account requirements
- workflow notes
- client-specific metadata

---

# 47. Client Lifecycle

Use:

```text
Draft
 ↓
Active
 ↓
Paused
 ↓
Completed / Inactive
```

A client becomes operational after required details and Admin assignment are present.

CEO can activate/pause/close.

If Paused:

- existing data remains
- existing work remains visible
- future recurring Monthly Work stops

If Completed/Inactive:

- history remains searchable
- new work cannot be created unless CEO reactivates

---

# 48. Calendar

Provide Day / Week / Month views for date-based work/events.

Relevant event types:

- Shoot
- Site Visit
- Meeting
- Posting
- other dated task types

Filters:

- client
- employee
- task type
- status

The CEO/Admin calendar should help identify:

- upcoming work
- conflicts
- employee overloading

---

# 49. Conflict & Workload Warnings

When creating/assigning a task:

- warn about overlapping time-based assignments
- warn about unusually high same-day workload
- warn if assigned employee has approved leave on the relevant date

CEO/Admin can intentionally proceed despite warnings.

Warnings can be recorded in task history when overridden.

Do not block assignment automatically.

---

# 50. Notifications

All notifications are mandatory.

Users cannot disable, mute, or block MaxOff notifications at the application level.

However, notifications should only go to **relevant recipients**, not literally everyone.

Examples:

- Task assigned → assigned employee + relevant management
- Task acknowledgement missing → employee, then Admin/CEO escalation
- Leave request → CEO
- Attendance approval → CEO
- Employee task changes → affected employee
- Upcoming assigned shoot → assigned staff + relevant management
- Financial update → CEO only

Notification system should have:

- in-app notifications
- browser push notifications
- notification history
- deep links to relevant records/actions
- mandatory delivery logic
- escalation logic

---

# 51. Notification Technology

Preferred initial approach:

**Native Web Push + Service Worker + VAPID**

Behind a `NotificationService` abstraction.

Future mobile app can later plug in FCM/APNs or another provider without rewriting core business logic.

MaxOff should be PWA-ready from the beginning.

If browser push permission is unavailable, in-app notifications still operate.

Email should be available as a fallback/secondary delivery path if browser push is unavailable or operational notifications need a stronger fallback.

Preferred email infrastructure can use the existing planned transactional-email service (e.g. Resend/SMTP).

WhatsApp can be added later; it is not required for the prototype.

---

# 52. Reminder & Escalation Rules

CEO/Admin can configure reminders per task.

Default examples:

```text
2 days before
1 day before
due date
overdue
escalate after configured threshold
```

Special tasks can have custom reminder patterns.

Unacknowledged tasks should generate repeated reminders.

Overdue/unresolved tasks escalate to relevant Admin/CEO after the configured threshold.

Do not spam users every few minutes. Use controlled repeated reminders.

---

# 53. Employee Workspace

Employees get a simple **My Day / My Tasks** dashboard.

Sections:

- Today
- Upcoming
- Overdue
- Pending Acknowledgement
- Pending Revision
- Upcoming Events

Prominent action items should be obvious.

Employees do not receive performance ratings or analytics.

---

# 54. Employee Visibility

If a task is linked to a client, Staff should see only:

- client name
- task-specific information necessary for execution

Staff should not see:

- GST
- financial values
- billing information
- internal CEO notes
- unrelated client records

---

# 55. Employee Performance Visibility

CEO and Admin can view raw metrics such as:

- completed tasks
- overdue tasks
- average completion time
- rejected submissions
- attendance history
- overtime
- acknowledgement delays
- workload

Employees do not receive performance analytics/ratings.

Do not build an automatic Good/Bad/Underperforming score.

Raw metrics are preferred.

Reports can support:

- Week
- Month
- Custom date range

---

# 56. Task File Upload / Online Review

Staff can optionally upload their completed work directly to a task.

Use Cloudflare R2/object storage.

Do not route large media files through the Next.js application server.

Preferred architecture:

```text
Browser
  ↓ direct/resumable upload
R2
  ↓
MaxOff stores metadata
```

Store metadata such as:

- file name
- type
- size
- task ID
- uploader
- timestamp
- storage path

CEO/Admin can:

- preview supported files
- review
- download
- comment
- approve
- request changes

---

# 57. File Versioning

Task submissions are versioned.

Previous submissions are not deleted when a new version is uploaded.

Workflow:

```text
Version 1
 ↓
Review
 ↓
Changes Required
 ↓
Version 2
 ↓
Review
```

Retain:

- file version
- uploader
- timestamp
- reviewer
- comments
- decisions

---

# 58. File Requirement

File/proof upload is **optional** for every task.

Do not require an upload before marking Done.

The employee may upload when the work benefits from review.

---

# 59. Storage Constraints

Initial file behavior should support common:

- images
- videos
- PDFs
- common documents
- common design/project files

Prototype target: up to approximately **2 GB per file**, using direct/resumable object-storage upload.

No complex media transcoding is required initially.

---

# 60. Monthly/Company Reporting

CEO-only reporting should include:

- Potential Revenue
- Achieved Revenue
- Remaining Revenue
- Monthly Work completion
- Project progress
- Additional Work
- overdue/delayed work
- employee workload/performance metrics
- operational trends

Exports:

- Markdown
- CSV
- PDF

The Markdown export should be **machine-readable and information-dense**, primarily intended for feeding into AI tools such as Claude.

Human readability is useful but secondary.

The report should contain as much relevant underlying detail as practical.

---

# 61. Historical Monthly Reports

Every closed month should have a historical snapshot.

Past snapshots should not silently change if current operational data changes later.

Historical reports support month-to-month comparison.

Compare:

- revenue
- completion
- delays
- employee metrics
- workload
- operational trends

---

# 62. Closing a Month

CEO can close a month.

Closing creates the historical snapshot.

If an error is found later:

- CEO may use a simple explicit correction action
- preserve prior snapshot
- record that a correction occurred

Do not build an elaborate accounting adjustment framework.

---

# 63. AI Export

CEO monthly export should contain both:

1. executive-level summary information
2. detailed structured/raw operational data

The detailed machine-readable part is important because the CEO intends to feed the exported Markdown into Claude to answer questions such as:

- Which employees are performing strongly/weakly based on raw metrics?
- Which workflow stage is taking too long?
- Which role may need hiring?
- Which client work is at risk?
- Which service is consuming too much operational effort?
- What revenue was potentially available?
- What revenue was actually achieved?
- What work remained incomplete?

Do not have MaxOff itself generate subjective employee ratings initially.

---

# 64. CEO Financial/Performance Complexity

The CEO UI can intentionally be more complex because it is the analytical control layer.

Admin UI should hide financial complexity and focus on operational execution.

Staff UI should be very simple and action-oriented.

This is not a defect; it is deliberate role-based UX.

---

# 65. Global Search

Provide a global search, e.g. `Ctrl/Cmd + K`.

Search authorized:

- clients
- employees
- tasks
- projects
- deliverables
- contacts
- other important records

Results should be grouped by record type and open the selected item directly.

Respect permissions.

---

# 66. Activity / Audit History

Maintain an immutable/tamper-resistant Activity History for important actions.

At minimum record:

- user
- action
- affected record
- timestamp
- old value/new value when relevant

Events include:

- task creation
- assignment
- reassignment
- deadline changes
- priority changes
- reminder changes
- comments
- Done submission
- Admin approval/rejection
- CEO approval/rejection
- attendance actions
- leave actions
- scope changes
- client assignment changes
- revenue overrides
- project changes
- important file actions

No silent modification of history.

---

# 67. Activity Search

CEO can search/filter Activity History by:

- user/employee
- client
- task/record
- action type
- date range

Admins can see only authorized operational activity.

---

# 68. Data Deletion

Default principle:

**Archive, do not delete.**

Permanent deletion is CEO-only.

Deleted/cancelled/closed business records should remain historically visible where appropriate.

Permanent deletion should be exceptional and explicit.

---

# 69. Client Deliverable Deletion

Admin should not permanently delete a monthly deliverable.

Use cancel/close/remove-from-current-work with a reason.

CEO has permanent deletion authority if genuinely necessary.

---

# 70. Data Backup & Recovery

Use Supabase/Postgres backup features.

Use R2 object protection/retention where appropriate.

Nightly backups and tested restore remain a production requirement.

At minimum, perform a restore drill before launch and periodically afterward.

---

# 71. Real-Time Updates

Use Supabase Realtime where operationally valuable.

Important real-time areas:

- dashboards
- approvals
- notifications
- task changes
- comments
- operational status changes

The user should not need to manually refresh for common management workflows.

---

# 72. Responsive UX

Prototype is desktop-first.

Staff experience must be good on mobile browsers.

CEO/Admin operations are optimized for desktop.

Target:

- responsive at 375px+
- accessible
- loading/empty/error/permission-denied states
- keyboard-friendly where practical
- fast operational navigation

PWA-ready from day one.

---

# 73. Recommended Technical Architecture

Retain the original decision to use a **modular monolith**.

Recommended conceptual structure:

```text
Next.js App Router
        ↓
UI / Server Actions
        ↓
Domain / Module Layer
        ↓
Repositories / Data Layer
        ↓
Supabase Postgres + Auth
        ↓
R2 for files
```

Core principles from the original architecture remain valid:

- modules isolated under `src/modules/<module>/`
- shared cross-cutting services under `src/core/`
- database access only through data/repository layers
- Zod input validation
- permission checks server-side
- RLS in Postgres
- append-only migrations
- no `any`

---

# 74. IMPORTANT Architecture Corrections from Original Blueprint

The original repository was well structured, but this discovery changes several areas.

## A. Full multi-tenancy is NOT required now

Add a clean organization/workspace boundary to the data model for future SaaS-readiness, but do not implement a complicated multi-tenant product now.

## B. Original Owner/Admin/Member terminology must change

Use:

- CEO
- Admin
- Staff

Job titles remain editable data and are not RBAC roles.

## C. Monthly Work must not automatically generate employee tasks

The original product concept allowed templates/deliverables to turn into tasks.

For this MaxOff version:

**Client Monthly Work tracking is separate from employee task assignment.**

## D. Project dates are not required

Projects do not need start/end dates at the prototype level.

Tasks hold the operational deadlines.

## E. Project completion is manual

Do not auto-complete projects from task completion.

## F. Time tracking is intentionally simplified

Do not build a full timesheet/stopwatch module.

## G. Attendance/leave is now core MVP functionality

The original Product spec treated some HR features more lightly; MaxOff now needs attendance/leave as a first-class core workflow.

## H. Revenue is now core CEO reporting

The original roadmap pushed invoicing later. Full invoicing remains later, but **CEO-only revenue estimation/achievement tracking is now core MVP**.

## I. Notifications are core MVP

Native Web Push + in-app notifications are now core, with escalation.

## J. Task approval is mandatory

Every task must flow through Admin Approval → CEO Approval.

## K. Monthly Work revenue approval is also CEO-controlled

Admin can mark deliverables operationally complete, but CEO approval is required before they count as Achieved Revenue.

---

# 75. Recommended Database Entity Set

Exact naming can be refined by Claude, but the conceptual entities should include:

## Identity & permissions

- `organization`
- `members`
- `roles`
- `permissions`
- `role_permissions`
- `job_titles`

## Core client domain

- `clients`
- `client_admin_assignment` or equivalent one-current-admin relationship
- `client_contacts`
- `client_services`
- client custom-field values

## Monthly work

- `monthly_scopes`
- `monthly_scope_change_summaries`
- `monthly_periods`
- `monthly_deliverables`
- `monthly_deliverable_stages`
- carry-forward references

## Projects

- `projects`
- `project_tasks`
- project status/configuration entities if needed
- `project_templates`
- template tasks/stages

## Tasks

- `tasks`
- task assignees
- primary owner
- acknowledgement records
- task comments
- task status/history
- task approval records
- task reminders
- task type/configuration
- task custom fields
- subtasks if used

## Attendance / Leave

- `attendance_records`
- `attendance_approval_records` if needed
- `leave_requests`
- leave change/cancellation history
- logout/session records
- overtime/review flags

## Notifications

- `notifications`
- push subscription/device registration
- delivery attempts/logs if needed
- escalation state

## Files

- `files`
- task file submissions / versions
- storage metadata

## Financial reference

- CEO-only billing allocation values
- revenue calculation records or derived views
- revenue overrides
- billing status

## Audit

- `activity_log`

## Reporting

- monthly company snapshots
- monthly client snapshots if useful
- report export metadata if needed

Do not implement every entity speculatively. Normalize only where business rules demand it.

---

# 76. Revenue Calculation Data Model Principle

Store enough raw data to reconstruct the calculation:

- work item
- category
- planned value
- allocation method
- individual allocation if any
- approval state
- CEO approval timestamp
- system-calculated achieved value
- CEO override value
- billing status

Do not store only a final number with no provenance.

---

# 77. Audit Transaction Requirement

Important mutation + activity entry should ideally occur atomically.

Original pattern was:

```text
validate
→ authorize
→ repository mutation
→ recordActivity
→ revalidate
```

Correction:

For important transactional changes, especially financial/approval/attendance operations:

```text
BEGIN
  mutation
  audit entry
COMMIT
```

Do not allow a business change to succeed while its required audit record silently fails.

---

# 78. RLS & Authorization

Security lives in Postgres.

Every table must have RLS enabled.

Server-side permission checks are required.

UI checks only hide unavailable controls.

Suggested conceptual permission categories:

- user management
- client management
- monthly work management
- project management
- task assignment
- task approval
- attendance view
- attendance approval
- leave view
- leave approval
- financial view
- revenue edit
- report export
- permanent delete

CEO has all permissions.

Admin excludes CEO-only permissions.

Staff gets execution-only permissions.

---

# 79. Do Not Overbuild Yet

Explicitly out of the prototype:

- GST invoice generation
- automated invoicing
- client login/portal
- WhatsApp workflow
- native mobile app
- complex time tracking
- social publishing
- large AI workflow inside MaxOff
- advanced HR leave policies
- complicated dependency engine
- complicated payroll
- accounting integration
- advanced CRM leads pipeline
- client-facing financial reports

These can be future modules.

---

# 80. Prototype Module Scope

The first working prototype should include:

1. Authentication & Roles
2. CEO Dashboard
3. Admin Dashboard
4. Staff / My Tasks
5. Attendance
6. Leave
7. Clients
8. Monthly Scope
9. Monthly Deliverables
10. Projects
11. Tasks
12. Task Templates
13. Project Templates
14. Calendar
15. Notifications
16. File / Work Submission
17. Task Approval
18. Activity History
19. CEO Reports / Analytics
20. Revenue reference/calculation layer
21. Global Search
22. Basic Settings/custom fields/lists

---

# 81. Recommended Build Order

Do not blindly follow the original roadmap order.

Build an early vertical slice.

Suggested sequence:

```text
Foundation
 ↓
Auth / Roles
 ↓
CEO / Admin / Staff permission model
 ↓
Clients + Admin assignment
 ↓
Attendance + Leave
 ↓
Task creation + assignment
 ↓
Task acknowledgement
 ↓
Task comments / progress
 ↓
Admin approval
 ↓
CEO approval
 ↓
Notifications / reminders
 ↓
My Day / CEO Daily Dashboard
 ↓
Monthly Scope + Deliverables
 ↓
Projects
 ↓
Additional Work
 ↓
Files / versioned review
 ↓
Revenue calculations
 ↓
Reports / historical snapshots
 ↓
Search / polish / hardening
```

The first usable vertical slice should appear early.

---

# 82. Prototype UX Hierarchy

## CEO

```text
Today at a Glance
 ↓
Approvals
 ↓
People / Attendance
 ↓
Today's Tasks
 ↓
Overdue / Risks
 ↓
Calendar
 ↓
Clients / Monthly Progress
 ↓
Revenue / Performance
```

## Admin

```text
Assigned Clients
 ↓
Client Work
 ↓
Staff Tasks
 ↓
Approvals
 ↓
Calendar
 ↓
Operational Issues
```

## Staff

```text
Attendance
 ↓
My Day
 ↓
Task Acknowledgement
 ↓
Task Work
 ↓
Updates / Upload
 ↓
Done
 ↓
Logout
```

---

# 83. Important Reporting Distinction

Always distinguish:

### Operational Progress

Example:

`6/12 Reels in progress/completed`

### Final Approved Completion

Example:

`5/12 CEO approved`

### Potential Revenue

Value represented by planned/eligible work.

### Achieved Revenue

Value represented by work with final CEO approval.

### Remaining Revenue

Potential minus Achieved, subject to CEO overrides/carry-forward logic.

Do not merge these concepts.

---

# 84. Staff Accountability Model

The system is designed to make responsibility explicit.

For every task:

```text
Management assigns
 ↓
Employee acknowledges
 ↓
Employee works
 ↓
Employee updates
 ↓
Employee submits Done
 ↓
Admin checks
 ↓
CEO checks
 ↓
Task is finally complete
```

This is intentional. Staff should not be able to claim ignorance of an assigned task because acknowledgement is explicit.

---

# 85. CEO End-of-Day Review Model

At the end of the day, CEO should be able to see entries like:

```text
Rahul
Present — 09:14 AM
Logout — 08:42 PM

Task A
Done
Admin Approved
CEO Approved

Task B
Done
Admin Approved
CEO Pending

Task C
Not Done
Reason: Client asset pending
Admin Reviewed
CEO Pending
```

The goal is operational accountability without requiring the CEO to inspect every system page.

---

# 86. Client Monthly Review Model

CEO opening a client should see:

```text
CLIENT
│
├── Basic Details
├── Assigned Admin
├── Google Drive
├── Monthly Scope
│
├── September 2026
│   ├── 12 Reels
│   │   ├── Reel 1
│   │   ├── Reel 2
│   │   └── ...
│   └── 4 Posts
│
├── Projects
├── Additional Work
└── History
```

For each Reel/Post show stage progress.

Example:

```text
Reel 6
Script ✓
Shoot ✓
Editing ✓
Posted ☐
```

CEO can see the entire operational state.

---

# 87. Revenue Example

Suppose:

```text
Client monthly scope:
12 Reels
4 Posts

Total monthly billing:
₹60,000
```

If the system evenly allocates across 16 deliverables:

```text
Per deliverable = ₹3,750
```

If 8 deliverables have CEO approval:

```text
Achieved Revenue = ₹30,000
Remaining = ₹30,000
```

If the CEO later says:

```text
Actually Reel = ₹5,000
Post = ₹2,500
```

use the explicit individual allocation instead.

If CEO overrides the final achieved amount, show the system calculation and CEO adjustment separately.

---

# 88. Performance Intelligence Dataset

The backend should retain detailed operational facts sufficient to analyze:

- employee workload
- task acknowledgement delay
- completion delay
- time taken
- task rejection rate
- revision rate
- approval cycle time
- stage duration
- recurring task performance
- client workload
- revenue achievement
- additional work
- overdue patterns
- overtime patterns

The system should not automatically judge employee quality.

It should collect the facts so CEO/AI can analyze them later.

---

# 89. Example AI Questions This Data Should Eventually Support

Without requiring MaxOff itself to answer them initially, the data should allow a future AI analysis to answer:

- Which workflow stage consumes the most time?
- Which roles are overloaded?
- Which task categories are frequently overdue?
- Which clients consume disproportionate operational effort?
- How much potential monthly revenue was not achieved?
- What portion of monthly scope was finally CEO-approved?
- Where are repeated revision loops happening?
- Is more editing capacity needed?
- Is scripting becoming a bottleneck?
- Which work types generate the most additional workload?
- Where might hiring or process improvement be useful?

---

# 90. Prototype Quality Requirements

Retain the original production-level quality intent:

## Security

- RLS on all tables
- invite-only authentication
- immediate deactivation enforcement
- secure private files
- expiring download/access links
- sanitized SVG handling
- rate limits where appropriate
- security headers

## Reliability

- backups
- tested restore
- monitoring
- CI
- error tracking

## UX

- loading states
- empty states
- error states
- permission-denied states
- responsive mobile support
- accessibility basics

## Performance

- indexed lists
- pagination
- efficient queries
- avoid N+1
- real-time updates where useful

---

# 91. Original Repository Workflow — Keep but Update

The original Claude Code workflow is useful and should remain conceptually:

```text
Read docs
 ↓
Plan
 ↓
Approve plan
 ↓
Implement one task
 ↓
Run tests
 ↓
Update docs
 ↓
Commit
 ↓
Review phase
```

One task per session remains a good rule.

`PROGRESS.md` remains the handoff source.

`ROADMAP.md` remains task-oriented.

`ARCHITECTURE.md` and ADRs remain the architecture source.

However, first **reframe those files around this v2 specification** before implementing the prototype.

---

# 92. Original Claude Permission/Workflow Cleanup

The original repo had a small mismatch between documented Git actions and explicit Claude permissions.

When updating the repo:

- ensure required Git commands are actually permitted
- keep commands documented and executable
- do not rely on undocumented workflow assumptions

---

# 93. Model Selection Guidance

Do not hard-code volatile model names into the methodology.

Prefer role-based guidance:

- high-capability model → architecture/security/core engines/reviews
- strong coding model → normal implementation
- fast model → simple UI/polish/docs

The methodology should survive model changes.

---

# 94. Architecture Boundaries to Preserve

Core must not import feature modules.

Modules communicate through public interfaces/index files.

Database access stays in designated data/repository layers.

Business lists remain configurable.

Custom fields remain centralized.

RLS remains mandatory.

Every meaningful mutation should record activity.

Important financial/approval/attendance changes should be transactionally consistent with the audit record.

---

# 95. Product Boundary: Internal First, SaaS Later

Current goal:

```text
Pixora Clips internal operating system
```

Future possibility:

```text
MaxOff SaaS for other agencies/companies
```

Do not allow future SaaS assumptions to distort the prototype.

Only keep architectural seams that are cheap and valuable now:

- organization boundary
- clean modules
- authorization layer
- storage adapter
- notification abstraction
- data-driven customization

Do not build billing/subscriptions/multi-tenant admin portal now.

---

# 96. Final Product Philosophy

MaxOff should answer these questions extremely well every day:

### CEO

> Who is working today?  
> What are they doing?  
> What is late?  
> What requires my approval?  
> What client work is progressing?  
> What revenue is potentially achievable?  
> What revenue has actually been approved?  
> Where is the team/workflow slowing down?

### Admin

> Which clients am I responsible for?  
> What client deliverables are pending?  
> What team tasks need attention?  
> What needs approval?  
> What is overdue?  
> What should happen next?

### Staff

> What do I need to do today?  
> What is due soon?  
> What is overdue?  
> Have I acknowledged the task?  
> What feedback do I need to address?  
> What upcoming shoot/meeting/event must I remember?

If the product consistently answers these questions, it is solving the actual problem.

---

# 97. Immediate Instruction to Claude Code

**Do not start implementation immediately.**

First perform a repository-wide reconciliation against this document.

Claude should:

1. Read the existing `CLAUDE.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `PROGRESS.md`, ADRs, and Claude command files.
2. Compare them against this v2 context.
3. Identify contradictions.
4. Reframe `PRODUCT.md` around the approved product requirements.
5. Reframe `ARCHITECTURE.md` around the approved architecture and workflows.
6. Add/update ADRs where important architectural decisions have changed.
7. Rebuild the RBAC/permission matrix.
8. Define the authoritative data model.
9. Define task, approval, attendance, leave, monthly deliverable, project, revenue, notification and reporting state machines.
10. Rebuild the roadmap so a usable vertical slice appears early.
11. Identify any remaining ambiguities that genuinely block database/schema implementation.
12. **Do not silently invent business rules.** Ask only when a decision is truly required.
13. Do not write application code until the revised documentation and architecture are internally consistent.

---

# 98. Final Non-Negotiable Rules

1. One CEO account.
2. CEO/Admin/Staff are the only prototype system roles.
3. Job titles are editable by CEO.
4. One Admin per client.
5. No fixed Staff-to-Admin hierarchy.
6. No working-hour restrictions.
7. First login of the IST day triggers attendance choice.
8. Attendance must be approved by CEO.
9. Leave must be approved by CEO.
10. Logout timestamp is captured immediately when manually logged out.
11. All assigned employees must acknowledge a task.
12. Every task ultimately requires CEO approval.
13. Admin approval comes before CEO approval.
14. Revenue only counts after CEO approval.
15. Monthly Work, Projects and Additional Work remain separate billing categories.
16. Staff can upload work for review, but files are optional.
17. File submissions are versioned.
18. Notifications are mandatory for relevant users.
19. Employees cannot disable notifications.
20. CEO/Admin can configure task reminders.
21. Monthly Work tracker is independent from Staff tasks.
22. Monthly Scope is CEO-controlled.
23. Monthly deliverables are individually tracked.
24. Monthly deliverables support configurable stages.
25. Client financial information is CEO-only.
26. CEO sees full company performance/reporting.
27. Admin sees operational data but no finances/attendance-leave authority.
28. Staff sees only execution-focused information.
29. Projects do not require project dates.
30. Project completion is manual by CEO.
31. No task-to-task dependency engine.
32. Avoid complex time tracking.
33. Archive rather than delete.
34. Permanent deletion is CEO-only.
35. Historical records must remain traceable.
36. Use IST consistently.
37. Backups and recovery are required.
38. Real-time updates are required where valuable.
39. PWA-ready responsive web application.
40. Internal-first, SaaS-ready architecture without premature SaaS complexity.

---

# 99. What Claude Should Produce After Reframing

Before coding, the updated repository should contain a coherent set of documents that answer:

- What is MaxOff?
- What are the roles?
- What does each role see/do?
- What are the exact workflows?
- What is the data model?
- What are the states?
- What can be edited/approved?
- What is financially visible?
- How does Monthly Work differ from Projects and Additional Work?
- How does revenue get calculated?
- When is revenue recognized?
- How does attendance work?
- How does leave work?
- How does task acknowledgement/approval work?
- How do notifications work?
- How do files/revisions work?
- How are reports generated?
- How is historical data protected?
- How does the prototype roadmap reach a usable vertical slice quickly?

The final implementation should be based on the reconciled documents, **not on the earlier conflicting version of the repo documentation**.

---

# End State

MaxOff should become a trusted internal operating system where:

```text
People
  ↓
Work
  ↓
Clients
  ↓
Monthly Work / Projects / Additional Work
  ↓
Tasks
  ↓
Acknowledgement
  ↓
Execution
  ↓
Admin Approval
  ↓
CEO Approval
  ↓
Operational Completion
  ↓
Revenue Recognition
  ↓
Historical Reporting
  ↓
Performance Intelligence
```

The goal is not to make MaxOff the most feature-rich system possible.

The goal is to make it the **single reliable source of truth for how Pixora's people, client work, operational execution, approvals, and revenue progress are moving every day.**
