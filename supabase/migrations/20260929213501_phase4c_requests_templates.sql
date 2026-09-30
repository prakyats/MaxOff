-- 4C (tasks 4.5, 4.6): task templates and task requests, the template foreign key on tasks, the
-- Owner's task type order, and the counts behind the Tasks and Approvals badges. Expand-only
-- (ARCHITECTURE §18): new tables, a new enum, new functions, one foreign key on a column nothing
-- but phase 4 reads (tasks.template_id), no change to anything main's code uses.
--
-- 1. task_templates (DATA-MODEL §6; Kickoff 4 decision 19, WORKFLOWS §3.5): shared by the whole
--    company; any holder of templates.manage reads and uses them; an Admin edits and archives the
--    ones they created, the Owner any. A plain edit (ARCHITECTURE §4.2): RLS + a guard trigger,
--    audited. A template never fixes the client, the people or the deadline (PRODUCT §4.6): it has
--    no column for them.
-- 2. tasks.template_id → task_templates (4A later item L3): the values are nulled first (the table
--    is new, so any value is stale), then the foreign key; a trigger refuses another
--    organization's template or an archived one when it is set.
-- 3. task_requests (WORKFLOWS §3.4, PERMISSIONS §1/§2): pending → converted (task_id) | declined
--    (reason) | withdrawn. No API writes: task_request_create, task_request_withdraw,
--    task_request_decline, task_request_convert (task_create and the conversion in one
--    transaction).
-- 4. task_type_move(): the Owner's task type order (4A later item (b), settings.manage).
-- 5. task_counts(): the Tasks badge (not noted + changes requested, a coordinator's freelancers
--    included) and the tasks the viewer may decide (Kickoff 4 decision 16).

-- 1. task_templates ---------------------------------------------------------------------------------
create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default app.current_org_id() references public.organizations (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  task_type_id uuid not null references public.task_types (id),
  description text null check (description is null or length(description) <= 10000),
  default_priority public.priority not null default 'medium',
  stages text[] not null default '{}' check (cardinality(stages) <= 30),
  reminder_rules jsonb not null default '[]'::jsonb check (jsonb_typeof(reminder_rules) = 'array'),
  field_defaults jsonb not null default '{}'::jsonb check (jsonb_typeof(field_defaults) = 'object'),
  archived_at timestamptz null,
  created_by uuid not null default auth.uid() references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.task_templates is
  'Task templates (PRODUCT §4.6, 4.6): a type, default stages, reminders (5.3 edits them), priority '
  'and custom field defaults; never a client, assignee or deadline. Shared company-wide '
  '(templates.manage reads and uses every active one); an Admin edits and archives the ones they '
  'created, the Owner any (Kickoff 4 decision 19). Archived, never deleted. Audited.';
create unique index task_templates_active_name_unique
  on public.task_templates (org_id, lower(btrim(name))) where archived_at is null;
create index task_templates_org_idx on public.task_templates (org_id, archived_at);

create trigger set_updated_at before update on public.task_templates
  for each row execute function app.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.task_templates
  for each row execute function app.audit_row_change();

-- The rules RLS cannot state: the type, the stages and the owner of a row. Not security definer, so
-- a migration or a function (the owner) passes through app.in_transition(), like the task guards.
create function app.task_templates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stage text;
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by or new.org_id is distinct from old.org_id then
      perform app.fail('FORBIDDEN', 'A template keeps its author.');
    end if;
  elsif not app.in_transition() and new.created_by is distinct from auth.uid() then
    perform app.fail('FORBIDDEN', 'A template is written by the person creating it.');
  end if;
  -- A type of the organization, active when it is chosen (a template keeps an archived type, as a
  -- task does: 4B review S7).
  if tg_op = 'INSERT' or new.task_type_id is distinct from old.task_type_id then
    if not exists (select 1 from public.task_types tt
                   where tt.id = new.task_type_id and tt.org_id = new.org_id and tt.archived_at is null) then
      perform app.fail('VALIDATION', 'Choose a task type from the list.');
    end if;
  end if;
  new.stages := array(select btrim(s) from unnest(new.stages) s);
  foreach v_stage in array new.stages loop
    if length(v_stage) not between 1 and 120 then
      perform app.fail('VALIDATION', 'Each stage needs a name of up to 120 characters.');
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function app.task_templates_guard() from public;
grant execute on function app.task_templates_guard() to authenticated, service_role;

comment on function app.task_templates_guard() is
  'BEFORE INSERT OR UPDATE on task_templates (4.6): the author is the caller and never changes; the '
  'type is one of the organization''s, active when chosen; each stage 1..120 characters (as a task''s).';

create trigger task_templates_guard before insert or update on public.task_templates
  for each row execute function app.task_templates_guard();

alter table public.task_templates enable row level security;

create policy task_templates_select on public.task_templates for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('templates.manage')));
create policy task_templates_insert on public.task_templates for insert to authenticated
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('templates.manage'))
              and created_by = (select c.id from app.current_member() c));
-- Kickoff 4 decision 19: an Admin edits and archives their own templates, the Owner any.
create policy task_templates_update on public.task_templates for update to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('templates.manage'))
         and ((select app.is_owner()) or created_by = (select c.id from app.current_member() c)))
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('templates.manage'))
              and ((select app.is_owner()) or created_by = (select c.id from app.current_member() c)));

revoke all on public.task_templates from anon;
revoke all on public.task_templates from authenticated;
grant select on public.task_templates to authenticated;
grant insert (name, task_type_id, description, default_priority, stages, reminder_rules, field_defaults)
  on public.task_templates to authenticated;
grant update (name, task_type_id, description, default_priority, stages, reminder_rules, field_defaults, archived_at)
  on public.task_templates to authenticated;

-- 2. tasks.template_id --------------------------------------------------------------------------------
-- 4A left the column without its table (4A later item L3): any value there now names nothing.
update public.tasks set template_id = null
where template_id is not null
  and template_id not in (select tt.id from public.task_templates tt);

alter table public.tasks
  add constraint tasks_template_id_fkey foreign key (template_id) references public.task_templates (id);
create index tasks_template_idx on public.tasks (template_id) where template_id is not null;

create function app.tasks_template_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.template_id is not null
     and (tg_op = 'INSERT' or new.template_id is distinct from old.template_id)
     and not exists (select 1 from public.task_templates tt
                     where tt.id = new.template_id and tt.org_id = new.org_id and tt.archived_at is null) then
    perform app.fail('VALIDATION', 'This template is archived or gone. Pick another, or none.');
  end if;
  return new;
end;
$$;

revoke all on function app.tasks_template_check() from public;
grant execute on function app.tasks_template_check() to authenticated, service_role;

comment on function app.tasks_template_check() is
  'BEFORE INSERT OR UPDATE OF template_id on tasks (4.6): a task names an active template of its own '
  'organization when the template is set (task_create); a task keeps a template archived later.';

create trigger tasks_template_check before insert or update of template_id on public.tasks
  for each row execute function app.tasks_template_check();

comment on column public.tasks.template_id is
  'The task template the task was started from (4.6; a record of where the defaults came from: the '
  'task never follows later edits of the template).';

-- 3. task_requests ------------------------------------------------------------------------------------
create type public.request_state as enum ('pending', 'converted', 'declined', 'withdrawn');

create table public.task_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default app.current_org_id() references public.organizations (id),
  requested_by uuid not null references public.members (id),
  title text not null check (length(btrim(title)) between 1 and 200),
  details text null check (details is null or length(details) <= 5000),
  client_id uuid null references public.clients (id),
  state public.request_state not null default 'pending',
  decided_by uuid null references public.members (id),
  decided_at timestamptz null,
  decision_reason text null check (decision_reason is null or length(decision_reason) <= 1000),
  task_id uuid null references public.tasks (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_requests_converted_has_task check ((state = 'converted') = (task_id is not null)),
  constraint task_requests_declined_has_reason check ((state = 'declined') = (decision_reason is not null)),
  constraint task_requests_decided check (
    (state in ('converted', 'declined')) = (decided_by is not null and decided_at is not null))
);
comment on table public.task_requests is
  'A suggested task (PRODUCT §4.6, WORKFLOWS §3.4): Staff and Admins suggest (title, details, an '
  'optional client label), the Owner or an Admin who sees it converts it into a task or declines it '
  'with a reason, the requester may withdraw it while pending. No API writes (task_request_* '
  'functions). RLS (PERMISSIONS §2): the Owner all; an Admin their own, those labelled with their '
  'clients and those with no client; Staff their own. Audited.';
create index task_requests_org_state_idx on public.task_requests (org_id, state, created_at);
create index task_requests_requested_by_idx on public.task_requests (requested_by, created_at desc);

create trigger set_updated_at before update on public.task_requests
  for each row execute function app.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.task_requests
  for each row execute function app.audit_row_change();

-- Who sees a request (PERMISSIONS §2), and so who may decide it (with task_requests.decide).
create function app.task_request_visible(p_requested_by uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_owner())
    or p_requested_by = auth.uid()
    or ((select app.has_permission('task_requests.decide'))
        and (p_client_id is null or p_client_id in (select app.admin_client_ids())));
$$;

revoke all on function app.task_request_visible(uuid, uuid) from public;
grant execute on function app.task_request_visible(uuid, uuid) to authenticated, service_role;

comment on function app.task_request_visible(uuid, uuid) is
  'May the caller see a task request (PERMISSIONS §2)? The Owner: all. Anyone: their own. A decider '
  '(task_requests.decide: an Admin): those with no client and those labelled with their own clients.';

alter table public.task_requests enable row level security;
create policy task_requests_select on public.task_requests for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and app.task_request_visible(requested_by, client_id));

revoke all on public.task_requests from anon;
revoke all on public.task_requests from authenticated;
grant select on public.task_requests to authenticated;

create policy activity_log_select_task_requests on public.activity_log for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and entity = 'task_requests'
         and exists (select 1 from public.task_requests r where r.id = entity_id));

comment on policy activity_log_select_task_requests on public.activity_log is
  'The entries about a task request the caller can see (4.6; RLS on task_requests decides).';

-- The request, locked, for a function that changes it. NOT_FOUND when the caller may not see it.
create function app.task_request_lock(p_request_id uuid)
returns public.task_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.task_requests;
begin
  select r.* into v_request
  from public.task_requests r
  where r.id = p_request_id and r.org_id = (select m.org_id from app.current_member() m)
  for update;
  if v_request.id is null or not app.task_request_visible(v_request.requested_by, v_request.client_id) then
    perform app.fail('NOT_FOUND', 'This suggestion is gone.');
  end if;
  return v_request;
end;
$$;

revoke all on function app.task_request_lock(uuid) from public, authenticated;
grant execute on function app.task_request_lock(uuid) to service_role;

comment on function app.task_request_lock(uuid) is
  'Internal (4.6): the request row for update, NOT_FOUND outside the organization or outside what the '
  'caller may see (app.task_request_visible).';

create function public.task_request_create(title text, details text default null, client_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_title text := btrim(coalesce(task_request_create.title, ''));
  v_details text := nullif(btrim(coalesce(task_request_create.details, '')), '');
  v_client public.clients;
  v_id uuid;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('task_requests.create') then
    perform app.fail('FORBIDDEN', 'You create tasks yourself.');
  end if;
  if v_title = '' then
    perform app.fail('VALIDATION', 'Give the suggestion a title.');
  end if;
  if length(v_title) > 200 then
    perform app.fail('VALIDATION', 'Keep the title under 200 characters.');
  end if;
  if v_details is not null and length(v_details) > 5000 then
    perform app.fail('VALIDATION', 'Keep the details under 5000 characters.');
  end if;
  if task_request_create.client_id is not null then
    -- A label the caller can see (ADR-0005: Staff see the labels on their own tasks, an Admin their
    -- clients), Active or Paused like a task's (Kickoff 4 decision 22).
    select c.* into v_client from public.clients c
    where c.id = task_request_create.client_id and c.org_id = v_caller.org_id;
    if v_client.id is null
       or not (app.client_visible(v_client.id) or v_client.id in (select app.labelled_client_ids())) then
      perform app.fail('NOT_FOUND', 'This client does not exist.');
    end if;
    if v_client.state not in ('active', 'paused') then
      perform app.fail('VALIDATION', format('%s takes no new work: suggest it with another client, or with none.', v_client.name));
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'requested')::text, true);
  insert into public.task_requests (org_id, requested_by, title, details, client_id)
  values (v_caller.org_id, v_caller.id, v_title, v_details, task_request_create.client_id)
  returning id into v_id;
  -- WORKFLOWS §9: notifies the Owner and the client's Admin (every Admin when there is no client);
  -- the notification rows are 5.1's.
  return v_id;
end;
$$;

revoke all on function public.task_request_create(text, text, uuid) from public, anon;
grant execute on function public.task_request_create(text, text, uuid) to authenticated, service_role;

comment on function public.task_request_create(text, text, uuid) is
  'task_requests.create (Admins and Staff; PRODUCT §4.6): a suggested task, pending. The client is a '
  'label the caller can see, Active or Paused. Audit action: requested. Notifies the Owner and the '
  'client''s Admin, or every Admin when there is no client (WORKFLOWS §9; the rows are 5.1''s).';

create function public.task_request_withdraw(request_id uuid)
returns public.request_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.task_requests;
begin
  if (select m.id from app.current_member() m) is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  v_request := app.task_request_lock(task_request_withdraw.request_id);
  if v_request.requested_by <> auth.uid() then
    perform app.fail('FORBIDDEN', 'Only the person who suggested it can withdraw it.');
  end if;
  if v_request.state <> 'pending' then
    perform app.fail('INVALID_STATE', 'This suggestion was already decided.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'withdrawn')::text, true);
  update public.task_requests set state = 'withdrawn' where id = v_request.id;
  return 'withdrawn';
end;
$$;

revoke all on function public.task_request_withdraw(uuid) from public, anon;
grant execute on function public.task_request_withdraw(uuid) to authenticated, service_role;

comment on function public.task_request_withdraw(uuid) is
  'The requester takes back a pending suggestion (pending → withdrawn; WORKFLOWS §3.4). Audit action: '
  'withdrawn. Nobody is notified.';

create function public.task_request_decline(request_id uuid, reason text)
returns public.request_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.task_requests;
  v_reason text := app.clean_reason(task_request_decline.reason);
begin
  if (select m.id from app.current_member() m) is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('task_requests.decide') then
    perform app.fail('FORBIDDEN', 'You cannot decide suggested tasks.');
  end if;
  v_request := app.task_request_lock(task_request_decline.request_id);
  if v_request.state <> 'pending' then
    perform app.fail('INVALID_STATE', 'This suggestion was already decided.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say why, so they know.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'declined', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.task_requests
  set state = 'declined', decision_reason = v_reason, decided_by = auth.uid(), decided_at = now()
  where id = v_request.id;
  -- WORKFLOWS §9: the requester is told, with the reason (5.1).
  return 'declined';
end;
$$;

revoke all on function public.task_request_decline(uuid, text) from public, anon;
grant execute on function public.task_request_decline(uuid, text) to authenticated, service_role;

comment on function public.task_request_decline(uuid, text) is
  'task_requests.decide on a request the caller sees (the Owner any; an Admin those with no client or '
  'their own clients''): pending → declined with a required reason the requester reads. Audit action: '
  'declined (meta.reason). Notifies the requester (5.1).';

-- Convert = create the task and mark the request, in one transaction: the arguments are
-- task_create's, after the request's id.
create function public.task_request_convert(
  request_id uuid,
  title text,
  description text,
  task_type_id uuid,
  client_id uuid,
  priority public.priority,
  due_at timestamptz,
  assignee_ids uuid[],
  primary_owner_id uuid,
  approving_admin_id uuid default null,
  event_date date default null,
  event_start_at timestamptz default null,
  event_end_at timestamptz default null,
  location text default null,
  purpose text default null,
  stages text[] default '{}',
  custom_fields jsonb default '{}',
  reminder_rules jsonb default null,
  template_id uuid default null,
  warnings jsonb default '[]'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.task_requests;
  v_task_id uuid;
begin
  if (select m.id from app.current_member() m) is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('task_requests.decide') then
    perform app.fail('FORBIDDEN', 'You cannot decide suggested tasks.');
  end if;
  v_request := app.task_request_lock(task_request_convert.request_id);
  if v_request.state <> 'pending' then
    perform app.fail('INVALID_STATE', 'This suggestion was already decided.');
  end if;

  -- The task is the decider's own, with every rule of task_create (the route, the label, the people).
  v_task_id := public.task_create(
    task_request_convert.title, task_request_convert.description, task_request_convert.task_type_id,
    task_request_convert.client_id, task_request_convert.priority, task_request_convert.due_at,
    task_request_convert.assignee_ids, task_request_convert.primary_owner_id,
    task_request_convert.approving_admin_id, task_request_convert.event_date,
    task_request_convert.event_start_at, task_request_convert.event_end_at,
    task_request_convert.location, task_request_convert.purpose, task_request_convert.stages,
    task_request_convert.custom_fields, task_request_convert.reminder_rules,
    task_request_convert.template_id, task_request_convert.warnings);

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'converted', 'meta', jsonb_build_object('task_id', v_task_id))::text, true);
  update public.task_requests
  set state = 'converted', task_id = v_task_id, decided_by = auth.uid(), decided_at = now()
  where id = v_request.id;
  -- WORKFLOWS §9: the requester is told it became a task (5.1); task_create names its own.
  return v_task_id;
end;
$$;

revoke all on function public.task_request_convert(uuid, text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.task_request_convert(uuid, text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) to authenticated, service_role;

comment on function public.task_request_convert(uuid, text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) is
  'task_requests.decide (and task_create''s own checks: tasks.create, the route, the label, the '
  'people) on a pending request the caller sees: creates the task and marks the request converted '
  '(task_id) in one transaction. Returns the task id. Audit actions: task_create''s, then converted '
  '(meta.task_id). Notifies the requester (5.1).';

-- 4. task_type_move ---------------------------------------------------------------------------------
create function public.task_type_move(task_type_id uuid, direction text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_type public.task_types;
  v_neighbour public.task_types;
begin
  select m.org_id into v_org from app.current_member() m;
  if v_org is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  -- Kickoff 4 decision 15: the task types are the Owner's.
  if not app.has_permission('settings.manage') then
    perform app.fail('FORBIDDEN', 'Task types are the Owner''s to change.');
  end if;
  if direction not in ('up', 'down') then
    perform app.fail('VALIDATION', 'Move a type up or down.');
  end if;

  select tt.* into v_type
  from public.task_types tt
  where tt.id = task_type_move.task_type_id and tt.org_id = v_org and tt.archived_at is null
  for update;
  if v_type.id is null then
    perform app.fail('NOT_FOUND', 'This task type is no longer in the list.');
  end if;

  -- The neighbour is the next type the Owner sees: archived ones are skipped.
  if direction = 'up' then
    select tt.* into v_neighbour from public.task_types tt
    where tt.org_id = v_org and tt.archived_at is null and tt.position < v_type.position
    order by tt.position desc limit 1 for update;
  else
    select tt.* into v_neighbour from public.task_types tt
    where tt.org_id = v_org and tt.archived_at is null and tt.position > v_type.position
    order by tt.position asc limit 1 for update;
  end if;
  if v_neighbour.id is null then
    return null;
  end if;

  update public.task_types tt
  set position = case tt.id when v_type.id then v_neighbour.position else v_type.position end
  where tt.id in (v_type.id, v_neighbour.id);
  return v_neighbour.id;
end;
$$;

revoke all on function public.task_type_move(uuid, text) from public, anon;
grant execute on function public.task_type_move(uuid, text) to authenticated, service_role;

comment on function public.task_type_move(uuid, text) is
  'settings.manage (the Owner; Kickoff 4 decision 15, 4A later item (b)). Swaps a task type''s '
  'position with the neighbour above or below it (archived types skipped), as list_item_move does. '
  'Returns the neighbour''s id, or null at that end. NOT_FOUND for an unknown or archived type.';

-- 5. task_counts --------------------------------------------------------------------------------------
create function public.task_counts()
returns table (not_noted integer, changes_requested integer, badge integer, to_decide integer)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.id, m.org_id from app.current_member() m
  ),
  -- The caller and the freelancers they coordinate now (ADR-0013: a freelancer's work is theirs).
  mine as (
    select me.id as member_id from me
    union all
    select mc.member_id from public.member_coordinators mc join me on mc.coordinator_id = me.id
    where mc.to_at is null
  ),
  work as (
    select t.id, t.state, bool_or(a.acknowledged_at is null) as unnoted
    from public.tasks t
    join me on t.org_id = me.org_id
    join public.task_assignees a on a.task_id = t.id and a.removed_at is null
    where a.member_id in (select mine.member_id from mine)
      and t.state not in ('completed', 'cancelled')
    group by t.id, t.state
  ),
  deciding as (
    select t.id
    from public.tasks t
    join me on t.org_id = me.org_id
    where ((select app.has_permission('tasks.approve_final')) and t.state = 'admin_approved')
       or ((select app.has_permission('tasks.approve_admin'))
           and t.state = 'submitted' and t.approving_admin_id = me.id
           and not exists (select 1 from public.task_assignees a
                           where a.task_id = t.id and a.member_id = me.id and a.removed_at is null))
  )
  select (select count(*) from work where work.unnoted)::integer,
         (select count(*) from work where work.state = 'changes_requested')::integer,
         (select count(*) from work where work.unnoted or work.state = 'changes_requested')::integer,
         (select count(*) from deciding)::integer
  from me;
$$;

revoke all on function public.task_counts() from public, anon;
grant execute on function public.task_counts() to authenticated, service_role;

comment on function public.task_counts() is
  'The caller''s task counts for the nav badges (Kickoff 4 decision 16, WORKFLOWS §9 "Phase 4 ships '
  'before phase 5"): open tasks not yet noted by the caller or a freelancer they coordinate, those in '
  'changes_requested, the badge (either, each task once), and the tasks the caller may decide now '
  '(the Owner: waiting for the final approval; an approving Admin: waiting for their check, not '
  'on a task they are assigned to). One row for an active member, none otherwise.';
