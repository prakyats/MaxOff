-- 4A (4.2) Staff tasks: the transition functions (WORKFLOWS §3, PRODUCT §4.6, PERMISSIONS §3,
--   DATA-MODEL §6; ADR-0006, ADR-0013; kickoff 4 decisions 1-5, 10, 14).
--
-- Each function, in one transaction: the caller (an active member, the permission key), the scope
-- (assignee / coordinator / manager / approver), the task locked and its state checked, the
-- change, the history rows, the activity_log entry (through app.audit_override, with on_behalf_of
-- when a coordinator acted for a freelancer). No notification rows yet (phase 4 ships before 5):
-- the WORKFLOWS §9 recipients are named in each comment for 5.1, as in phase 3b.
--
-- On behalf (ADR-0013 §3): task_acknowledge, task_start and task_submit_done take on_behalf_of = a
-- freelancer assignee; app.task_actor() allows it only to that freelancer's CURRENT coordinator and
-- records actor = the coordinator, on_behalf_of = the freelancer. A freelancer's own id is never an
-- actor. Reviews, reopen, cancel, edits and approver changes never carry on_behalf_of.
--
-- EXPAND-ONLY (ARCHITECTURE §18): new functions only. Append-only: never edit once applied.

-- Internal helpers (service_role only: called inside the security definer functions) ---------------

-- The next fractional-index key after `last` (the TS mirror is core/lists nextPosition()).
create function app.next_position(last text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_last_char text;
  v_index integer;
  v_head integer;
begin
  if last is null or last = '' then
    return 'a0';
  end if;
  v_last_char := right(last, 1);
  v_index := position(v_last_char in digits) - 1;
  if v_index >= 0 and v_index < length(digits) - 1 then
    return left(last, -1) || substr(digits, v_index + 2, 1);
  end if;
  if length(last) = 2 and left(last, 1) <> 'z' then
    v_head := position(left(last, 1) in digits) - 1;
    return substr(digits, v_head + 2, 1) || '0';
  end if;
  return last || '0';
end;
$$;

revoke all on function app.next_position(text) from public, authenticated;
grant execute on function app.next_position(text) to service_role;

comment on function app.next_position(text) is
  'Internal (4A): the position key after `last` (a0 .. a9, aa .. az, b0 ..; null = a0), for the '
  'stages a task is created with. Mirrors core/lists nextPosition().';

-- The caller of a task-creating or task-editing function: an active member with tasks.create.
create function app.task_require_creator(out caller_id uuid, out org_id uuid, out is_owner boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.member_role;
begin
  select m.id, m.org_id, m.role into caller_id, org_id, v_role from app.current_member() m;
  if caller_id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('tasks.create') then
    perform app.fail('FORBIDDEN', 'Only the Owner and Admins create and change tasks.');
  end if;
  is_owner := v_role = 'owner';
end;
$$;

revoke all on function app.task_require_creator() from public, authenticated;
grant execute on function app.task_require_creator() to service_role;

comment on function app.task_require_creator() is
  'Internal (4A): the caller''s id, organization and whether they are the Owner, or UNAUTHENTICATED '
  '/ FORBIDDEN without tasks.create.';

-- The task row locked for update, in the caller's organization.
create function app.task_lock(p_task_id uuid, p_org uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select t.* into v_task from public.tasks t where t.id = p_task_id and t.org_id = p_org for update;
  if v_task.id is null then
    perform app.fail('NOT_FOUND', 'This task does not exist.');
  end if;
  return v_task;
end;
$$;

revoke all on function app.task_lock(uuid, uuid) from public, authenticated;
grant execute on function app.task_lock(uuid, uuid) to service_role;

comment on function app.task_lock(uuid, uuid) is
  'Internal (4A): the task row locked for update, NOT_FOUND outside the organization. Every task '
  'function locks the task before its children.';

-- Who acts, and for whom (ADR-0013 §3). The caller must hold tasks.work, be a permanent member
-- (a freelancer's own id is never an actor) and be an active assignee; or on_behalf_of names an
-- active freelance assignee whose current coordinator is the caller.
create function app.task_actor(p_task_id uuid, p_on_behalf_of uuid, out actor_id uuid, out subject_id uuid, out org_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_subject public.members;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('tasks.work') then
    perform app.fail('FORBIDDEN', 'You cannot work on tasks.');
  end if;
  if v_caller.engagement <> 'permanent' then
    perform app.fail('FORBIDDEN', 'A freelancer''s work is recorded by their coordinator.');
  end if;
  actor_id := v_caller.id;
  org_id := v_caller.org_id;

  if p_on_behalf_of is null then
    if not app.is_task_assignee(p_task_id, v_caller.id) then
      perform app.fail('FORBIDDEN', 'Only an assignee of this task can do that.');
    end if;
    subject_id := v_caller.id;
    return;
  end if;

  if p_on_behalf_of = v_caller.id then
    perform app.fail('VALIDATION', 'on_behalf_of names the freelancer you act for, not yourself.');
  end if;
  select m.* into v_subject from public.members m where m.id = p_on_behalf_of and m.org_id = v_caller.org_id;
  if v_subject.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_subject.engagement <> 'freelance' then
    perform app.fail('FORBIDDEN', 'You can act on behalf of a freelancer only.');
  end if;
  if not app.is_task_assignee(p_task_id, v_subject.id) then
    perform app.fail('FORBIDDEN', 'This freelancer is not assigned to the task.');
  end if;
  if app.coordinator_of(v_subject.id) is distinct from v_caller.id then
    perform app.fail('FORBIDDEN', format('Only %s''s current coordinator can act for them.', v_subject.full_name));
  end if;
  subject_id := v_subject.id;
end;
$$;

revoke all on function app.task_actor(uuid, uuid) from public, authenticated;
grant execute on function app.task_actor(uuid, uuid) to service_role;

comment on function app.task_actor(uuid, uuid) is
  'Internal (4A, ADR-0013 §3): (actor_id, subject_id, org_id) for a task action. Without '
  'on_behalf_of the caller must be an active assignee; with it, a permanent member acting for an '
  'active freelance assignee whose current coordinator they are. A freelancer''s own id, a former '
  'coordinator, another member and a non-freelancer subject are FORBIDDEN.';

-- An assignee: an active Admin, Staff member or freelancer of the organization, never the Owner.
create function app.task_assignee_check(p_org uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.members;
begin
  select m.* into v from public.members m where m.id = p_member_id and m.org_id = p_org;
  if v.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v.role = 'owner' then
    perform app.fail('VALIDATION', 'The Owner is never an assignee (the Owner approves the work).');
  end if;
  if v.status <> 'active' then
    perform app.fail('VALIDATION', format('%s is not active and cannot be assigned.', v.full_name));
  end if;
end;
$$;

revoke all on function app.task_assignee_check(uuid, uuid) from public, authenticated;
grant execute on function app.task_assignee_check(uuid, uuid) to service_role;

comment on function app.task_assignee_check(uuid, uuid) is
  'Internal (4A): NOT_FOUND / VALIDATION unless the member is an active Admin, Staff or freelancer '
  'of the organization (kickoff 4 decision 1: never the Owner).';

-- The field rules task_create and task_update_assignment share (PRODUCT §4.6, kickoff 4 decisions 2, 4).
create function app.task_check_fields(
  p_org uuid, p_is_owner boolean, p_type public.task_types, p_client_id uuid, p_due_at timestamptz,
  p_new boolean, p_event_date date, p_event_start_at timestamptz, p_event_end_at timestamptz,
  p_location text, p_purpose text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_type.id is null or p_type.org_id <> p_org then
    perform app.fail('NOT_FOUND', 'This task type does not exist.');
  end if;
  if p_type.archived_at is not null then
    perform app.fail('VALIDATION', 'Choose a task type from the list.');
  end if;
  if p_client_id is not null then
    if not exists (select 1 from public.clients c where c.id = p_client_id and c.org_id = p_org) then
      perform app.fail('NOT_FOUND', 'This client does not exist.');
    end if;
    -- Kickoff 4 decision 2: an Admin labels a task only with their own clients.
    if not p_is_owner and p_client_id not in (select app.admin_client_ids()) then
      perform app.fail('FORBIDDEN', 'You can label a task only with your own clients.');
    end if;
  end if;
  if p_due_at is null then
    perform app.fail('VALIDATION', 'Set a deadline.');
  end if;
  -- Kickoff 4 decision 4: a past deadline is refused at creation; a later edit may move it anywhere.
  if p_new and p_due_at <= now() then
    perform app.fail('VALIDATION', 'The deadline has already passed. Pick a later time.');
  end if;
  if p_type.kind = 'event' then
    if p_event_date is null then
      perform app.fail('VALIDATION', 'Pick the event date.');
    end if;
  elsif p_event_date is not null or p_event_start_at is not null or p_event_end_at is not null then
    perform app.fail('VALIDATION', format('A %s has no event date.', p_type.name));
  elsif p_purpose is not null then
    perform app.fail('VALIDATION', 'Only an event has a purpose.');
  end if;
  if p_event_end_at is not null and p_event_start_at is null then
    perform app.fail('VALIDATION', 'An event with an end time needs a start time.');
  end if;
  if p_event_start_at is not null and app.to_ist_date(p_event_start_at) <> p_event_date then
    perform app.fail('VALIDATION', 'The event time must be on the event date.');
  end if;
  if p_event_end_at is not null and p_event_end_at <= p_event_start_at then
    perform app.fail('VALIDATION', 'The event must end after it starts.');
  end if;
  if p_location is not null and not p_type.has_location then
    perform app.fail('VALIDATION', format('A %s has no location.', p_type.name));
  end if;
end;
$$;

revoke all on function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text) from public, authenticated;
grant execute on function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text) to service_role;

comment on function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text) is
  'Internal (4A): the type, label, deadline and event field rules of a task (PRODUCT §4.6): an '
  'active type of the organization; a label from the caller''s own clients unless the Owner; a '
  'deadline, not in the past when p_new; event_date required for an event type and refused for '
  'the rest, times on that IST date and in order, purpose only on an event, location only when the '
  'type has one.';

-- The overridden warnings a create or edit records (WORKFLOWS §3.1 "Assignment warnings").
create function app.task_record_warnings(p_task_id uuid, p_caller uuid, p_assignees uuid[], p_warnings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w jsonb;
  v_member uuid;
begin
  if p_warnings is null then
    return;
  end if;
  if jsonb_typeof(p_warnings) <> 'array' then
    perform app.fail('VALIDATION', 'warnings is a list.');
  end if;
  for w in select * from jsonb_array_elements(p_warnings) loop
    if jsonb_typeof(w) <> 'object' or (w ->> 'kind') is null
       or (w ->> 'kind') not in ('overlap', 'workload', 'on_leave') or (w ->> 'member_id') is null then
      perform app.fail('VALIDATION', 'Each warning names its kind and the person it is about.');
    end if;
    v_member := (w ->> 'member_id')::uuid;
    if not (v_member = any (p_assignees)) then
      perform app.fail('VALIDATION', 'A warning is about one of the assignees.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'warning_overridden',
      'meta', jsonb_build_object('kind', w ->> 'kind', 'member_id', v_member))::text, true);
    insert into public.task_warnings (task_id, kind, member_id, details, overridden_by)
    values (p_task_id, w ->> 'kind', v_member,
            case when jsonb_typeof(w -> 'details') = 'object' then w -> 'details' else '{}'::jsonb end,
            p_caller);
  end loop;
end;
$$;

revoke all on function app.task_record_warnings(uuid, uuid, uuid[], jsonb) from public, authenticated;
grant execute on function app.task_record_warnings(uuid, uuid, uuid[], jsonb) to service_role;

comment on function app.task_record_warnings(uuid, uuid, uuid[], jsonb) is
  'Internal (4A): writes one task_warnings row per element of [{kind, member_id, details}] with '
  'overridden_by = the caller; the person must be one of the task''s assignees. Audit action '
  'warning_overridden per row.';

-- task_create -------------------------------------------------------------------------------------
create function public.task_create(
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
  v_caller uuid;
  v_org uuid;
  v_is_owner boolean;
  v_title text := btrim(coalesce(task_create.title, ''));
  v_description text := nullif(btrim(coalesce(task_create.description, '')), '');
  v_location text := nullif(btrim(coalesce(task_create.location, '')), '');
  v_purpose text := nullif(btrim(coalesce(task_create.purpose, '')), '');
  v_type public.task_types;
  v_approver uuid;
  v_route text;
  v_ids uuid[];
  v_id uuid;
  v_member uuid;
  v_stage text;
  v_position text := null;
  v_reminders jsonb;
  v_task_id uuid := gen_random_uuid();
begin
  select r.caller_id, r.org_id, r.is_owner into v_caller, v_org, v_is_owner from app.task_require_creator() r;

  if v_title = '' then
    perform app.fail('VALIDATION', 'A title is required.');
  end if;
  if length(v_title) > 200 then
    perform app.fail('VALIDATION', 'Keep the title under 200 characters.');
  end if;
  if v_description is not null and length(v_description) > 10000 then
    perform app.fail('VALIDATION', 'Keep the description under 10000 characters.');
  end if;
  if task_create.priority is null then
    perform app.fail('VALIDATION', 'Pick a priority.');
  end if;

  select tt.* into v_type from public.task_types tt where tt.id = task_create.task_type_id;
  perform app.task_check_fields(v_org, v_is_owner, v_type, task_create.client_id, task_create.due_at, true,
    task_create.event_date, task_create.event_start_at, task_create.event_end_at, v_location, v_purpose);

  -- The approval route (PRODUCT §4.6 table; kickoff 4 decisions 2 and 3).
  if v_is_owner then
    v_approver := task_create.approving_admin_id;
    if v_approver is not null and not exists (
      select 1 from public.members m
      where m.id = v_approver and m.org_id = v_org and m.role = 'admin'
        and m.status = 'active' and m.engagement = 'permanent') then
      perform app.fail('VALIDATION', 'Choose an active Admin as the approver.');
    end if;
    v_route := case when v_approver is null then 'owner_direct' else 'owner_via_admin' end;
  else
    if task_create.approving_admin_id is not null and task_create.approving_admin_id <> v_caller then
      perform app.fail('VALIDATION', 'A task you create routes to you for approval.');
    end if;
    v_approver := v_caller;
    v_route := 'admin';
  end if;

  -- Assignees: active Admins, Staff or freelancers, never the Owner; the primary among them.
  v_ids := array(select distinct a from unnest(coalesce(task_create.assignee_ids, '{}'::uuid[])) a where a is not null);
  if coalesce(cardinality(v_ids), 0) = 0 then
    perform app.fail('VALIDATION', 'Assign at least one person.');
  end if;
  if task_create.primary_owner_id is null or not (task_create.primary_owner_id = any (v_ids)) then
    perform app.fail('VALIDATION', 'The primary owner must be one of the assignees.');
  end if;
  foreach v_member in array v_ids loop
    perform app.task_assignee_check(v_org, v_member);
  end loop;

  foreach v_stage in array coalesce(task_create.stages, '{}'::text[]) loop
    if length(btrim(coalesce(v_stage, ''))) not between 1 and 120 then
      perform app.fail('VALIDATION', 'Each stage needs a name of up to 120 characters.');
    end if;
  end loop;

  if task_create.custom_fields is null or jsonb_typeof(task_create.custom_fields) <> 'object' then
    perform app.fail('VALIDATION', 'Custom fields are an object.');
  end if;
  -- Kickoff 4 decision 14: no reminder editor yet; a task takes its type's defaults.
  v_reminders := coalesce(task_create.reminder_rules, v_type.default_reminders, '[]'::jsonb);
  if jsonb_typeof(v_reminders) <> 'array' then
    perform app.fail('VALIDATION', 'Reminder rules are a list.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'created',
    'meta', jsonb_build_object('route', v_route, 'approving_admin_id', v_approver,
                               'assignee_ids', to_jsonb(v_ids), 'primary_owner_id', task_create.primary_owner_id))::text, true);
  insert into public.tasks (
    id, org_id, title, description, task_type_id, client_id, priority, due_at,
    event_date, event_start_at, event_end_at, location, purpose,
    state, approving_admin_id, admin_step, created_by, primary_owner_id,
    reminder_rules, custom_fields, template_id)
  values (
    v_task_id, v_org, v_title, v_description, v_type.id, task_create.client_id, task_create.priority, task_create.due_at,
    task_create.event_date, task_create.event_start_at, task_create.event_end_at, v_location, v_purpose,
    'todo', v_approver, (case when v_approver is null then 'none' else 'required' end)::public.admin_step, v_caller, task_create.primary_owner_id,
    v_reminders, task_create.custom_fields, task_create.template_id);

  foreach v_member in array v_ids loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'assigned',
      'meta', jsonb_build_object('member_id', v_member, 'is_primary', v_member = task_create.primary_owner_id))::text, true);
    insert into public.task_assignees (task_id, member_id, is_primary, assigned_by)
    values (v_task_id, v_member, v_member = task_create.primary_owner_id, v_caller);
  end loop;

  foreach v_stage in array coalesce(task_create.stages, '{}'::text[]) loop
    v_position := app.next_position(v_position);
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'stage_added', 'meta', jsonb_build_object('name', btrim(v_stage)))::text, true);
    insert into public.task_stages (task_id, name, position) values (v_task_id, btrim(v_stage), v_position);
  end loop;

  perform app.task_record_warnings(v_task_id, v_caller, v_ids, task_create.warnings);

  return v_task_id;
end;
$$;

revoke all on function public.task_create(text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.task_create(text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) to authenticated, service_role;

comment on function public.task_create(text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) is
  'tasks.create (the Owner and Admins). A task in todo with its route resolved (PRODUCT §4.6): the '
  'Owner names any active Admin as approver or none; an Admin''s task routes to that Admin and its '
  'client label must be one of their clients. Assignees are active Admins, Staff or freelancers, '
  'never the Owner; the primary owner is one of them. due_at is required and not in the past; the '
  'type decides the event fields (app.task_check_fields); reminder_rules default to the type''s; '
  'stages are typed names; warnings = [{kind, member_id, details}] the caller proceeded past. '
  'Audit: created (meta.route), assigned per person, stage_added, warning_overridden. Notifies each '
  'assignee (a freelancer''s coordinator, worded for them; WORKFLOWS §9; the rows are 5.1''s).';

-- task_acknowledge ----------------------------------------------------------------------------------
create function public.task_acknowledge(task_id uuid, on_behalf_of uuid default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_subject uuid;
  v_org uuid;
  v_task public.tasks;
  v_row public.task_assignees;
  v_at timestamptz := now();
begin
  select a.actor_id, a.subject_id, a.org_id into v_actor, v_subject, v_org
  from app.task_actor(task_acknowledge.task_id, task_acknowledge.on_behalf_of) a;
  v_task := app.task_lock(task_acknowledge.task_id, v_org);
  if v_task.state in ('completed', 'cancelled') then
    perform app.fail('INVALID_STATE', 'This task is closed.');
  end if;
  select ta.* into v_row from public.task_assignees ta
  where ta.task_id = v_task.id and ta.member_id = v_subject for update;
  if v_row.acknowledged_at is not null then
    perform app.fail('INVALID_STATE', 'Already noted.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'acknowledged',
    'on_behalf_of', task_acknowledge.on_behalf_of,
    'meta', jsonb_build_object('member_id', v_subject))::text, true);
  update public.task_assignees set acknowledged_at = v_at, acknowledged_by = v_actor
  where task_assignees.task_id = v_task.id and member_id = v_subject;
  return v_at;
end;
$$;

revoke all on function public.task_acknowledge(uuid, uuid) from public, anon;
grant execute on function public.task_acknowledge(uuid, uuid) to authenticated, service_role;

comment on function public.task_acknowledge(uuid, uuid) is
  'tasks.work. "Task Noted" (WORKFLOWS §3.2): the caller''s own assignee row, or their freelancer''s '
  'with on_behalf_of (the current coordinator only, ADR-0013), acknowledged_at = now(), '
  'acknowledged_by = the caller. Once per person; INVALID_STATE on a completed or cancelled task. '
  'Audit action: acknowledged (on_behalf_of_id when for a freelancer). Notifies nobody (the '
  'reminders stop for that person, 5.1).';

-- task_start ---------------------------------------------------------------------------------------
create function public.task_start(task_id uuid, on_behalf_of uuid default null)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_subject uuid;
  v_org uuid;
  v_task public.tasks;
begin
  select a.actor_id, a.subject_id, a.org_id into v_actor, v_subject, v_org
  from app.task_actor(task_start.task_id, task_start.on_behalf_of) a;
  v_task := app.task_lock(task_start.task_id, v_org);
  if v_task.state = 'in_progress' then
    perform app.fail('INVALID_STATE', 'This task has already been started.');
  end if;
  if v_task.state <> 'todo' then
    perform app.fail('INVALID_STATE', 'This task cannot be started now.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'started',
    'on_behalf_of', task_start.on_behalf_of,
    'meta', jsonb_build_object('member_id', v_subject))::text, true);
  update public.tasks set state = 'in_progress' where id = v_task.id;
  return 'in_progress';
end;
$$;

revoke all on function public.task_start(uuid, uuid) from public, anon;
grant execute on function public.task_start(uuid, uuid) to authenticated, service_role;

comment on function public.task_start(uuid, uuid) is
  'tasks.work. todo -> in_progress by any active assignee, or by a freelancer assignee''s current '
  'coordinator with on_behalf_of (ADR-0013). Optional (Done can follow todo directly); implies no '
  'acknowledgement. INVALID_STATE from any other state. Audit action: started. Notifies nobody.';

-- task_submit_done ---------------------------------------------------------------------------------
create function public.task_submit_done(
  task_id uuid, note text default null, late_reason text default null, on_behalf_of uuid default null)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_subject uuid;
  v_org uuid;
  v_task public.tasks;
  v_row public.task_assignees;
  v_note text := nullif(btrim(coalesce(task_submit_done.note, '')), '');
  v_late boolean;
  v_late_reason text := app.clean_reason(task_submit_done.late_reason);
  v_version integer;
  v_submission uuid;
  v_state public.task_state;
  v_step public.admin_step;
  v_meta jsonb;
begin
  select a.actor_id, a.subject_id, a.org_id into v_actor, v_subject, v_org
  from app.task_actor(task_submit_done.task_id, task_submit_done.on_behalf_of) a;
  v_task := app.task_lock(task_submit_done.task_id, v_org);
  if v_subject <> v_task.primary_owner_id then
    perform app.fail('FORBIDDEN', 'Only the primary owner marks a task Done.');
  end if;
  if v_task.state in ('submitted', 'admin_approved') then
    perform app.fail('INVALID_STATE', 'Already submitted: the task is waiting for its review.');
  end if;
  if v_task.state = 'completed' then
    perform app.fail('INVALID_STATE', 'This task is complete.');
  end if;
  if v_task.state = 'cancelled' then
    perform app.fail('INVALID_STATE', 'This task was cancelled.');
  end if;
  if v_note is not null and length(v_note) > 5000 then
    perform app.fail('VALIDATION', 'Keep the note under 5000 characters.');
  end if;
  v_late := now() > v_task.due_at;
  if v_late and v_late_reason is null then
    perform app.fail('REASON_REQUIRED', 'The deadline has passed: say why the task is late.');
  end if;

  -- Done does not wait for acknowledgements: the primary owner's is recorded now if missing.
  select ta.* into v_row from public.task_assignees ta
  where ta.task_id = v_task.id and ta.member_id = v_subject for update;
  if v_row.acknowledged_at is null then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'acknowledged',
      'on_behalf_of', task_submit_done.on_behalf_of,
      'meta', jsonb_build_object('member_id', v_subject, 'implied', true))::text, true);
    update public.task_assignees set acknowledged_at = now(), acknowledged_by = v_actor
    where task_assignees.task_id = v_task.id and member_id = v_subject;
  end if;

  -- The hand-in: one version per Done or resubmit (WORKFLOWS §3.3).
  select coalesce(max(s.version), 0) + 1 into v_version from public.task_submissions s where s.task_id = v_task.id;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submission_added',
    'on_behalf_of', task_submit_done.on_behalf_of,
    'meta', jsonb_build_object('version', v_version))::text, true);
  insert into public.task_submissions (task_id, version, note, submitted_by, on_behalf_of)
  values (v_task.id, v_version, v_note, v_actor, task_submit_done.on_behalf_of)
  returning id into v_submission;

  -- The route (PRODUCT §4.6): the Admin step is required, none (no approver) or skipped
  -- (the approver is an assignee; the reason lives only in the activity log).
  if v_task.approving_admin_id is null then
    v_state := 'admin_approved'; v_step := 'none';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'none');
  elsif app.is_task_assignee(v_task.id, v_task.approving_admin_id) then
    v_state := 'admin_approved'; v_step := 'skipped';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'skipped', 'reason', 'approver_is_assignee');
  else
    v_state := 'submitted'; v_step := 'required';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'required');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'on_behalf_of', task_submit_done.on_behalf_of, 'meta', v_meta)::text, true);
  update public.tasks
  set state = v_state, admin_step = v_step, submitted_at = now(), submitted_by = v_actor,
      submitted_on_behalf_of = task_submit_done.on_behalf_of,
      late_reason = case when v_late then v_late_reason else tasks.late_reason end,
      admin_approved_at = null
  where id = v_task.id;
  return v_state;
end;
$$;

revoke all on function public.task_submit_done(uuid, text, text, uuid) from public, anon;
grant execute on function public.task_submit_done(uuid, text, text, uuid) to authenticated, service_role;

comment on function public.task_submit_done(uuid, text, text, uuid) is
  'tasks.work, the primary owner (or their current coordinator with on_behalf_of, ADR-0013), from '
  'todo / in_progress / changes_requested. Records the primary owner''s acknowledgement if missing '
  '(audit acknowledged, meta.implied), writes the next task_submissions version (the optional note, '
  'links allowed), requires late_reason past due_at (REASON_REQUIRED), then routes: submitted with '
  'admin_step required when an approving Admin exists and is not an assignee; otherwise '
  'admin_approved with admin_step none (no approver) or skipped (the approver is an assignee; '
  'meta.reason approver_is_assignee). Audit action: submitted. Notifies the approving Admin, or the '
  'Owner when there is no Admin step (WORKFLOWS §9; 5.1).';

-- task_review --------------------------------------------------------------------------------------
create function public.task_review(task_id uuid, decision public.review_decision, reason text default null)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_task public.tasks;
  v_reason text := app.clean_reason(task_review.reason);
  v_step text;
  v_state public.task_state;
  v_submission uuid;
  v_action text;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if task_review.decision is null then
    perform app.fail('VALIDATION', 'The decision is approved or rejected.');
  end if;
  if task_review.decision = 'rejected' and v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say what needs to change.');
  end if;
  v_task := app.task_lock(task_review.task_id, v_org);

  if v_task.state = 'submitted' then
    -- The Admin step: the approving Admin, never an assignee (PERMISSIONS §3). The Owner's way
    -- past a waiting Admin is task_set_approver.
    if v_task.approving_admin_id is distinct from v_caller or not app.has_permission('tasks.approve_admin') then
      if app.is_owner() then
        perform app.fail('INVALID_STATE', 'This task is waiting for its approving Admin. Change or remove the approver to decide it yourself.');
      end if;
      perform app.fail('FORBIDDEN', 'Only the task''s approving Admin reviews it at this step.');
    end if;
    if app.is_task_assignee(v_task.id, v_caller) then
      perform app.fail('FORBIDDEN', 'An assignee cannot approve their own task.');
    end if;
    v_step := 'admin';
    v_state := case when task_review.decision = 'approved' then 'admin_approved' else 'changes_requested' end;
  elsif v_task.state = 'admin_approved' then
    if not app.has_permission('tasks.approve_final') then
      perform app.fail('FORBIDDEN', 'Only the Owner gives the final approval.');
    end if;
    v_step := 'owner';
    v_state := case when task_review.decision = 'approved' then 'completed' else 'changes_requested' end;
  elsif v_task.state = 'completed' then
    perform app.fail('INVALID_STATE', 'This task is already complete.');
  elsif v_task.state = 'cancelled' then
    perform app.fail('INVALID_STATE', 'This task was cancelled.');
  else
    perform app.fail('INVALID_STATE', 'Nothing to review: the task has not been submitted.');
  end if;

  select s.id into v_submission from public.task_submissions s
  where s.task_id = v_task.id order by s.version desc limit 1;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'review_recorded',
    'meta', jsonb_build_object('step', v_step, 'decision', task_review.decision, 'reason', v_reason))::text, true);
  insert into public.task_reviews (task_id, step, decision, reason, reviewer_id, submission_id)
  values (v_task.id, v_step, task_review.decision, v_reason, v_caller, v_submission);

  v_action := case v_state when 'admin_approved' then 'admin_approved'
                           when 'completed' then 'completed'
                           else 'changes_requested' end;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', v_action,
    'meta', jsonb_build_object('step', v_step, 'reason', v_reason, 'submission_id', v_submission))::text, true);
  update public.tasks
  set state = v_state,
      admin_approved_at = case when v_state = 'admin_approved' then now() else admin_approved_at end,
      completed_at = case when v_state = 'completed' then now() else null end
  where id = v_task.id;
  return v_state;
end;
$$;

revoke all on function public.task_review(uuid, public.review_decision, text) from public, anon;
grant execute on function public.task_review(uuid, public.review_decision, text) to authenticated, service_role;

comment on function public.task_review(uuid, public.review_decision, text) is
  'The review (WORKFLOWS §3.3). submitted: the approving Admin (tasks.approve_admin, never an '
  'assignee; the Owner is INVALID_STATE here and changes the approver instead) -> admin_approved or '
  'changes_requested. admin_approved: tasks.approve_final (the Owner) -> completed or '
  'changes_requested. rejected needs a reason (REASON_REQUIRED). One task_reviews row per call, '
  'pointing at the latest submission; bulk approve is this function once per task (approved only, '
  'kickoff 4 decision 5). Audit: review_recorded, then admin_approved | completed | '
  'changes_requested. Notifies: the Owner after an Admin approval; the assignees (a freelancer''s '
  'coordinator) on changes requested or completion (WORKFLOWS §9; 5.1).';

-- task_reopen ---------------------------------------------------------------------------------------
create function public.task_reopen(task_id uuid, reason text)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_task public.tasks;
  v_reason text := app.clean_reason(task_reopen.reason);
  v_state public.task_state;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say why the task is reopened.');
  end if;
  v_task := app.task_lock(task_reopen.task_id, v_org);
  -- The key and the scope (PERMISSIONS §1/§3): tasks.create, and the creator / approver / Owner.
  if not app.has_permission('tasks.create') or not app.task_manager(v_task.id) then
    perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner reopens it.');
  end if;
  if v_task.state = 'completed' then
    v_state := 'in_progress';
  elsif v_task.state = 'cancelled' then
    v_state := 'todo';
  else
    perform app.fail('INVALID_STATE', 'Only a completed or cancelled task can be reopened.');
  end if;

  -- The same route again (WORKFLOWS §3.1): the Admin step is re-evaluated at the next Done;
  -- acknowledgements stay. The stamps are cleared; the audit diff keeps them.
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'reopened',
    'meta', jsonb_build_object('reason', v_reason, 'from_state', v_task.state))::text, true);
  update public.tasks
  set state = v_state,
      admin_step = (case when approving_admin_id is null then 'none' else 'required' end)::public.admin_step,
      submitted_at = null, submitted_by = null, submitted_on_behalf_of = null,
      admin_approved_at = null, completed_at = null, cancelled_at = null, cancelled_reason = null
  where id = v_task.id;
  return v_state;
end;
$$;

revoke all on function public.task_reopen(uuid, text) from public, anon;
grant execute on function public.task_reopen(uuid, text) to authenticated, service_role;

comment on function public.task_reopen(uuid, text) is
  'The task''s creator, its approving Admin or the Owner (app.task_manager). completed -> '
  'in_progress, cancelled -> todo; reason required (REASON_REQUIRED, kept only in the activity '
  'log). The route is walked again: admin_step back to required / none, the submission, approval '
  'and cancellation stamps cleared; acknowledgements kept. Audit action: reopened. Notifies the '
  'assignees and the creator (WORKFLOWS §9; 5.1).';

-- task_cancel ---------------------------------------------------------------------------------------
create function public.task_cancel(task_id uuid, reason text)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_task public.tasks;
  v_reason text := app.clean_reason(task_cancel.reason);
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say why the task is cancelled.');
  end if;
  v_task := app.task_lock(task_cancel.task_id, v_org);
  -- The key and the scope (PERMISSIONS §1/§3): tasks.create, and the creator / approver / Owner.
  if not app.has_permission('tasks.create') or not app.task_manager(v_task.id) then
    perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner cancels it.');
  end if;
  if v_task.state = 'cancelled' then
    perform app.fail('INVALID_STATE', 'This task is already cancelled.');
  end if;
  if v_task.state = 'completed' then
    perform app.fail('INVALID_STATE', 'A completed task is reopened, not cancelled.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'cancelled',
    'meta', jsonb_build_object('reason', v_reason, 'from_state', v_task.state))::text, true);
  update public.tasks
  set state = 'cancelled', cancelled_at = now(), cancelled_reason = v_reason
  where id = v_task.id;
  return 'cancelled';
end;
$$;

revoke all on function public.task_cancel(uuid, text) from public, anon;
grant execute on function public.task_cancel(uuid, text) to authenticated, service_role;

comment on function public.task_cancel(uuid, text) is
  'The task''s creator, its approving Admin or the Owner (app.task_manager). Any state but '
  'completed or cancelled -> cancelled with the reason (REASON_REQUIRED); the task stays in history '
  'and reports, reminders stop (5.1). Audit action: cancelled. Notifies the assignees and the '
  'creator (WORKFLOWS §9; 5.1).';

-- task_update_assignment ---------------------------------------------------------------------------
create function public.task_update_assignment(task_id uuid, changes jsonb, warnings jsonb default '[]')
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_is_owner boolean;
  v_task public.tasks;
  v_type public.task_types;
  v_key text;
  v_changed text[] := '{}';
  -- The values after the change (start from the row, overwrite what `changes` names).
  v_title text;
  v_description text;
  v_task_type_id uuid;
  v_client_id uuid;
  v_priority public.priority;
  v_due_at timestamptz;
  v_event_date date;
  v_event_start_at timestamptz;
  v_event_end_at timestamptz;
  v_location text;
  v_purpose text;
  v_custom_fields jsonb;
  v_reminder_rules jsonb;
  v_primary uuid;
  v_new_ids uuid[];
  v_current_ids uuid[];
  v_member uuid;
  v_row public.task_assignees;
begin
  select r.caller_id, r.org_id, r.is_owner into v_caller, v_org, v_is_owner from app.task_require_creator() r;
  if task_update_assignment.changes is null or jsonb_typeof(task_update_assignment.changes) <> 'object'
     or task_update_assignment.changes = '{}'::jsonb then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(task_update_assignment.changes) loop
    if v_key not in ('title', 'description', 'task_type_id', 'client_id', 'priority', 'due_at',
                     'event_date', 'event_start_at', 'event_end_at', 'location', 'purpose',
                     'custom_fields', 'reminder_rules', 'assignee_ids', 'primary_owner_id') then
      perform app.fail('VALIDATION', format('"%s" is not a task field that can be changed here.', v_key));
    end if;
  end loop;

  v_task := app.task_lock(task_update_assignment.task_id, v_org);
  if not app.task_manager(v_task.id) then
    perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner changes it.');
  end if;
  if v_task.state in ('completed', 'cancelled') then
    perform app.fail('INVALID_STATE', 'Reopen the task to change it.');
  end if;

  -- The values after the change; a value of the wrong shape is VALIDATION, never a raw cast error.
  begin
    v_title := case when changes ? 'title' then btrim(coalesce(changes ->> 'title', '')) else v_task.title end;
    v_description := case when changes ? 'description' then nullif(btrim(coalesce(changes ->> 'description', '')), '') else v_task.description end;
    v_task_type_id := case when changes ? 'task_type_id' then (changes ->> 'task_type_id')::uuid else v_task.task_type_id end;
    v_client_id := case when changes ? 'client_id' then (changes ->> 'client_id')::uuid else v_task.client_id end;
    v_priority := case when changes ? 'priority' then (changes ->> 'priority')::public.priority else v_task.priority end;
    v_due_at := case when changes ? 'due_at' then (changes ->> 'due_at')::timestamptz else v_task.due_at end;
    v_event_date := case when changes ? 'event_date' then (changes ->> 'event_date')::date else v_task.event_date end;
    v_event_start_at := case when changes ? 'event_start_at' then (changes ->> 'event_start_at')::timestamptz else v_task.event_start_at end;
    v_event_end_at := case when changes ? 'event_end_at' then (changes ->> 'event_end_at')::timestamptz else v_task.event_end_at end;
    v_location := case when changes ? 'location' then nullif(btrim(coalesce(changes ->> 'location', '')), '') else v_task.location end;
    v_purpose := case when changes ? 'purpose' then nullif(btrim(coalesce(changes ->> 'purpose', '')), '') else v_task.purpose end;
    v_custom_fields := case when changes ? 'custom_fields' then changes -> 'custom_fields' else v_task.custom_fields end;
    v_reminder_rules := case when changes ? 'reminder_rules' then changes -> 'reminder_rules' else v_task.reminder_rules end;
    v_primary := case when changes ? 'primary_owner_id' then (changes ->> 'primary_owner_id')::uuid else v_task.primary_owner_id end;
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or data_exception then
      perform app.fail('VALIDATION', 'A field has the wrong format.');
  end;

  if v_title = '' then
    perform app.fail('VALIDATION', 'A title is required.');
  end if;
  if length(v_title) > 200 then
    perform app.fail('VALIDATION', 'Keep the title under 200 characters.');
  end if;
  if v_description is not null and length(v_description) > 10000 then
    perform app.fail('VALIDATION', 'Keep the description under 10000 characters.');
  end if;
  if v_priority is null then
    perform app.fail('VALIDATION', 'Pick a priority.');
  end if;
  if v_custom_fields is null or jsonb_typeof(v_custom_fields) <> 'object' then
    perform app.fail('VALIDATION', 'Custom fields are an object.');
  end if;
  if v_reminder_rules is null or jsonb_typeof(v_reminder_rules) <> 'array' then
    perform app.fail('VALIDATION', 'Reminder rules are a list.');
  end if;
  select tt.* into v_type from public.task_types tt where tt.id = v_task_type_id;
  perform app.task_check_fields(v_org, v_is_owner, v_type, v_client_id, v_due_at, false,
    v_event_date, v_event_start_at, v_event_end_at, v_location, v_purpose);

  -- Assignees: the full new set when given; the primary owner among the active rows either way.
  v_current_ids := array(select a.member_id from public.task_assignees a where a.task_id = v_task.id and a.removed_at is null);
  if changes ? 'assignee_ids' then
    if jsonb_typeof(changes -> 'assignee_ids') <> 'array' then
      perform app.fail('VALIDATION', 'assignee_ids is a list.');
    end if;
    v_new_ids := array(select distinct (e #>> '{}')::uuid from jsonb_array_elements(changes -> 'assignee_ids') e);
    if coalesce(cardinality(v_new_ids), 0) = 0 then
      perform app.fail('VALIDATION', 'Assign at least one person.');
    end if;
    foreach v_member in array v_new_ids loop
      perform app.task_assignee_check(v_org, v_member);
    end loop;
  else
    v_new_ids := v_current_ids;
  end if;
  if v_primary is null or not (v_primary = any (v_new_ids)) then
    perform app.fail('VALIDATION', 'The primary owner must be one of the assignees.');
  end if;

  -- Removed people keep their row with removed_at (WORKFLOWS §3.2).
  foreach v_member in array v_current_ids loop
    if not (v_member = any (v_new_ids)) then
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'unassigned', 'meta', jsonb_build_object('member_id', v_member))::text, true);
      update public.task_assignees set removed_at = now(), is_primary = false
      where task_assignees.task_id = v_task.id and member_id = v_member;
      v_changed := array_append(v_changed, 'assignee_ids');
    end if;
  end loop;
  -- A primary change first clears the old flag (one active primary per task).
  if v_primary <> v_task.primary_owner_id then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'primary_changed',
      'meta', jsonb_build_object('from', v_task.primary_owner_id, 'to', v_primary))::text, true);
    update public.task_assignees set is_primary = false
    where task_assignees.task_id = v_task.id and member_id = v_task.primary_owner_id and is_primary;
  end if;
  -- Added people start their own acknowledgement; someone re-added starts again.
  foreach v_member in array v_new_ids loop
    if not (v_member = any (v_current_ids)) then
      select a.* into v_row from public.task_assignees a where a.task_id = v_task.id and a.member_id = v_member;
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'assigned',
        'meta', jsonb_build_object('member_id', v_member, 'is_primary', v_member = v_primary, 'again', v_row.task_id is not null))::text, true);
      if v_row.task_id is not null then
        update public.task_assignees
        set removed_at = null, assigned_at = now(), assigned_by = v_caller,
            acknowledged_at = null, acknowledged_by = null, is_primary = (v_member = v_primary)
        where task_assignees.task_id = v_task.id and member_id = v_member;
      else
        insert into public.task_assignees (task_id, member_id, is_primary, assigned_by)
        values (v_task.id, v_member, v_member = v_primary, v_caller);
      end if;
      v_changed := array_append(v_changed, 'assignee_ids');
    end if;
  end loop;
  if v_primary <> v_task.primary_owner_id then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'primary_changed',
      'meta', jsonb_build_object('from', v_task.primary_owner_id, 'to', v_primary))::text, true);
    update public.task_assignees set is_primary = true
    where task_assignees.task_id = v_task.id and member_id = v_primary and not is_primary;
    v_changed := array_append(v_changed, 'primary_owner_id');
  end if;

  -- The task's own fields: the trigger's diff is the field-level record (action updated).
  if v_title <> v_task.title then v_changed := array_append(v_changed, 'title'); end if;
  if v_description is distinct from v_task.description then v_changed := array_append(v_changed, 'description'); end if;
  if v_task_type_id <> v_task.task_type_id then v_changed := array_append(v_changed, 'task_type_id'); end if;
  if v_client_id is distinct from v_task.client_id then v_changed := array_append(v_changed, 'client_id'); end if;
  if v_priority <> v_task.priority then v_changed := array_append(v_changed, 'priority'); end if;
  if v_due_at <> v_task.due_at then v_changed := array_append(v_changed, 'due_at'); end if;
  if v_event_date is distinct from v_task.event_date then v_changed := array_append(v_changed, 'event_date'); end if;
  if v_event_start_at is distinct from v_task.event_start_at then v_changed := array_append(v_changed, 'event_start_at'); end if;
  if v_event_end_at is distinct from v_task.event_end_at then v_changed := array_append(v_changed, 'event_end_at'); end if;
  if v_location is distinct from v_task.location then v_changed := array_append(v_changed, 'location'); end if;
  if v_purpose is distinct from v_task.purpose then v_changed := array_append(v_changed, 'purpose'); end if;
  if v_custom_fields <> v_task.custom_fields then v_changed := array_append(v_changed, 'custom_fields'); end if;
  if v_reminder_rules <> v_task.reminder_rules then v_changed := array_append(v_changed, 'reminder_rules'); end if;

  v_changed := array(select distinct c from unnest(v_changed) c order by c);
  if coalesce(cardinality(v_changed), 0) = 0 then
    perform app.fail('VALIDATION', 'Nothing changed.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'updated', 'meta', jsonb_build_object('fields', to_jsonb(v_changed)))::text, true);
  update public.tasks
  set title = v_title, description = v_description, task_type_id = v_task_type_id, client_id = v_client_id,
      priority = v_priority, due_at = v_due_at, event_date = v_event_date,
      event_start_at = v_event_start_at, event_end_at = v_event_end_at,
      location = v_location, purpose = v_purpose, custom_fields = v_custom_fields,
      reminder_rules = v_reminder_rules, primary_owner_id = v_primary
  where id = v_task.id;
  -- A no-op on the row itself (assignees only) leaves the override unconsumed: clear it.
  perform set_config('app.audit_override', '', true);

  perform app.task_record_warnings(v_task.id, v_caller, v_new_ids, task_update_assignment.warnings);

  return v_changed;
end;
$$;

revoke all on function public.task_update_assignment(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.task_update_assignment(uuid, jsonb, jsonb) to authenticated, service_role;

comment on function public.task_update_assignment(uuid, jsonb, jsonb) is
  'tasks.create and app.task_manager (the creator, the approving Admin, the Owner), not on a '
  'completed or cancelled task. changes = a jsonb object of the fields to change: title, '
  'description, task_type_id, client_id (an Admin: own clients only), priority, due_at (any value; '
  'overdue follows), event_date, event_start_at, event_end_at, location, purpose, custom_fields, '
  'reminder_rules, assignee_ids (the full new set: added people start their acknowledgement, '
  'removed ones keep their row with removed_at, a re-added person starts again), primary_owner_id '
  '(an active assignee, never the Owner). warnings as task_create. Returns the fields that changed '
  '(VALIDATION when none did). Audit: updated (the trigger''s diff, meta.fields) plus assigned / '
  'unassigned / primary_changed rows. Notifies the affected assignees (WORKFLOWS §9; 5.1).';

-- task_set_approver ---------------------------------------------------------------------------------
create function public.task_set_approver(task_id uuid, approving_admin_id uuid)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_task public.tasks;
  v_state public.task_state;
  v_step public.admin_step;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.is_owner() then
    perform app.fail('FORBIDDEN', 'Only the Owner changes who approves a task.');
  end if;
  v_task := app.task_lock(task_set_approver.task_id, v_org);
  if v_task.state in ('completed', 'cancelled') then
    perform app.fail('INVALID_STATE', 'Reopen the task to change its approver.');
  end if;
  if task_set_approver.approving_admin_id is not null and not exists (
    select 1 from public.members m
    where m.id = task_set_approver.approving_admin_id and m.org_id = v_org and m.role = 'admin'
      and m.status = 'active' and m.engagement = 'permanent') then
    perform app.fail('VALIDATION', 'Choose an active Admin as the approver.');
  end if;
  if task_set_approver.approving_admin_id is not distinct from v_task.approving_admin_id then
    perform app.fail('VALIDATION', 'That is already the approving Admin.');
  end if;

  v_state := v_task.state;
  if v_task.state = 'submitted' then
    -- The review moves to the new approver, or the task goes to the Owner at once.
    if task_set_approver.approving_admin_id is null then
      v_state := 'admin_approved'; v_step := 'none';
    elsif app.is_task_assignee(v_task.id, task_set_approver.approving_admin_id) then
      v_state := 'admin_approved'; v_step := 'skipped';
    else
      v_step := 'required';
    end if;
  elsif v_task.state = 'admin_approved' then
    -- The Admin step is behind the task: only a removed approver changes the record.
    v_step := case when task_set_approver.approving_admin_id is null then 'none' else v_task.admin_step end;
  else
    v_step := case when task_set_approver.approving_admin_id is null then 'none' else 'required' end;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approver_changed',
    'meta', jsonb_build_object('from', v_task.approving_admin_id, 'to', task_set_approver.approving_admin_id,
                               'from_state', v_task.state, 'to_state', v_state))::text, true);
  update public.tasks
  set approving_admin_id = task_set_approver.approving_admin_id, admin_step = v_step, state = v_state
  where id = v_task.id;
  return v_state;
end;
$$;

revoke all on function public.task_set_approver(uuid, uuid) from public, anon;
grant execute on function public.task_set_approver(uuid, uuid) to authenticated, service_role;

comment on function public.task_set_approver(uuid, uuid) is
  'The Owner. Changes or removes (null) a task''s approving Admin (an active permanent Admin), not '
  'on a completed or cancelled task. admin_step follows (none without an approver, else required); '
  'while submitted the review moves to the new approver, or the task goes to admin_approved at '
  'once when the approver is removed (none) or is an assignee (skipped); while admin_approved only '
  'a removal changes the record. Audit action: approver_changed (meta.from / to). Notifies the new '
  'approver when a review is waiting (WORKFLOWS §9; 5.1).';
