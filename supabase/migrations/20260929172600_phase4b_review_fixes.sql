-- 4B independent review fixes (unit 4B = 4.3 + 4.4). Expand-only (ARCHITECTURE §18): three internal
-- functions change behaviour, nothing main uses is renamed, dropped or narrowed (main has no tasks).
--
-- S5  A stage tick's time is the server's: app.task_stages_guard() stamps done_at := now() on a tick
--     (it already set done_by to the caller), so a tick sent through the API cannot carry a forged
--     time. The app still sends a done_at: a non-null value is what says "tick".
-- S6  WORKFLOWS §4: no new client-labelled tasks for an Inactive client. app.task_check_fields()
--     refuses a label set or changed to an inactive client (the Owner included); a task already
--     labelled keeps its label when the client closes, and its other fields stay editable.
-- S7  An archived task type (4C's type editor archives them) no longer blocks every edit of the tasks
--     that have it: app.task_check_fields() refuses an archived type only when the type is set (a new
--     task) or changed (p_type_changed). task_update_assignment passes the flag; task_create's call
--     is unchanged and gets the default (true: a new task's type is always being set).

-- S5 ------------------------------------------------------------------------------------------------
create or replace function app.task_stages_guard()
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
      -- The tick's time is the server's, whatever the caller sent (4B review S5).
      new.done_at := now();
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

comment on function app.task_stages_guard() is
  'BEFORE INSERT OR UPDATE OR DELETE on task_stages (API path). A manager (creator, approving '
  'Admin, Owner) adds, renames, reorders and deletes unticked stages while the task is not '
  'completed / cancelled. A worker ticks (done_at = now(), whatever was sent, 4B review S5; done_by '
  '= the caller; on_behalf_of = a freelancer assignee the caller coordinates) or unticks while the '
  'task is todo / in_progress / changes_requested: locked from submitted (WORKFLOWS §3.1).';

-- S6, S7 --------------------------------------------------------------------------------------------
drop function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text, boolean);
create function app.task_check_fields(
  p_org uuid, p_is_owner boolean, p_type public.task_types, p_client_id uuid, p_due_at timestamptz,
  p_new boolean, p_event_date date, p_event_start_at timestamptz, p_event_end_at timestamptz,
  p_location text, p_purpose text, p_client_changed boolean, p_type_changed boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
begin
  if p_type.id is null or p_type.org_id <> p_org then
    perform app.fail('NOT_FOUND', 'This task type does not exist.');
  end if;
  -- A task keeps an archived type; only choosing one is refused (4B review S7).
  if p_type_changed and p_type.archived_at is not null then
    perform app.fail('VALIDATION', 'Choose a task type from the list.');
  end if;
  if p_client_id is not null then
    select c.* into v_client from public.clients c where c.id = p_client_id and c.org_id = p_org;
    if v_client.id is null then
      perform app.fail('NOT_FOUND', 'This client does not exist.');
    end if;
    -- Kickoff 4 decision 2: an Admin labels a task only with their own clients. Checked when the
    -- label is set or changed (PERMISSIONS §3), not when an approving Admin edits another field of
    -- a task the Owner labelled with someone else's client (4A review S1).
    if p_client_changed and not p_is_owner and p_client_id not in (select app.admin_client_ids()) then
      perform app.fail('FORBIDDEN', 'You can label a task only with your own clients.');
    end if;
    -- WORKFLOWS §4: an Inactive client takes no new client-labelled task (4B review S6). A task
    -- labelled before the client closed keeps its label.
    if p_client_changed and v_client.state = 'inactive' then
      perform app.fail('VALIDATION', format('%s is inactive: label the task with another client, or with none.', v_client.name));
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

revoke all on function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text, boolean, boolean) from public, authenticated;
grant execute on function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text, boolean, boolean) to service_role;

comment on function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text, boolean, boolean) is
  'Internal (4A, 4B review): the type, label, deadline and event field rules of a task (PRODUCT '
  '§4.6): a type of the organization, active when it is set or changed (p_type_changed, default '
  'true: task_create; 4B review S7); a label from the caller''s own clients unless the Owner, and '
  'never an inactive client, both checked when p_client_changed (a label set or changed; 4A review '
  'S1, 4B review S6, WORKFLOWS §4); a deadline, not in the past when p_new; event_date required for '
  'an event type and refused for the rest, times on that IST date and in order, purpose only on an '
  'event, location only when the type has one.';

-- S7: the edit passes whether the type is being changed. Unchanged from the 4A review fixes but for
-- that last argument of app.task_check_fields().
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
    (changes ? 'client_id') and v_client_id is distinct from v_task.client_id,
    -- An archived type blocks only a change to it, never an edit of a task that has it (4B review S7).
    (changes ? 'task_type_id') and v_task_type_id is distinct from v_task.task_type_id);

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
  'description, task_type_id (an archived type is kept by a task that has it, never chosen: 4B '
  'review S7), client_id (a label an Admin sets or changes must be one of their own clients; the '
  'approving Admin edits the other fields of a task labelled with another Admin''s client, 4A '
  'review S1; a label is never set or changed to an inactive client, 4B review S6), priority, '
  'due_at (any value; overdue follows), event_date, event_start_at, event_end_at, location, '
  'purpose, custom_fields, reminder_rules, assignee_ids (the full new set: added people start '
  'their acknowledgement, removed ones keep their row with removed_at, a re-added person starts '
  'again), primary_owner_id (an active assignee, never the Owner). warnings as task_create. Returns '
  'the fields that changed (VALIDATION when none did, or when a value, an assignee id included, has '
  'the wrong shape). Audit: updated (the trigger''s diff, meta.fields) plus assigned / unassigned / '
  'primary_changed rows. Notifies the affected assignees (WORKFLOWS §9; 5.1).';
