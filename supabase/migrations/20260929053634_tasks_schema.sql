-- 4A (4.1) Staff tasks: the schema (PRODUCT §4.6, WORKFLOWS §3, PERMISSIONS §2/§3, DATA-MODEL §0/§2/§6;
--   ADR-0004, ADR-0005, ADR-0006, ADR-0013; kickoff 4 decisions 1-5, 10, 11, 14, 15).
--
-- 1. Enums (DATA-MODEL §0): task_state, admin_step, priority, task_type_kind, review_decision.
-- 2. task_types: seeded per organization by trigger and backfilled; the Owner's list (a guard
--    refuses every write without settings.manage, PERMISSIONS ³); field_definitions.task_type_id
--    gains its FK and the definitions guard checks it.
-- 3. tasks, task_assignees, task_stages, task_comments, task_reviews, task_submissions,
--    task_warnings: indexes, audit (entity_id = the task), protect_columns, grants.
-- 4. Visibility: app.task_visible() and friends; RLS on every table; the activity_log policy;
--    app.labelled_client_ids() filled in (what client_labels shows Staff, ADR-0005);
--    app.directory_visible() re-created with the people on the caller's tasks.
-- 5. The API paths that stay plain edits, each with a guard: task_comments (insert only) and
--    task_stages (a manager's checklist edits, a worker's ticks). Everything else is a
--    task_* function (the next migration).
-- 6. member_availability(): counts and busy blocks, how Admins see other people (ADR-0004).
--
-- EXPAND-ONLY (ARCHITECTURE §18): new enums, tables, functions and policies; a view with more
-- rows; an FK on a column nothing has written yet. Append-only: never edit once applied.

-- 1. Enums ------------------------------------------------------------------------------------------
create type public.task_state as enum (
  'todo', 'in_progress', 'submitted', 'admin_approved', 'changes_requested', 'completed', 'cancelled');
create type public.admin_step as enum ('required', 'none', 'skipped');
create type public.priority as enum ('low', 'medium', 'high', 'urgent');
create type public.task_type_kind as enum ('normal', 'event', 'custom');
create type public.review_decision as enum ('approved', 'rejected');

comment on type public.task_state is
  'WORKFLOWS §3.1. Overdue is derived (now() > due_at and not completed / cancelled), never a state.';
comment on type public.admin_step is
  'How the Admin approval step stands: required (an approving Admin exists), none (the Owner '
  'assigned directly), skipped (the approving Admin is an assignee; recorded at Done).';
comment on type public.task_type_kind is
  'A task type''s behaviour: normal, event (event date, times, purpose; on the calendar), custom. Names are data.';

-- 2. task_types -------------------------------------------------------------------------------------
create table public.task_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default app.current_org_id() references public.organizations (id),
  name text not null check (length(btrim(name)) between 1 and 80),
  kind public.task_type_kind not null default 'normal',
  shows_on_calendar boolean not null default false,
  has_location boolean not null default false,
  default_reminders jsonb not null default '[]'::jsonb check (jsonb_typeof(default_reminders) = 'array'),
  color text null check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  icon text null check (icon is null or length(icon) <= 64),
  position text not null default 'a0' check (length(position) between 1 and 64),
  is_system boolean not null default false,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.task_types is
  'The task types (PRODUCT §4.6; ADR-0002: data, not code). kind decides a task''s fields; '
  'default_reminders become a new task''s reminder_rules (kickoff 4 decision 14). The Owner''s list '
  '(settings.manage, PERMISSIONS ³): Admins only pick from it. Archived, never deleted.';
create unique index task_types_active_name_unique
  on public.task_types (org_id, lower(btrim(name))) where archived_at is null;
create index task_types_org_position_idx on public.task_types (org_id, position);

create trigger set_updated_at before update on public.task_types
  for each row execute function app.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.task_types
  for each row execute function app.audit_row_change();

-- lists.manage (Admins too) edits lists; the task types are the Owner's (kickoff 4 decision 15).
-- Not security definer, so a function or a migration (the owner) passes through app.in_transition().
create function app.task_types_owner_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.in_transition() then
    return new;
  end if;
  if not app.has_permission('settings.manage') then
    perform app.fail('FORBIDDEN', 'Task types are the Owner''s to change.');
  end if;
  return new;
end;
$$;

revoke all on function app.task_types_owner_guard() from public;
grant execute on function app.task_types_owner_guard() to authenticated, service_role;

comment on function app.task_types_owner_guard() is
  'BEFORE INSERT OR UPDATE on task_types (4A, PERMISSIONS ³): an API write needs settings.manage '
  '(the Owner), although lists.manage opens every other list to Admins.';

create trigger task_types_owner_guard before insert or update on public.task_types
  for each row execute function app.task_types_owner_guard();

alter table public.task_types enable row level security;
-- Every active member reads the types (the create dialog, cards, the calendar).
create policy task_types_select on public.task_types for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c));
create policy task_types_insert on public.task_types for insert to authenticated
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('settings.manage')));
create policy task_types_update on public.task_types for update to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('settings.manage')))
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('settings.manage')));

revoke all on public.task_types from anon;
revoke delete, truncate, references, trigger on public.task_types from authenticated;
-- position moves through a function with the Settings screen (as list_items); is_system never.
revoke update on public.task_types from authenticated;
grant update (name, shows_on_calendar, has_location, default_reminders, color, icon, archived_at)
  on public.task_types to authenticated;

-- The seven launch types (PRODUCT §4.6) for every organization, now and later.
create function app.seed_org_task_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_types (org_id, name, kind, shows_on_calendar, has_location, position)
  values (new.id, 'Normal', 'normal', false, false, 'a0'),
         (new.id, 'Shoot / Site Visit', 'event', true, true, 'a1'),
         (new.id, 'Meeting', 'event', true, true, 'a2'),
         (new.id, 'Posting', 'event', true, false, 'a3'),
         (new.id, 'Review / Approval', 'normal', false, false, 'a4'),
         (new.id, 'Other', 'normal', false, false, 'a5'),
         (new.id, 'Custom', 'custom', false, false, 'a6');
  return null;
end;
$$;

revoke all on function app.seed_org_task_types() from public;
grant execute on function app.seed_org_task_types() to authenticated, service_role;

comment on function app.seed_org_task_types() is
  'AFTER INSERT on organizations: the launch task types (PRODUCT §4.6). Rows, not code: the Owner '
  'renames or archives them in Settings.';

create trigger seed_org_task_types after insert on public.organizations
  for each row execute function app.seed_org_task_types();

insert into public.task_types (org_id, name, kind, shows_on_calendar, has_location, position)
select o.id, t.name, t.kind::public.task_type_kind, t.cal, t.loc, t.position
from public.organizations o
cross join (values
  ('Normal', 'normal', false, false, 'a0'),
  ('Shoot / Site Visit', 'event', true, true, 'a1'),
  ('Meeting', 'event', true, true, 'a2'),
  ('Posting', 'event', true, false, 'a3'),
  ('Review / Approval', 'normal', false, false, 'a4'),
  ('Other', 'normal', false, false, 'a5'),
  ('Custom', 'custom', false, false, 'a6')) t(name, kind, cal, loc, position)
where not exists (select 1 from public.task_types tt where tt.org_id = o.id);

-- A task field that exists for one type only (3.2 left the column without its table).
alter table public.field_definitions
  add constraint field_definitions_task_type_id_fkey foreign key (task_type_id) references public.task_types (id);
create index field_definitions_task_type_idx on public.field_definitions (task_type_id);

-- 3. The task tables -------------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default app.current_org_id() references public.organizations (id),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text null check (description is null or length(description) <= 10000),
  task_type_id uuid not null references public.task_types (id),
  client_id uuid null references public.clients (id),
  priority public.priority not null default 'medium',
  due_at timestamptz not null,
  event_date date null,
  event_start_at timestamptz null,
  event_end_at timestamptz null,
  location text null check (location is null or length(location) <= 300),
  purpose text null check (purpose is null or length(purpose) <= 1000),
  state public.task_state not null default 'todo',
  approving_admin_id uuid null references public.members (id),
  admin_step public.admin_step not null default 'none',
  created_by uuid not null references public.members (id),
  primary_owner_id uuid not null references public.members (id),
  reminder_rules jsonb not null default '[]'::jsonb check (jsonb_typeof(reminder_rules) = 'array'),
  late_reason text null check (late_reason is null or length(late_reason) <= 1000),
  cancelled_reason text null check (cancelled_reason is null or length(cancelled_reason) <= 1000),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  template_id uuid null,
  submitted_at timestamptz null,
  submitted_by uuid null references public.members (id),
  submitted_on_behalf_of uuid null references public.members (id),
  admin_approved_at timestamptz null,
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  archived_at timestamptz null,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_cancelled_matches_state check (
    (state = 'cancelled') = (cancelled_at is not null) and (state = 'cancelled') = (cancelled_reason is not null)),
  constraint tasks_completed_matches_state check ((state = 'completed') = (completed_at is not null)),
  constraint tasks_admin_step_needs_approver check (admin_step = 'none' or approving_admin_id is not null),
  constraint tasks_event_times_need_date check (event_start_at is null or event_date is not null),
  constraint tasks_event_end_after_start check (
    event_end_at is null or (event_start_at is not null and event_end_at > event_start_at)),
  constraint tasks_submitted_pair check (submitted_on_behalf_of is null or submitted_by is not null)
);
comment on table public.tasks is
  'A staff task (PRODUCT §4.6, ADR-0005: client_id is a label, never a link to client work). '
  'Every write is a task_* transition function (no API grant at all); state and its timestamps '
  'carry protect_columns as well. RLS: app.task_visible(id). Audited through app.audit_override; '
  'the history is every activity_log row whose entity_id is the task.';
comment on column public.tasks.due_at is
  'The deadline, an exact instant (IST on screen). Required; task_create refuses a past one, a '
  'later edit may move it anywhere (kickoff 4 decision 4). Overdue = now() > due_at while open.';
comment on column public.tasks.event_date is
  'Event types only (task_types.kind = event): the day of the shoot, meeting or posting. The '
  'optional time is event_start_at / event_end_at on that IST date (no end = one hour for the '
  'overlap warning; no start = a date-only event, which never overlaps).';
comment on column public.tasks.template_id is
  'The task template the task was made from (4.6 creates task_templates and the FK).';

create index tasks_org_state_due_idx on public.tasks (org_id, state, due_at);
create index tasks_approving_admin_idx on public.tasks (approving_admin_id, state);
create index tasks_client_idx on public.tasks (client_id);
create index tasks_created_by_idx on public.tasks (created_by);
create index tasks_primary_owner_idx on public.tasks (primary_owner_id);
create index tasks_task_type_idx on public.tasks (task_type_id);
create index tasks_submitted_by_idx on public.tasks (submitted_by);
create index tasks_submitted_on_behalf_of_idx on public.tasks (submitted_on_behalf_of);
create index tasks_event_date_idx on public.tasks (org_id, event_date) where event_date is not null;
create index tasks_search_idx on public.tasks using gin (search);

create table public.task_assignees (
  task_id uuid not null references public.tasks (id),
  member_id uuid not null references public.members (id),
  is_primary boolean not null default false,
  assigned_at timestamptz not null default now(),
  assigned_by uuid null references public.members (id),
  acknowledged_at timestamptz null,
  acknowledged_by uuid null references public.members (id),
  removed_at timestamptz null,
  primary key (task_id, member_id),
  constraint task_assignees_ack_pair check ((acknowledged_at is null) = (acknowledged_by is null))
);
comment on table public.task_assignees is
  'Who a task is assigned to (WORKFLOWS §3.2): one primary owner among the active rows; each row '
  'acknowledges once ("Task Noted"; acknowledged_by is the coordinator when on behalf). A removed '
  'person keeps their row with removed_at. Never the Owner. Written by the task functions only.';
create unique index task_assignees_one_primary on public.task_assignees (task_id)
  where is_primary and removed_at is null;
create index task_assignees_member_idx on public.task_assignees (member_id) where removed_at is null;
create index task_assignees_assigned_by_idx on public.task_assignees (assigned_by);
create index task_assignees_acknowledged_by_idx on public.task_assignees (acknowledged_by);

create table public.task_stages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  position text not null default 'a0' check (length(position) between 1 and 64),
  done_at timestamptz null,
  done_by uuid null references public.members (id),
  on_behalf_of uuid null references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_stages_done_pair check ((done_at is null) = (done_by is null)),
  constraint task_stages_on_behalf_needs_done check (on_behalf_of is null or done_at is not null)
);
comment on table public.task_stages is
  'A task''s optional checklist (PRODUCT §4.6; no presets, typed on the task or from a template). '
  'Managed by the task''s creator / approving Admin / Owner while the task is open; ticked by an '
  'active assignee, or by a freelancer assignee''s current coordinator (on_behalf_of), while the '
  'task is todo / in_progress / changes_requested (app.task_stages_guard). Audited (entity_id = task).';
create index task_stages_task_idx on public.task_stages (task_id, position);
create index task_stages_done_by_idx on public.task_stages (done_by);
create index task_stages_on_behalf_of_idx on public.task_stages (on_behalf_of);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id),
  author_id uuid not null default auth.uid() references public.members (id),
  on_behalf_of uuid null references public.members (id),
  body text not null check (length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
comment on table public.task_comments is
  'Timestamped comments on a task (PRODUCT §4.6), append-only. Inserted through the API by anyone '
  'who sees the task and holds tasks.work, in any state (assignees still comment once locked); '
  'on_behalf_of = a freelancer assignee the author currently coordinates (app.task_comments_guard). '
  'Audited (entity_id = task).';
create index task_comments_task_idx on public.task_comments (task_id, created_at);
create index task_comments_author_idx on public.task_comments (author_id);
create index task_comments_on_behalf_of_idx on public.task_comments (on_behalf_of);

create table public.task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id),
  version integer not null check (version >= 1),
  note text null check (note is null or length(note) <= 5000),
  submitted_by uuid not null references public.members (id),
  on_behalf_of uuid null references public.members (id),
  at timestamptz not null default now(),
  unique (task_id, version)
);
comment on table public.task_submissions is
  'One version per Done or resubmit (WORKFLOWS §3.3; kickoff 4 decision 10): the optional note may '
  'carry http / https links, the hand-in until phase 8 adds submission_items. Written by '
  'task_submit_done only; append-only.';
create index task_submissions_submitted_by_idx on public.task_submissions (submitted_by);
create index task_submissions_on_behalf_of_idx on public.task_submissions (on_behalf_of);

create table public.task_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id),
  step text not null check (step in ('admin', 'owner')),
  decision public.review_decision not null,
  reason text null check (reason is null or length(reason) <= 1000),
  reviewer_id uuid not null references public.members (id),
  submission_id uuid null references public.task_submissions (id),
  at timestamptz not null default now(),
  constraint task_reviews_reason_on_reject check (decision <> 'rejected' or reason is not null)
);
comment on table public.task_reviews is
  'Every approve or reject (WORKFLOWS §3.3): the step, the decision, the reason, the reviewer and '
  'the submission version it refers to. Written by task_review only; append-only. Never on behalf.';
create index task_reviews_task_idx on public.task_reviews (task_id, at);
create index task_reviews_reviewer_idx on public.task_reviews (reviewer_id);
create index task_reviews_submission_idx on public.task_reviews (submission_id);

create table public.task_warnings (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id),
  kind text not null check (kind in ('overlap', 'workload', 'on_leave')),
  member_id uuid not null references public.members (id),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  overridden_by uuid not null references public.members (id),
  at timestamptz not null default now()
);
comment on table public.task_warnings is
  'An assignment warning the person assigning proceeded past (WORKFLOWS §3.1 "Assignment '
  'warnings"): the kind, who it was about, the details the dialog showed, who overrode it. Written '
  'by task_create / task_update_assignment only; append-only.';
create index task_warnings_task_idx on public.task_warnings (task_id);
create index task_warnings_member_idx on public.task_warnings (member_id);
create index task_warnings_overridden_by_idx on public.task_warnings (overridden_by);

-- Triggers: updated_at, the state guard, the audit (entity_id = the task on every child table).
create trigger set_updated_at before update on public.tasks
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.task_stages
  for each row execute function app.set_updated_at();
create trigger protect_columns before update on public.tasks
  for each row execute function app.protect_columns(
    'org_id', 'state', 'approving_admin_id', 'admin_step', 'created_by', 'primary_owner_id',
    'late_reason', 'cancelled_reason', 'submitted_at', 'submitted_by', 'submitted_on_behalf_of',
    'admin_approved_at', 'completed_at', 'cancelled_at', 'archived_at');
create trigger protect_columns before update on public.task_assignees
  for each row execute function app.protect_columns(
    'task_id', 'member_id', 'is_primary', 'assigned_at', 'assigned_by', 'acknowledged_at',
    'acknowledged_by', 'removed_at');

create trigger audit_row_change after insert or update or delete on public.tasks
  for each row execute function app.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.task_assignees
  for each row execute function app.audit_row_change('task_id');
create trigger audit_row_change after insert or update or delete on public.task_stages
  for each row execute function app.audit_row_change('task_id');
create trigger audit_row_change after insert or update or delete on public.task_comments
  for each row execute function app.audit_row_change('task_id');
create trigger audit_row_change after insert or update or delete on public.task_reviews
  for each row execute function app.audit_row_change('task_id');
create trigger audit_row_change after insert or update or delete on public.task_submissions
  for each row execute function app.audit_row_change('task_id');
create trigger audit_row_change after insert or update or delete on public.task_warnings
  for each row execute function app.audit_row_change('task_id');

-- Custom field values on a task (DATA-MODEL §2, core/custom-fields): checked on every write, the
-- functions' too (they are the only writers), against the active task definitions of the
-- organization scoped to no type or to the task's type.
create function app.task_custom_fields_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then old.custom_fields else '{}'::jsonb end;
  v_key text;
  v_value jsonb;
  v_def public.field_definitions;
begin
  if octet_length(new.custom_fields::text) > 32768 then
    perform app.fail('VALIDATION', 'These custom fields are too long.');
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(new.custom_fields) e loop
    continue when v_old -> v_key is not distinct from v_value;
    select d.* into v_def from public.field_definitions d
    where d.entity = 'task' and d.key = v_key and d.archived_at is null
      and d.org_id = new.org_id
      and (d.task_type_id is null or d.task_type_id = new.task_type_id)
    order by d.task_type_id nulls last
    limit 1;
    if v_def.id is null then
      perform app.fail('VALIDATION', format('There is no field "%s" here.', v_key));
    end if;
    if not app.custom_field_value_ok(v_def.type, v_def.options, v_value) then
      perform app.fail('VALIDATION', format('%s: this is not a valid value.', v_def.label));
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function app.task_custom_fields_guard() from public;
grant execute on function app.task_custom_fields_guard() to authenticated, service_role;

comment on function app.task_custom_fields_guard() is
  'BEFORE INSERT OR UPDATE OF custom_fields on tasks: every changed key names an active task field '
  'of the organization (global or this task type''s) and its value fits the type '
  '(app.custom_field_value_ok). Runs inside the functions too: they are the only writers.';

create trigger custom_fields_guard before insert or update of custom_fields on public.tasks
  for each row execute function app.task_custom_fields_guard();

-- A definition's type is immutable once a task holds a value for it (3.2 guard, tasks added).
create or replace function app.field_definition_has_values(def public.field_definitions)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case def.entity
    when 'client' then exists (
      select 1 from public.clients c
      where c.org_id = def.org_id and c.custom_fields ? def.key
        and (def.client_id is null or c.id = def.client_id))
    when 'contact' then exists (
      select 1 from public.client_contacts cc
      where cc.org_id = def.org_id and cc.custom_fields ? def.key
        and (def.client_id is null or cc.client_id = def.client_id))
    when 'task' then exists (
      select 1 from public.tasks t
      where t.org_id = def.org_id and t.custom_fields ? def.key
        and (def.task_type_id is null or t.task_type_id = def.task_type_id))
    else false
  end;
$$;

comment on function app.field_definition_has_values(public.field_definitions) is
  'True when any record in the definition''s scope holds a value under its key. clients, '
  'client_contacts and tasks (4A); projects and items join when they gain custom_fields.';

create or replace function app.field_definitions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  opt jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.entity <> old.entity or new.key <> old.key
       or new.client_id is distinct from old.client_id
       or new.task_type_id is distinct from old.task_type_id
       or new.org_id <> old.org_id then
      perform app.fail('FORBIDDEN', 'A field''s entity, key and scope never change. Archive it and add a new one.');
    end if;
    -- Kickoff 3 (9): the type is immutable once a value exists.
    if new.type <> old.type and app.field_definition_has_values(old) then
      perform app.fail('INVALID_STATE', 'This field already holds values, so its type cannot change. Archive it and add a new field.');
    end if;
  end if;
  if new.client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.client_id and c.org_id = new.org_id
  ) then
    perform app.fail('NOT_FOUND', 'This client does not exist.');
  end if;
  -- 4A: a per-type task field names a task type of the same organization.
  if new.task_type_id is not null and not exists (
    select 1 from public.task_types tt where tt.id = new.task_type_id and tt.org_id = new.org_id
  ) then
    perform app.fail('NOT_FOUND', 'This task type does not exist.');
  end if;
  -- Options are {key, label} objects with distinct keys in the same format as a field key.
  for opt in select * from jsonb_array_elements(new.options) loop
    if jsonb_typeof(opt) <> 'object'
       or not (opt ->> 'key') ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
       or length(btrim(coalesce(opt ->> 'label', ''))) not between 1 and 80 then
      perform app.fail('VALIDATION', 'Each option needs a key and a label.');
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(new.options) o) <> (select count(distinct o ->> 'key') from jsonb_array_elements(new.options) o) then
    perform app.fail('VALIDATION', 'Option keys must be distinct.');
  end if;
  return new;
end;
$$;

comment on function app.field_definitions_guard() is
  'BEFORE INSERT OR UPDATE on field_definitions: entity, key and scope never change; the type is '
  'immutable once a value exists (INVALID_STATE); a client or task type scope must exist (4A); '
  'options are {key, label} objects with distinct keys.';

-- Grants -------------------------------------------------------------------------------------------
revoke all on public.tasks, public.task_assignees, public.task_stages, public.task_comments,
  public.task_reviews, public.task_submissions, public.task_warnings from anon;
revoke truncate, references, trigger on public.tasks, public.task_assignees, public.task_stages,
  public.task_comments, public.task_reviews, public.task_submissions, public.task_warnings from authenticated;
-- Function-only tables: not one API write.
revoke insert, update, delete on public.tasks, public.task_assignees, public.task_reviews,
  public.task_submissions, public.task_warnings from authenticated;
-- Comments: append-only; author_id is the default (auth.uid()), never chosen.
revoke insert, update, delete on public.task_comments from authenticated;
grant insert (task_id, body, on_behalf_of) on public.task_comments to authenticated;
-- Stages: a manager's checklist edits and a worker's ticks (the guard below decides which).
revoke insert, update on public.task_stages from authenticated;
grant insert (task_id, name, position) on public.task_stages to authenticated;
grant update (name, position, done_at, done_by, on_behalf_of) on public.task_stages to authenticated;

-- 4. Visibility (PERMISSIONS §2, ADR-0004) ----------------------------------------------------------

-- An active assignee (removed_at null) of the task.
create or replace function app.is_task_assignee(p_task_id uuid, p_member_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.task_assignees a
    where a.task_id = p_task_id and a.member_id = p_member_id and a.removed_at is null);
$$;

revoke all on function app.is_task_assignee(uuid, uuid) from public;
grant execute on function app.is_task_assignee(uuid, uuid) to authenticated, service_role;

comment on function app.is_task_assignee(uuid, uuid) is
  'True when the member (default the caller) is an active assignee of the task (removed_at null).';

create or replace function app.is_approving_admin(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.approving_admin_id = auth.uid()
      and t.org_id = (select m.org_id from app.current_member() m));
$$;

revoke all on function app.is_approving_admin(uuid) from public;
grant execute on function app.is_approving_admin(uuid) to authenticated, service_role;

comment on function app.is_approving_admin(uuid) is 'True when the caller is the task''s approving Admin.';

-- Who may edit, reassign, cancel or reopen: the creator, the approving Admin or the Owner.
create or replace function app.task_manager(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and t.org_id = (select m.org_id from app.current_member() m)
      and ((select app.is_owner()) or t.created_by = auth.uid() or t.approving_admin_id = auth.uid()));
$$;

revoke all on function app.task_manager(uuid) from public;
grant execute on function app.task_manager(uuid) to authenticated, service_role;

comment on function app.task_manager(uuid) is
  'True when the caller may edit, reassign, cancel or reopen the task (PERMISSIONS §3): its '
  'creator, its approving Admin or the Owner. Other Admins who see it cannot change it.';

-- The RLS gate of every task table.
create or replace function app.task_visible(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and t.org_id = (select m.org_id from app.current_member() m)
      and ((select app.is_owner())
           or t.created_by = auth.uid()
           or t.approving_admin_id = auth.uid()
           or exists (select 1 from public.task_assignees a
                      where a.task_id = t.id and a.removed_at is null
                        and (a.member_id = auth.uid() or app.coordinator_of(a.member_id) = auth.uid()))
           or (t.client_id is not null
               and (select app.has_permission('clients.edit_assigned'))
               and t.client_id in (select app.admin_client_ids()))));
$$;

revoke all on function app.task_visible(uuid) from public;
grant execute on function app.task_visible(uuid) to authenticated, service_role;

comment on function app.task_visible(uuid) is
  'May the caller see this task (PERMISSIONS §2)? The Owner: every task of the organization. An '
  'Admin: tasks they created, approve, are assigned to, or labelled with one of their clients. '
  'Staff: tasks they are assigned to. A coordinator: their current freelancers'' tasks as well '
  '(ADR-0013 §6). A removed assignee and a former coordinator see nothing.';

-- A coordinator's right on a freelancer assignee's task (comments, stage ticks; the functions use
-- app.task_actor).
create or replace function app.task_on_behalf_ok(p_task_id uuid, p_freelancer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_assignees a
    join public.members f on f.id = a.member_id
    where a.task_id = p_task_id and a.member_id = p_freelancer_id and a.removed_at is null
      and f.engagement = 'freelance' and f.status = 'active'
      and app.coordinator_of(f.id) = auth.uid());
$$;

revoke all on function app.task_on_behalf_ok(uuid, uuid) from public;
grant execute on function app.task_on_behalf_ok(uuid, uuid) to authenticated, service_role;

comment on function app.task_on_behalf_ok(uuid, uuid) is
  'True when the caller is the current coordinator of this active freelancer, who is an active '
  'assignee of the task (ADR-0013 §3). What lets a coordinator comment or tick on their behalf.';

-- The client labels on the tasks the caller can see: what client_labels shows Staff (ADR-0005).
create or replace function app.labelled_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct t.client_id
  from public.tasks t
  where t.client_id is not null
    and t.org_id = (select m.org_id from app.current_member() m)
    and ((select app.is_owner())
         or t.created_by = auth.uid()
         or t.approving_admin_id = auth.uid()
         or exists (select 1 from public.task_assignees a
                    where a.task_id = t.id and a.removed_at is null
                      and (a.member_id = auth.uid() or app.coordinator_of(a.member_id) = auth.uid())));
$$;

comment on function app.labelled_client_ids() is
  'The clients whose label sits on a task the caller can see (4A): the second half of '
  'client_labels'' WHERE, a label at most (ADR-0005), never the client record.';

-- The directory: the people on the caller's tasks join (PERMISSIONS §2).
create or replace function app.directory_visible(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_member_id = auth.uid()
    or (select app.has_permission('team.view'))
    or app.coordinator_of(p_member_id) = auth.uid()
    or exists (
      select 1 from public.tasks t
      where app.task_visible(t.id)
        and (t.created_by = p_member_id or t.approving_admin_id = p_member_id
             or exists (select 1 from public.task_assignees a
                        where a.task_id = t.id and a.member_id = p_member_id and a.removed_at is null)));
$$;

-- RLS ----------------------------------------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_stages enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_reviews enable row level security;
alter table public.task_submissions enable row level security;
alter table public.task_warnings enable row level security;

create policy tasks_select on public.tasks for select to authenticated
  using (app.task_visible(id));
create policy task_assignees_select on public.task_assignees for select to authenticated
  using (app.task_visible(task_id));
create policy task_stages_select on public.task_stages for select to authenticated
  using (app.task_visible(task_id));
create policy task_comments_select on public.task_comments for select to authenticated
  using (app.task_visible(task_id));
create policy task_reviews_select on public.task_reviews for select to authenticated
  using (app.task_visible(task_id));
create policy task_submissions_select on public.task_submissions for select to authenticated
  using (app.task_visible(task_id));
create policy task_warnings_select on public.task_warnings for select to authenticated
  using (app.task_visible(task_id));

-- Comments: whoever sees the task and holds tasks.work; the guard checks on_behalf_of.
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check ((select app.has_permission('tasks.work')) and app.task_visible(task_id)
              and author_id = (select m.id from app.current_member() m));

-- Stages: the guard decides between a manager's edit and a worker's tick.
create policy task_stages_insert on public.task_stages for insert to authenticated
  with check ((select app.has_permission('tasks.work')) and app.task_visible(task_id));
create policy task_stages_update on public.task_stages for update to authenticated
  using ((select app.has_permission('tasks.work')) and app.task_visible(task_id))
  with check ((select app.has_permission('tasks.work')) and app.task_visible(task_id));
create policy task_stages_delete on public.task_stages for delete to authenticated
  using ((select app.has_permission('tasks.work')) and app.task_visible(task_id));

-- Activity (PERMISSIONS §2): every task table audits with entity_id = the task, so one rule.
create policy activity_log_select_tasks on public.activity_log for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and entity in ('tasks', 'task_assignees', 'task_stages', 'task_comments', 'task_reviews',
                        'task_submissions', 'task_warnings')
         and app.task_visible(entity_id));

comment on policy activity_log_select_tasks on public.activity_log is
  'Entries about a task the caller can see (4A): the task row and its children all carry the '
  'task''s id as entity_id. The Owner reads everything through activity.view_all.';

-- 5. The guards on the two plain-edit paths ---------------------------------------------------------

-- Not security definer, so app.in_transition() tells the API path from the functions' (the scope
-- helpers it calls are security definer themselves).
create function app.task_comments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.in_transition() then
    return new;
  end if;
  if new.author_id is distinct from auth.uid() then
    perform app.fail('FORBIDDEN', 'A comment is signed by its author.');
  end if;
  if new.on_behalf_of is not null and not app.task_on_behalf_ok(new.task_id, new.on_behalf_of) then
    perform app.fail('FORBIDDEN', 'You can comment for a freelancer only as their current coordinator, on their task.');
  end if;
  return new;
end;
$$;

revoke all on function app.task_comments_guard() from public;
grant execute on function app.task_comments_guard() to authenticated, service_role;

comment on function app.task_comments_guard() is
  'BEFORE INSERT on task_comments (API path): author_id is the caller; on_behalf_of, when set, is a '
  'freelancer assignee the caller currently coordinates (ADR-0013 §3).';

create trigger comments_guard before insert on public.task_comments
  for each row execute function app.task_comments_guard();

-- Not security definer (as the comments guard): the task row it reads is one RLS already showed
-- the caller, and the scope helpers are security definer.
create function app.task_stages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_task_id uuid := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  v_state public.task_state;
  v_tick boolean;
  v_edit boolean;
begin
  if app.in_transition() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  select t.state into v_state from public.tasks t where t.id = v_task_id;
  if v_state is null then
    perform app.fail('NOT_FOUND', 'This task does not exist.');
  end if;

  if tg_op = 'DELETE' then
    if not app.task_manager(old.task_id) then
      perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner edits the checklist.');
    end if;
    if v_state in ('completed', 'cancelled') then
      perform app.fail('INVALID_STATE', 'Reopen the task to change its checklist.');
    end if;
    if old.done_at is not null then
      perform app.fail('INVALID_STATE', 'A ticked stage stays in the history. Untick it first.');
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not app.task_manager(new.task_id) then
      perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner edits the checklist.');
    end if;
    if v_state in ('completed', 'cancelled') then
      perform app.fail('INVALID_STATE', 'Reopen the task to change its checklist.');
    end if;
    -- A new stage is unticked (the column grant already keeps the tick columns out of an insert).
    new.done_at := null; new.done_by := null; new.on_behalf_of := null;
    return new;
  end if;

  -- UPDATE
  if new.task_id <> old.task_id then
    perform app.fail('FORBIDDEN', 'A stage stays on its task.');
  end if;
  v_edit := new.name <> old.name or new.position <> old.position;
  v_tick := new.done_at is distinct from old.done_at or new.done_by is distinct from old.done_by
            or new.on_behalf_of is distinct from old.on_behalf_of;
  if v_edit then
    if not app.task_manager(new.task_id) then
      perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner edits the checklist.');
    end if;
    if v_state in ('completed', 'cancelled') then
      perform app.fail('INVALID_STATE', 'Reopen the task to change its checklist.');
    end if;
  end if;
  if v_tick then
    -- Locked from submitted onwards (WORKFLOWS §3.1): editing resumes only through changes_requested.
    if v_state not in ('todo', 'in_progress', 'changes_requested') then
      perform app.fail('INVALID_STATE', 'This task is with its reviewers. Stages can be ticked again if changes are requested.');
    end if;
    if new.done_at is not null then
      new.done_by := auth.uid();
      if new.on_behalf_of is null then
        if not app.is_task_assignee(new.task_id, auth.uid()) then
          perform app.fail('FORBIDDEN', 'Only an assignee ticks a stage.');
        end if;
      elsif not app.task_on_behalf_ok(new.task_id, new.on_behalf_of) then
        perform app.fail('FORBIDDEN', 'You can tick for a freelancer only as their current coordinator, on their task.');
      end if;
    else
      new.done_by := null;
      new.on_behalf_of := null;
      if not app.is_task_assignee(new.task_id, auth.uid())
         and not exists (select 1 from public.task_assignees a
                         where a.task_id = new.task_id and a.removed_at is null
                           and app.coordinator_of(a.member_id) = auth.uid()) then
        perform app.fail('FORBIDDEN', 'Only an assignee unticks a stage.');
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app.task_stages_guard() from public;
grant execute on function app.task_stages_guard() to authenticated, service_role;

comment on function app.task_stages_guard() is
  'BEFORE INSERT OR UPDATE OR DELETE on task_stages (API path). A manager (creator, approving '
  'Admin, Owner) adds, renames, reorders and deletes unticked stages while the task is not '
  'completed / cancelled. A worker ticks (done_at; done_by = the caller; on_behalf_of = a '
  'freelancer assignee the caller coordinates) or unticks while the task is todo / in_progress / '
  'changes_requested: locked from submitted (WORKFLOWS §3.1).';

create trigger stages_guard before insert or update or delete on public.task_stages
  for each row execute function app.task_stages_guard();

-- 6. member_availability (PERMISSIONS §2, ARCHITECTURE §5) -----------------------------------------
create function public.member_availability(from_date date, to_date date, member_ids uuid[] default null)
returns table (
  member_id uuid, engagement public.engagement, day date,
  open_tasks_due integer, event_blocks jsonb, leave text, present boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('availability.view') then
    perform app.fail('FORBIDDEN', 'Only the Owner and Admins see other people''s availability.');
  end if;
  if from_date is null or to_date is null or to_date < from_date then
    perform app.fail('VALIDATION', 'Pick a date range.');
  end if;
  if to_date - from_date > 61 then
    perform app.fail('VALIDATION', 'Ask for two months at most.');
  end if;

  return query
  with people as (
    select m.id, m.engagement
    from public.members m
    where m.org_id = v_org and m.status = 'active' and m.role <> 'owner'
      and (member_availability.member_ids is null or m.id = any (member_availability.member_ids))
  ),
  days as (
    select s::date as day from generate_series(from_date, to_date, interval '1 day') s
  ),
  open_tasks as (
    select a.member_id, app.to_ist_date(t.due_at) as day, count(*)::integer as n
    from public.tasks t
    join public.task_assignees a on a.task_id = t.id and a.removed_at is null
    where t.org_id = v_org
      and t.state not in ('completed', 'cancelled')
      and app.to_ist_date(t.due_at) between from_date and to_date
    group by a.member_id, app.to_ist_date(t.due_at)
  ),
  events as (
    select a.member_id, t.event_date as day,
           jsonb_agg(jsonb_build_object(
             'start_at', t.event_start_at,
             'end_at', coalesce(t.event_end_at, t.event_start_at + interval '1 hour'))
             order by t.event_start_at) as blocks
    from public.tasks t
    join public.task_assignees a on a.task_id = t.id and a.removed_at is null
    where t.org_id = v_org
      and t.state not in ('completed', 'cancelled')
      and t.event_start_at is not null
      and t.event_date between from_date and to_date
    group by a.member_id, t.event_date
  )
  select p.id, p.engagement, d.day,
         coalesce(o.n, 0),
         coalesce(e.blocks, '[]'::jsonb),
         case when p.engagement = 'freelance' then null
              else coalesce(
                (select r.type::text from public.leave_requests r
                 where r.member_id = p.id and r.state = 'approved'
                   and r.start_date <= d.day and r.end_date >= d.day
                 order by r.decided_at desc, r.created_at desc limit 1),
                (select 'requested' from public.leave_requests r
                 where r.member_id = p.id and r.state = 'submitted' and not r.requests_cancellation
                   and r.start_date <= d.day and r.end_date >= d.day limit 1)) end,
         case when d.day = v_today and p.engagement = 'permanent'
              then exists (select 1 from public.attendance_days ad
                           where ad.member_id = p.id and ad.work_date = d.day and ad.started_at is not null)
              end
  from people p
  cross join days d
  left join open_tasks o on o.member_id = p.id and o.day = d.day
  left join events e on e.member_id = p.id and e.day = d.day
  order by p.id, d.day;
end;
$$;

revoke all on function public.member_availability(date, date, uuid[]) from public, anon;
grant execute on function public.member_availability(date, date, uuid[]) to authenticated, service_role;

comment on function public.member_availability(date, date, uuid[]) is
  'availability.view (the Owner and Admins; FORBIDDEN otherwise). Read only. One row per active '
  'non-Owner member (or the ids given) per IST day of the range (62 days at most): open_tasks_due '
  '(tasks not completed / cancelled due that day), event_blocks ([{start_at, end_at}] of their '
  'timed event tasks that day, no end = one hour; no titles or ids), leave (the approved leave '
  'type covering the day, else requested for a pending request; null for a freelancer), present '
  '(today only, for an employee: a Start day recorded). Counts and busy blocks, never the tasks '
  'themselves (ADR-0004). What the 4.3 assignment warnings are computed from.';
