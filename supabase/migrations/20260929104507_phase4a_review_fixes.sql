-- 4A independent review fixes (the orchestrator's review of 1571299..5ba79f5; fix forward: the three
-- 4A migrations are applied to staging and stay as they are).
--
-- M1. task_warnings leaked another person's leave and workload to a co-assignee: the rows and their
--     warning_overridden activity entries now need availability.view (the Owner and Admins;
--     PERMISSIONS §2), on a visible task.
-- M2. A reactivated freelancer could come back behind a coordinator who had left: member_deactivate
--     closes every current coordinator row pointing at the person (a deactivated freelancer's too,
--     reason coordinator_deactivated) and member_reactivate requires a current coordinator who is
--     still an active permanent Admin or Staff, their row locked as app.coordinator_eligible() does
--     (WORKFLOWS §1b).
-- S1. An approving Admin may edit a task the Owner labelled with another Admin's client: the
--     own-clients rule applies to a label the Admin sets or changes, not to every edit.
-- S2. The API on-behalf paths (a comment, a stage tick for a freelancer) carry on_behalf_of_id in
--     activity_log too: audit_row_change() falls back to the row's own on_behalf_of column.
-- S3. assignee_ids and warning member_id values of the wrong shape are VALIDATION, not a raw cast error.
-- S4. A coordinator-change reason is the Owner's and the Admins' (owner decision 2026-09-29, kickoff 4
--     decision 20): member_coordinators and its activity entries are read with team.view only; a
--     coordinator, current or former, reads their own rows without the reason through the
--     coordinated_freelancers view.
--
-- EXPAND-ONLY (ARCHITECTURE §18): policies and functions re-created with the same public signatures
-- (the internal app.task_check_fields gains an argument; nothing outside these functions calls it),
-- one new view. main's code uses none of the 4A tables, functions or policies touched here.
-- Append-only: never edit once applied.

-- M1 ------------------------------------------------------------------------------------------------
drop policy task_warnings_select on public.task_warnings;
create policy task_warnings_select on public.task_warnings for select to authenticated
  using (app.task_visible(task_id) and (select app.has_permission('availability.view')));

comment on policy task_warnings_select on public.task_warnings is
  'A warning names another person''s leave or load, so it is read by availability.view holders (the '
  'Owner and Admins) on a task they can see, never by a co-assignee (PERMISSIONS §2; 4A review M1).';

drop policy activity_log_select_tasks on public.activity_log;
create policy activity_log_select_tasks on public.activity_log for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and ((entity in ('tasks', 'task_assignees', 'task_stages', 'task_comments', 'task_reviews', 'task_submissions')
               and app.task_visible(entity_id))
              or (entity = 'task_warnings' and app.task_visible(entity_id)
                  and (select app.has_permission('availability.view')))));

comment on policy activity_log_select_tasks on public.activity_log is
  'Entries about a task the caller can see (4A): the task row and its children all carry the '
  'task''s id as entity_id; the warning entries only for availability.view (M1). The Owner reads '
  'everything through activity.view_all.';

-- M2 ------------------------------------------------------------------------------------------------
create or replace function public.member_deactivate(member_id uuid, reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_target public.members;
  v_reason text := nullif(btrim(coalesce(reason, '')), '');
  v_count int;
  v_row record;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;

  select m.* into v_target
  from public.members m
  where m.id = member_id and m.org_id = v_org
  for update;
  if v_target.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_target.id = v_caller then
    perform app.fail('FORBIDDEN', 'You cannot deactivate yourself.');
  end if;
  if v_target.role = 'owner' then
    perform app.fail('FORBIDDEN', 'The Owner cannot be deactivated.');
  end if;
  if v_target.status = 'deactivated' then
    perform app.fail('INVALID_STATE', 'This person is already deactivated.');
  end if;
  -- 4A (WORKFLOWS §1b): no freelancer is left without a coordinator.
  select count(*) into v_count
  from public.member_coordinators mc
  join public.members f on f.id = mc.member_id and f.status = 'active'
  where mc.coordinator_id = v_target.id and mc.to_at is null;
  if v_count > 0 then
    perform app.fail('CONFLICT', format(
      'Move %s''s %s to another coordinator first.', v_target.full_name,
      case when v_count = 1 then '1 freelancer' else v_count || ' freelancers' end));
  end if;

  if v_target.engagement = 'freelance' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'coordinator_closed', 'meta', jsonb_build_object('reason', 'deactivated'))::text, true);
    update public.member_coordinators mc set to_at = now()
    where mc.member_id = v_target.id and mc.to_at is null;
  end if;
  -- 4A review (M2): past the CONFLICT above, a current row still pointing at this person belongs to
  -- a deactivated freelancer (a coordinator set to prepare a reactivation). It is closed with them,
  -- so nobody is ever reactivated behind a coordinator who has left (ADR-0013 §2); the
  -- reactivation asks for a coordinator again. One row per statement: the audit override labels
  -- only the first row a statement writes. `to_at is null` again in the update, so a change that
  -- closed the row meanwhile is never overwritten (history is never rewritten).
  for v_row in
    select mc.id from public.member_coordinators mc
    where mc.coordinator_id = v_target.id and mc.to_at is null
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'coordinator_closed',
      'meta', jsonb_build_object('reason', 'coordinator_deactivated', 'coordinator_id', v_target.id))::text, true);
    update public.member_coordinators set to_at = now() where id = v_row.id and to_at is null;
  end loop;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'deactivated',
    'meta', jsonb_build_object('reason', v_reason, 'from_status', v_target.status)
  )::text, true);
  update public.members set status = 'deactivated', deactivated_at = now() where id = member_id;

  -- Access ends now, not when the JWT expires: no refresh token of theirs survives (ADR-0012).
  -- A freelancer has neither (no auth user): the deletes find nothing.
  delete from auth.refresh_tokens where user_id = member_id::text;
  delete from auth.sessions where user_id = member_id;

  return 'deactivated';
end;
$$;
create or replace function public.member_reactivate(member_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_target public.members;
  v_to public.member_status;
  v_coordinator public.members;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  select m.* into v_target
  from public.members m
  where m.id = member_id and m.org_id = v_org
  for update;
  if v_target.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_target.status <> 'deactivated' then
    perform app.fail('INVALID_STATE', 'Only a deactivated person can be reactivated.');
  end if;
  if v_target.engagement = 'freelance' then
    if app.coordinator_of(v_target.id) is null then
      perform app.fail('INVALID_STATE', 'Set a coordinator first, then reactivate this freelancer.');
    end if;
    -- 4A review (M2): the current coordinator must still be eligible (app.coordinator_eligible's
    -- rule: an active permanent Admin or Staff, never the Owner). Their row is locked as
    -- coordinator_eligible() locks it, so a deactivation of the coordinator at the same instant
    -- either waits and then counts this freelancer as active (CONFLICT), or runs first and this
    -- check sees them deactivated. INVALID_STATE, not coordinator_eligible's VALIDATION: the
    -- Owner fixes it with "Change coordinator", not by changing this call.
    select c.* into v_coordinator
    from public.members c
    where c.id = app.coordinator_of(v_target.id) and c.org_id = v_org
    for update;
    if v_coordinator.id is null or v_coordinator.role = 'owner' or v_coordinator.status <> 'active'
       or v_coordinator.engagement <> 'permanent' then
      perform app.fail('INVALID_STATE', 'Their coordinator is no longer on the team. Set a coordinator first, then reactivate this freelancer.');
    end if;
  end if;

  v_to := case when v_target.joined_at is not null then 'active' else 'invited' end;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'reactivated',
    'meta', jsonb_build_object('to_status', v_to)
  )::text, true);
  update public.members set status = v_to, deactivated_at = null where id = member_id;

  return v_to::text;
end;
$$;

comment on function public.member_deactivate(uuid, text) is
  'team.manage. active | invited → deactivated; never the caller, never the Owner; CONFLICT while an '
  'active freelancer has them as current coordinator (4A). Closes every current coordinator row of '
  'the person: their own as a freelancer (reason deactivated) and the rows of deactivated freelancers '
  'still pointing at them (reason coordinator_deactivated; 4A review M2). Deletes the person''s '
  'auth.refresh_tokens and auth.sessions in the same transaction. The optional reason is kept in the '
  'activity log (meta.reason). Audit action: deactivated.';

comment on function public.member_reactivate(uuid) is
  'team.manage. deactivated → active when the person had joined, otherwise back to invited (a new '
  'link is needed). A freelancer is reactivated only behind a current coordinator who is still an '
  'active permanent Admin or Staff, their row locked (member_set_coordinator first; INVALID_STATE '
  'otherwise, 4A and its review M2). deactivated_at is cleared; the activity log keeps the history. '
  'Audit action: reactivated.';

-- S2 ------------------------------------------------------------------------------------------------
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  id_column text := coalesce(tg_argv[0], 'id');
  override jsonb := nullif(current_setting('app.audit_override', true), '')::jsonb;
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  diff_old jsonb := '{}'::jsonb;
  diff_new jsonb := '{}'::jsonb;
  key text;
  entity_uuid uuid;
  org uuid;
begin
  if override is not null then
    perform set_config('app.audit_override', '', true);
  end if;

  if tg_op = 'INSERT' then
    new_row := to_jsonb(new);
    row_data := new_row;
    diff_new := new_row - 'updated_at';
  elsif tg_op = 'UPDATE' then
    old_row := to_jsonb(old);
    new_row := to_jsonb(new);
    row_data := new_row;
    for key in select jsonb_object_keys(new_row) loop
      if key <> 'updated_at' and old_row -> key is distinct from new_row -> key then
        diff_old := diff_old || jsonb_build_object(key, old_row -> key);
        diff_new := diff_new || jsonb_build_object(key, new_row -> key);
      end if;
    end loop;
    if diff_new = '{}'::jsonb then
      return null; -- nothing changed, nothing to record
    end if;
  else
    old_row := to_jsonb(old);
    row_data := old_row;
    diff_old := old_row - 'updated_at';
  end if;

  entity_uuid := (row_data ->> id_column)::uuid;
  org := coalesce(
    (row_data ->> 'org_id')::uuid,
    case when tg_table_name = 'organizations' then entity_uuid end,
    app.current_org_id()
  );

  insert into public.activity_log (org_id, actor_id, on_behalf_of_id, entity, entity_id, action, diff, meta)
  values (
    org,
    auth.uid(),
    -- The override's on_behalf_of (a transition function), else the row's own on_behalf_of column
    -- (the API paths: a comment or a stage tick for a freelancer; 4A review S2, ADR-0013 §3): on an
    -- insert, and on an update that is a tick (on_behalf_of or done_at changed). Never on another
    -- update or a delete: renaming a stage once ticked for a freelancer is the manager's own act.
    coalesce(
      nullif(override ->> 'on_behalf_of', ''),
      case when tg_op = 'INSERT'
                or (tg_op = 'UPDATE' and (diff_new ? 'on_behalf_of' or diff_new ? 'done_at'))
           then nullif(row_data ->> 'on_behalf_of', '') end)::uuid,
    tg_table_name,
    entity_uuid,
    coalesce(override ->> 'action', lower(tg_op)),
    jsonb_build_object('old', diff_old, 'new', diff_new),
    coalesce(override -> 'meta', '{}'::jsonb)
  );
  return null;
end;
$$;

comment on function app.audit_row_change() is
  'AFTER INSERT OR UPDATE OR DELETE row trigger. Writes activity_log with entity = the table '
  'name, action = insert|update|delete (or the action named by the app.audit_override setting a '
  'transition function set, with its meta and, since 4A, its on_behalf_of as on_behalf_of_id), '
  'entity_id = the row''s id (or the column named by the first trigger argument), diff = {old, new} '
  'of the changed columns only (updated_at excluded), actor_id = auth.uid() or null. Without an '
  'override on_behalf_of, on_behalf_of_id is the row''s own on_behalf_of column on an insert or on '
  'an update that changes on_behalf_of or done_at (a comment or a stage tick for a freelancer '
  'through the API; 4A review S2). A no-op update writes nothing.';

-- S1, S3 -------------------------------------------------------------------------------------------
drop function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text);
create function app.task_check_fields(
  p_org uuid, p_is_owner boolean, p_type public.task_types, p_client_id uuid, p_due_at timestamptz,
  p_new boolean, p_event_date date, p_event_start_at timestamptz, p_event_end_at timestamptz,
  p_location text, p_purpose text, p_client_changed boolean)
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
    -- Kickoff 4 decision 2: an Admin labels a task only with their own clients. Checked when the
    -- label is set or changed (PERMISSIONS §3), not when an approving Admin edits another field of
    -- a task the Owner labelled with someone else's client (4A review S1).
    if p_client_changed and not p_is_owner and p_client_id not in (select app.admin_client_ids()) then
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

revoke all on function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text, boolean) from public, authenticated;
grant execute on function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text, boolean) to service_role;

comment on function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text, boolean) is
  'Internal (4A): the type, label, deadline and event field rules of a task (PRODUCT §4.6): an '
  'active type of the organization; a label from the caller''s own clients unless the Owner, checked '
  'when p_client_changed (a label set or changed, 4A review S1); a deadline, not in the past when '
  'p_new; event_date required for an event type and refused for the rest, times on that IST date and '
  'in order, purpose only on an event, location only when the type has one.';

create or replace function app.task_record_warnings(p_task_id uuid, p_caller uuid, p_assignees uuid[], p_warnings jsonb)
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
    begin
      v_member := (w ->> 'member_id')::uuid;
    exception when invalid_text_representation then
      perform app.fail('VALIDATION', 'A warning names its person by id.');
    end;
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
create or replace function public.task_create(
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
    task_create.event_date, task_create.event_start_at, task_create.event_end_at, v_location, v_purpose, true);

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
create or replace function public.task_update_assignment(task_id uuid, changes jsonb, warnings jsonb default '[]')
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
    v_event_date, v_event_start_at, v_event_end_at, v_location, v_purpose,
    (changes ? 'client_id') and v_client_id is distinct from v_task.client_id);

  -- Assignees: the full new set when given; the primary owner among the active rows either way.
  v_current_ids := array(select a.member_id from public.task_assignees a where a.task_id = v_task.id and a.removed_at is null);
  if changes ? 'assignee_ids' then
    if jsonb_typeof(changes -> 'assignee_ids') <> 'array' then
      perform app.fail('VALIDATION', 'assignee_ids is a list.');
    end if;
    begin
      v_new_ids := array(select distinct (e #>> '{}')::uuid from jsonb_array_elements(changes -> 'assignee_ids') e);
    exception when invalid_text_representation then
      perform app.fail('VALIDATION', 'assignee_ids names people by id.');
    end;
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

comment on function public.task_update_assignment(uuid, jsonb, jsonb) is
  'tasks.create and app.task_manager (the creator, the approving Admin, the Owner), not on a '
  'completed or cancelled task. changes = a jsonb object of the fields to change: title, '
  'description, task_type_id, client_id (a label an Admin sets or changes must be one of their own '
  'clients; the approving Admin edits the other fields of a task labelled with another Admin''s '
  'client, 4A review S1), priority, due_at (any value; overdue follows), event_date, event_start_at, '
  'event_end_at, location, purpose, custom_fields, reminder_rules, assignee_ids (the full new set: '
  'added people start their acknowledgement, removed ones keep their row with removed_at, a re-added '
  'person starts again), primary_owner_id (an active assignee, never the Owner). warnings as '
  'task_create. Returns the fields that changed (VALIDATION when none did, or when a value, an '
  'assignee id included, has the wrong shape). Audit: updated (the trigger''s diff, meta.fields) plus '
  'assigned / unassigned / primary_changed rows. Notifies the affected assignees (WORKFLOWS §9; 5.1).';

-- S4 ------------------------------------------------------------------------------------------------
-- A coordinator-change reason is readable by the Owner and Admins only, like a deactivation reason
-- (owner decision 2026-09-29, after the 4A review; kickoff 4 decision 20). team.view is the key
-- they hold for the team's records (PERMISSIONS §1). The reason sits in member_coordinators.reason,
-- in the coordinator_changed / coordinator_set entries' meta.reason and diff.new.reason, and in the
-- coordinator_closed entries' meta.reason (with meta.next_coordinator_id). So the table and its
-- activity entries become team.view's, and a coordinator, current or former, reads their own rows
-- without the reason through coordinated_freelancers ("your freelancers" on /me, 4C).
drop policy member_coordinators_select on public.member_coordinators;
create policy member_coordinators_select on public.member_coordinators for select to authenticated
  using ((select app.has_permission('team.view')));

comment on policy member_coordinators_select on public.member_coordinators is
  'team.view (the Owner and Admins) reads every row, the reason included. A coordinator reads their '
  'own rows, without the reason, through the coordinated_freelancers view (4A review S4). Nobody '
  'writes through the API.';

comment on table public.member_coordinators is
  'Who looks after a freelancer (ADR-0013): history, never rewritten. One row with to_at null per '
  'freelancer. Written only by the team functions. RLS: team.view reads all, the reason included; a '
  'coordinator reads their own rows without the reason through coordinated_freelancers (4A review S4).';

drop policy activity_log_select_member_coordinators on public.activity_log;
create policy activity_log_select_member_coordinators on public.activity_log for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and entity = 'member_coordinators'
         and (select app.has_permission('team.view')));

comment on policy activity_log_select_member_coordinators on public.activity_log is
  'The entries about a freelancer''s coordination (coordinator_set / coordinator_changed / '
  'coordinator_closed, which carry the reason in meta and diff): team.view only, like the reason '
  'itself (4A review S4). A coordinator, current or former, reads none; the Owner also reads them '
  'through activity.view_all.';

create view public.coordinated_freelancers
with (security_invoker = false, security_barrier = true)
as
  select mc.id, mc.member_id, mc.coordinator_id, mc.from_at, mc.to_at, mc.set_by, mc.created_at
  from public.member_coordinators mc
  where mc.coordinator_id = (select c.id from app.current_member() c);

comment on view public.coordinated_freelancers is
  'The caller''s own member_coordinators rows, current (to_at null) and past, without the reason '
  '(4A review S4): which freelancers a coordinator looks after ("your freelancers" on /me, 4C). '
  'Names and phones come from member_directory. Nothing for someone who coordinates nobody.';

revoke all on public.coordinated_freelancers from anon;
revoke all on public.coordinated_freelancers from authenticated;
grant select on public.coordinated_freelancers to authenticated;
