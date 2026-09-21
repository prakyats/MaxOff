# MaxOff: Data Model

> The authoritative list of tables. Migrations must match it. Change it here (and in an ADR for anything structural) **before** writing a migration.
> Conventions (ARCHITECTURE §6): `id uuid pk`, `created_at`, `updated_at` (trigger) and `created_by` on business tables. `archived_at` instead of delete. RLS on every table. Workflow `state` columns change **only** through transition functions.
> **Org seam:** root tables have `org_id uuid not null default current_org_id()`. Child tables inherit scope from their parent. There's one organization row in the prototype.

## 0. Enums (only for categories code depends on)
```
member_role        ceo | admin | staff
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
field_type         text | long_text | number | currency | date | datetime | checkbox | select |
                   multi_select | url | email | phone | color | member | rating
```

## 1. Organization, people and access
```
organizations        id, name, logo_file_id, timezone ('Asia/Kolkata'), created_at
org_settings         org_id pk, weekly_off_days smallint[] (0=Sun..6=Sat), logout_reminder_time time,
                     ack_repeat_hours int, ack_escalate_hours int, overdue_escalate_hours int,
                     default_task_reminders jsonb, workload_warning_threshold int
holidays             id, org_id, date, name, unique(org_id, date)
members              id (= auth.users.id), org_id, full_name, email, phone, avatar_file_id,
                     role member_role, job_title_id → list_items, status member_status,
                     invited_at, joined_at, deactivated_at
                     unique partial index (org_id) where role = 'ceo'
role_permissions     role member_role, permission text, pk(role, permission)   -- seeded
session_events       id, member_id, kind ('login'|'logout'), at, user_agent, ip_hash
push_subscriptions   id, member_id, endpoint unique, p256dh, auth, user_agent, created_at,
                     last_success_at, failure_count, disabled_at
```

## 2. Configuration (customization as data)
```
list_items           id, org_id, list_key ('job_title'|...), name, description, color, icon,
                     position, meta jsonb, is_system, archived_at
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
```
Entities with custom fields have `custom_fields jsonb not null default '{}'`, validated against active definitions on every write (`core/custom-fields`).

## 3. Attendance and leave
```
attendance_days      id, member_id, work_date date (IST), first_login_at, is_day_off bool,
                     state attendance_state, submitted_choice attendance_choice null, submitted_at,
                     proposed_by_system bool (absent check), final_status day_status null,
                     decided_by, decided_at, decision_reason,
                     last_logout_at, logout_not_recorded bool, overtime_flag bool, overtime_reason,
                     leave_request_id null, unique(member_id, work_date)
attendance_events    id, attendance_day_id, action ('submitted'|'proposed_absent'|'approved'|
                     'corrected'|'logout'|'overtime_flagged'), from_status, to_status, reason,
                     actor_id, at                                  -- append-only
leave_requests       id, member_id, type leave_type, start_date, end_date, reason,
                     state leave_state, source ('form'|'attendance'|'ceo'), supersedes_id null,
                     decided_by, decided_at, decision_reason, created_at
```

## 4. Clients
```
clients              id, org_id, name, legal_name, state client_state, admin_id → members,
                     gstin, address, city, phone, email, website, drive_url, requirements, notes,
                     custom_fields, activated_at, archived_at, created_by
client_private       client_id pk, ceo_notes                        -- CEO-only table
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
                     billing_category (CEO-set; default from recurrence), template_id null,
                     custom_fields, created_by, completed_at, completed_by, archived_at
project_stages       id, project_id, name, position                  -- copied from a preset; may be empty
project_item_blueprints  id, project_id, title, position            -- item list copied into each new cycle
project_cycles       id, project_id, period_start date null, period_end date null, label,
                     state cycle_state, generated_by ('schedule'|'manual'|'create'),
                     unique(project_id, period_start)
project_items        id, cycle_id, title, position, planned_date null, notes, custom_fields,
                     state item_state, done_at, done_by, approved_at, approved_by,
                     cancelled_reason, carry_decision null, carry_decided_by, carry_decided_at,
                     carried_from_item_id null, origin_cycle_id (self cycle unless carried in)
project_item_stages  item_id, stage_id, done_at, done_by, pk(item_id, stage_id)
item_reviews         id, item_id, decision review_decision, reason, reviewer_id, at   -- append-only
project_templates    id, org_id, name, description, recurrence, default_billing_category,
                     stages text[], items text[], field_defaults jsonb, archived_at
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
task_reviews         id, task_id, step ('admin'|'ceo'), decision, reason, reviewer_id,
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
                     'ack_escalation'|'overdue_escalation'|'event'), fire_at, sent_at null,
                     cancelled_at null                               -- materialized from reminder_rules
task_warnings        id, task_id, kind ('overlap'|'workload'|'on_leave'), details jsonb,
                     overridden_by, at
task_requests        id, org_id, requested_by, title, details, client_id null, state request_state,
                     decided_by, decided_at, decision_reason, task_id null
task_templates       id, org_id, name, task_type_id, description, default_priority,
                     stages text[], reminder_rules jsonb, field_defaults jsonb, archived_at
```

## 7. Money (all CEO-only tables)
```
project_billing      project_id pk, cycle_amount numeric null (recurring), fixed_amount numeric null (one-time)
item_billing         item_id pk, value numeric                       -- explicit per-item value
cycle_billing        cycle_id pk, billing_status, billed_on date, note
revenue_overrides    id, scope ('cycle'|'project'), ref_id, calculated_value, adjusted_value,
                     note, by_id, at, superseded_at null
views (security invoker, CEO only): item_values_v, revenue_by_cycle_v, revenue_by_client_month_v
```
All amounts are `numeric(12,2)` in INR.

## 8. Google Drive archive (CEO-managed, core module `drive`)
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
                     status ('pending'|'ready'|'failed'), created_at, archived_at
notifications        id, recipient_id, kind, title, body, link, entity, entity_id, payload jsonb,
                     created_at, read_at null, escalation_level int
notification_deliveries  id, notification_id, channel ('push'|'email'), state ('queued'|'sent'|'failed'),
                     attempts, last_error, sent_at
activity_log         id bigint identity, org_id, actor_id null (system), entity, entity_id, action,
                     diff jsonb (old/new), meta jsonb, at               -- append-only (UPDATE/DELETE revoked)
eod_reports          id, org_id, report_date, data jsonb, generated_at, unique(org_id, report_date)
month_snapshots      id, org_id, month date (1st), version int, data jsonb, closed_by, closed_at,
                     corrects_id null, correction_note, unique(org_id, month, version)
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
