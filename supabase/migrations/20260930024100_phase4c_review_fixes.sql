-- 4C review fixes (2026-09-30), and the owner's answers to its three questions (Kickoff 4 decisions
-- 23 and 24). Expand-only (ARCHITECTURE §18): every function keeps its signature, the guards are
-- re-created in place, and one column privilege of a phase-4 table is taken back; main's code
-- reads none of it.
--
-- 1. (S1) Template field defaults and reminders, checked in the database: app.task_templates_guard()
--    caps field_defaults at 32 KB and checks every key the write adds or changes against an active
--    task field of the organization (company-wide or the template's type) and its value against
--    the field's type (app.custom_field_value_ok), as app.task_custom_fields_guard() does for a
--    task (4A) and the client guards do for clients (20260927152618_values_checked_in_db).
--    reminder_rules loses its API insert and update grants: nothing writes it before 5.3's editor.
-- 2. (S8a) An Admin suggests a task with their own clients only (Kickoff 4 decision 2, WORKFLOWS
--    §3.4): task_request_create refuses an Admin's label on another Admin's client, even one they
--    see on a task they are on. Staff unchanged (a label they can see, Active or Paused).
-- 3. (Kickoff 4 decision 23) An Admin never decides their own suggestion: task_request_convert and
--    task_request_decline refuse it (FORBIDDEN); the Admin may withdraw it. The Owner never
--    suggests, so the Owner decides any.
-- 4. (Kickoff 4 decision 24, from Kickoff 5 decision 9, PR #21) The requester is told when their
--    suggestion is converted or declined; a withdrawal notifies nobody. The function comments name
--    the recipients; delivery is phase 5's.
-- 5. (L1) The last active task type is never archived: app.task_types_owner_guard() refuses it
--    (the Settings action already did; now the database does too).
-- 6. (L2) task_type_move() cannot deadlock against an opposite move: moves in one organization are
--    serialized by a transaction advisory lock, and the two rows are locked in id order.

-- 1. Template field defaults and reminders ------------------------------------------------------------
create or replace function app.task_templates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stage text;
  v_old jsonb := case when tg_op = 'UPDATE' then old.field_defaults else '{}'::jsonb end;
  v_key text;
  v_value jsonb;
  v_def public.field_definitions;
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
  -- The field defaults (4C review S1): a task's custom field values, checked as a task's are.
  -- Keys the write leaves as they were pass, so an archived field keeps its default. The
  -- definitions are read under the caller's RLS (every active member reads the task fields).
  if octet_length(new.field_defaults::text) > 32768 then
    perform app.fail('VALIDATION', 'These field defaults are too long.');
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(new.field_defaults) e loop
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

comment on function app.task_templates_guard() is
  'BEFORE INSERT OR UPDATE on task_templates (4.6; 4C review S1): the author is the caller and never '
  'changes; the type is one of the organization''s, active when chosen; each stage 1..120 characters '
  '(as a task''s); field_defaults at most 32 KB, every key the write adds or changes an active task '
  'field of the organization (company-wide or the template''s type) holding a value of its type '
  '(app.custom_field_value_ok). A required field may stay empty (the task form asks for it).';

-- Nothing writes a template's reminders before 5.3's editor (it stays '[]').
revoke insert (reminder_rules), update (reminder_rules) on public.task_templates from authenticated;

comment on column public.task_templates.reminder_rules is
  'The template''s reminders (5.3 edits them). No API write until then (4C review S1): ''[]''.';

-- 2 and 3. Task requests ------------------------------------------------------------------------------
create or replace function public.task_request_create(title text, details text default null, client_id uuid default null)
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
    -- A label the caller can see (ADR-0005: Staff see the labels on their own tasks), Active or
    -- Paused like a task's (Kickoff 4 decision 22).
    select c.* into v_client from public.clients c
    where c.id = task_request_create.client_id and c.org_id = v_caller.org_id;
    if v_client.id is null
       or not (app.client_visible(v_client.id) or v_client.id in (select app.labelled_client_ids())) then
      perform app.fail('NOT_FOUND', 'This client does not exist.');
    end if;
    -- An Admin labels with their own clients only (Kickoff 4 decision 2, WORKFLOWS §3.4; 4C review
    -- S8a), never another Admin's client they see on a task they are on. The Owner never suggests.
    if app.has_permission('clients.edit_assigned')
       and v_client.id not in (select app.admin_client_ids()) then
      perform app.fail('FORBIDDEN', 'Suggest it with one of your own clients, or with none.');
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
  -- the notification rows are phase 5's.
  return v_id;
end;
$$;

comment on function public.task_request_create(text, text, uuid) is
  'task_requests.create (Admins and Staff; PRODUCT §4.6): a suggested task, pending. The client is a '
  'label the caller can see, Active or Paused; an Admin''s is one of their own clients (Kickoff 4 '
  'decision 2, 4C review S8a: FORBIDDEN otherwise). Audit action: requested. Notifies the Owner and '
  'the client''s Admin, or every Admin when there is no client (WORKFLOWS §9; delivery is phase 5''s).';

comment on function public.task_request_withdraw(uuid) is
  'The requester takes back a pending suggestion (pending → withdrawn; WORKFLOWS §3.4), an Admin '
  'their own too (Kickoff 4 decision 23). Audit action: withdrawn. Nobody is notified (Kickoff 4 '
  'decision 24, from Kickoff 5 decision 9, PR #21).';

create or replace function public.task_request_decline(request_id uuid, reason text)
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
  -- Kickoff 4 decision 23: an Admin never decides their own suggestion (it goes to the Owner).
  if v_request.requested_by = auth.uid() and not app.is_owner() then
    perform app.fail('FORBIDDEN', 'Your own suggestion goes to the Owner: you can withdraw it.');
  end if;
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
  -- WORKFLOWS §9 (Kickoff 4 decision 24, from Kickoff 5 decision 9): the requester is told, with
  -- the reason; delivery is phase 5's.
  return 'declined';
end;
$$;

comment on function public.task_request_decline(uuid, text) is
  'task_requests.decide on a request the caller sees (the Owner any; an Admin those with no client or '
  'their own clients'', never their own suggestion: Kickoff 4 decision 23): pending → declined with a '
  'required reason the requester reads. Audit action: declined (meta.reason). Notifies the requester '
  '(WORKFLOWS §9, Kickoff 4 decision 24 from Kickoff 5 decision 9; delivery is phase 5''s).';

create or replace function public.task_request_convert(
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
  -- Kickoff 4 decision 23: an Admin never decides their own suggestion (it goes to the Owner).
  if v_request.requested_by = auth.uid() and not app.is_owner() then
    perform app.fail('FORBIDDEN', 'Your own suggestion goes to the Owner: you can withdraw it.');
  end if;
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
  -- WORKFLOWS §9 (Kickoff 4 decision 24, from Kickoff 5 decision 9): the requester is told it
  -- became a task; task_create names its own recipients. Delivery is phase 5's.
  return v_task_id;
end;
$$;

comment on function public.task_request_convert(uuid, text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) is
  'task_requests.decide (and task_create''s own checks: tasks.create, the route, the label, the '
  'people) on a pending request the caller sees, never an Admin''s own (Kickoff 4 decision 23): '
  'creates the task and marks the request converted (task_id) in one transaction. Returns the task '
  'id. Audit actions: task_create''s, then converted (meta.task_id). Notifies the requester '
  '(WORKFLOWS §9, Kickoff 4 decision 24 from Kickoff 5 decision 9; delivery is phase 5''s).';

-- 5. The last active task type ------------------------------------------------------------------------
create or replace function app.task_types_owner_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A new task always needs a type (4C review L1): the organization keeps one active type, for
  -- every writer. Archivals in one organization queue behind this lock, so two at once cannot
  -- each leave the other as the last one.
  if tg_op = 'UPDATE' and old.archived_at is null and new.archived_at is not null then
    perform pg_advisory_xact_lock(hashtext('task_types_active'), hashtext(new.org_id::text));
    if not exists (select 1 from public.task_types tt
                   where tt.org_id = new.org_id and tt.archived_at is null and tt.id <> new.id) then
      perform app.fail('INVALID_STATE', 'Keep at least one task type: add another first.');
    end if;
  end if;
  if app.in_transition() then
    return new;
  end if;
  if not app.has_permission('settings.manage') then
    perform app.fail('FORBIDDEN', 'Task types are the Owner''s to change.');
  end if;
  return new;
end;
$$;

comment on function app.task_types_owner_guard() is
  'BEFORE INSERT OR UPDATE on task_types (4A, PERMISSIONS ³): an API write needs settings.manage '
  '(the Owner), although lists.manage opens every other list to Admins. The last active type of an '
  'organization is never archived, by any writer (4C review L1: INVALID_STATE).';

-- 6. task_type_move -----------------------------------------------------------------------------------
create or replace function public.task_type_move(task_type_id uuid, direction text)
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

  -- One move at a time per organization (4C review L2): an opposite move of the same two types
  -- waits here instead of locking them in the other order.
  perform pg_advisory_xact_lock(hashtext('task_type_move'), hashtext(v_org::text));

  select tt.* into v_type
  from public.task_types tt
  where tt.id = task_type_move.task_type_id and tt.org_id = v_org and tt.archived_at is null;
  if v_type.id is null then
    perform app.fail('NOT_FOUND', 'This task type is no longer in the list.');
  end if;

  -- The neighbour is the next type the Owner sees: archived ones are skipped.
  if direction = 'up' then
    select tt.* into v_neighbour from public.task_types tt
    where tt.org_id = v_org and tt.archived_at is null and tt.position < v_type.position
    order by tt.position desc limit 1;
  else
    select tt.* into v_neighbour from public.task_types tt
    where tt.org_id = v_org and tt.archived_at is null and tt.position > v_type.position
    order by tt.position asc limit 1;
  end if;
  if v_neighbour.id is null then
    return null;
  end if;

  -- Both rows, locked in id order (the order every writer of two types uses).
  perform 1 from public.task_types tt
  where tt.id in (v_type.id, v_neighbour.id)
  order by tt.id
  for update;

  update public.task_types tt
  set position = case tt.id when v_type.id then v_neighbour.position else v_type.position end
  where tt.id in (v_type.id, v_neighbour.id);
  return v_neighbour.id;
end;
$$;

comment on function public.task_type_move(uuid, text) is
  'settings.manage (the Owner; Kickoff 4 decision 15, 4A later item (b)). Swaps a task type''s '
  'position with the neighbour above or below it (archived types skipped), as list_item_move does. '
  'Returns the neighbour''s id, or null at that end. NOT_FOUND for an unknown or archived type. Moves '
  'in one organization run one at a time and lock the two rows in id order (4C review L2).';
