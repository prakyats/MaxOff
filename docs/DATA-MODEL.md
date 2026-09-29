# MaxOff: Data Model

> The authoritative list of tables. Migrations must match it. Change it here (and in an ADR for anything structural) **before** writing a migration.
> Conventions (ARCHITECTURE §6): `id uuid pk`, `created_at`, `updated_at` (trigger) and `created_by` on business tables. `archived_at` instead of delete. RLS on every table. Workflow `state` columns change **only** through transition functions.
> **Org seam:** root tables have `org_id uuid not null default current_org_id()`. Child tables inherit scope from their parent. There's one organization row in the prototype.

## 0. Enums (only for categories code depends on)
```
member_role        owner | admin | staff
member_status      invited | active | deactivated
engagement         permanent | freelance      -- ADR-0013 (4A): a freelancer has no login; data, not a role
attendance_choice  present | leave | half_day | comp_leave
day_status         present | leave | half_day | comp_leave | absent
attendance_state   awaiting_choice | pending_review | approved | corrected
leave_type         leave | half_day | comp_leave
leave_state        submitted | approved | rejected | withdrawn | superseded | cancelled
client_state       draft | active | paused | inactive
recurrence         one_time | weekly | monthly
project_state      open | in_progress | completed | cancelled
billing_category   retainer | project | additional
cycle_state        open | settled
item_state         open | done | approved | cancelled | carried
carry_decision     carry_forward | close | leave_pending
task_state         todo | in_progress | submitted | admin_approved | changes_requested | completed | cancelled
admin_step         required | none | skipped
priority           low | medium | high | urgent
task_type_kind     normal | event | custom          -- behaviour category; names are data
review_decision    approved | rejected
request_state      pending | converted | declined | withdrawn
billing_status     not_billed | billed
field_type         text | long_text | number | date | datetime | checkbox | select |
                   multi_select | url | email | phone | color | member | rating
                   -- deliberately NO currency type: money lives only in the Owner-only tables (§7)
```

## 0a. Base schema (task 0.2)
Extensions: `pg_cron` (in `pg_catalog`, jobs from 2.5), `pg_net` (in `extensions`). pgTAP is created by the test runner only, never in production.
Schema **`app`** holds the helpers every module uses. It's not exposed through the API. `authenticated` and `service_role` have usage and execute; `anon` has nothing. Every function in `app` (and every `security definer` function later) gets an explicit `revoke all ... from public` + `grant execute ... to authenticated, service_role`, because Postgres grants EXECUTE to PUBLIC on creation and a per-schema default privilege can't undo it. Consequence: a policy or default that calls `app.*` raises `42501` for `anon` instead of returning no rows, so no table may be readable by `anon` (fine: clients never log in).
```
app.set_updated_at()            BEFORE UPDATE row trigger: every table with updated_at attaches it
app.to_ist_date(timestamptz)    -> date in Asia/Kolkata (stable, strict; null in -> null out)
app.today_ist()                 -> app.to_ist_date(now())
app.fail(code, detail)          raises SQLSTATE P0001 with message = code, detail = the human reason
                                (ARCHITECTURE 4.3). Every transition function raises through it
app.is_working_day(date)        (1.4) false when the date's weekday is in org_settings.weekly_off_days
                                or a holidays row matches it, true otherwise. Stable, parallel safe,
                                security definer, scoped by app.current_org_id() so a service-role job
                                gets the same answer. **Null in, null out, and null when no single
                                organization is in scope** (none, or more than one): callers treat null
                                as "do not act", never as a working day, so a job cannot mark a team
                                absent on a Sunday. The TS mirror is core/time isWorkingDay()

-- Identity and audit helpers (task 1.1, ARCHITECTURE §5). All security definer, search_path = ''.
app.current_org_id()            the caller's org; with no member row (bootstrap, service role) the single
                                organizations row; null when there are none or several. Default of every
                                root table's org_id
app.current_member()            the caller's member row when status = 'active', else no row
app.has_permission(text)        caller's role has this key in role_permissions (active members only)
app.audit_row_change()          AFTER INSERT/UPDATE/DELETE row trigger writing activity_log:
                                entity = table name, action = insert|update|delete, entity_id = new/old.id
                                (or TG_ARGV[0] as the id column), diff = {old:{}, new:{}} of the changed
                                columns only (updated_at excluded), actor_id = auth.uid() or null (system).
                                A transition function that writes an audited table sets the transaction
                                setting app.audit_override = '{"action": "...", "meta": {...}}' first
                                (1.3): the trigger's row then carries the workflow action name and meta
                                (e.g. the deactivation reason) instead of a generic 'update', and the
                                function writes no second row. Consumed by the FIRST audited write of
                                the transaction, so set it right before the row it describes (a
                                function that writes a history row first labels that row instead).
                                on_behalf_of_id (4A): the override's on_behalf_of, else (4A review S2)
                                the row's own on_behalf_of column on an insert or on an update that
                                changes on_behalf_of or done_at (a comment or a stage tick for a
                                freelancer through the API); never on another update or a delete
app.in_transition()             true while the statement runs as the function owner (inside a security
                                definer transition function, a migration, a seed or a service-role job);
                                false for a direct API write as authenticated / anon. Nothing to switch on
app.protect_columns()           BEFORE UPDATE trigger; TG_ARGV = column names that may change only
                                while app.in_transition(). Raises FORBIDDEN otherwise. Every state
                                column gets it (ADR-0006 "trigger guard")
app.members_self_edit_guard()   BEFORE UPDATE on members: without team.manage only full_name and phone
                                change; the Owner row never loses its role outside a transition
app.members_insert_guard()      BEFORE INSERT on members: outside a transition a new row is invited,
                                with no joined_at / deactivated_at
app.create_org_settings()       AFTER INSERT on organizations: the org_settings row with launch defaults

-- Session and bootstrap functions (task 1.2, ADR-0012). public schema (RPC), security definer,
-- search_path = ''. EXECUTE is revoked from public AND anon explicitly: Supabase's default
-- privileges grant it to anon on every new public function.
public.session_login(user_agent, ip_hash)    inserts session_events(login) for the calling active
                                member (app.current_member()); UNAUTHENTICATED otherwise. Called
                                once per sign-in and once when a recovery link opens a session.
                                No activity_log row: the session_events row is the record
public.session_sign_out(user_agent, ip_hash)   "Sign out of this device" (3b.1, §3): the same for
                                logout and nothing else. (session_logout() and app.attendance_logout(),
                                the 2.x pair that also stamped the attendance day, were dropped by the
                                3c.1 contract migration)
public.bootstrap_owner(user_id, email, full_name, org_name)   service_role only. Creates the single
                                organization when none exists and the first, active Owner member for
                                an existing auth user; CONFLICT once any member exists. Called by
                                scripts/bootstrap-owner.mjs, which prints a one-time recovery link and
                                never handles a password

-- Team functions (task 1.3, WORKFLOWS §1a). public schema, security definer, search_path = '', the
-- same grants. Each one writes its activity_log row through app.audit_override (above).
public.member_invite(user_id, email, full_name, role, job_title_id)
                                team.manage. Inserts the invited member row for the auth user the action
                                just created with auth.admin.generateLink(type = invite). role is admin or
                                staff; CONFLICT when a member with that email exists; the auth user's
                                email must match. Audit action 'invited'
public.member_invite_refresh(member_id)
                                team.manage, member must be invited. Bumps invited_at; audit action
                                'invite_link_issued'. The action then generates a fresh link, and the
                                previous link stops working (GoTrue keeps one token per user)
public.member_self_status()     the caller's own status whatever it is (null with no row). RLS shows a
                                member row only to active members, so the invite link and set-password
                                steps read the status through this instead
public.member_accept_invite()   the caller's own row, invited → active with joined_at. Called by
                                setPassword() once the invited person's password is stored. Audit
                                action 'accepted'
public.member_deactivate(member_id, reason)
                                team.manage. active | invited → deactivated (deactivated_at). Never the
                                caller, never the Owner. Deletes the person's auth.refresh_tokens and
                                auth.sessions rows in the same transaction, so a live session cannot
                                refresh (ADR-0012). reason is optional free text, kept in meta.reason.
                                Audit action 'deactivated'
public.member_reactivate(member_id)
                                team.manage. deactivated → active when joined_at is set, otherwise back
                                to invited (they still have to accept). deactivated_at is cleared; the
                                activity log keeps the history. Audit action 'reactivated'
public.list_item_move(list_key, item_id, direction)
                                (1.4) lists.manage. Swaps an entry's `position` with the neighbour
                                above or below it (archived entries skipped) in ONE update that
                                touches no other column, so a reorder cannot revert a rename another
                                editor just made and the order is never half-written. Returns the
                                neighbour's id, or null at either end. A plain edit: the audit
                                trigger's two 'update' rows are the record
public.member_change_email(member_id, new_email)
                                (1.4) team.manage. Changes the login identity of an active, invited
                                or Owner row: CONFLICT when the address is another member's,
                                VALIDATION when it is malformed or unchanged. Writes members.email
                                only; the sign-in itself is moved by the action through
                                auth.admin.updateUserById(email_confirm: true), which is the
                                supported way and the reason this is not one transaction (the
                                action rolls the Auth change back when the rpc refuses). Sessions
                                are left alive: nothing reads the email from the JWT. Audit action
                                'email_changed', meta.from / meta.to
app.members_job_title_guard()   BEFORE INSERT/UPDATE on members: job_title_id, when set, is an
                                unarchived list_items row with list_key = 'job_title' of the same org
app.seed_org_lists()            AFTER INSERT on organizations: the launch job titles (PRODUCT §7)

-- Freelancers (4A, ADR-0013, WORKFLOWS §1b). Same conventions and grants as the team functions.
public.member_add_freelancer(full_name, job_title_id, phone, coordinator_id)
                                team.manage. The freelance member row (a fresh uuid, role staff, active,
                                engagement freelance, no email, joined_at now) and its first
                                member_coordinators row. The coordinator: an active permanent Admin or
                                Staff (VALIDATION otherwise, the Owner included). Audit actions
                                'freelancer_added' (members) and 'coordinator_set' (member_coordinators).
                                Notifies the coordinator (§9; the row is 5.1's)
public.member_set_coordinator(member_id, coordinator_id, reason)
                                team.manage. Closes the freelancer's current member_coordinators row
                                (to_at) and opens the next (set_by, reason) in one transaction; allowed
                                on a deactivated freelancer too (it prepares the reactivation).
                                VALIDATION for a permanent member or an ineligible coordinator,
                                INVALID_STATE when that coordinator is already current. Audit actions
                                'coordinator_closed' and 'coordinator_changed' (or 'coordinator_set'
                                when none was current). Notifies the new coordinator and the previous
                                one if still active (§9)
public.member_invite_employee(member_id, email)
                                team.manage. "Invite as employee": the active freelance row becomes an
                                invited permanent employee with that email on the SAME id (the action
                                created the auth user with this id first; the address must match it and
                                be free), invited_at now, joined_at cleared, the current coordinator row
                                closed (reason 'became_employee'). Audit action 'invited_as_employee'.
                                The action then issues the invite link exactly as member_invite's does
app.coordinator_of(member_id)   the freelancer's current coordinator (to_at null), or null. Security
                                definer, stable: every on-behalf check calls it at the moment of the action
```

## 1. Organization, people and access
```
organizations        id, name, logo_file_id → files (3.3), timezone ('Asia/Kolkata'), created_at, updated_at
                     -- API UPDATE grant: name, logo_file_id (timezone stays IST, invariant 8; phase 1 review).
                     -- 3.3: logo_file_id must be a ready image file the caller uploaded (app.files_reference_guard);
                     -- replacing it archives the previous file row (app.files_archive_replaced trigger)
org_settings         org_id pk, weekly_off_days smallint[] (0=Sun..6=Sat), logout_reminder_time time,
                     ack_repeat_hours int (2), ack_escalate_hours int (4), ack_escalate_owner_hours int (8),
                     overdue_escalate_hours int (24), email_daily_cap_per_member int (20),
                     default_task_reminders jsonb, workload_warning_threshold int,
                     expense_receipt_above numeric(12,2) (500; 3b.3, expand-only: a claim above this
                     amount needs a receipt photo; check >= 0; in the API UPDATE grant, so
                     settings.manage edits it like the rest, from Settings -> Expenses),
                     end_day_cutoff_time time ('05:00'; 3b review, expand-only: yesterday's open day
                     can be ended until this IST time, never once today started; Settings ->
                     Thresholds, which offers 00:00-11:59)
                     -- API UPDATE grant: the eleven settings columns above, never org_id or the timestamps
                     -- defaults in brackets = launch settings (PRODUCT §7); default_task_reminders '[]' until
                     -- 5.3, workload_warning_threshold null until 4.3. Created by trigger with the organization
                     -- kickoff 4 (owner decision 2026-09-28): workload_warning_threshold defaults to 4 and is
                     -- set to 4 on existing rows (open tasks due the same IST day, WORKFLOWS §3.1 "Assignment
                     -- warnings"; check > 0), edited in Settings -> Thresholds
holidays             id, org_id, date, name, created_at, updated_at, unique(org_id, date)
                     -- API UPDATE grant: date, name
                     -- 1.4. RLS: every active member reads (a holiday is everyone's calendar);
                     -- insert/update/delete need settings.manage. Audited. The one configuration
                     -- table with a real DELETE (it has no archived_at): removing a mistyped date
                     -- is the Owner's, and audit_row_change() keeps the removed row. Deleting a
                     -- holiday never rewrites the past: attendance_days carries its own is_day_off
                     -- (2.1), decided on the day itself
members              id (= auth.users.id for a login; a fresh uuid for a freelancer), org_id, full_name,
                     email null (a freelancer has none), phone, avatar_file_id → files (3.3; own upload, raster only),
                     role member_role, job_title_id null → list_items (1.3), status member_status,
                     engagement engagement ('permanent'; 4A, ADR-0013),
                     invited_at, joined_at, deactivated_at, created_at, updated_at
                     unique partial index (org_id) where role = 'owner'; unique index on lower(email)
                     -- 4A as built: the FK members.id → auth.users is gone (a freelancer has no auth
                     -- row; expand-only, nothing reads it); check members_email_matches_engagement:
                     -- (engagement = 'permanent') = (email is not null). A freelance row has role =
                     -- staff for permission arithmetic, no auth.users row, no invite (member_invite()
                     -- refuses the id: "Use Invite as employee"), joined_at set on creation. Created
                     -- only by member_add_freelancer(full_name, job_title_id, phone, coordinator_id)
                     -- (team.manage): app.members_insert_guard() refuses an API insert with engagement
                     -- = freelance, and engagement is a protected column (transition functions only).
                     -- Every attendance and leave function, the day gate and the 2.5 jobs act on
                     -- permanent members only (PERMISSIONS §3): app.attendance_require_self() refuses a
                     -- freelance caller, comp_leave_grant() a freelance member, app.absent_check(),
                     -- app.end_day_reminder_due(), attendance_today_detail() and month_summary() select
                     -- engagement = 'permanent'. A later tasks-only login attaches an auth.users row to
                     -- this same id (ADR-0013 §7), so nothing about it ever moves.
member_coordinators  id, member_id → members (the freelancer), coordinator_id → members (an active
                     permanent Admin or Staff), from_at, to_at null (the current one), set_by, reason,
                     created_at
                     -- 4A, ADR-0013: history, never rewritten. unique partial index (member_id) where
                     -- to_at is null (exactly one current coordinator); check member_id <> coordinator_id.
                     -- Written only by the team functions (team.manage): member_add_freelancer() opens
                     -- the first row; member_set_coordinator(member_id, coordinator_id, reason) closes
                     -- the current row and opens the next in one transaction (INVALID_STATE when that
                     -- coordinator is already current; allowed on a deactivated freelancer, so
                     -- reactivation can be prepared); refused when the coordinator is not an active
                     -- permanent Admin or Staff, is the freelancer, or the member is not freelance.
                     -- member_deactivate(freelancer) closes the current row (reason 'deactivated') and
                     -- member_reactivate(freelancer) needs a current row again (INVALID_STATE "Set a
                     -- coordinator first"), the handover pattern: two calls. member_deactivate(coordinator)
                     -- is CONFLICT while an active freelancer points at them.
                     -- 4A review (M2): member_deactivate(coordinator) also closes the current rows of
                     -- DEACTIVATED freelancers still pointing at them (a coordinator set to prepare a
                     -- reactivation; reason 'coordinator_deactivated'), and member_reactivate(freelancer)
                     -- also refuses (INVALID_STATE) while the current coordinator is no longer an active
                     -- permanent Admin or Staff (their row locked, as app.coordinator_eligible() does).
                     -- RLS (4A review S4, owner decision 2026-09-29): team.view reads every row, reason
                     -- included; the reason of a coordinator change is the Owner's and the Admins' (like a
                     -- deactivation reason), so a coordinator, current or former, reads their own rows
                     -- only through the coordinated_freelancers view, without it. No API writes. Audited
                     -- (actions coordinator_set, coordinator_changed, coordinator_closed, with meta.reason;
                     -- those entries are team.view only, activity_log_select_member_coordinators).
                     -- kickoff 4 (owner decision 2026-09-28): the coordinator is never the Owner (refused
                     -- as not an Admin or Staff); a coordinator may have many freelancers (no uniqueness on
                     -- coordinator_id). Freelancer -> employee: the Owner's "Invite as employee",
                     -- member_invite_employee(member_id, email) (team.manage): the action first creates
                     -- the auth user WITH THE SAME id (auth.admin.createUser({ id, email })), then the
                     -- function sets engagement = permanent and email, status -> invited (invited_at =
                     -- now(), joined_at cleared so acceptance stamps the join and attendance starts the
                     -- IST day after it), closes the current row (to_at, reason 'became_employee');
                     -- refused on a permanent row, a deactivated freelancer, a taken email or when the
                     -- auth user is missing or carries another address. Never permanent -> freelance.
                     -- member_change_email() refuses a freelance row (INVALID_STATE: no sign-in exists).
                     -- No tasks-only login in phase 4 (ADR-0013 §7 keeps it possible).
                     -- app.coordinator_of(freelancer_id) → the current coordinator (null when none),
                     -- used by every on-behalf check and by notification routing (WORKFLOWS §9).
                     -- status, invited_at, joined_at, deactivated_at are protected columns (transition
                     -- functions only, 1.2/1.3). RLS: own row; every row for team.view; writes team.manage;
                     -- own name/phone/avatar editable (PERMISSIONS §3). job_title_id is in the API
                     -- role's UPDATE grant, and app.members_self_edit_guard() keeps it team.manage-only
member_directory     view (security definer): id, org_id, full_name, phone, role, status, job_title_id,
                     created_at, avatar_file_id (appended in 3.3), engagement (appended in 4A).
                     Everyone's row for team.view, plus the caller's own, plus (4A, PERMISSIONS §2) the
                     people on the caller's visible tasks (assignees, creator, approving Admin) and
                     the freelancers the caller currently coordinates. No email (PERMISSIONS §2); phone
                     only for team.view, the person themselves and a freelancer's current coordinator
                     (null on a co-worker seen through a shared task).
coordinated_freelancers  view (security definer; 4A review S4): id, member_id, coordinator_id, from_at,
                     to_at, set_by, created_at: the caller's own member_coordinators rows (coordinator_id =
                     the caller), current (to_at null) and past, never the reason. "Your freelancers"
                     on /me (4C) reads it; names and phones come from member_directory. Select only
role_permissions     role member_role, permission text, pk(role, permission)   -- seeded
session_events       id, member_id, kind ('login'|'logout'), at, user_agent (≤ 512), ip_hash
                     -- append-only, written only by session_login() (1.2) and
                     -- session_sign_out() (3b.1). ip_hash = salted SHA-256 of the client IP
                     -- (SESSION_IP_HASH_SALT) or null; never the IP, never an unsalted hash.
                     -- RLS: own rows; all for attendance.view_all
push_subscriptions   id, member_id, endpoint unique, p256dh, auth, user_agent, created_at,
                     platform ('android'|'ios'|'desktop'|'other'), is_standalone bool (PWA installed),
                     label (device name shown to the member), last_success_at, last_failure_at,
                     failure_count, disabled_at, disabled_reason ('gone'|'expired'|'signed_out'|
                     'deactivated'), last_test_at
                     -- kept across logout (title-only payloads); removed on "sign out of this
                     -- device" or deactivation. See PRODUCT §4.11 and WORKFLOWS §9a.
```

## 2. Configuration (customization as data)
```
list_items           id, org_id, list_key ('job_title'|...), name, description, color, icon,
                     position, meta jsonb, is_system, archived_at, created_at, updated_at
                     -- API UPDATE grant: name, description, color, icon, archived_at (position only through
                     -- list_item_move(); list_key, is_system and meta never through the API)
                     -- 1.3 (core/lists). unique (org_id, list_key, lower(name)) where archived_at is
                     -- null. RLS: every active member reads; insert/update need lists.manage; no
                     -- DELETE (archive instead). Audited. Seeded per organization by trigger with the
                     -- launch job titles (PRODUCT §7); 1.4 adds the Settings screen
                     -- 3b.3: list_key 'expense_category' (seeded Travel, Food, Materials, Other) is the
                     -- Owner's list: app.list_items_owner_guard() refuses an API insert or update of
                     -- it without expenses.decide, although Admins hold lists.manage
task_types           id, org_id, name, kind task_type_kind, shows_on_calendar bool,
                     has_location bool, default_reminders jsonb, color, icon, position,
                     is_system, archived_at, created_at, updated_at
                     -- seeds: Normal(normal), Shoot / Site Visit(event, calendar, location),
                     --        Meeting(event, calendar, location), Posting(event, calendar),
                     --        Review / Approval(normal), Other(normal), Custom(custom)
                     -- 4A as built: seeded for every organization by app.seed_org_task_types() (AFTER
                     -- INSERT on organizations) and backfilled; is_system false (the Owner renames or
                     -- archives them). unique (org_id, lower(btrim(name))) where archived_at is null.
                     -- RLS: every active member reads; insert / update need settings.manage, and
                     -- app.task_types_owner_guard() refuses a write without it even where a policy
                     -- would allow one (PERMISSIONS ³). API UPDATE grant: name, shows_on_calendar,
                     -- has_location, default_reminders, color, icon, archived_at (position through a
                     -- move function with the Settings screen). No DELETE. Audited. kind decides the
                     -- task's fields (task_create): event -> event_date required, event times and
                     -- purpose allowed; has_location -> location allowed; default_reminders -> the
                     -- task's reminder_rules when none are given (kickoff 4 decision 14).
                     -- kickoff 4 (owner decision 2026-09-28): the Owner's list. A guard refuses insert,
                     -- update, move and archive without settings.manage (Admins hold lists.manage but only
                     -- pick types; PERMISSIONS ³). Tasks have no stage presets: stage_presets are projects' (7.4)
stage_presets        id, org_id, name, stages text[] (ordered), archived_at
field_definitions    id, org_id, entity ('client'|'contact'|'project'|'item'|'task'),
                     client_id null (a field that exists for one client only),
                     task_type_id null (a field that exists for one task type only; FK → task_types since 4A),
                     key, label, help_text, type field_type, options jsonb, required,
                     section, position, archived_at, unique(org_id, entity, key, client_id, task_type_id)
                     -- rows with entity in ('project','item') are Owner-only to create/edit (PERMISSIONS ¹)
                     -- kickoff 3: global client/contact rows Owner-only; client_id rows by the Owner or
                     -- that client's current Admin (PERMISSIONS ²); type immutable once a value exists
                     -- (guard trigger); archive only, never delete; select values store the option key
                     -- 3.2 as built: key ~ ^[a-z][a-z0-9_]{0,39}$ (derived from the label, then fixed);
                     -- options jsonb [{key, label}] (non-empty for select / multi_select, [] otherwise);
                     -- position fractional index (appended); client_id only with entity client|contact,
                     -- task_type_id only with entity task (4.1). Unique on (org_id, entity, key,
                     -- coalesce(client_id), coalesce(task_type_id)). API UPDATE grant: label, help_text,
                     -- type, options, required, section, position, archived_at (entity, key and the
                     -- scope never move). Writes are decided by app.field_definition_writable(entity,
                     -- client_id): lists.manage plus PERMISSIONS ¹ ² (global client/contact and every
                     -- project/item row: the Owner; a client-scoped row: the Owner or that client's
                     -- current Admin; task rows: lists.manage). Reads: task rows for every active
                     -- member (4.1 forms); the rest for lists.manage on a visible scope. Audited.
                     -- app.field_definitions_guard() refuses a type change once any clients.custom_fields
                     -- or client_contacts.custom_fields holds the key (4.1 / 7.x extend it to their tables).
```
Entities with custom fields have `custom_fields jsonb not null default '{}'`, validated against active definitions on every write (`core/custom-fields`).

## 3. Attendance and leave
```
attendance_days      id, member_id, work_date date (IST), is_day_off bool,
                     state attendance_state, submitted_choice attendance_choice null, submitted_at,
                     proposed_by_system bool (the absent check, or a day derived from approved leave,
                     or a system correction), final_status day_status null,
                     decided_by null (system), decided_at, decision_reason,
                     overtime_flag bool, overtime_reason,
                     worked_on_leave bool ("1 day worked": Present approved on an approved-leave day),
                     leave_request_id null, created_at, updated_at, unique(member_id, work_date),
                     started_at null, ended_at null, end_not_recorded bool (3b.1, expand-only:
                     the Start day and End day taps, and the 00:00 job's "end of day not
                     recorded"; check ended_at needs started_at and is not before it; all three
                     under protect_columns. The 2.x sign-in columns first_login_at /
                     last_logout_at / logout_not_recorded were backfilled onto started_at /
                     ended_at / end_not_recorded (audit 'backfilled', kickoff 3b decision 31) and
                     dropped by the 3c.1 contract migration)
                     -- 2.1. No org_id: the member carries it (like session_events). RLS: own rows,
                     -- all for attendance.view_all. NO insert/update/delete grant for the API role:
                     -- every change is a transition function, and the state columns carry
                     -- protect_columns as well. Audited through app.audit_override.
                     -- is_day_off is decided when the row is created and never re-derived from
                     -- today's holidays / weekly_off_days. Every time is the server clock (now());
                     -- session_events.user_agent / ip_hash are caller-supplied and are not evidence
attendance_events    id bigint identity, attendance_day_id, action ('submitted'|'proposed_absent'|'derived_from_leave'|
                     'approved'|'corrected'|'overtime_flagged'|'started'|'ended'), from_status, to_status, reason,
                     -- started | ended (3b.1): the Start day and End day taps (actor = the member).
                     -- 'logout' (2.x) is closed for new rows by a NOT VALID check (3c.1): rows that
                     -- carry it stay readable (never destroy history), nothing writes it
                     actor_id null (system), at                    -- append-only (no API writes);
                     -- readable with the parent day. Not audited: it is the history
leave_requests       id, member_id, type leave_type, start_date, end_date, reason,
                     state leave_state, source ('form'|'attendance'|'owner'), supersedes_id null,
                     requests_cancellation bool, decided_by null, decided_at, decision_reason,
                     created_at, updated_at
                     -- RLS and grants as attendance_days. Audited. Half day: start_date = end_date.
                     -- requests_cancellation (2.1): an employee's "cancel my approved leave" is a
                     -- new submitted row that supersedes the original; on approval the original AND
                     -- this row end cancelled, so "approved leave covering a date" is always
                     -- state = approved and nothing else
                     credit_days numeric(2,1) null (3b.2, expand-only: the comp leave credit this
                     request uses; check: null, or type = comp_leave with 1.0, or type = half_day
                     with 0.5. Set by leave_submit_comp() (1.0 / 0.5) and, since the 3c review, by
                     the two Owner routes attendance_decide(correct, comp_leave) and
                     leave_owner_edit(comp_leave) at 1.0; a 2.x gate comp leave carries null.
                     Under protect_columns)
extra_work_notes     id, member_id, work_date (IST, today or up to 7 days back), kind ('overtime'|'day_off'),
                     duration_minutes null (overtime only, rough), note (required), state ('submitted'|'reviewed'),
                     decision null ('granted'|'no_comp_leave'), day_marked_worked bool (day_off only),
                     decided_by null, decided_at, created_at, updated_at, unique(member_id, work_date, kind)
                     -- 3b.2 (PRODUCT §4.3a, kickoff 3b decisions 10-13). An overtime note or an
                     -- "I worked today" note on a day off, reviewed by the Owner in Approvals ->
                     -- Extra work. The grant it earned is the comp_leave_credits row whose note_id
                     -- points here; "Reviewed by the Owner" is decision = no_comp_leave. RLS: own
                     -- rows, all for attendance.view_all; no API writes (functions only). Audited.
comp_leave_credits   id, member_id, days numeric(2,1) (0.5 | 1.0), used_days numeric(2,1), reserved_days numeric(2,1),
                     granted_by, granted_at, granted_on date (IST), expires_on date (the last day of
                     the IST month of granted_on), note null (the Owner's, shown to the member),
                     note_id null -> extra_work_notes, revoked_at null, revoked_by null, revoke_reason null,
                     request_key uuid null (3b review: the grant dialog's key; unique per
                     (member_id, request_key) where not null), created_at, updated_at
                     -- 3b.2 (decisions 12, 14, 15, 17). check used + reserved <= days; a revoked
                     -- credit has used = reserved = 0. The status is DERIVED, never stored:
                     -- revoked_at -> revoked; used_days = days -> used; expires_on < today ->
                     -- expired (whatever is left is lost, and stays in history as expired);
                     -- reserved_days > 0 and nothing free -> reserved; else available with
                     -- days - used - reserved free. So there is no expiry job. RLS and grants as
                     -- extra_work_notes. Audited.
comp_leave_credit_uses
                     id, credit_id, leave_request_id, days numeric(2,1) (0.5 | 1.0),
                     state ('reserved'|'used'|'released'), created_at, updated_at, unique(credit_id, leave_request_id)
                     -- 3b.2 (decision 16): the ledger between a comp leave request and the credits
                     -- it draws on, oldest credit first. A submitted request reserves; approval
                     -- uses; reject / withdraw / cancel / supersede releases (the days go back to
                     -- the credit, which is simply expired by then if its month has passed). RLS:
                     -- through the credit's member (own, or attendance.view_all). Audited.
```
Functions (2.1, WORKFLOWS §1/§2). `public` schema (RPC), security definer, search_path = '', the usual grants. Each audited write is labelled through `app.audit_override`; a system correction carries `meta.system = true` (the audit trigger records the caller as actor). **No notification rows yet:** 5.1 adds them to every function below; the WORKFLOWS §9 recipient is named in each function's comment. The `app.*` helpers of this task that write or read across members (`attendance_event`, `attendance_apply_leave`, `attendance_release_leave`, `leave_covering`, `leave_overlaps`, and since 2.2 `leave_supersede_gate`, `leave_clash`, `leave_clash_label`; `attendance_logout` went with 3c.1) are **executable by service_role only**: the security definer functions call them as the owner, and `00_core_base` lists them as the exception to "authenticated may execute app.*".
```
app.ist_day_start(date)         -> timestamptz: midnight IST of that date (stable). SQL mirror of
                                core/time istDayStart(); use it for "events on this IST date" so an
                                index on the timestamp still applies
(attendance_touch(user_agent, ip_hash), the 2.x first-request gate that opened the day on sign-in,
                                was dropped by the 3c.1 contract migration; a day is opened by the
                                Start day tap, the prompt's leave choice or the 23:59 job, all through
                                app.attendance_open_day below)
public.attendance_submit(choice, reason, for_date)
                                attendance.self, today's own day. for_date (2.2, optional): the IST
                                date the gate screen was shown for; any other date is INVALID_STATE
                                ("The day changed. Choose again for today."). awaiting_choice -> pending_review;
                                or approved + proposed_by_system -> pending_review for choice =
                                present only ("I'm working today", leave_request_id kept). A leave
                                choice inserts leave_requests(source = attendance, today, submitted)
                                and links it; comp_leave is VALIDATION (3c.1: a credit is spent only
                                through leave_submit_comp). reason optional. Event submitted. Notifies nobody
public.attendance_decide(day_id, decision, status, reason)
                                attendance.decide. decision = 'approve' (pending_review only;
                                final_status = the submitted choice, or the proposed absent;
                                worked_on_leave when the choice was Present on a day linked to
                                approved leave, which stays untouched) or 'correct' (any state,
                                status required, REASON_REQUIRED without a reason; awaiting_choice
                                included, the gate then stops asking; Present on a date covered by
                                the linked approved leave sets worked_on_leave and that leave is
                                never touched, phase 2 review 2026-09-26). A linked submitted request is
                                decided in the same call: approved when the outcome equals its type,
                                otherwise rejected with the same reason. Correcting to a leave type
                                with no approved request of that type behind it creates
                                leave_requests(source = owner, approved) and links it; for
                                comp_leave (3c review) that request carries credit_days 1.0 and
                                draws the member's free credits valid on that date, oldest first
                                (app.comp_credit_draw), used at once (app.comp_credit_settle):
                                VALIDATION with none ("Comp leave needs an earned credit valid on
                                that date. Grant one first from their Leave tab.") or on a day off
                                ("That date is a day off. Comp leave is for a working day."); a
                                half comp day is not set here (leave_submit_comp's). A day whose
                                approved request already is comp leave is re-corrected without a
                                new request or credit. Events approved | corrected. Bulk = one call
                                per row. Notifies the member
(app.attendance_logout(member_id), the 2.x logout stamp, was dropped by the 3c.1 contract migration:
                                the End day tap is the end of a day, attendance_end_day below)
public.attendance_flag_overtime(day_id, reason)
                                attendance.self, own day, any state: overtime_flag = true and
                                overtime_reason, REQUIRED (VALIDATION when empty, 2.2; a second call
                                replaces the reason). Event overtime_flagged. No approval, no
                                notification
public.attendance_flag_overtime_today(reason)
                                attendance.self. The Log out note (phase 2 review, 2026-09-26):
                                attendance_flag_overtime() on the caller's day for today, or on
                                yesterday's when there is none today and yesterday has a start and
                                no end, the day attendance_end_day() will close (3c.1). INVALID_STATE
                                when neither exists. Returns the day id
public.leave_submit(type, start_date, end_date, reason)
                                attendance.self. Never comp_leave (VALIDATION, 3c.1: a comp leave
                                request reserves a credit through leave_submit_comp). start_date >=
                                today, end_date >= start_date, at most
                                365 days (phase 2 review, 2026-09-26; app.leave_validate, shared by
                                leave_request_change and leave_owner_edit), half_day a single date,
                                reason optional (VALIDATION otherwise). CONFLICT when
                                the range overlaps the caller's own submitted or approved request;
                                rejected, withdrawn, superseded and cancelled rows never block.
                                source = form. Audit 'submitted'. Notifies the Owner
public.leave_withdraw(request_id)
                                own row, submitted -> withdrawn. Never a source = attendance request:
                                the attendance day is the single door for those. Audit 'withdrawn'
public.leave_request_change(request_id, type, start_date, end_date, reason, cancel)
                                own approved request that has not ended (2.3: end_date < today IST
                                -> INVALID_STATE "This leave has ended. Ask the Owner to correct it.";
                                ongoing leave stays changeable; past leave is the Owner's, through
                                the attendance day) -> a new submitted row with supersedes_id. A
                                change to type comp_leave is VALIDATION (3c.1: no credit would be
                                spent; cancel and request comp leave from the credit instead).
                                cancel = true copies type and dates and sets requests_cancellation;
                                otherwise the new dates are validated as in leave_submit (start may
                                stay the original's, end >= today) and checked for overlap against
                                everything but the original. One open change per request (CONFLICT).
                                The original stays approved until the decision. Audit
                                'change_requested' | 'cancellation_requested'. Notifies the Owner
public.leave_decide(request_id, decision, reason)
                                attendance.decide, submitted only, never source = attendance. reject
                                needs a reason (REASON_REQUIRED). approve: an original this row
                                supersedes becomes superseded (a cancellation: the original becomes
                                cancelled and this row too), then "a later leave wins" over every day
                                in range: pending_review (2.2: only a day not yet decided) ->
                                corrected to the leave type (actor null, reason "leave approved",
                                event corrected, and the gate's own still-submitted request for
                                that day is superseded); an untouched derived day follows the new
                                request; an awaiting_choice day in range -> the derived day. CONFLICT
                                when approved leave already covers the dates. 2.2: only a form or
                                owner request clashes (the message names its type and dates); an
                                approved source = attendance request on those dates is superseded
                                first (app.leave_supersede_gate) and its day, approved or corrected,
                                is corrected to this leave even when the type is the same. A day the
                                Owner decided, approved or corrected (not a gate leave), is kept and
                                its date returned.
                                Returns (state, kept_dates date[]) since 2.2. A cancellation (and a
                                superseded range) returns today's untouched derived day (approved,
                                proposed_by_system, no submission) to awaiting_choice (actor null,
                                reason "leave cancelled") so the gate asks again; past days are
                                history and stay. Audit 'approved' | 'rejected' | 'cancelled'
                                (+ 'superseded' | 'cancelled' on the original). Notifies the member
public.leave_owner_edit(request_id, type, start_date, end_date, reason)
                                attendance.decide, approved only: the original becomes superseded by
                                a new source = owner, approved row (any dates; CONFLICT while the
                                member has another open request on them, a pending change to this
                                one included), then the same day corrections as leave_decide. 2.2:
                                an approved gate leave on the new dates is superseded before the
                                overlap check (app.leave_supersede_gate, as leave_decide). Audit
                                'superseded' + 'approved'. Notifies the member. 2.4: returns
                                (new_id uuid, kept_dates date[]), the new row's id and the dates whose
                                Owner decision was kept, as leave_decide. 3c review: type =
                                comp_leave is one date ("Comp leave is one day at a time. Edit it
                                to a single date.") on a working day ("That date is a day off. Comp
                                leave is for a working day."), the new row carries credit_days 1.0
                                and, after the superseded row's release, draws the member's free
                                credits valid on that date oldest first (app.comp_credit_draw) and
                                uses them at once; VALIDATION with none ("Grant one first from
                                their Leave tab"), the original then stays approved. A comp day
                                moved to another date re-uses its own credit
public.leave_owner_cancel(request_id, reason)
                                attendance.decide, approved only, REASON_REQUIRED: -> cancelled, and
                                today's untouched derived day returns to awaiting_choice. Notifies
                                the member
(attendance_today(), the 2.4 read, was dropped by the 3c.1 contract migration in favour of
                                attendance_today_detail() below, which the Owner's card and board read)

-- Jobs (2.5, WORKFLOWS §8). app schema (not an RPC), security definer, search_path = '',
-- executable by service_role only; pg_cron runs them as postgres. Every write is labelled through
-- app.audit_override, actor null (system). No notification rows yet (5.1).
app.job_day(at, cutoff)         -> date: the most recent IST date whose cutoff time has passed at
                                `at` (stable, strict). 23:59 IST on D -> D; 00:00 IST on D+1 -> D; 23:58
                                IST on D -> D-1. Both jobs default to job_day(now(), '23:59')
app.attendance_open_day(member_id, date)
                                the member's day for that date, opened when there is none: approved
                                leave covering it (app.leave_covering) -> approved, final_status =
                                the leave type, proposed_by_system, leave_request_id, event and audit
                                'derived_from_leave'; otherwise awaiting_choice, audit 'opened'.
                                No sign-in time (3c.1 dropped the third argument: a start is the
                                Start day tap); is_day_off = app.is_working_day(date) is false.
                                Named-constraint on-conflict re-read, so a concurrent writer's row
                                is returned. THE CALLER HOLDS THE MEMBER'S leave: LOCK. Used by
                                attendance_start_day, attendance_choose_leave_today and absent_check
app.absent_check(for_date default null)
                                returns (work_date, member_id, day_id, outcome 'proposed_absent' |
                                'derived_from_leave'), one row per day written. for_date null: the
                                7 IST dates ending at job_day(now(), '23:59'), oldest first (catch-
                                up, WORKFLOWS §8); a given date: that date only, INVALID_STATE when
                                its cutoff has not passed. Per date: app.is_working_day null ->
                                INVALID_STATE (no single organization in scope, do not act), false
                                -> nothing at all. Then for each active member whose role holds
                                attendance.self and whose attendance started before the date
                                (app.to_ist_date(joined_at) < date), in id order, under the
                                member's leave: lock (before any row lock): no day + leave covering
                                -> attendance_open_day (a derived day with no start); no day, no
                                leave -> pending_review, final_status = absent, proposed_by_system;
                                awaiting_choice and not is_day_off -> the same
                                update. Event proposed_absent, audit
                                'proposed_absent'. Any other state, and a row marked is_day_off,
                                is left alone: running twice writes nothing. Notifies the Owner
                                once per run with everyone proposed (5.1; the return value is the
                                list)
(app.logout_not_recorded(), the 2.x 00:00 job, and its cron row were dropped by the 3c.1 contract
                                migration; app.end_not_recorded below is the 3b.1 job in its place)
cron.job                        'absent_check' at 29 18 * * * (23:59 IST) -> select
                                app.absent_check(). Scheduled by the 2.5
                                migration through cron.schedule(name, schedule, command), which
                                updates an existing name instead of adding a second job

-- 3b.1 Start day / End day (migration start_end_day; PRODUCT §4.2, WORKFLOWS §1 "Settled in
-- 3b.1", ADR-0012 amendment 2026-09-27). Built EXPAND-ONLY beside the 2.x functions while main's
-- app still called them on the shared staging database; the 3c.1 contract migration
-- (20260928131234_contract_phase3b) then removed attendance_touch(), session_logout(),
-- app.attendance_logout(), attendance_today(), app.logout_not_recorded() and the three sign-in
-- columns, and re-created the readers below without them.
public.attendance_own_today()   attendance.self (FORBIDDEN otherwise: the Owner has no day). Read only,
                                security definer (it needs app.is_working_day). One row for the caller
                                and today (IST): (work_date, attendance_started: today > the IST date
                                of joined_at, is_working_day: app.is_working_day(today) is not false,
                                the day row's columns or nulls, leave_type of the linked request,
                                yesterday_open_day_id / yesterday_started_at: yesterday's day with a
                                start and no end, the one attendance_end_day() will close;
                                covering_leave_type: approved leave covering today while no row
                                exists yet, so a leave day never prompts). The
                                Start-day prompt and the attendance strip read it (one call per
                                request)
public.attendance_start_day()   attendance.self, the caller's own day for today (IST). INVALID_STATE
                                on the joining day, on a day off (app.is_working_day false, or a row
                                marked is_day_off: "add an I worked today note"), when started_at is
                                already set, or when today is a leave or a decided absence.
                                Takes the leave: lock, opens today's row through
                                app.attendance_open_day(member, today) when there is none. Then:
                                awaiting_choice -> pending_review, submitted_choice = present,
                                submitted_at = started_at = now(), event started (null -> present);
                                an untouched day derived from full leave or comp leave -> the same
                                ("I'm working today", leave_request_id kept, event started from the
                                leave status); a half-day leave day, or a day already Present (a
                                2.x gate choice, or one the Owner decided) -> started_at = now()
                                only, the standing unchanged, event started (null -> null). The
                                start time is the tap, never the app opening. Audit action: started.
                                Returns the day id. Notifies nobody (the Owner's Today is the digest)
public.attendance_choose_leave_today(choice, reason)
                                attendance.self. The prompt's "On leave today? Choose leave":
                                choice must be leave or half_day (VALIDATION for present or
                                comp_leave: comp leave is requested from the leave form, decision
                                16). Joining day and a day off are INVALID_STATE. Takes the leave:
                                lock, opens today's row when there is none, then
                                calls attendance_submit(choice, reason, today), so the rules, the
                                source = attendance request and the audit are the 2.1 ones
public.attendance_end_day()     attendance.self. The caller's day with started_at and no ended_at:
                                today's, else yesterday's (an End day after midnight lands on the
                                previous day, the 2.1 late-logout rule carried over: a real time,
                                never made up). ended_at = now() and end_not_recorded = false in one
                                write (a late End day clears the 00:00 flag, as 2.5 did for logout),
                                event ended. INVALID_STATE with no started day ("Start your day
                                first") or when today's day has ended ("Your day has already ended":
                                End day is final, no resume). Yesterday is looked at only when today
                                has no start at all, so a second tap after today ended never writes an
                                end onto an open yesterday (3bA review), and only while the IST time
                                is before org_settings.end_day_cutoff_time (3b review, default 05:00;
                                INVALID_STATE past it: yesterday stays end_not_recorded, late work
                                goes in an overtime note). Returns (day_id, work_date). 3b.2
                                re-creates it with the optional overtime note (below)
public.session_sign_out(user_agent, ip_hash)
                                "Sign out of this device" (ADR-0012 amendment): session_events(logout)
                                for the calling active member and nothing else; the attendance day
                                is never touched. Replaced session_logout(), dropped in 3c.1. The push
                                subscription of the device goes with 5.2 (no table yet)
public.attendance_today_detail()
                                the 2.4 attendance_today() shape plus started_at, ended_at and
                                end_not_recorded per row (and without the three 2.x columns since
                                3c.1): the Owner's Today card and people board (3b: "Not started",
                                "Started 9:12", "End not recorded"). attendance.view_all. The old
                                function keeps its shape for main
app.end_not_recorded(for_date default null)
                                the 00:00 IST job (WORKFLOWS §8), the same date rule as
                                app.absent_check: every day on the date with started_at set,
                                ended_at null and end_not_recorded false gets the flag, under the
                                member's leave: lock; audit end_not_recorded, no event. Returns
                                (work_date, member_id, day_id). Idempotent. Notifies nobody
app.end_day_reminder_due(at default now())
                                read only, service_role: the members to remind at 20:30 IST
                                ("You haven't ended your day", WORKFLOWS §9): every day on the IST
                                date of `at` with started_at set and ended_at null, for active
                                members. Returns (member_id, day_id, started_at). The notification
                                rows and the schedule are 5.1's (kickoff 3b decision 32)
cron.job                        'end_not_recorded' at 30 18 * * * (00:00 IST) -> select
                                app.end_not_recorded() (the 2.x logout_not_recorded row is gone, 3c.1)

-- 3b.2 Extra work and comp leave credits (migration extra_work_comp_leave; PRODUCT §4.3a,
-- WORKFLOWS §2 "Settled in 3b.2", kickoff 3b decisions 10-17). Expand-only again: the 2.x
-- leave functions keep their signatures and meaning (a settle on a request with no credit
-- uses is a no-op); leave_submit() is untouched and stays main's.
public.extra_work_note_submit(kind, work_date, note, duration_minutes default null)
                                attendance.self. kind overtime | day_off; work_date between today - 7
                                and today (IST) (VALIDATION otherwise: "up to 7 days back"); note
                                required (VALIDATION); duration_minutes 1..1440, overtime only (a
                                day_off note stores none). An overtime note on a day off, or a
                                day_off note on a working day (app.is_working_day), is VALIDATION
                                naming the other kind. A day before attendance started (the joining
                                day or earlier) is VALIDATION. One note per member, date and kind
                                (CONFLICT, a concurrent duplicate included). Audit 'submitted'.
                                Returns the id. Notifies the Owner
public.extra_work_note_decide(note_id, decision, days default null, mark_day_worked default false, note default null)
                                attendance.decide, submitted only (INVALID_STATE). decision grant
                                (days 0.5 | 1.0 required, VALIDATION) creates a comp_leave_credits
                                row (granted_on = today IST, expires_on = its month's last day,
                                note_id = this note, the Owner's optional note) or no_comp_leave
                                ("Reviewed by the Owner", no credit). mark_day_worked is for a
                                day_off note only (VALIDATION otherwise): under the member's leave:
                                lock, the attendance day for work_date is created (is_day_off,
                                corrected, present, decided by the Owner, reason 'worked on a day
                                off') or corrected to present when it does not already count as
                                Present; the leave request behind it, if any, is not touched. The
                                note -> reviewed with decision, day_marked_worked, decided_by/at.
                                Audit 'reviewed' (+ 'granted' on the credit, 'corrected' on the
                                day). Returns the credit id or null. Notifies the member
public.comp_leave_grant(member_id, days, note default null, request_key default null)
                                attendance.decide, independent of any note (decision 14): an active
                                member of the org whose role holds attendance.self (NOT_FOUND /
                                VALIDATION otherwise), days 0.5 | 1.0, expires_on = the end of this
                                IST month. Takes the member's leave: lock. Idempotent on request_key
                                (3b review): the same key returns the first credit, CONFLICT when the
                                amount differs. Audit 'granted' (once). Returns the id. Notifies the member
public.comp_leave_revoke(credit_id, reason)
                                attendance.decide, REASON_REQUIRED. Only an unused, unreserved,
                                unexpired, unrevoked credit (INVALID_STATE naming why). The
                                member's leave: lock before the credit row, so a revoke and a
                                comp leave request serialise. Sets
                                revoked_at/by/reason. Audit 'revoked'. Notifies the member
public.comp_leave_balance(member_id default null)
                                read: the caller's own (attendance.self) or, with attendance.view_all,
                                anyone's. Returns (available_days, use_by): the free days over
                                unrevoked credits with expires_on >= today, and the latest such
                                expiry (all live credits share the current month's end, decision 15)
public.leave_submit_comp(start_date, half_day default false, reason default null)
                                attendance.self. A comp leave request for ONE date (a full day, type
                                comp_leave with credit_days 1.0, or a half day, type half_day with
                                credit_days 0.5), start_date >= today and a working day (VALIDATION
                                on a weekly day off or a holiday, 3b review), reason optional,
                                CONFLICT on overlap as leave_submit. Under the leave: lock the credits with
                                expires_on >= start_date (the date counts, not the decision) and
                                free days are drawn oldest first (granted_at, id): VALIDATION "not
                                enough comp leave for that date" when they do not cover it (checked
                                again after the draw, so a request never stands on nothing). Writes
                                the request, one comp_leave_credit_uses row per credit drawn
                                (reserved) and reserved_days. Audit 'submitted' (meta comp). Returns
                                the id. Notifies the Owner
public.comp_leave_dates()       attendance.self, read (3b review): the working days (no weekly day off,
                                no holiday) from today to the latest use-by date of the caller's free
                                credits, each with the free days valid on it: (work_date,
                                available_days). Empty with no free credit. What the leave form lists
app.holiday_release_comp()      AFTER INSERT / UPDATE OF date on holidays (3b review): every waiting or
                                approved comp leave request (credit_days not null) covering the new
                                date -> cancelled, decided_by = the Owner adding it, a reason naming
                                the holiday; today's untouched derived day released; the credit
                                released (app.comp_credit_settle). Audit 'cancelled' (meta holiday)
                                and 'released'. Notifies the member (5.1)
app.end_day_late_allowed(at, cutoff), app.end_day_cutoff(org)
                                3b review: whether an IST instant is before the End day cutoff, and
                                the org's cutoff (internal)
app.comp_credit_draw(p_member, p_request_id, p_on, p_days) returns numeric
                                internal (3c review; service_role only; the caller holds the
                                member's leave: lock). Reserves p_days of the member's unrevoked
                                credits with expires_on >= p_on, oldest first (granted_at, id, for
                                update): reserved_days on each credit drawn, one
                                comp_leave_credit_uses row (reserved) per credit, audit 'reserved'
                                with {leave_request_id, days}. Returns the days left undrawn; the
                                caller refuses the request when it is above zero. The
                                leave_submit_comp() loop, lifted; that function keeps its own copy
app.comp_credit_settle(request_id, outcome)
                                internal (service_role only). outcome used: every reserved use of
                                the request -> used (reserved_days -> used_days on the credit);
                                released: every reserved or used use -> released (the days go back
                                to the credit; an expired credit shows them as expired). A request
                                with no uses is a no-op, so the 2.x callers below keep their
                                meaning. Audit on the credit: 'used' | 'released'
public.leave_withdraw / leave_decide / leave_owner_cancel / leave_owner_edit
                                re-created with the same signatures: leave_withdraw and
                                leave_decide(reject) settle 'released'; leave_decide(approve)
                                settles the approved request 'used' and a cancelled or superseded
                                original 'released'; leave_owner_cancel and leave_owner_edit settle
                                the cancelled / superseded row 'released'
public.leave_request_change     re-created: a change (cancel = false) of a request with credit_days
                                is INVALID_STATE ("Comp leave can't be changed: ask to cancel it
                                and request it again"); asking to cancel stays allowed and releases
                                the credit on approval
public.attendance_end_day(overtime_note default null, overtime_minutes default null)
                                re-created (dropped, 3b.1's shape; main never called it): after the
                                end, a non-null overtime_note becomes extra_work_note_submit
                                ('overtime', the ended day's date, note, minutes) in the same
                                transaction. Returns (day_id, work_date, note_id)
```
**Lock order (2.4, migration `attendance_owner_review`):** every function that writes a member's days or leave (`attendance_submit`, `attendance_decide`, `leave_submit`, `leave_withdraw`, `leave_request_change`, `leave_decide`, `leave_owner_edit`, `leave_owner_cancel`) takes `pg_advisory_xact_lock(hashtext('leave:' || member_id))` **before any row lock**. A function that starts from a row id reads the row's member without a lock, takes the advisory lock, then locks the row and re-checks it. `attendance_start_day()` (3b.1) takes the member's `leave:` lock before any row lock too, then looks for today's day and opens it under that lock (it derives the day from approved leave), so a phone and a laptop tapping Start day at the same instant produce one day (pgTAP `09`, two real connections); 2.2's `attendance_touch()`, with its own `touch:` lock in front of the `leave:` lock, went with the 3c.1 contract migration. pgTAP `12` asserts each waits on the advisory lock first. **2.5's jobs follow the same order:** `app.absent_check()` and `app.end_not_recorded()` (3b.1; 2.5's `app.logout_not_recorded()` went with 3c.1) take each member's `leave:` lock before that member's rows (members in id order, so two overlapping runs cannot cross), and `app.attendance_open_day()` is called only under it (pgTAP `14`). The comp leave draw and settle (`app.comp_credit_draw`, `app.comp_credit_settle`) lock credit rows after the day and request rows, under the same `leave:` lock. Partial index `attendance_days_pending_idx (work_date) where state = 'pending_review'` serves the Approvals list and badge.

## 4. Clients
```
clients              id, org_id, name, legal_name, state client_state, admin_id → members,
                     gstin, address, city, phone, email, website, drive_url, requirements, notes,
                     custom_fields, activated_at, archived_at, created_by, search tsvector (generated),
                     created_at, updated_at
                     -- kickoff 3 (2026-09-27): unique (org_id, lower(name)) where state <> 'inactive';
                     -- gstin check (15-char format) when not null; website / drive_url https only;
                     -- archived_at reserved (no archive action in phase 3: inactive is the end state)
                     -- 3.1: created by a plain INSERT under clients.manage (state draft; admin_id may be
                     -- given at creation and opens the first assignment row by trigger). state,
                     -- activated_at, admin_id and archived_at are protected columns (transition
                     -- functions only). API UPDATE grant: name, legal_name, gstin, address, city, phone,
                     -- email, website, drive_url, requirements, notes, custom_fields. Audited.
                     -- RLS: app.client_visible(id) = the org's Owner (clients.manage) or the current
                     -- Admin (admin_id = caller, holding clients.edit_assigned since the phase 3 review);
                     -- writes need clients.edit_assigned on a visible row. members trigger
                     -- client_admin_guard: an Admin who is some client's admin_id cannot stop being an
                     -- active Admin; client_hand_over(from_admin, moves jsonb) moves their clients first.
                     -- custom_fields (and client_contacts.custom_fields) are checked by the database too
                     -- (phase 3 review): ≤ 32 KB, and every key a write adds or changes has an active
                     -- definition in scope and a value of its type (app.custom_field_value_ok, the same
                     -- rules as core/custom-fields; url https only); unchanged keys pass, so an archived
                     -- field keeps its value. client_brand.colors ≤ 12 {name, hex #RRGGBB}, fonts ≤ 6
                     -- {family, usage?} (CHECKs app.brand_colors_ok / app.brand_fonts_ok).
                     -- Staff never read the table.
client_private       client_id pk, owner_notes, created_at, updated_at   -- Owner-only table
                     -- 3.1: one row per client, created by trigger with the client; single policy
                     -- clients.private_notes for select and update. Its activity_log entries are
                     -- readable by activity.view_all only (never an Admin).
client_close_reasons activity_id pk → activity_log(id), org_id, client_id, reason, created_at
                     -- Owner-only table (phase 3 review, 2026-09-27): the optional reason given to
                     -- client_close(), one row per 'closed' activity entry that had one. The entry's
                     -- meta carries only from_state, so the client's Admin (who reads the entry under
                     -- activity_log_select_clients) never reads the reason. Written only by
                     -- client_close(); select for clients.manage; no API write. Never rewritten.
client_admin_assignments  id, client_id, admin_id, assigned_by, from_at, to_at null, created_at
                     -- 3.1: history, never rewritten; unique partial (client_id) where to_at is null.
                     -- Written only by client_assign_admin() (and the clients insert trigger for an
                     -- admin given at creation). RLS: clients.manage reads all; an Admin reads the
                     -- rows where they are the admin. No API write.
client_contacts      id, org_id, client_id, name, designation, email, phone, is_primary, custom_fields,
                     archived_at, created_at, updated_at
                     -- unique partial index (client_id) where is_primary and archived_at is null;
                     -- exactly one primary once any live contact exists: the first live contact is
                     -- made primary by trigger, is_primary and archived_at move only through
                     -- client_contact_set_primary() / client_contact_archive(next) /
                     -- client_contact_restore(). API UPDATE grant: name, designation, email, phone,
                     -- custom_fields. RLS follows the client (clients.edit_assigned to write). Audited.
client_brand         client_id pk, logo_file_id → files (FK from 3.3), colors jsonb [{name, hex}],
                     fonts jsonb [{family, usage}], tone_of_voice, brand_notes, created_at, updated_at
                     -- shape validated by zod (arrays checked in SQL). Created by trigger with the
                     -- client. RLS follows the client. Audited (entity_id = client_id).
view client_labels   (id, name, state, logo_file_id, colors, fonts, tone_of_voice, brand_notes)
                     security-barrier view: rows for clients the caller may see OR that label a task
                     the caller is assigned to (app.labelled_client_ids(): the labels of the caller's
                     visible tasks since 4A)
```
**Functions (3.1, ADR-0006):** `app.admin_client_ids()` (the caller's assigned clients), `app.client_visible(client_id)`, `app.is_owner()`, `app.labelled_client_ids()` (since 4A: the client labels of the tasks the caller can see, `app.task_visible()`; empty before that), `client_activate(client_id)` (draft | paused → active; needs an active Admin), `client_pause(client_id)` (active → paused), `client_close(client_id, reason)` (active | paused → inactive), `client_reactivate(client_id)` (inactive → active; the name must be free again), `client_assign_admin(client_id, admin_id)` (any state; closes the open assignment and opens the next; notifies the new and previous Admin, WORKFLOWS §9, delivered by 5.1), `client_contact_set_primary(contact_id)`, `client_contact_archive(contact_id, next_primary_id)`, `client_contact_restore(contact_id)`. Every lifecycle function is `clients.manage`; the contact functions are `clients.edit_assigned` on a visible client.

## 5. Client work: projects, cycles, items
```
projects             id, client_id (required), name, description, recurrence, state project_state,
                     billing_category (Owner-set; default from recurrence; a template's default applies
                     only when the Owner creates the project), template_id null,
                     custom_fields, created_by, completed_at, completed_by, archived_at
                     -- guard trigger: state, billing_category, client_id and recurrence change only
                     -- through transition functions (billing_category/client_id/recurrence: Owner only)
project_stages       id, project_id, name, position                  -- copied from a preset; may be empty
project_item_blueprints  id, project_id, title, position            -- item list copied into each new cycle
project_cycles       id, project_id, period_start date null, period_end date null, label,
                     state cycle_state, generated_by ('schedule'|'manual'|'create'|'carry'), created_at,
                     unique(project_id, period_start),
                     unique partial index (project_id) where period_start is null  -- one cycle per one-time project
project_items        id, cycle_id, title, position, planned_date null, notes, custom_fields,
                     state item_state, done_at, done_by, approved_at, approved_by,
                     cancelled_reason, cancelled_by, cancelled_at,
                     carry_decision null, carry_decided_by, carry_decided_at,
                     carried_from_item_id null, origin_cycle_id (self cycle unless carried in)
project_item_stages  item_id, stage_id, done_at, done_by, pk(item_id, stage_id)
item_reviews         id, item_id, decision review_decision, reason, reviewer_id, at   -- append-only
project_templates    id, org_id, name, description, recurrence, default_billing_category (applied only
                     when the Owner creates the project), stages text[], items text[], field_defaults jsonb, archived_at
```

## 6. Staff tasks
```
tasks                id, org_id, title, description, task_type_id, client_id null (label only),
                     priority, due_at timestamptz, event_date date null, event_start_at null,
                     event_end_at null, location null, purpose null, state task_state,
                     approving_admin_id null, admin_step admin_step, created_by,
                     primary_owner_id, reminder_rules jsonb, late_reason, cancelled_reason,
                     custom_fields, template_id null,
                     submitted_at, submitted_by null, submitted_on_behalf_of null,
                     admin_approved_at, completed_at, cancelled_at, archived_at,
                     search tsvector (generated: title, description, location), created_at, updated_at
                     -- kickoff 4 (owner decision 2026-09-28): due_at NOT NULL; task_create refuses a due_at
                     -- in the past (later edits may move it anywhere); priority default 'medium'. An Admin
                     -- creator's client_id must be one of admin_client_ids() (so approving_admin_id = the
                     -- creator); the Owner sets any client_id and picks any active Admin as approver
                     -- 4A as built: an event type (task_types.kind = event) requires event_date and may
                     -- carry event_start_at / event_end_at (the optional time, on that IST date; no end =
                     -- 1 hour for the overlap warning; no start = a date-only event) and purpose; location
                     -- only when the type has_location. template_id has no FK until 4.6 creates
                     -- task_templates. Checks: cancelled_reason / cancelled_at exactly when cancelled,
                     -- completed_at exactly when completed, admin_step 'required' | 'skipped' only with an
                     -- approving Admin, event times need event_date, end after start. NO API writes at all
                     -- (every change is a task_* function); the state columns carry protect_columns too.
                     -- RLS select: app.task_visible(id) (the Owner all; created / approving / assigned /
                     -- labelled with an assigned client; a coordinator sees their current freelancers'
                     -- tasks). Audited through app.audit_override; a task's history is every activity_log
                     -- row with entity_id = the task (the child tables audit with entity_id = task_id)
task_assignees       task_id, member_id, is_primary, assigned_at, assigned_by,
                     -- kickoff 4: member_id is never the Owner (refused by task_create / task_update_assignment)
                     acknowledged_at null, acknowledged_by null (the coordinator when on behalf; else = member_id),
                     removed_at null, pk(task_id, member_id)
                     -- 4A: unique partial index (task_id) where is_primary and removed_at is null. A
                     -- removed person re-added gets a fresh assigned_at and acknowledgement (WORKFLOWS
                     -- §3.2). No API writes. Audited (entity_id = task_id; actions assigned, unassigned,
                     -- acknowledged, primary_changed)
task_stages          id, task_id, name, position, done_at, done_by, on_behalf_of null,   -- optional checklist
                     created_at, updated_at
                     -- 4A: created by task_create / task_update_assignment, or through the API by a task
                     -- manager (creator, approving Admin, Owner) while the task is not completed or
                     -- cancelled: insert, rename, reorder, delete an unticked stage. Ticked (done_at,
                     -- done_by = the caller, on_behalf_of) through the API by an active assignee, or by
                     -- the current coordinator of a freelancer assignee, while the task is todo,
                     -- in_progress or changes_requested (locked from submitted, WORKFLOWS §3.1);
                     -- app.task_stages_guard() enforces it. Audited (entity_id = task_id)
task_comments        id, task_id, author_id, on_behalf_of null, body, created_at        -- append-only
                     -- on_behalf_of (4A, ADR-0013): set when a coordinator acts for a freelancer; the
                     -- actor column keeps the coordinator. Same pair on task_submissions (submitted_by,
                     -- on_behalf_of) and on the Done/resubmit transition (tasks.submitted_by,
                     -- tasks.submitted_on_behalf_of). Never set on a review (a freelancer never reviews).
                     -- 4A: inserted through the API (tasks.work, a visible task, author_id = the caller;
                     -- app.task_comments_guard() checks on_behalf_of: a freelancer assignee the caller
                     -- currently coordinates), in any state (assignees still comment once locked).
                     -- UPDATE / DELETE revoked. body 1..5000. Audited (entity_id = task_id)
task_reviews         id, task_id, step ('admin'|'owner'), decision, reason, reviewer_id,
                     submission_id null, at                          -- append-only; written by task_review only
task_submissions     id, task_id, version int, note, submitted_by, on_behalf_of null, at, unique(task_id, version)
                     -- kickoff 4 (owner decision 2026-09-28): built in 4A, before phase 8. Every Done and
                     -- resubmit writes a version; note null or text (≤ 5000) that may contain http/https
                     -- links, rendered as tappable links for the reviewer; no submission_items until 8.1.
                     -- Written by task_submit_done only
submission_items     id, submission_id, kind ('upload'|'drive_link'),
                     file_id null (uploads), source_url null (pasted Drive link),
                     source_file_id null (Google file id of THEIR file),
                     original_name, mime, size_bytes null,
                     preview_file_id null (generated JPEG preview for photos),
                     link_state ('ok'|'private'|'missing'|'unchecked'), link_checked_at,
                     archive_state ('queued'|'archived'|'failed'|'blocked'),
                     drive_file_id null, drive_web_link null, archived_at,
                     archive_error, archive_attempts, local_deleted_at, created_at
task_reminders       id, task_id, member_id null, kind ('before_due'|'due'|'overdue'|'ack'|
                     'ack_escalation'|'overdue_escalation'|'event'), escalation_level int null (1 = Admin, 2 = Owner),
                     fire_at, sent_at null, cancelled_at null       -- materialized from reminder_rules + org_settings
task_warnings        id, task_id, kind ('overlap'|'workload'|'on_leave'), member_id (the person the
                     warning is about; 4A), details jsonb, overridden_by, at
                     -- 4A: the dialog computes the warnings (4.3, member_availability()); a person kept
                     -- despite one is recorded by task_create / task_update_assignment (the warnings
                     -- argument), overridden_by = the caller; a member_id that is not a uuid is
                     -- VALIDATION. No API writes. Audited (entity_id = task_id).
                     -- RLS (4A review M1): a warning names another person's leave or load, so the rows
                     -- and their warning_overridden entries are read with app.task_visible(task_id) AND
                     -- availability.view (the Owner and Admins, PERMISSIONS §2), never by a Staff
                     -- co-assignee or coordinator
task_requests        id, org_id, requested_by, title, details, client_id null, state request_state,
                     decided_by, decided_at, decision_reason, task_id null
task_templates       id, org_id, name, task_type_id, description, default_priority,
                     stages text[], reminder_rules jsonb, field_defaults jsonb, archived_at,
                     created_by                                     -- kickoff 4: shared company-wide; an Admin
                     -- edits and archives only rows they created, the Owner any (PERMISSIONS ³).
                     -- Built in 4.6 with task_requests (4A left tasks.template_id without an FK)
```
**Helpers (4A, ARCHITECTURE §5), `app` schema, security definer, stable:** `app.task_visible(task_id)` (the RLS gate of every task table: the Owner sees every task of the organization; otherwise the caller created it, is its approving Admin, is an active assignee, holds `clients.edit_assigned` and the label is one of `app.admin_client_ids()`, or is the current coordinator of an active freelancer assignee), `app.is_task_assignee(task_id, member_id)` (active row, `removed_at` null), `app.is_approving_admin(task_id)`, `app.task_manager(task_id)` (creator, approving Admin or the Owner: who may edit, reassign, cancel, reopen), `app.task_on_behalf_ok(task_id, freelancer_id)` (the freelancer is an active freelance assignee and `app.coordinator_of()` is the caller; a coordinator's on-behalf right on comments and stage ticks). Internal (service_role only, called inside the functions): `app.task_lock(task_id, org_id)` (the row `for update`, NOT_FOUND outside the organization), `app.task_actor(task_id, on_behalf_of)` (who acts and for whom: the caller must hold `tasks.work`, be `permanent` (a freelancer's own id is never an actor: FORBIDDEN) and be an active assignee, or `on_behalf_of` names a freelance assignee whose current coordinator is the caller; a former coordinator, another member or anyone naming a non-freelancer is FORBIDDEN), `app.task_check_fields(..., p_client_changed)` (the field rules shared by `task_create` and `task_update_assignment`; since the 4A review (S1) the own-clients rule runs only when `p_client_changed`: always on create, on an edit only when `client_id` is sent and differs, so the approving Admin edits the other fields of an Owner task labelled with another Admin's client).

**Transition functions (4.2, ADR-0006, WORKFLOWS §3), `public` schema, the usual grants; each names its WORKFLOWS §9 recipients in its comment (delivery 5.1):**
`task_create(title, description, task_type_id, client_id, priority, due_at, assignee_ids, primary_owner_id, approving_admin_id, event_date, event_start_at, event_end_at, location, purpose, stages, custom_fields, reminder_rules, template_id, warnings)` → task id (`tasks.create`; the approval route: the Owner names any active Admin or none, an Admin's task routes to the Admin and its label must be one of their clients; assignees are active Admins, Staff or freelancers, never the Owner, the primary among them; `due_at` required and not in the past; the type's field rules; `reminder_rules` default to the type's; `warnings` = `[{kind, member_id, details}]` recorded as overridden; audit `created`, `assigned` per assignee, `warning_overridden`);
`task_acknowledge(task_id, on_behalf_of)` ("Task Noted", any non-final state, once; audit `acknowledged`);
`task_start(task_id, on_behalf_of)` (`todo` → `in_progress`, any assignee; no acknowledgement is implied);
`task_submit_done(task_id, note, late_reason, on_behalf_of)` (the primary owner, or their coordinator, from `todo` / `in_progress` / `changes_requested`; `late_reason` required past `due_at` (REASON_REQUIRED); writes the next `task_submissions` version; acknowledges the primary owner if not yet (audit `acknowledged`, meta `implied`); → `submitted` with `admin_step` `required` when an approving Admin exists and is not an assignee, else → `admin_approved` with `admin_step` `none` (no approver) or `skipped` (approver is an assignee, meta.reason `approver_is_assignee`); audit `submitted`);
`task_review(task_id, decision, reason)` (`submitted`: the approving Admin only, `tasks.approve_admin`, never an assignee → `admin_approved` or `changes_requested`; `admin_approved`: `tasks.approve_final` → `completed` or `changes_requested`; the Owner does not decide at the Admin step (INVALID_STATE: remove or change the approver instead); `rejected` needs a reason (REASON_REQUIRED); one `task_reviews` row pointing at the latest submission; bulk approve = the app calling it per id, as the attendance bulk does; audit `admin_approved`, `completed`, `changes_requested`);
`task_reopen(task_id, reason)` (`app.task_manager`; `completed` → `in_progress`, `cancelled` → `todo`; reason required; `admin_step` back to `required` / `none`, the completion and cancellation stamps cleared (the diff keeps them); acknowledgements kept; audit `reopened`, meta.reason);
`task_cancel(task_id, reason)` (`app.task_manager`; any non-final state → `cancelled`; audit `cancelled`);
`task_update_assignment(task_id, changes, warnings)` → text[] of changed fields (`app.task_manager` with `tasks.create`; not on a final task; `changes` is a jsonb object of the keys to change: title, description, task_type_id, client_id (a label an Admin sets or changes: own clients only; 4A review S1), priority, due_at (any value), event_date, event_start_at, event_end_at, location, purpose, custom_fields, reminder_rules, assignee_ids (the full new set: added rows get a fresh acknowledgement, removed rows get `removed_at`, a person re-added is re-opened; an element that is not a uuid is VALIDATION), primary_owner_id; the field-level audit is the trigger's diff on `tasks` (action `updated`, meta.fields) plus `assigned` / `unassigned` / `primary_changed` rows; notifies the affected assignees);
`task_set_approver(task_id, approving_admin_id)` (the Owner; an active permanent Admin or null; not on a final task; `admin_step` follows: null → `none`, else `required`; while `submitted`, the review moves to the new approver, or the task goes to `admin_approved` at once when the approver is removed (`none`) or is an assignee (`skipped`); audit `approver_changed`, meta.from / meta.to);
`member_availability(from_date, to_date, member_ids)` (`availability.view`; read only; one row per active non-Owner member per IST day in the range (≤ 62 days): `open_tasks_due` (tasks not completed / cancelled whose `due_at` falls on that day), `event_blocks` (`[{start_at, end_at}]` of the person's event tasks that day, no end = one hour; no titles or ids), `leave` (`leave` / `half_day` / `comp_leave` for approved leave covering the day, `requested` for a pending request, null for a freelancer), `present` (today only: a Start day recorded). What 4.3's warnings and an Admin's view of others are computed from).

## 7. Money (all Owner-only tables)
## 7. Money (all Owner-only tables)
```
project_billing      project_id pk, cycle_amount numeric null (recurring), fixed_amount numeric null (one-time)
item_billing         item_id pk, value numeric                       -- explicit per-item value
cycle_billing        cycle_id pk, billing_status, billed_on date, note
revenue_overrides    id, scope ('cycle'|'project'), ref_id, calculated_value, adjusted_value,
                     note, by_id, at, superseded_at null
views (security invoker, Owner only): item_values_v, revenue_by_cycle_v, revenue_by_client_month_v
```
All amounts are `numeric(12,2)` in INR.

### 7a. Expense claims (a member's own money; ADR-0007 amendment 2026-09-27, task 3b.3)
Not business money and not in `modules/revenue`: a member's own reimbursement claims, read and written only through `modules/expenses` (lint: the relation name appears nowhere else in `src/`).
```
expense_claims       id, member_id → members, expense_date date (IST), amount numeric(12,2) (> 0, INR),
                     category_id → list_items (list_key 'expense_category'), note (required, ≤ 500),
                     receipt_file_id null → files (unique: one upload, one claim), state ('submitted'|
                     'approved'|'rejected'|'withdrawn'|'paid'), decided_by null, decided_at null,
                     decision_reason null (the reject reason, shown to the member), paid_on date null,
                     paid_by null, paid_at null, created_at, updated_at
                     -- 3b.3 (PRODUCT §4.18, kickoff 3b decisions 21-27). checks: decided_* set exactly
                     -- when approved | rejected | paid; decision_reason exactly when rejected; paid_*
                     -- exactly when paid. RLS: SELECT own rows, or every row for expenses.decide (the
                     -- Owner); **an Admin reads no one else's row, not even their team's** (pgTAP per
                     -- role). No API writes at all (functions only), protect_columns on every column,
                     -- audited (the claimant and the Owner read the entries: activity_log policy
                     -- activity_log_select_expenses_self + activity.view_all). Never in a Realtime
                     -- publication, search or an export. Admins and Staff claim (attendance.self);
                     -- freelancers never (phase 4 adds engagement = permanent to the check).
```
Functions (3b.3, `public`, security definer, `search_path = ''`, audited through `app.audit_override`; the WORKFLOWS §9 recipient is named in each comment, delivery is 5.1's, **an amount never appears in a notification's text**):
```
expense_claim_submit(expense_date, amount, category_id, note, receipt_file_id default null) -> uuid
                                attendance.self. The claim window (app.expense_window_start: the 1st of
                                this IST month, or of last month through the 5th; never a future date),
                                an active expense_category, > 0 with at most two decimals, the note
                                required; a receipt required when amount > org_settings.expense_receipt_above;
                                a receipt is a ready, unarchived PNG / JPEG / WebP original the caller
                                uploaded less than 6 days ago and attached nowhere else. Audit: submitted.
expense_claim_withdraw(claim_id)    the claimant, while submitted -> withdrawn. Audit: withdrawn.
expense_claim_decide(claim_id, decision 'approve'|'reject', reason)
                                expenses.decide, submitted only; reject needs the reason. Audit:
                                approved | rejected.
expense_claim_mark_paid(claim_id, paid_on default today IST)
                                expenses.decide, approved only -> paid; paid_on not in the future and not
                                before the expense. Audit: paid.
app.file_visible(file)          re-created (same signature): also true for a receipt when the caller holds
                                expenses.decide (the claimant is its uploader already).
```

### 7b. Month summary (task 3b.4)
No table: the summary is computed live from the attendance and extra-work tables (PRODUCT §4.18, kickoff 3b decisions 18–20, 31).
```
month_summary(month date, member_id uuid default null)
                                attendance.view_all (the Owner). One row (id = the member, full_name,
                                role, status, then the figures) per member who marks attendance
                                (a role holding attendance.self), joined by the month's last day and not
                                deactivated before its first, or the one member asked for, over the IST
                                month containing `month`: working_days (days of the month that are
                                working days by app.is_working_day), days_worked (decided Present on a
                                working day + ½ per decided half day), present_days, leave_days, half_days
                                (a half day that is not comp leave), absent_days, comp_leave_days (a
                                comp_leave day, + ½ for a half day that used a comp credit; the Owner's
                                comp leave uses a credit too since the 3c review, so comp_leave_days and
                                credits_used agree), additional_leave (leave_days + ½ × half_days + absent_days;
                                comp leave never counts), days_off_worked (decided Present on a day off,
                                its own line), pending_days (days waiting for the Owner: pending_review),
                                overtime_notes, overtime_granted (notes of the month whose decision is
                                granted), credits_granted / credits_used / credits_expired (days of the
                                month's unrevoked comp credits: granted, used, and what was left when
                                the month ended). "Decided" is state approved | corrected: attendance is
                                the Owner's decision (invariant 7), so a day still waiting shows as
                                pending, never as worked. The 2.x gate days count like any other (their
                                final_status is the same; decision 31). No money: the Owner's
                                approved-unpaid expenses come from modules/expenses beside it.
```

## 8. Google Drive archive (Owner-managed, core module `drive`)
```
drive_account        org_id pk, google_email, refresh_token_encrypted, access_token_encrypted,
                     token_expires_at, root_folder_id, scopes, connected_by, connected_at,
                     state ('connected'|'needs_reconnect'|'disconnected'), last_error,
                     quota_total_bytes, quota_used_bytes, quota_checked_at
drive_folders        id, org_id, path_key text unique       -- e.g. 'Clients/Cafe Mocha/2026-10/Photos'
                     drive_folder_id, created_at            -- cache so folders are made once
drive_jobs           id, submission_item_id, kind ('copy_link'|'upload_file'|'recheck_link'|
                     'delete_local'), state ('queued'|'running'|'done'|'failed'|'blocked'),
                     attempts, next_attempt_at, last_error, created_at, finished_at
```
- Tokens are encrypted with a server-side key (never sent to the browser). Only `drive.manage` can read `drive_account`.
- `drive_jobs` is the retry queue: idempotent, with exponential backoff and a cap.

## 9. Files, notifications, audit, reports
```
files                id, org_id, storage_key, name, mime, size_bytes, sha256 null, uploaded_by,
                     status ('pending'|'ready'|'failed'|'deleted'), created_at, archived_at,
                     preview_of null → files (a browser-made JPEG preview of that original; 3.3)
                     -- 'deleted' = the R2 object was removed by retention; the row stays
                     -- kickoff 3 (3.3): logos and avatars ≤ 5 MB (logo PNG/JPEG/WebP/SVG, avatar no
                     -- SVG); replacing archives the old row; storage_cleanup deletes objects of rows
                     -- archived 30 days ago, of pending or failed rows older than 24 h and of ready
                     -- originals nothing references after 7 days (3B review). Served to the browser
                     -- through /api/files/<id> (permission-checked, Cache-Control: private) for
                     -- previews; presigned GET (5 min) for downloads. Local and e2e use MinIO
                     -- 3.3 as built: status and archived_at are protected columns. A member inserts their
                     -- own pending row (uploaded_by = caller, status pending; preview_of must be their own
                     -- file); file_complete(id, size, sha256) moves pending → ready and file_fail(id) → failed
                     -- (uploader only); file_mark_deleted(id) (service_role only, the cleanup job) sets
                     -- deleted. app.file_visible(id): the uploader; any member for the company logo; team.view
                     -- or the person for an avatar; app.client_visible or a label row for a client logo; a
                     -- preview follows its original. storage_key = <org>/<yyyy>/<mm>/<file id>/<name>. Audited.
                     -- 3A review: file_cleanup_candidates also returns failed rows past the pending window
                     -- (a browser that gave up after the PUT left an object); files_archive_replaced audits
                     -- each archived row (original and previews) as 'archived'; files_reference_guard
                     -- resolves client_brand's org through clients.
                     -- 3B review (owner decision 2026-09-27): an **orphaned ready** original is a
                     -- candidate too: status ready, not archived, older than 7 days, and referenced by
                     -- no foreign key column that points at files (read from the catalog, so a new
                     -- consumer is protected by declaring its FK; files.preview_of is not a reference).
                     -- Phase 3 review (security must-fix, 2026-09-27): **no API insert**. A row is created
                     -- only by file_begin(id, uploader, name, mime, size_bytes, preview_of) and made ready
                     -- only by file_complete(id, uploader, size_bytes, sha256), both service_role only and
                     -- called by core/storage's actions after their own checks (permission, type and size
                     -- against the purpose; the object's size from the bucket; the SVG rewrite). file_begin
                     -- builds storage_key itself (<org>/<IST yyyy/mm>/<id>/<name>, a name of '', '.' or '..'
                     -- becomes 'file'), so a key can never alias another object; created_at is always now().
                     -- Both record the uploader as the activity actor. file_fail(id) stays the uploader's.
                     -- Phase 3 review (should-fix, 2026-09-27): **one upload, one place**: files_reference_guard
                     -- refuses an archived file and a file already attached elsewhere
                     -- (app.file_reference_count(id), the catalog scan), and the cleanup's archived branch
                     -- spares a file any foreign key still references, and a preview whose original is.
                     -- A preview follows its original: a candidate once the original is one or is
                     -- deleted, unless a foreign key references the preview itself (ADR-0010: a
                     -- submission's preview outlives its deleted local original). Signature:
                     -- file_cleanup_candidates(archived_before, pending_before, orphaned_before, batch
                     -- default 200); the 3-argument form is dropped (phase-3 only, never on main).
                     -- files_reference_guard refuses to attach an upload 6 days old or more ("Upload the
                     -- file again"), so nothing the 7-day rule takes can be referenced mid-cleanup
                     -- (20260927134340). A new column referencing files needs its FK **and an index**:
                     -- the cleanup runs one not-exists per FK column on every batch.
notifications        id, recipient_id, kind, title, body, link, entity, entity_id, payload jsonb,
                     created_at, read_at null, escalation_level int
notification_deliveries  id, notification_id, channel ('push'|'email'), state ('queued'|'sent'|'failed'),
                     attempts, last_error, sent_at
activity_log         id bigint identity, org_id, actor_id null (system), on_behalf_of_id null (4A,
                     ADR-0013: the freelancer a coordinator acted for; actor_id stays the coordinator;
                     written by app.audit_row_change() from the override's on_behalf_of key, else
                     from the audited row's own on_behalf_of on an insert or a tick (4A review S2: the
                     API comments and stage ticks), or by a transition function's own insert),
                     entity, entity_id, action,
                     diff jsonb (old/new), meta jsonb, at               -- append-only (UPDATE/DELETE revoked)
                     -- written only by app.audit_row_change() and transition functions (no INSERT grant).
                     -- RLS: activity.view_all, or entries about the caller's own member row except its
                     -- deactivated entry (the reason is the Owner's note). Scope is per entity, never per
                     -- actor: a row an Admin's action produced may describe an Owner-only table.
                     -- Each module adds a policy for the entities it owns (PERMISSIONS §2)
eod_reports          id, org_id, report_date, data jsonb, generated_at, unique(org_id, report_date)
month_snapshots      id, org_id, month date (1st), version int, data jsonb, closed_by, closed_at,
                     corrects_id null, correction_note, unique(org_id, month, version)
                     -- eod_reports and month_snapshots contain revenue: Owner-only tables
                     -- (single policy has_permission('reports.all')). Admin scoped reports are computed live.
feature_flags        key pk, enabled, description
```

## 10. Key indexes
- Every FK column.
- `tasks(state, due_at)`, `tasks(approving_admin_id, state)`, `tasks(client_id)`, `task_assignees(member_id) where removed_at is null`.
- `attendance_days(work_date, state)`, `leave_requests(state)`, `leave_requests(member_id, start_date, end_date)`.
- `project_items(cycle_id, state)`, `project_cycles(project_id, period_start)`.
- `task_reminders(fire_at) where sent_at is null and cancelled_at is null`.
- `notifications(recipient_id, read_at, created_at desc)`.
- `drive_jobs(state, next_attempt_at)`, `submission_items(archive_state)`, `submission_items(link_state) where kind = 'drive_link'`.
- `activity_log(entity, entity_id, at desc)`, `activity_log(actor_id, at desc)`.
- Full-text search: `tsvector` generated columns on clients, tasks, projects, items and contacts, with GIN indexes.
