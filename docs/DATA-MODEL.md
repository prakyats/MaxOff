# MaxOff: Data Model

> The authoritative list of tables. Migrations must match it. Change it here (and in an ADR for anything structural) **before** writing a migration.
> Conventions (ARCHITECTURE §6): `id uuid pk`, `created_at`, `updated_at` (trigger) and `created_by` on business tables. `archived_at` instead of delete. RLS on every table. Workflow `state` columns change **only** through transition functions.
> **Org seam:** root tables have `org_id uuid not null default current_org_id()`. Child tables inherit scope from their parent. There's one organization row in the prototype.

## 0. Enums (only for categories code depends on)
```
member_role        owner | admin | staff
member_status      invited | active | deactivated
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
app.is_working_day(date)        weekly offs + holidays, arrives in 1.4

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
                                function writes no second row. Cleared by the trigger after use
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
public.session_logout(user_agent, ip_hash)   the same for logout. 2.1 extends it with
                                attendance_days.last_logout_at
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
app.members_job_title_guard()   BEFORE INSERT/UPDATE on members: job_title_id, when set, is an
                                unarchived list_items row with list_key = 'job_title' of the same org
app.seed_org_lists()            AFTER INSERT on organizations: the launch job titles (PRODUCT §7)
```

## 1. Organization, people and access
```
organizations        id, name, logo_file_id (added in 3.3 with files), timezone ('Asia/Kolkata'), created_at, updated_at
org_settings         org_id pk, weekly_off_days smallint[] (0=Sun..6=Sat), logout_reminder_time time,
                     ack_repeat_hours int (2), ack_escalate_hours int (4), ack_escalate_owner_hours int (8),
                     overdue_escalate_hours int (24), email_daily_cap_per_member int (20),
                     default_task_reminders jsonb, workload_warning_threshold int
                     -- defaults in brackets = launch settings (PRODUCT §7); default_task_reminders '[]' until
                     -- 5.3, workload_warning_threshold null until 4.3. Created by trigger with the organization
holidays             id, org_id, date, name, unique(org_id, date)
members              id (= auth.users.id), org_id, full_name, email, phone, avatar_file_id (added in 3.3),
                     role member_role, job_title_id null → list_items (1.3), status member_status,
                     invited_at, joined_at, deactivated_at, created_at, updated_at
                     unique partial index (org_id) where role = 'owner'; unique index on lower(email)
                     -- status, invited_at, joined_at, deactivated_at are protected columns (transition
                     -- functions only, 1.2/1.3). RLS: own row; every row for team.view; writes team.manage;
                     -- own name/phone/avatar editable (PERMISSIONS §3). job_title_id is in the API
                     -- role's UPDATE grant, and app.members_self_edit_guard() keeps it team.manage-only
member_directory     view (security definer): id, org_id, full_name, phone, role, status, job_title_id,
                     created_at (+ avatar_file_id from 3.3). Everyone's row for team.view,
                     plus the caller's own.
                     No email (PERMISSIONS §2). Names of people on a member's own tasks join in 4.1
role_permissions     role member_role, permission text, pk(role, permission)   -- seeded
session_events       id, member_id, kind ('login'|'logout'), at, user_agent (≤ 512), ip_hash
                     -- append-only, written only by session_login() / session_logout() (1.2) and
                     -- attendance_touch() (2.1). ip_hash = salted SHA-256 of the client IP
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
                     -- 1.3 (core/lists). unique (org_id, list_key, lower(name)) where archived_at is
                     -- null. RLS: every active member reads; insert/update need lists.manage; no
                     -- DELETE (archive instead). Audited. Seeded per organization by trigger with the
                     -- launch job titles (PRODUCT §7); 1.4 adds the Settings screen
task_types           id, org_id, name, kind task_type_kind, shows_on_calendar bool,
                     has_location bool, default_reminders jsonb, color, icon, position,
                     is_system, archived_at
                     -- seeds: Normal(normal), Shoot / Site Visit(event), Meeting(event),
                     --        Posting(event), Review / Approval(normal), Other(normal), Custom(custom)
stage_presets        id, org_id, name, stages text[] (ordered), archived_at
field_definitions    id, org_id, entity ('client'|'contact'|'project'|'item'|'task'),
                     client_id null (a field that exists for one client only),
                     task_type_id null (a field that exists for one task type only),
                     key, label, help_text, type field_type, options jsonb, required,
                     section, position, archived_at, unique(org_id, entity, key, client_id, task_type_id)
                     -- rows with entity in ('project','item') are Owner-only to create/edit (PERMISSIONS ¹)
```
Entities with custom fields have `custom_fields jsonb not null default '{}'`, validated against active definitions on every write (`core/custom-fields`).

## 3. Attendance and leave
```
attendance_days      id, member_id, work_date date (IST), first_login_at, is_day_off bool,
                     state attendance_state, submitted_choice attendance_choice null, submitted_at,
                     proposed_by_system bool (absent check), final_status day_status null,
                     decided_by, decided_at, decision_reason,
                     last_logout_at, logout_not_recorded bool, overtime_flag bool, overtime_reason,
                     worked_on_leave bool ("1 day worked": Present approved on an approved-leave day),
                     leave_request_id null, unique(member_id, work_date)
attendance_events    id, attendance_day_id, action ('submitted'|'proposed_absent'|'derived_from_leave'|
                     'approved'|'corrected'|'logout'|'overtime_flagged'), from_status, to_status, reason,
                     actor_id null (system), at                    -- append-only
leave_requests       id, member_id, type leave_type, start_date, end_date, reason,
                     state leave_state, source ('form'|'attendance'|'owner'), supersedes_id null,
                     decided_by, decided_at, decision_reason, created_at
```

## 4. Clients
```
clients              id, org_id, name, legal_name, state client_state, admin_id → members,
                     gstin, address, city, phone, email, website, drive_url, requirements, notes,
                     custom_fields, activated_at, archived_at, created_by
client_private       client_id pk, ceo_notes                        -- Owner-only table
client_admin_assignments  id, client_id, admin_id, assigned_by, from_at, to_at null
client_contacts      id, client_id, name, designation, email, phone, is_primary, custom_fields, archived_at
client_brand         client_id pk, logo_file_id, colors jsonb [{name, hex}], fonts jsonb [{family, usage}],
                     tone_of_voice, brand_notes                     -- shape validated by zod
view client_labels   (id, name, logo_file_id, colors, fonts, tone_of_voice, brand_notes)
                     security-barrier view: rows only for clients the caller may see OR that label a task
                     the caller is assigned to
```

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
                     priority, due_at timestamptz, event_start_at null, event_end_at null,
                     location null, purpose null, state task_state,
                     approving_admin_id null, admin_step admin_step, created_by,
                     primary_owner_id, reminder_rules jsonb, late_reason, cancelled_reason,
                     custom_fields, template_id null,
                     submitted_at, admin_approved_at, completed_at, cancelled_at, archived_at
task_assignees       task_id, member_id, is_primary, assigned_at, assigned_by,
                     acknowledged_at null, removed_at null, pk(task_id, member_id)
task_stages          id, task_id, name, position, done_at, done_by   -- optional checklist
task_comments        id, task_id, author_id, body, created_at        -- append-only
task_reviews         id, task_id, step ('admin'|'owner'), decision, reason, reviewer_id,
                     submission_id null, at                          -- append-only
task_submissions     id, task_id, version int, note, submitted_by, at, unique(task_id, version)
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
task_warnings        id, task_id, kind ('overlap'|'workload'|'on_leave'), details jsonb,
                     overridden_by, at
task_requests        id, org_id, requested_by, title, details, client_id null, state request_state,
                     decided_by, decided_at, decision_reason, task_id null
task_templates       id, org_id, name, task_type_id, description, default_priority,
                     stages text[], reminder_rules jsonb, field_defaults jsonb, archived_at
```

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
                     status ('pending'|'ready'|'failed'|'deleted'), created_at, archived_at
                     -- 'deleted' = the R2 object was removed by retention; the row stays
notifications        id, recipient_id, kind, title, body, link, entity, entity_id, payload jsonb,
                     created_at, read_at null, escalation_level int
notification_deliveries  id, notification_id, channel ('push'|'email'), state ('queued'|'sent'|'failed'),
                     attempts, last_error, sent_at
activity_log         id bigint identity, org_id, actor_id null (system), entity, entity_id, action,
                     diff jsonb (old/new), meta jsonb, at               -- append-only (UPDATE/DELETE revoked)
                     -- written only by app.audit_row_change() and transition functions (no INSERT grant).
                     -- RLS: activity.view_all; own actions; entries about the caller's own member row.
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
