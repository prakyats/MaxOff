-- 5A + phase 4 review, combined (unit 5A; the owner asked for exactly one migration). Expand-only
-- (ARCHITECTURE §18): CREATE OR REPLACE of seven functions with the same names, arguments, results,
-- grants and search_path; nothing is dropped, renamed or narrowed that main's code reads.
--
-- Why: 20260930050132_notifications_core re-created task_create, task_update_assignment,
-- task_submit_done, task_review and task_set_approver with their app.notify() calls (5.1).
-- main's 20260930070616_phase4_review_fixes (phase 4's review, Kickoff 4 decisions 33-36) re-created
-- the same five from their phase-4 bodies, WITHOUT those calls, and sorts after 050132: on a fresh
-- database, on staging and on production every task notification was gone.
-- 20260930073623_notifications_review_fixes and 20260930075159_push_dispatch redefine none of them.
--
-- Here each of the five is 070616's body (decisions 33-36 and the L2 bounds: 20 assignees, 30 stages,
-- the reminder_rules check, the route rule app.task_approver_on_task) with 050132's notification
-- calls put back exactly as they were (a three-way merge from their common phase-4 base; the only
-- conflict was the header's line wrap). So:
--   task_create             task_assigned to each assignee.
--   task_update_assignment  task_assigned to added people, task_unassigned (no task named or linked,
--                           5A decision 25) to removed people, task_changed to those who stay.
--   task_submit_done        task_submitted to the approving Admin, or to the Owner when there is no
--                           Admin step: with decision 34 that includes an approving Admin who
--                           coordinates an active freelancer assignee (admin_step skipped).
--   task_review             task_admin_approved to the Owner; task_changes_requested to the
--                           assignees only (an Owner rejection too); task_completed to assignees +
--                           creator.
--   task_set_approver       task_submitted to a new approving Admin while submitted; an approver who
--                           is on the task (assignee or coordinator, decision 34) is skipped, so the
--                           task goes to the Owner and that Admin gets nothing.
--
-- Two helpers follow the combination:
--   app.task_skip_admin_step (070616): a submitted task that moves to the Owner because its approving
--     Admin is now on it (A-M2: an assignee added by task_update_assignment; decision 34: a
--     coordinator set, a freelancer reactivated) now tells the Owner with task_submitted, as 070616's
--     own comment on it said ("Notifies the Owner") and WORKFLOWS §9 "Task submitted (Done) -> the
--     Owner if there is no Admin step" reads; the actor is never told, so a move the Owner made
--     (coordinators and reactivation are the Owner's) writes nothing. Decision 33's re-route
--     (app.members_task_route, an Admin deactivated or made Staff) is unchanged: WORKFLOWS §3.1
--     defines no row for it and its actor is always the Owner.
--   app.task_visible_to (073623, the comment recipients' rule): it mirrored the pre-review
--     app.task_visible; it now follows 070616's (S-M1: a creator counts only with tasks.create, an
--     approving Admin only with tasks.approve_admin; S-S2: a coordinator only for an ACTIVE freelancer),
--     so a demoted Admin or a deactivated freelancer's coordinator gets no comment rows.

-- 1. task_create -------------------------------------------------------------------------------------
create or replace function public.task_create(
  title text, description text, task_type_id uuid, client_id uuid, priority public.priority,
  due_at timestamptz, assignee_ids uuid[], primary_owner_id uuid, approving_admin_id uuid default null,
  event_date date default null, event_start_at timestamptz default null, event_end_at timestamptz default null,
  location text default null, purpose text default null, stages text[] default '{}',
  custom_fields jsonb default '{}', reminder_rules jsonb default null, template_id uuid default null,
  warnings jsonb default '[]')
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
  -- ASSIGNEES_MAX (L2).
  if cardinality(v_ids) > 20 then
    perform app.fail('VALIDATION', 'Up to 20 people.');
  end if;
  if task_create.primary_owner_id is null or not (task_create.primary_owner_id = any (v_ids)) then
    perform app.fail('VALIDATION', 'The primary owner must be one of the assignees.');
  end if;
  foreach v_member in array v_ids loop
    perform app.task_assignee_check(v_org, v_member);
  end loop;

  -- STAGES_MAX, the templates' cap (L2).
  if coalesce(cardinality(task_create.stages), 0) > 30 then
    perform app.fail('VALIDATION', 'Up to 30 stages.');
  end if;
  foreach v_stage in array coalesce(task_create.stages, '{}'::text[]) loop
    if length(btrim(coalesce(v_stage, ''))) not between 1 and 120 then
      perform app.fail('VALIDATION', 'Each stage needs a name of up to 120 characters.');
    end if;
  end loop;

  if task_create.custom_fields is null or jsonb_typeof(task_create.custom_fields) <> 'object' then
    perform app.fail('VALIDATION', 'Custom fields are an object.');
  end if;
  -- Kickoff 4 decision 14: no reminder editor yet; a task takes its type's defaults. Rules a caller
  -- gives are bounded (L2).
  if task_create.reminder_rules is not null then
    perform app.task_check_reminders(task_create.reminder_rules);
  end if;
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

  -- WORKFLOWS §9 "Task assigned": each assignee (a freelancer's goes to their coordinator).
  perform app.notify(v_ids, 'task_assigned', 'New task: ' || v_title,
    format('Assigned by %s · due %s', app.member_name(v_caller), app.notify_when(task_create.due_at)),
    '/tasks/' || v_task_id, 'tasks', v_task_id, jsonb_build_object('task_id', v_task_id));

  return v_task_id;
end;
$$;

revoke all on function public.task_create(text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.task_create(text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) to authenticated, service_role;

comment on function public.task_create(text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) is
  'tasks.create (the Owner and Admins). A task in todo with its route resolved (PRODUCT §4.6): the '
  'Owner names any active Admin as approver or none; an Admin''s task routes to that Admin and its '
  'client label must be one of their clients. Assignees are 1 to 20 active Admins, Staff or '
  'freelancers, never the Owner; the primary owner is one of them. due_at is required and not in '
  'the past; the type decides the event fields (app.task_check_fields); reminder_rules default to '
  'the type''s (given ones: a list of at most 10 objects, 4 KB); stages are up to 30 typed names; '
  'warnings = [{kind, member_id, details}] the caller proceeded past (app.task_record_warnings '
  'bounds them). Audit: created (meta.route), assigned per person, stage_added, '
  'warning_overridden. 5.1: notifies each assignee (task_assigned; a freelancer''s coordinator, '
  'worded for them, ADR-0013) through app.notify().';

-- 2. task_update_assignment --------------------------------------------------------------------------
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
  -- 5.1
  v_removed uuid[] := '{}';
  v_added uuid[] := '{}';
  v_labels text[] := '{}';
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
  -- Rules a caller gives are bounded (L2); the task's own stay as they are.
  if changes ? 'reminder_rules' then
    perform app.task_check_reminders(v_reminder_rules);
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
    -- ASSIGNEES_MAX (L2).
    if cardinality(v_new_ids) > 20 then
      perform app.fail('VALIDATION', 'Up to 20 people.');
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
      v_removed := array_append(v_removed, v_member);
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
      v_added := array_append(v_added, v_member);
    end if;
  end loop;
  if v_primary <> v_task.primary_owner_id then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'primary_changed',
      'meta', jsonb_build_object('from', v_task.primary_owner_id, 'to', v_primary))::text, true);
    update public.task_assignees set is_primary = true
    where task_assignees.task_id = v_task.id and member_id = v_primary and not is_primary;
    v_changed := array_append(v_changed, 'primary_owner_id');
    v_labels := array_append(v_labels, 'primary owner');
  end if;

  -- The task's own fields: the trigger's diff is the field-level record (action updated).
  if v_title <> v_task.title then v_changed := array_append(v_changed, 'title'); v_labels := array_append(v_labels, 'title'); end if;
  if v_description is distinct from v_task.description then v_changed := array_append(v_changed, 'description'); v_labels := array_append(v_labels, 'description'); end if;
  if v_task_type_id <> v_task.task_type_id then v_changed := array_append(v_changed, 'task_type_id'); v_labels := array_append(v_labels, 'type'); end if;
  if v_client_id is distinct from v_task.client_id then v_changed := array_append(v_changed, 'client_id'); v_labels := array_append(v_labels, 'client'); end if;
  if v_priority <> v_task.priority then v_changed := array_append(v_changed, 'priority'); v_labels := array_append(v_labels, 'priority'); end if;
  if v_due_at <> v_task.due_at then v_changed := array_append(v_changed, 'due_at'); v_labels := array_append(v_labels, 'deadline (now ' || app.notify_when(v_due_at) || ')'); end if;
  if v_event_date is distinct from v_task.event_date then v_changed := array_append(v_changed, 'event_date'); v_labels := array_append(v_labels, 'event date'); end if;
  if v_event_start_at is distinct from v_task.event_start_at then v_changed := array_append(v_changed, 'event_start_at'); v_labels := array_append(v_labels, 'event time'); end if;
  if v_event_end_at is distinct from v_task.event_end_at then v_changed := array_append(v_changed, 'event_end_at'); v_labels := array_append(v_labels, 'event time'); end if;
  if v_location is distinct from v_task.location then v_changed := array_append(v_changed, 'location'); v_labels := array_append(v_labels, 'location'); end if;
  if v_purpose is distinct from v_task.purpose then v_changed := array_append(v_changed, 'purpose'); v_labels := array_append(v_labels, 'purpose'); end if;
  if v_custom_fields <> v_task.custom_fields then v_changed := array_append(v_changed, 'custom_fields'); v_labels := array_append(v_labels, 'details'); end if;
  if v_reminder_rules <> v_task.reminder_rules then v_changed := array_append(v_changed, 'reminder_rules'); v_labels := array_append(v_labels, 'reminders'); end if;

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

  -- The route (A-M2): the approving Admin now on a task waiting for their check (an assignee, or
  -- the coordinator of a freelancer added to it: decision 34) can no longer decide it, so the
  -- Admin step is skipped and the task waits for the Owner, as task_set_approver and
  -- task_submit_done do.
  if app.task_skip_admin_step(v_task.id) then
    v_changed := array(select distinct c from unnest(array_append(v_changed, 'state')) c order by c);
  end if;

  perform app.task_record_warnings(v_task.id, v_caller, v_new_ids, task_update_assignment.warnings);

  -- WORKFLOWS §9 (5.1): an added person is assigned; a removed person is told without the task
  -- named or linked (decision 25); everyone who stays is told what changed ("Task changed").
  perform app.notify(v_added, 'task_assigned', 'New task: ' || v_title,
    format('Assigned by %s · due %s', app.member_name(v_caller), app.notify_when(v_due_at)),
    '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  perform app.notify(v_removed, 'task_unassigned', 'You were taken off a task',
    format('%s reassigned it.', app.member_name(v_caller)));
  if cardinality(v_labels) > 0 then
    v_labels := array(select distinct l from unnest(v_labels) l order by l);
    perform app.notify(
      array(select a from unnest(v_new_ids) a where a = any (v_current_ids)),
      'task_changed', 'Task changed: ' || v_title,
      'Changed: ' || array_to_string(v_labels, ', '),
      '/tasks/' || v_task.id, 'tasks', v_task.id,
      jsonb_build_object('task_id', v_task.id, 'fields', to_jsonb(v_changed)));
  end if;

  return v_changed;
end;
$$;

revoke all on function public.task_update_assignment(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.task_update_assignment(uuid, jsonb, jsonb) to authenticated, service_role;

comment on function public.task_update_assignment(uuid, jsonb, jsonb) is
  'tasks.create and app.task_manager (the creator, the approving Admin, the Owner), not on a '
  'completed or cancelled task. changes = a jsonb object of the fields to change: title, '
  'description, task_type_id (an archived type is kept by a task that has it, never chosen: 4B '
  'review S7), client_id (a label an Admin sets or changes must be one of their own clients; the '
  'approving Admin edits the other fields of a task labelled with another Admin''s client, 4A '
  'review S1; a label is never set or changed to an inactive client, 4B review S6), priority, '
  'due_at (any value; overdue follows), event_date, event_start_at, event_end_at, location, '
  'purpose, custom_fields, reminder_rules (a list of at most 10 objects, 4 KB), assignee_ids (the '
  'full new set of 1 to 20: added people start their acknowledgement, removed ones keep their row '
  'with removed_at, a re-added person starts again), primary_owner_id (an active assignee, never '
  'the Owner). warnings as task_create. When the task is submitted and its approving Admin is now '
  'on it, it moves to admin_approved with admin_step skipped (app.task_skip_admin_step; phase 4 '
  'review A-M2, Kickoff 4 decision 34) and the result includes state. Returns the fields that '
  'changed (VALIDATION when none did, or when a value, an assignee id included, has the wrong '
  'shape). Audit: updated (the trigger''s diff, meta.fields) plus assigned / unassigned / '
  'primary_changed rows. 5.1: notifies added people (task_assigned), removed people '
  '(task_unassigned, no task named or linked: 5A decision 25), the people who stay when a field '
  'changed (task_changed), and the Owner when the task moves to them (task_submitted, through '
  'app.task_skip_admin_step), all through app.notify().';

-- 3. task_submit_done --------------------------------------------------------------------------------
create or replace function public.task_submit_done(
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

  -- The route (PRODUCT §4.6): the Admin step is required, none (no approver) or skipped (the
  -- approver is on the task: an assignee, or the coordinator of a freelancer on it, decision 34;
  -- the reason lives only in the activity log).
  if v_task.approving_admin_id is null then
    v_state := 'admin_approved'; v_step := 'none';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'none');
  elsif app.task_approver_on_task(v_task.id, v_task.approving_admin_id) then
    v_state := 'admin_approved'; v_step := 'skipped';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'skipped',
      'reason', case when app.is_task_assignee(v_task.id, v_task.approving_admin_id)
                     then 'approver_is_assignee' else 'approver_is_coordinator' end);
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

  -- WORKFLOWS §9 "Task submitted (Done)": the approving Admin, or the Owner when there is no
  -- Admin step (5.1).
  perform app.notify(
    array[case when v_state = 'submitted' then v_task.approving_admin_id else app.org_owner_id(v_org) end],
    'task_submitted', 'Done: ' || v_task.title,
    format('%s marked it Done%s', app.member_name(v_subject), case when v_late then ' (late)' else '' end),
    '/tasks/' || v_task.id, 'tasks', v_task.id,
    jsonb_build_object('task_id', v_task.id, 'version', v_version), v_actor);
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
  'admin_step required when an approving Admin exists and is not on the task; otherwise '
  'admin_approved with admin_step none (no approver) or skipped (the approver is an assignee, '
  'meta.reason approver_is_assignee, or the current coordinator of an active freelancer assignee, '
  'meta.reason approver_is_coordinator: Kickoff 4 decision 34). Audit action: submitted. 5.1: '
  'notifies the approving Admin, or the Owner when there is no Admin step (task_submitted) through '
  'app.notify().';

-- 4. task_review -------------------------------------------------------------------------------------
create or replace function public.task_review(task_id uuid, decision public.review_decision, reason text default null)
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
    -- The Admin step: the approving Admin, never one on the task (PERMISSIONS §3). The Owner's
    -- way past a waiting Admin is task_set_approver.
    if v_task.approving_admin_id is distinct from v_caller or not app.has_permission('tasks.approve_admin') then
      if app.is_owner() then
        perform app.fail('INVALID_STATE', 'This task is waiting for its approving Admin. Change or remove the approver to decide it yourself.');
      end if;
      perform app.fail('FORBIDDEN', 'Only the task''s approving Admin reviews it at this step.');
    end if;
    if app.is_task_assignee(v_task.id, v_caller) then
      perform app.fail('FORBIDDEN', 'An assignee cannot approve their own task.');
    end if;
    -- Decision 34: a coordinator is treated like an assignee (they act for the freelancer on it).
    if app.task_approver_on_task(v_task.id, v_caller) then
      perform app.fail('FORBIDDEN', 'You coordinate a freelancer on this task, so the Owner approves it.');
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

  -- WORKFLOWS §9 (5.1): "Admin approved" → the Owner; "Changes requested" → the assignees only
  -- (an Owner rejection too, kickoff 5 decision 2); "Task completed" → the assignees + creator.
  if v_state = 'admin_approved' then
    perform app.notify(array[app.org_owner_id(v_org)], 'task_admin_approved',
      'Approved by ' || app.member_name(v_caller) || ': ' || v_task.title,
      'Waiting for your final approval.',
      '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  elsif v_state = 'completed' then
    perform app.notify(app.task_people(v_task.id, true), 'task_completed',
      'Completed: ' || v_task.title, 'Approved by the Owner.',
      '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  else
    perform app.notify(app.task_people(v_task.id, false), 'task_changes_requested',
      'Changes requested: ' || v_task.title, v_reason,
      '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id, 'step', v_step));
  end if;
  return v_state;
end;
$$;

revoke all on function public.task_review(uuid, public.review_decision, text) from public, anon;
grant execute on function public.task_review(uuid, public.review_decision, text) to authenticated, service_role;

comment on function public.task_review(uuid, public.review_decision, text) is
  'The review (WORKFLOWS §3.3). submitted: the approving Admin (tasks.approve_admin, never an '
  'assignee nor the current coordinator of an active freelancer assignee, Kickoff 4 decision 34; '
  'the Owner is INVALID_STATE here and changes the approver instead) -> admin_approved or '
  'changes_requested. admin_approved: tasks.approve_final (the Owner) -> completed or '
  'changes_requested. rejected needs a reason (REASON_REQUIRED). One task_reviews row per call, '
  'pointing at the latest submission; bulk approve is this function once per task (approved only, '
  'kickoff 4 decision 5). Audit: review_recorded, then admin_approved | completed | '
  'changes_requested. 5.1 (WORKFLOWS §9, kickoff 5 decision 2): notifies the Owner after an Admin '
  'approval (task_admin_approved); the assignees only, an Owner rejection included, on changes '
  'requested (task_changes_requested); the assignees and the creator on completion '
  '(task_completed); through app.notify().';

-- 5. task_set_approver -------------------------------------------------------------------------------
create or replace function public.task_set_approver(task_id uuid, approving_admin_id uuid)
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
    -- The review moves to the new approver, or the task goes to the Owner at once (no approver,
    -- or one on the task: an assignee or a freelancer's coordinator, decision 34).
    if task_set_approver.approving_admin_id is null then
      v_state := 'admin_approved'; v_step := 'none';
    elsif app.task_approver_on_task(v_task.id, task_set_approver.approving_admin_id) then
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
  -- Kickoff 5 decision 2 (5.1): a new approving Admin, when the review is waiting, gets the
  -- "Task submitted" notification.
  if v_state = 'submitted' then
    perform app.notify(array[task_set_approver.approving_admin_id], 'task_submitted',
      'Done: ' || v_task.title, 'Waiting for your review (the Owner made you its approver).',
      '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  end if;
  return v_state;
end;
$$;

revoke all on function public.task_set_approver(uuid, uuid) from public, anon;
grant execute on function public.task_set_approver(uuid, uuid) to authenticated, service_role;

comment on function public.task_set_approver(uuid, uuid) is
  'The Owner. Changes or removes (null) a task''s approving Admin (an active permanent Admin), not '
  'on a completed or cancelled task. admin_step follows (none without an approver, else required); '
  'while submitted the review moves to the new approver, or the task goes to admin_approved at '
  'once when the approver is removed (none) or is on the task (skipped: an assignee, or the '
  'current coordinator of an active freelancer assignee, Kickoff 4 decision 34); while '
  'admin_approved only a removal changes the record. Audit action: approver_changed (meta.from / '
  'to). 5.1 (kickoff 5 decision 2): notifies the new approver when a review is waiting for them '
  '(task_submitted) through app.notify(); a skipped approver gets nothing.';

-- 6. app.task_skip_admin_step: the Owner is told when a waiting task moves to them -------------------
create or replace function app.task_skip_admin_step(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select t.* into v_task from public.tasks t where t.id = p_task_id for update;
  if v_task.id is null or v_task.state <> 'submitted'
     or not app.task_approver_on_task(v_task.id, v_task.approving_admin_id) then
    return false;
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'admin_step_skipped',
    'meta', jsonb_build_object(
      'reason', case when app.is_task_assignee(v_task.id, v_task.approving_admin_id)
                     then 'approver_is_assignee' else 'approver_is_coordinator' end,
      'approving_admin_id', v_task.approving_admin_id,
      'from_state', v_task.state, 'to_state', 'admin_approved'))::text, true);
  update public.tasks set state = 'admin_approved', admin_step = 'skipped' where id = v_task.id;
  -- WORKFLOWS §9 "Task submitted (Done)": with no Admin step the Owner is the recipient (never the
  -- actor: a move the Owner made writes nothing).
  perform app.notify(array[app.org_owner_id(v_task.org_id)], 'task_submitted',
    'Done: ' || v_task.title, 'Waiting for your final approval (the Admin step was skipped).',
    '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  return true;
end;
$$;

revoke all on function app.task_skip_admin_step(uuid) from public, anon, authenticated;
grant execute on function app.task_skip_admin_step(uuid) to service_role;

comment on function app.task_skip_admin_step(uuid) is
  'Internal (phase 4 review A-M2, Kickoff 4 decision 34): a submitted task whose approving Admin '
  'is now on it (app.task_approver_on_task) moves to admin_approved with admin_step skipped, '
  'audited as admin_step_skipped (meta.reason approver_is_assignee | approver_is_coordinator). '
  'Returns whether it moved. 5.1: notifies the Owner (task_submitted, never the actor) through '
  'app.notify().';

-- 7. app.task_visible_to: app.task_visible's phase 4 review rules for a named member -----------------
create or replace function app.task_visible_to(p_task_id uuid, p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.members m on m.id = p_member_id and m.org_id = t.org_id and m.status = 'active'
    where t.id = p_task_id
      and (m.role = 'owner'
           or (t.created_by = m.id
               and exists (select 1 from public.role_permissions rp
                           where rp.role = m.role and rp.permission = 'tasks.create'))
           or (t.approving_admin_id = m.id
               and exists (select 1 from public.role_permissions rp
                           where rp.role = m.role and rp.permission = 'tasks.approve_admin'))
           or exists (select 1 from public.task_assignees a
                      where a.task_id = t.id and a.removed_at is null and a.member_id = m.id)
           or exists (select 1 from public.task_assignees a
                      join public.members f on f.id = a.member_id
                      where a.task_id = t.id and a.removed_at is null
                        and f.engagement = 'freelance' and f.status = 'active'
                        and app.coordinator_of(f.id) = m.id)
           or (t.client_id is not null
               and exists (select 1 from public.role_permissions rp
                           where rp.role = m.role and rp.permission = 'clients.edit_assigned')
               and exists (select 1 from public.clients c
                           where c.id = t.client_id and c.admin_id = m.id))));
$$;

revoke all on function app.task_visible_to(uuid, uuid) from public, authenticated;
grant execute on function app.task_visible_to(uuid, uuid) to service_role;

comment on function app.task_visible_to(uuid, uuid) is
  '5.1 review (M1), service_role only: may this member see this task? The same rules as '
  'app.task_visible after the phase 4 review (PERMISSIONS §2, ADR-0013 §6) judged for a named '
  'active member instead of the caller: the Owner every task; the creator while their role holds '
  'tasks.create, the approving Admin while it holds tasks.approve_admin (S-M1), an active '
  'assignee, the current coordinator of an ACTIVE freelancer assignee (S-S2), and an Admin whose '
  'client the task is labelled with. A removed assignee, a former coordinator, a demoted Admin and '
  'a deactivated person see nothing. Used to keep a comment''s recipients to the people who can '
  'still open it.';
