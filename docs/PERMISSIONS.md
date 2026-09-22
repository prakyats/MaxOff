# MaxOff: Roles, Permissions and Visibility

> This is the source of truth for **who can see and do what**. It's enforced in Postgres (RLS + transition functions) and checked again in server actions. The UI only hides controls.
> Roles are fixed: `ceo`, `admin`, `staff`. Permission keys are stored as data (`role_permissions`) and seeded by migration, so custom roles can be added later without code changes (not in the prototype).

## 1. Permission keys and default grants

| Key | What it allows | CEO | Admin | Staff |
|---|---|:-:|:-:|:-:|
| `team.manage` | Invite, change role or job title, deactivate, edit names | ✅ | | |
| `team.view` | See the member list (names, job titles, roles) | ✅ | ✅ | |
| `availability.view` | See anyone's availability: task counts, busy blocks, approved leave, today's presence | ✅ | ✅ | |
| `settings.manage` | Company settings, days off, holidays, thresholds | ✅ | | |
| `drive.manage` | Connect or reconnect the company Google account, set the archive root, retry failed archives | ✅ | | |
| `drive.view_status` | See archive status on a submission ("Archived ✓", "Link is private") | ✅ | ✅ | ✅ (own tasks) |
| `notifications.reachability` | See who isn't reachable by push and why | ✅ (everyone) | ✅ (people on their tasks) | own devices only |
| `lists.manage` | Task types, stage presets, job titles, other lists, custom field definitions | ✅ | ✅ ¹ | |
| `templates.manage` | Project and task templates | ✅ | ✅ | |
| `clients.manage` | Create clients, assign the Admin, activate / pause / close | ✅ | | |
| `clients.edit_assigned` | Edit details, contacts, brand and custom fields of **their** clients | ✅ | ✅ | |
| `clients.private_notes` | CEO-only client notes | ✅ | | |
| `projects.manage` | Create and edit projects and items on **their** clients, start cycles manually | ✅ | ✅ | |
| `items.tick` | Tick stages and mark items done (operational) | ✅ | ✅ | |
| `items.approve` | Final approval or rejection of items | ✅ | | |
| `cycles.carry_decide` | Carry forward / close / leave pending | ✅ | | |
| `projects.complete` | Complete, cancel or reopen projects | ✅ | | |
| `tasks.create` | Create, assign, edit, reassign and cancel tasks within their scope | ✅ | ✅ | |
| `tasks.approve_admin` | The Admin approval step (only as the task's approving Admin) | | ✅ | |
| `tasks.approve_final` | The final approval step | ✅ | | |
| `tasks.work` | Acknowledge, comment, tick stages, upload, mark done (as an assignee) | ✅ | ✅ | ✅ |
| `task_requests.create` | Suggest a task | | ✅ | ✅ |
| `task_requests.decide` | Convert or decline a task request | ✅ | ✅ | |
| `attendance.self` | Submit own attendance and logout, request own leave | | ✅ | ✅ |
| `attendance.decide` | Approve or correct attendance, decide leave, edit approved leave | ✅ | | |
| `attendance.view_all` | Full attendance and leave history of everyone | ✅ | | |
| `finance.view` / `finance.edit` | Amounts, overrides, billing status, revenue (the billing **category** is set by the CEO but visible to Admins, see §2) | ✅ | | |
| `reports.all` | Company reports, metrics, AI export | ✅ | | |
| `reports.scoped` | Operational reports on their own scope, with no money | | ✅ | |
| `months.close` | Close a month, make corrections | ✅ | | |
| `activity.view_all` | The full activity log | ✅ | | |
| `records.hard_delete` | Permanent deletion (exceptional) | ✅ | | |

¹ Admins can edit lists and field definitions except company-level settings, and except **custom field definitions on `project` and `item`**, which are CEO-only (this closes the "amount in a number field" loophole, since there's no currency type). *Adjustable: it's just a row in `role_permissions`.*

**The CEO doesn't mark attendance.** The first-login attendance gate applies to Admins and Staff only.

## 2. Visibility rules (RLS)

| Data | CEO | Admin | Staff |
|---|---|---|---|
| Members | All | Everyone's name, job title, role, status and **phone** (a work contact), through the `member_directory` view. **Email is CEO-only**: it's the login identity | Own profile. Names of people on their own tasks (through `member_directory`, from 4.1) |
| Attendance / leave | All | **Own**. Others only through `availability` (present or on leave today, approved leave dates) | Own |
| Clients (full record) | All | **Assigned clients only** | ❌ Never |
| Client label (name, logo, colours, fonts, tone, brand notes) | All | Assigned clients + labels on visible tasks | Only for clients on their **own** tasks (through `client_labels` view) |
| CEO-only client notes | ✅ | ❌ | ❌ |
| Projects / cycles / items | All | Projects of assigned clients | ❌ Never |
| Staff tasks | All | Tasks they **created**, **approve**, are **assigned to**, or labelled with **their clients** | Tasks they're **assigned to** |
| Task comments / files / submissions | All | Same as the task | Same as the task |
| Task requests | All | Their own + requests labelled with their clients + requests with no client | Their own |
| Availability of others | Full detail | **Counts and busy blocks only** (`member_availability()` function) | ❌ |
| Money (any amount, override, billing status, revenue) | ✅ | ❌ (not even in exports) | ❌ |
| A project's billing **category** (Retainer / Project / Additional Work) | ✅ set and see | See only (it's operational context, not an amount) | ❌ |
| Reports / snapshots | All | Scoped operational reports, **computed live**. `eod_reports` and `month_snapshots` hold revenue and are CEO-only tables | ❌ |
| Activity log | All | Entries about records they can see | Entries about their own tasks, attendance and leave |
| Notifications | Own | Own | Own |

**Scope changes are live:** if the CEO reassigns a client to another Admin, the old Admin loses access immediately and the new Admin gains it.

## 3. Rules enforced by transition functions (not just RLS)
- Only the task's **approving Admin** can do the Admin approval step, and never on a task they're assigned to (#3).
- Only the **primary owner** can mark a task Done. From `submitted` onwards, assignees can't edit (they can still comment).
- A task may be **edited, reassigned, cancelled or reopened** only by its **creator**, its **approving Admin** or the **CEO**. Other Admins who can see it can't change it.
- Only the CEO can move money fields, approve items, approve tasks finally, decide attendance and leave, and close months.
- Only the CEO can change `projects.billing_category`, `projects.client_id` and `projects.recurrence` (guard trigger, like state columns). An Admin-created project takes its billing category from its recurrence; a template's default category applies only when the CEO creates the project.
- Custom field definitions for `project` and `item` are CEO-only (footnote ¹).
- The single-CEO rule is enforced by a unique partial index on `members(role) where role = 'ceo'`.
- A member edits their **own** name, phone and avatar (plain edit, audited). Role, job title and status are `team.manage` only. **Email is never self-edited**: it's the login identity, and changing it goes through the CEO (a transition function, 1.3). `members.status` and its timestamps change only through transition functions (`app.protect_columns()` guard).
