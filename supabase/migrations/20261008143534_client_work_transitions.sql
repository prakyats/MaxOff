-- 7A (7.2) Client work: the transition functions and the nightly cycle job (WORKFLOWS §5 / §8 / §9,
--   PERMISSIONS §3 "Client work"; ADR-0006, ADR-0007 with its 2026-10-08 amendment; kickoff 7
--   decisions 1-18 and amendments A and C).
--
-- Every write to the client-work tables is one of these functions (the tables have no API write):
-- the caller, the permission key and the scope (app.client_visible: the Owner every client, the
-- client's Admin their own), the row locks (always the project first, then its cycles and items),
-- the state check, the change, the audit (app.audit_override + audit_row_change) and the
-- notifications (app.notify, WORKFLOWS §9) in one transaction.
--
--   projects      project_create, project_update (name, description, delivery date, fields),
--                 project_complete, project_cancel(reason), project_reopen(reason)
--   stages        project_stage_add / _update / _archive
--   item list     project_blueprint_add / _update / _archive (recurring projects)
--   items         item_add, item_update, item_cancel(reason), item_mark_done, item_unmark_done,
--                 item_tick_stage, item_approve(ids[]) (bulk), item_reject(reason)
--   cycles        cycle_start_next, cycle_carry_decide(ids[], decision, reason)
--   job           app.cycle_generate() at 00:00 IST (18:30 UTC) every night
--
-- The unfinished-items prompt (cycle_close_prompt) waits for the owner's answer on its recipient
-- (issue #56 Q2) and comes in its own migration.
--
-- EXPAND-ONLY: new functions, notification kinds and one pg_cron job. Append-only: never edit once
-- applied.

-- Notification kinds (WORKFLOWS §9, kickoff 7 decision 17, amendment C6). actionable = the email
-- fallback for someone with no working push; the info kinds are in-app and push only, never email.
insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('project_created',   false, false, true, 'An Admin added a project (the Owner; never an amount)'),
  ('project_completed', false, false, true, 'A project was completed (the Owner or the client''s Admin, whoever did not)'),
  ('project_cancelled', false, false, true, 'A project was cancelled (the Owner or the client''s Admin, whoever did not)'),
  ('project_reopened',  false, false, true, 'A project was reopened (the Owner or the client''s Admin, whoever did not)'),
  ('item_rejected',     true,  false, true, 'An item was sent back, with the reason (the client''s Admin)'),
  ('item_cancelled',    false, false, true, 'An Admin cancelled an item (the Owner)'),
  ('cycle_generated',   true,  false, true, 'New cycles are ready: rename this period''s items (the client''s Admin)'),
  ('carry_decided',     false, false, true, 'The Owner decided unfinished items (the client''s Admin, one per batch)');

-- Periods (WORKFLOWS §5.2; IST dates) -------------------------------------------------------------------
create function app.period_start(p_recurrence public.recurrence, p_day date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_recurrence
    when 'monthly' then date_trunc('month', p_day)::date
    when 'weekly' then p_day - (extract(isodow from p_day)::integer - 1)
  end;
$$;

create function app.period_end(p_recurrence public.recurrence, p_start date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_recurrence
    when 'monthly' then (p_start + interval '1 month')::date - 1
    when 'weekly' then p_start + 6
  end;
$$;

create function app.period_next(p_recurrence public.recurrence, p_start date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_recurrence
    when 'monthly' then (p_start + interval '1 month')::date
    when 'weekly' then p_start + 7
  end;
$$;

-- Kickoff 7 decision 26: "October 2026" / "5–11 Oct 2026" (across months "29 Sep–5 Oct 2026",
-- across years "29 Dec 2026–4 Jan 2027"); a one-time project's cycle has none.
create function app.cycle_label(p_recurrence public.recurrence, p_start date)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_end date;
begin
  if p_recurrence = 'monthly' then
    return to_char(p_start, 'FMMonth YYYY');
  elsif p_recurrence = 'weekly' then
    v_end := p_start + 6;
    if date_trunc('month', p_start) = date_trunc('month', v_end) then
      return to_char(p_start, 'FMDD') || '–' || to_char(v_end, 'FMDD Mon YYYY');
    elsif extract(year from p_start) = extract(year from v_end) then
      return to_char(p_start, 'FMDD Mon') || '–' || to_char(v_end, 'FMDD Mon YYYY');
    end if;
    return to_char(p_start, 'FMDD Mon YYYY') || '–' || to_char(v_end, 'FMDD Mon YYYY');
  end if;
  return null;
end;
$$;

revoke all on function app.period_start(public.recurrence, date), app.period_end(public.recurrence, date),
  app.period_next(public.recurrence, date), app.cycle_label(public.recurrence, date) from public;
grant execute on function app.period_start(public.recurrence, date), app.period_end(public.recurrence, date),
  app.period_next(public.recurrence, date), app.cycle_label(public.recurrence, date) to authenticated, service_role;

comment on function app.period_start(public.recurrence, date) is
  '7.2: the first IST date of the period holding p_day: the 1st (monthly) or the Monday (weekly); null for one-time.';
comment on function app.period_end(public.recurrence, date) is
  '7.2: the last date of the period starting p_start: the month''s last day, or the Sunday.';
comment on function app.period_next(public.recurrence, date) is
  '7.2: the first date of the period after the one starting p_start.';
comment on function app.cycle_label(public.recurrence, date) is
  '7.2 (kickoff 7 decision 26): a cycle''s label, "October 2026" or "5–11 Oct 2026"; null for one-time.';

-- Callers and locks -------------------------------------------------------------------------------------
-- An active member holding the key; the message names what they cannot do.
create function app.client_work_caller(p_key text, p_message text)
returns public.members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission(p_key) then
    perform app.fail('FORBIDDEN', p_message);
  end if;
  return v_caller;
end;
$$;

-- The project, locked: NOT_FOUND outside the caller's organization or clients (never "forbidden",
-- which would confirm it exists). Every function locks the project before its cycles and items.
create function app.project_lock(p_project_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
begin
  select p.* into v_project from public.projects p
  where p.id = p_project_id and p.org_id = (select m.org_id from app.current_member() m)
  for update;
  if v_project.id is null or not app.client_visible(v_project.client_id) then
    perform app.fail('NOT_FOUND', 'This project is not one of yours.');
  end if;
  return v_project;
end;
$$;

-- The item, locked after its project.
create function app.item_lock(p_item_id uuid)
returns public.project_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_item public.project_items;
begin
  select i.project_id into v_project_id from public.project_items i
  where i.id = p_item_id and i.org_id = (select m.org_id from app.current_member() m);
  if v_project_id is null then
    perform app.fail('NOT_FOUND', 'This item is not one of yours.');
  end if;
  perform app.project_lock(v_project_id);
  select i.* into v_item from public.project_items i where i.id = p_item_id for update;
  return v_item;
end;
$$;

-- Decision 14: a completed or cancelled project is read-only to everyone.
create function app.project_check_writable(p_project public.projects)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_project.state not in ('open', 'in_progress') then
    perform app.fail('INVALID_STATE', format('This project is %s, so it is read-only. Reopen it first.', p_project.state));
  end if;
end;
$$;

revoke all on function app.client_work_caller(text, text), app.project_lock(uuid), app.item_lock(uuid),
  app.project_check_writable(public.projects) from public, authenticated;
grant execute on function app.client_work_caller(text, text), app.project_lock(uuid), app.item_lock(uuid),
  app.project_check_writable(public.projects) to service_role;

comment on function app.client_work_caller(text, text) is
  'Internal (7.2): the caller, an active member holding p_key (UNAUTHENTICATED / FORBIDDEN p_message).';
comment on function app.project_lock(uuid) is
  'Internal (7.2): the project row FOR UPDATE; NOT_FOUND outside the caller''s organization or a '
  'client they may not see (app.client_visible). The first lock of every client-work function.';
comment on function app.item_lock(uuid) is
  'Internal (7.2): the item row FOR UPDATE, after its project''s (app.project_lock); NOT_FOUND likewise.';
comment on function app.project_check_writable(public.projects) is
  'Internal (7.2, kickoff 7 decision 14): INVALID_STATE unless the project is open or in progress.';

-- Text, positions and helpers ------------------------------------------------------------------------------
create function app.client_work_text(p_value text, p_max integer, p_message text, p_required boolean default true)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v is null then
    if p_required then
      perform app.fail('VALIDATION', p_message);
    end if;
    return null;
  end if;
  if length(v) > p_max then
    perform app.fail('VALIDATION', p_message);
  end if;
  return v;
end;
$$;

create function app.client_work_position(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^[0-9a-z]{1,64}$' then
    perform app.fail('VALIDATION', 'This is not a position in the list.');
  end if;
  return p_value;
end;
$$;

-- The project's page, the link every client-work notification opens (7.3's route).
create function app.project_link(p_project public.projects)
returns text
language sql
immutable
set search_path = ''
as $$
  select '/clients/' || p_project.client_id || '/projects/' || p_project.id;
$$;

-- The first time an item of the project is ticked or marked done: open -> in_progress (WORKFLOWS §5.1).
create function app.project_mark_started(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.projects p where p.id = p_project_id and p.state = 'open') then
    perform set_config('app.audit_override', jsonb_build_object('action', 'started')::text, true);
    update public.projects set state = 'in_progress' where id = p_project_id;
  end if;
end;
$$;

-- A cycle is settled once a later cycle of its project exists and none of its items is open or done
-- (WORKFLOWS §5.2; leave_pending keeps it open: those items are open). A one-time project's single
-- cycle never has a later one. Recomputed after every change that can move it, both ways (an item
-- added to a current cycle opens it again).
create function app.cycle_refresh(p_cycle_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.project_cycles;
  v_state public.cycle_state;
begin
  select c.* into v_cycle from public.project_cycles c where c.id = p_cycle_id;
  if v_cycle.id is null then
    return;
  end if;
  v_state := case
    when v_cycle.period_start is not null
         and exists (select 1 from public.project_cycles n
                     where n.project_id = v_cycle.project_id and n.period_start > v_cycle.period_start)
         and not exists (select 1 from public.project_items i
                         where i.cycle_id = v_cycle.id and i.state in ('open', 'done'))
    then 'settled'::public.cycle_state
    else 'open'::public.cycle_state
  end;
  if v_state <> v_cycle.state then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', case when v_state = 'settled' then 'settled' else 'unsettled' end)::text, true);
    update public.project_cycles set state = v_state where id = v_cycle.id;
  end if;
end;
$$;

-- A new cycle (the project already locked): the period, the label, and the item list copied in as
-- items (a one-time project has none: its items are added to its cycle). Earlier cycles are
-- re-checked, since a later cycle now exists.
create function app.cycle_create(p_project public.projects, p_start date, p_generated_by text, p_actor uuid)
returns public.project_cycles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.project_cycles;
  v_earlier uuid;
begin
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'generated', 'meta', jsonb_build_object('generated_by', p_generated_by))::text, true);
  insert into public.project_cycles (org_id, project_id, period_start, period_end, label, generated_by, created_by)
  values (
    p_project.org_id, p_project.id, p_start,
    case when p_start is null then null else app.period_end(p_project.recurrence, p_start) end,
    case when p_start is null then null else app.cycle_label(p_project.recurrence, p_start) end,
    p_generated_by, p_actor)
  returning * into v_cycle;

  insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
  select p_project.org_id, p_project.id, v_cycle.id, b.title, b.position, v_cycle.id, p_actor
  from public.project_item_blueprints b
  where b.project_id = p_project.id and b.archived_at is null
  order by b.position collate "C";

  if p_start is not null then
    for v_earlier in
      select c.id from public.project_cycles c
      where c.project_id = p_project.id and c.period_start < p_start and c.state = 'open'
    loop
      perform app.cycle_refresh(v_earlier);
    end loop;
  end if;
  return v_cycle;
end;
$$;

-- The client's current Admin (null for a draft with none).
create function app.project_client(p_project public.projects)
returns public.clients
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from public.clients c where c.id = p_project.client_id;
$$;

-- The live items of a cycle: not cancelled, not carried (decision 18's total; the 100 cap, decision 9).
create function app.cycle_live_items(p_cycle_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.project_items i
  where i.cycle_id = p_cycle_id and i.state not in ('cancelled', 'carried');
$$;

-- The next position after the last of a list ('a0' for an empty one; app.next_position, 4A).
create function app.client_work_next_position(p_last text)
returns text
language sql
immutable
set search_path = ''
as $$
  select app.next_position(p_last);
$$;

revoke all on function app.client_work_text(text, integer, text, boolean), app.client_work_position(text),
  app.project_link(public.projects), app.project_mark_started(uuid), app.cycle_refresh(uuid),
  app.cycle_create(public.projects, date, text, uuid), app.project_client(public.projects),
  app.cycle_live_items(uuid), app.client_work_next_position(text) from public, authenticated;
grant execute on function app.client_work_text(text, integer, text, boolean), app.client_work_position(text),
  app.project_link(public.projects), app.project_mark_started(uuid), app.cycle_refresh(uuid),
  app.cycle_create(public.projects, date, text, uuid), app.project_client(public.projects),
  app.cycle_live_items(uuid), app.client_work_next_position(text) to service_role;

comment on function app.client_work_text(text, integer, text, boolean) is
  'Internal (7.2): trimmed text, VALIDATION p_message when empty and required, or longer than p_max.';
comment on function app.client_work_position(text) is
  'Internal (7.2): a fractional-index position key ([0-9a-z], 1..64), VALIDATION otherwise.';
comment on function app.project_link(public.projects) is
  'Internal (7.2): the project page every client-work notification opens: /clients/<client>/projects/<project>.';
comment on function app.project_mark_started(uuid) is
  'Internal (7.2, WORKFLOWS §5.1): open -> in_progress, audited ''started'', the first time an item is ticked or done.';
comment on function app.cycle_refresh(uuid) is
  'Internal (7.2, WORKFLOWS §5.2): sets the cycle settled when a later cycle exists and none of its '
  'items is open or done, open otherwise (audited settled / unsettled when it changes).';
comment on function app.cycle_create(public.projects, date, text, uuid) is
  'Internal (7.2): a new cycle for a locked project (p_start null for one-time), its label, the '
  'active item list copied in as open items, and the earlier open cycles re-checked. Audited '
  '''generated'' with meta generated_by.';
comment on function app.project_client(public.projects) is 'Internal (7.2): the project''s client row.';
comment on function app.cycle_live_items(uuid) is
  'Internal (7.2): a cycle''s items not cancelled and not carried (the 100 cap, kickoff 7 decision 9).';
comment on function app.client_work_next_position(text) is 'Internal (7.2): app.next_position().';

-- Projects ------------------------------------------------------------------------------------------------
create function public.project_create(
  client_id uuid,
  name text,
  recurrence public.recurrence,
  description text default null,
  delivery_date date default null,
  stages text[] default '{}',
  items text[] default '{}',
  template_id uuid default null,
  custom_fields jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_client public.clients;
  v_name text;
  v_description text;
  v_project public.projects;
  v_cycle public.project_cycles;
  v_text text;
  v_position text := null;
  v_stages text[] := coalesce(project_create.stages, '{}');
  v_items text[] := coalesce(project_create.items, '{}');
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot create projects.');
  select c.* into v_client from public.clients c
  where c.id = project_create.client_id and c.org_id = v_caller.org_id
  for share;
  if v_client.id is null or not app.client_visible(v_client.id) then
    perform app.fail('NOT_FOUND', 'This client is not one of yours.');
  end if;
  -- Decision 1: a Draft, Active or Paused client; an Inactive one takes no new projects (§4).
  if v_client.state = 'inactive' then
    perform app.fail('INVALID_STATE', format('%s is closed, so it takes no new projects.', v_client.name));
  end if;
  if project_create.recurrence is null then
    perform app.fail('VALIDATION', 'Choose how often this project repeats.');
  end if;
  v_name := app.client_work_text(project_create.name, 120, 'Give the project a name of up to 120 characters.');
  v_description := app.client_work_text(project_create.description, 5000, 'Keep the description under 5000 characters.', false);
  -- Amendment A: a one-time project needs its delivery date; a weekly or monthly one has none.
  if project_create.recurrence = 'one_time' and project_create.delivery_date is null then
    perform app.fail('VALIDATION', 'A one-time project needs a delivery date.');
  end if;
  if project_create.recurrence <> 'one_time' and project_create.delivery_date is not null then
    perform app.fail('VALIDATION', 'A weekly or monthly project has no delivery date.');
  end if;
  if cardinality(v_stages) > 12 then
    perform app.fail('VALIDATION', 'A project has at most 12 stages.');
  end if;
  if cardinality(v_items) > 100 then
    perform app.fail('VALIDATION', 'A cycle holds at most 100 items.');
  end if;
  if project_create.template_id is not null and not exists (
    select 1 from public.project_templates t
    where t.id = project_create.template_id and t.org_id = v_caller.org_id and t.archived_at is null
  ) then
    perform app.fail('VALIDATION', 'Choose a template from the list.');
  end if;

  begin
    insert into public.projects (
      org_id, client_id, name, description, recurrence, delivery_date, template_id, custom_fields, created_by)
    values (
      v_caller.org_id, v_client.id, v_name, v_description, project_create.recurrence,
      project_create.delivery_date, project_create.template_id,
      coalesce(project_create.custom_fields, '{}'::jsonb), v_caller.id)
    returning * into v_project;
  exception when unique_violation then
    perform app.fail('CONFLICT', format('%s already has an open project called %s.', v_client.name, v_name));
  end;

  foreach v_text in array v_stages loop
    v_position := app.client_work_next_position(v_position);
    insert into public.project_stages (org_id, project_id, name, position)
    values (v_caller.org_id, v_project.id,
            app.client_work_text(v_text, 120, 'Each stage needs a name of up to 120 characters.'), v_position);
  end loop;

  v_position := null;
  if v_project.recurrence = 'one_time' then
    -- A one-time project's single cycle, whatever the client's state (decision 1); its items go
    -- straight into it.
    v_cycle := app.cycle_create(v_project, null, 'create', v_caller.id);
    foreach v_text in array v_items loop
      v_position := app.client_work_next_position(v_position);
      insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
      values (v_caller.org_id, v_project.id, v_cycle.id,
              app.client_work_text(v_text, 200, 'Each item needs a title of up to 200 characters.'),
              v_position, v_cycle.id, v_caller.id);
    end loop;
  else
    foreach v_text in array v_items loop
      v_position := app.client_work_next_position(v_position);
      insert into public.project_item_blueprints (org_id, project_id, title, position)
      values (v_caller.org_id, v_project.id,
              app.client_work_text(v_text, 200, 'Each item needs a title of up to 200 characters.'), v_position);
    end loop;
    -- WORKFLOWS §5.2: the current period's cycle at once, while the client is Active (decision 1);
    -- otherwise from the first night it is (cycle_generate).
    if v_client.state = 'active' then
      perform app.cycle_create(v_project, app.period_start(v_project.recurrence, app.today_ist()), 'create', v_caller.id);
    end if;
  end if;

  -- WORKFLOWS §9 "Project created by an Admin": the Owner (info), never an amount. The Owner's own
  -- project tells nobody (the actor is dropped).
  perform app.notify(array[app.org_owner_id(v_caller.org_id)], 'project_created',
    format('%s added the project %s for %s', v_caller.full_name, v_name, v_client.name),
    'Set the amount and billing category.',
    app.project_link(v_project), 'projects', v_project.id,
    jsonb_build_object('project_id', v_project.id, 'client_id', v_client.id), v_caller.id);
  return v_project.id;
end;
$$;

revoke all on function public.project_create(uuid, text, public.recurrence, text, date, text[], text[], uuid, jsonb) from public, anon;
grant execute on function public.project_create(uuid, text, public.recurrence, text, date, text[], text[], uuid, jsonb) to authenticated, service_role;

comment on function public.project_create(uuid, text, public.recurrence, text, date, text[], text[], uuid, jsonb) is
  '7.2 (WORKFLOWS §5.2, §5.4 items 1, 4, 5, 19; amendments A, C): projects.manage on a client the '
  'caller may see, Draft, Active or Paused (Inactive: INVALID_STATE). The name is unique per client '
  'among open and in-progress projects (CONFLICT). One-time: delivery_date required, its single '
  'cycle created now with the items in it. Weekly / monthly: no delivery date; items become the '
  'item list, and the current period''s cycle is created now when the client is Active. Stages <= '
  '12, items <= 100. Notifies the Owner when an Admin creates it (project_created, info).';

create function public.project_update(project_id uuid, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_key text;
  v_name text;
  v_description text;
  v_delivery date;
  v_fields jsonb;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_update.project_id);
  perform app.project_check_writable(v_project);
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('name', 'description', 'delivery_date', 'custom_fields') then
      perform app.fail('VALIDATION', format('"%s" is not a project detail that can change.', v_key));
    end if;
  end loop;

  v_name := v_project.name;
  v_description := v_project.description;
  v_delivery := v_project.delivery_date;
  v_fields := v_project.custom_fields;
  if changes ? 'name' then
    v_name := app.client_work_text(changes ->> 'name', 120, 'Give the project a name of up to 120 characters.');
  end if;
  if changes ? 'description' then
    v_description := app.client_work_text(changes ->> 'description', 5000, 'Keep the description under 5000 characters.', false);
  end if;
  if changes ? 'delivery_date' then
    -- Amendment A: only a one-time project has one, and it keeps one.
    if v_project.recurrence <> 'one_time' then
      perform app.fail('VALIDATION', 'A weekly or monthly project has no delivery date.');
    end if;
    if nullif(changes ->> 'delivery_date', '') is null then
      perform app.fail('VALIDATION', 'A one-time project needs a delivery date.');
    end if;
    begin
      v_delivery := (changes ->> 'delivery_date')::date;
    exception when others then
      perform app.fail('VALIDATION', 'This is not a date.');
    end;
  end if;
  if changes ? 'custom_fields' then
    v_fields := changes -> 'custom_fields';
    if jsonb_typeof(v_fields) <> 'object' then
      perform app.fail('VALIDATION', 'Custom fields are a set of named values.');
    end if;
  end if;

  if v_name is distinct from v_project.name then v_changed := array_append(v_changed, 'name'); end if;
  if v_description is distinct from v_project.description then v_changed := array_append(v_changed, 'description'); end if;
  if v_delivery is distinct from v_project.delivery_date then v_changed := array_append(v_changed, 'delivery_date'); end if;
  if v_fields is distinct from v_project.custom_fields then v_changed := array_append(v_changed, 'custom_fields'); end if;
  if cardinality(v_changed) = 0 then
    return v_changed;
  end if;
  -- Audited by the trigger: the diff carries the old and new values (amendment A: the delivery date).
  begin
    update public.projects
    set name = v_name, description = v_description, delivery_date = v_delivery, custom_fields = v_fields
    where id = v_project.id;
  exception when unique_violation then
    perform app.fail('CONFLICT', 'This client already has an open project with this name.');
  end;
  return v_changed;
end;
$$;

revoke all on function public.project_update(uuid, jsonb) from public, anon;
grant execute on function public.project_update(uuid, jsonb) to authenticated, service_role;

comment on function public.project_update(uuid, jsonb) is
  '7.2: projects.manage on the caller''s clients, the project open or in progress. changes: name, '
  'description, delivery_date (one-time only, never cleared: amendment A), custom_fields. client_id '
  'and recurrence never change (decision 4). Returns the keys that changed (none: nothing written). '
  'Audited by the trigger (old and new values).';

-- Lifecycle (decision 14; amendment C: projects.complete, the Owner on any client, the client's
-- Admin on theirs). The other one is told (info, never email; C6): app.notify drops the actor.
create function app.project_lifecycle_notify(p_project public.projects, p_kind text, p_title text, p_body text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients := app.project_client(p_project);
begin
  perform app.notify(array[app.org_owner_id(p_project.org_id), v_client.admin_id], p_kind, p_title, p_body,
    app.project_link(p_project), 'projects', p_project.id,
    jsonb_build_object('project_id', p_project.id, 'client_id', p_project.client_id), p_actor);
end;
$$;

revoke all on function app.project_lifecycle_notify(public.projects, text, text, text, uuid) from public, authenticated;
grant execute on function app.project_lifecycle_notify(public.projects, text, text, text, uuid) to service_role;

comment on function app.project_lifecycle_notify(public.projects, text, text, text, uuid) is
  'Internal (7.2, WORKFLOWS §9, amendment C6): a project completed, cancelled or reopened tells the '
  'Owner and the client''s Admin, never the actor: by the Owner, the Admin; by the Admin, the Owner.';

create function public.project_complete(project_id uuid)
returns public.project_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_open integer;
  v_client public.clients;
begin
  v_caller := app.client_work_caller('projects.complete', 'You cannot complete projects.');
  v_project := app.project_lock(project_complete.project_id);
  perform app.project_check_writable(v_project);
  select count(*) into v_open from public.project_items i
  where i.project_id = v_project.id and i.state in ('open', 'done');
  if v_open > 0 then
    perform app.fail('INVALID_STATE', format(
      '%s still open or waiting for approval: approve, carry, close or cancel %s first.',
      case when v_open = 1 then '1 item is' else v_open || ' items are' end,
      case when v_open = 1 then 'it' else 'them' end));
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'completed', 'meta', jsonb_build_object('from_state', v_project.state))::text, true);
  update public.projects set state = 'completed', completed_at = now(), completed_by = v_caller.id
  where id = v_project.id;

  v_client := app.project_client(v_project);
  perform app.project_lifecycle_notify(v_project, 'project_completed',
    format('%s completed %s', v_caller.full_name, v_project.name), v_client.name, v_caller.id);
  return 'completed';
end;
$$;

revoke all on function public.project_complete(uuid) from public, anon;
grant execute on function public.project_complete(uuid) to authenticated, service_role;

comment on function public.project_complete(uuid) is
  '7.2 (WORKFLOWS §5.4 item 14, amendment C): projects.complete on the caller''s clients; open or '
  'in progress -> completed; refused (INVALID_STATE) while any item is open or done. Stops new '
  'cycles; the project is read-only. Audited ''completed''. Notifies the Owner or the client''s '
  'Admin, whoever did not act (project_completed, info).';

create function public.project_cancel(project_id uuid, reason text)
returns public.project_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_reason text;
  v_item public.project_items;
  v_cycle uuid;
  v_client public.clients;
  v_count integer := 0;
begin
  v_caller := app.client_work_caller('projects.complete', 'You cannot cancel projects.');
  v_project := app.project_lock(project_cancel.project_id);
  perform app.project_check_writable(v_project);
  v_reason := nullif(btrim(coalesce(project_cancel.reason, '')), '');
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Cancelling a project needs a reason.');
  end if;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;

  -- Decision 14: every open and done item is cancelled with the project's reason (they stay in
  -- Potential as closed, not achieved); approved items stay approved.
  for v_item in
    select i.* from public.project_items i
    where i.project_id = v_project.id and i.state in ('open', 'done')
    order by i.id
    for update
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'cancelled', 'meta', jsonb_build_object('from_state', v_item.state, 'project_cancelled', true))::text, true);
    update public.project_items
    set state = 'cancelled', cancelled_reason = v_reason, cancelled_by = v_caller.id, cancelled_at = now()
    where id = v_item.id;
    v_count := v_count + 1;
  end loop;
  for v_cycle in select c.id from public.project_cycles c where c.project_id = v_project.id and c.state = 'open' loop
    perform app.cycle_refresh(v_cycle);
  end loop;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'cancelled',
    'meta', jsonb_build_object('from_state', v_project.state, 'items_cancelled', v_count))::text, true);
  update public.projects
  set state = 'cancelled', cancelled_at = now(), cancelled_by = v_caller.id, cancelled_reason = v_reason
  where id = v_project.id;

  v_client := app.project_client(v_project);
  perform app.project_lifecycle_notify(v_project, 'project_cancelled',
    format('%s cancelled %s', v_caller.full_name, v_project.name),
    format('%s. Reason: %s', v_client.name, v_reason), v_caller.id);
  return 'cancelled';
end;
$$;

revoke all on function public.project_cancel(uuid, text) from public, anon;
grant execute on function public.project_cancel(uuid, text) to authenticated, service_role;

comment on function public.project_cancel(uuid, text) is
  '7.2 (WORKFLOWS §5.4 item 14, amendment C): projects.complete on the caller''s clients; open or in '
  'progress -> cancelled with a reason (REASON_REQUIRED), every open and done item cancelled with it '
  'in the same transaction (approved items stay). Stops new cycles; read-only. Audited '
  '''cancelled''. Notifies the Owner or the client''s Admin, whoever did not act (project_cancelled).';

create function public.project_reopen(project_id uuid, reason text)
returns public.project_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_reason text;
  v_state public.project_state;
  v_client public.clients;
begin
  v_caller := app.client_work_caller('projects.complete', 'You cannot reopen projects.');
  v_project := app.project_lock(project_reopen.project_id);
  if v_project.state not in ('completed', 'cancelled') then
    perform app.fail('INVALID_STATE', 'Only a completed or cancelled project can be reopened.');
  end if;
  v_reason := nullif(btrim(coalesce(project_reopen.reason, '')), '');
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Reopening a project needs a reason.');
  end if;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;
  -- Decision 14: in progress when anything was ever ticked or done (a tick row, an item done or
  -- reviewed, a 'done' entry in its history), otherwise open. Items cancelled by a cancel stay so.
  v_state := case when exists (
      select 1 from public.project_items i
      where i.project_id = v_project.id
        and (i.done_at is not null
             or exists (select 1 from public.project_item_stages s where s.item_id = i.id)
             or exists (select 1 from public.item_reviews r where r.item_id = i.id)
             or exists (select 1 from public.activity_log a
                        where a.entity = 'project_items' and a.entity_id = i.id and a.action = 'done')))
    then 'in_progress'::public.project_state else 'open'::public.project_state end;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'reopened', 'meta', jsonb_build_object('from_state', v_project.state, 'reason', v_reason))::text, true);
  begin
    update public.projects
    set state = v_state, completed_at = null, completed_by = null,
        cancelled_at = null, cancelled_by = null, cancelled_reason = null
    where id = v_project.id;
  exception when unique_violation then
    perform app.fail('CONFLICT', 'This client already has an open project with this name: rename one first.');
  end;

  v_client := app.project_client(v_project);
  perform app.project_lifecycle_notify(v_project, 'project_reopened',
    format('%s reopened %s', v_caller.full_name, v_project.name),
    format('%s. Reason: %s', v_client.name, v_reason), v_caller.id);
  return v_state;
end;
$$;

revoke all on function public.project_reopen(uuid, text) from public, anon;
grant execute on function public.project_reopen(uuid, text) to authenticated, service_role;

comment on function public.project_reopen(uuid, text) is
  '7.2 (WORKFLOWS §5.4 item 14, amendment C): projects.complete on the caller''s clients; completed '
  'or cancelled -> in_progress when any item was ever ticked or done, else open (the reason, '
  'required, in the audit meta). Items it cancelled stay cancelled; recurring cycles resume from the '
  'current period (the nightly cycle_generate). CONFLICT when an open project of the client has its '
  'name. Notifies the Owner or the client''s Admin, whoever did not act (project_reopened).';

-- Stages (decision 8) ---------------------------------------------------------------------------------------
create function public.project_stage_add(project_id uuid, name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_last text;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_stage_add.project_id);
  perform app.project_check_writable(v_project);
  if (select count(*) from public.project_stages s where s.project_id = v_project.id and s.archived_at is null) >= 12 then
    perform app.fail('VALIDATION', 'A project has at most 12 stages.');
  end if;
  select max(s.position collate "C") into v_last from public.project_stages s where s.project_id = v_project.id;
  insert into public.project_stages (org_id, project_id, name, position)
  values (v_project.org_id, v_project.id,
          app.client_work_text(project_stage_add.name, 120, 'Give the stage a name of up to 120 characters.'),
          app.client_work_next_position(v_last))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.project_stage_update(stage_id uuid, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_stage public.project_stages;
  v_project public.projects;
  v_key text;
  v_name text;
  v_position text;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  select s.* into v_stage from public.project_stages s
  where s.id = project_stage_update.stage_id and s.org_id = v_caller.org_id;
  if v_stage.id is null then
    perform app.fail('NOT_FOUND', 'This stage is gone.');
  end if;
  v_project := app.project_lock(v_stage.project_id);
  perform app.project_check_writable(v_project);
  select s.* into v_stage from public.project_stages s where s.id = v_stage.id for update;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was removed.');
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('name', 'position') then
      perform app.fail('VALIDATION', format('"%s" is not a stage detail that can change.', v_key));
    end if;
  end loop;
  v_name := case when changes ? 'name'
    then app.client_work_text(changes ->> 'name', 120, 'Give the stage a name of up to 120 characters.')
    else v_stage.name end;
  v_position := case when changes ? 'position' then app.client_work_position(changes ->> 'position') else v_stage.position end;
  if v_name is distinct from v_stage.name then v_changed := array_append(v_changed, 'name'); end if;
  if v_position is distinct from v_stage.position then v_changed := array_append(v_changed, 'position'); end if;
  if cardinality(v_changed) > 0 then
    update public.project_stages set name = v_name, position = v_position where id = v_stage.id;
  end if;
  return v_changed;
end;
$$;

create function public.project_stage_archive(stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_stage public.project_stages;
  v_project public.projects;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  select s.* into v_stage from public.project_stages s
  where s.id = project_stage_archive.stage_id and s.org_id = v_caller.org_id;
  if v_stage.id is null then
    perform app.fail('NOT_FOUND', 'This stage is gone.');
  end if;
  v_project := app.project_lock(v_stage.project_id);
  perform app.project_check_writable(v_project);
  select s.* into v_stage from public.project_stages s where s.id = v_stage.id for update;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was already removed.');
  end if;
  -- Decision 8: archived, never deleted: hidden from every item, its ticks kept in the history.
  perform set_config('app.audit_override', jsonb_build_object('action', 'archived')::text, true);
  update public.project_stages set archived_at = now() where id = v_stage.id;
end;
$$;

revoke all on function public.project_stage_add(uuid, text), public.project_stage_update(uuid, jsonb),
  public.project_stage_archive(uuid) from public, anon;
grant execute on function public.project_stage_add(uuid, text), public.project_stage_update(uuid, jsonb),
  public.project_stage_archive(uuid) to authenticated, service_role;

comment on function public.project_stage_add(uuid, text) is
  '7.2 (WORKFLOWS §5.4 item 8): projects.manage on the caller''s clients, the project open or in '
  'progress; a stage at the end of the list (at most 12 active). Returns its id.';
comment on function public.project_stage_update(uuid, jsonb) is
  '7.2 (decision 8): rename or reorder a stage (changes: name, position). Returns the changed keys.';
comment on function public.project_stage_archive(uuid) is
  '7.2 (decision 8): a removed stage is archived (hidden from items, its ticks kept). Audited ''archived''.';

-- The item list (decision 9: later cycles only) ------------------------------------------------------------
create function public.project_blueprint_add(project_id uuid, title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_last text;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_blueprint_add.project_id);
  perform app.project_check_writable(v_project);
  if v_project.recurrence = 'one_time' then
    perform app.fail('VALIDATION', 'A one-time project has no item list: add the item to its cycle.');
  end if;
  if (select count(*) from public.project_item_blueprints b
      where b.project_id = v_project.id and b.archived_at is null) >= 100 then
    perform app.fail('VALIDATION', 'The item list holds at most 100 items.');
  end if;
  select max(b.position collate "C") into v_last from public.project_item_blueprints b where b.project_id = v_project.id;
  insert into public.project_item_blueprints (org_id, project_id, title, position)
  values (v_project.org_id, v_project.id,
          app.client_work_text(project_blueprint_add.title, 200, 'Give the item a title of up to 200 characters.'),
          app.client_work_next_position(v_last))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.project_blueprint_update(blueprint_id uuid, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_row public.project_item_blueprints;
  v_project public.projects;
  v_key text;
  v_title text;
  v_position text;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  select b.* into v_row from public.project_item_blueprints b
  where b.id = project_blueprint_update.blueprint_id and b.org_id = v_caller.org_id;
  if v_row.id is null then
    perform app.fail('NOT_FOUND', 'This item is gone from the list.');
  end if;
  v_project := app.project_lock(v_row.project_id);
  perform app.project_check_writable(v_project);
  select b.* into v_row from public.project_item_blueprints b where b.id = v_row.id for update;
  if v_row.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This item was removed from the list.');
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('title', 'position') then
      perform app.fail('VALIDATION', format('"%s" is not a list detail that can change.', v_key));
    end if;
  end loop;
  v_title := case when changes ? 'title'
    then app.client_work_text(changes ->> 'title', 200, 'Give the item a title of up to 200 characters.')
    else v_row.title end;
  v_position := case when changes ? 'position' then app.client_work_position(changes ->> 'position') else v_row.position end;
  if v_title is distinct from v_row.title then v_changed := array_append(v_changed, 'title'); end if;
  if v_position is distinct from v_row.position then v_changed := array_append(v_changed, 'position'); end if;
  if cardinality(v_changed) > 0 then
    update public.project_item_blueprints set title = v_title, position = v_position where id = v_row.id;
  end if;
  return v_changed;
end;
$$;

create function public.project_blueprint_archive(blueprint_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_row public.project_item_blueprints;
  v_project public.projects;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  select b.* into v_row from public.project_item_blueprints b
  where b.id = project_blueprint_archive.blueprint_id and b.org_id = v_caller.org_id;
  if v_row.id is null then
    perform app.fail('NOT_FOUND', 'This item is gone from the list.');
  end if;
  v_project := app.project_lock(v_row.project_id);
  perform app.project_check_writable(v_project);
  select b.* into v_row from public.project_item_blueprints b where b.id = v_row.id for update;
  if v_row.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This item was already removed from the list.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'archived')::text, true);
  update public.project_item_blueprints set archived_at = now() where id = v_row.id;
end;
$$;

revoke all on function public.project_blueprint_add(uuid, text), public.project_blueprint_update(uuid, jsonb),
  public.project_blueprint_archive(uuid) from public, anon;
grant execute on function public.project_blueprint_add(uuid, text), public.project_blueprint_update(uuid, jsonb),
  public.project_blueprint_archive(uuid) to authenticated, service_role;

comment on function public.project_blueprint_add(uuid, text) is
  '7.2 (WORKFLOWS §5.4 item 9): projects.manage; a recurring project''s item list gains an entry at '
  'the end (at most 100 active). Feeds later cycles only: no existing cycle changes.';
comment on function public.project_blueprint_update(uuid, jsonb) is
  '7.2 (decision 9): rename or reorder an entry of the item list (changes: title, position). Later cycles only.';
comment on function public.project_blueprint_archive(uuid) is
  '7.2 (decision 9): remove an entry from the item list (archived). Later cycles only. Audited ''archived''.';

-- Items: edits (decision 9, 10) ------------------------------------------------------------------------------
create function public.item_add(
  cycle_id uuid,
  title text,
  planned_date date default null,
  notes text default null,
  custom_fields jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_cycle public.project_cycles;
  v_project public.projects;
  v_client public.clients;
  v_last text;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot add items.');
  select c.* into v_cycle from public.project_cycles c
  where c.id = item_add.cycle_id and c.org_id = v_caller.org_id;
  if v_cycle.id is null then
    perform app.fail('NOT_FOUND', 'This cycle is not one of yours.');
  end if;
  v_project := app.project_lock(v_cycle.project_id);
  perform app.project_check_writable(v_project);
  v_client := app.project_client(v_project);
  if v_client.state = 'inactive' then
    perform app.fail('INVALID_STATE', format('%s is closed, so it takes no new items.', v_client.name));
  end if;
  -- Decision 9: never into a past cycle (a one-time project's single cycle always takes them).
  if v_cycle.period_end is not null and v_cycle.period_end < app.today_ist() then
    perform app.fail('INVALID_STATE', format('%s has ended: add the item to the current cycle.', v_cycle.label));
  end if;
  if app.cycle_live_items(v_cycle.id) >= 100 then
    perform app.fail('VALIDATION', 'A cycle holds at most 100 items.');
  end if;
  select max(i.position collate "C") into v_last from public.project_items i where i.cycle_id = v_cycle.id;
  insert into public.project_items (
    org_id, project_id, cycle_id, title, position, planned_date, notes, custom_fields, origin_cycle_id, created_by)
  values (
    v_project.org_id, v_project.id, v_cycle.id,
    app.client_work_text(item_add.title, 200, 'Give the item a title of up to 200 characters.'),
    app.client_work_next_position(v_last), item_add.planned_date,
    app.client_work_text(item_add.notes, 5000, 'Keep the notes under 5000 characters.', false),
    coalesce(item_add.custom_fields, '{}'::jsonb), v_cycle.id, v_caller.id)
  returning id into v_id;
  perform app.cycle_refresh(v_cycle.id);
  return v_id;
end;
$$;

revoke all on function public.item_add(uuid, text, date, text, jsonb) from public, anon;
grant execute on function public.item_add(uuid, text, date, text, jsonb) to authenticated, service_role;

comment on function public.item_add(uuid, text, date, text, jsonb) is
  '7.2 (WORKFLOWS §5.4 items 9, 10): projects.manage on the caller''s clients; a new open item at the '
  'end of a cycle whose period has not ended (a one-time project''s single cycle always), the project '
  'open or in progress and the client not Inactive; at most 100 live items per cycle. planned_date '
  'any date. Returns its id.';

create function public.item_update(item_id uuid, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
  v_key text;
  v_title text;
  v_notes text;
  v_planned date;
  v_fields jsonb;
  v_position text;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit items.');
  v_item := app.item_lock(item_update.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if v_item.state not in ('open', 'done') then
    perform app.fail('INVALID_STATE', format('This item is %s, so it no longer changes.', v_item.state));
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('title', 'notes', 'planned_date', 'custom_fields', 'position') then
      perform app.fail('VALIDATION', format('"%s" is not an item detail that can change.', v_key));
    end if;
  end loop;
  v_title := case when changes ? 'title'
    then app.client_work_text(changes ->> 'title', 200, 'Give the item a title of up to 200 characters.')
    else v_item.title end;
  v_notes := case when changes ? 'notes'
    then app.client_work_text(changes ->> 'notes', 5000, 'Keep the notes under 5000 characters.', false)
    else v_item.notes end;
  v_planned := v_item.planned_date;
  if changes ? 'planned_date' then
    begin
      v_planned := nullif(changes ->> 'planned_date', '')::date;
    exception when others then
      perform app.fail('VALIDATION', 'This is not a date.');
    end;
  end if;
  v_fields := case when changes ? 'custom_fields' then changes -> 'custom_fields' else v_item.custom_fields end;
  if jsonb_typeof(v_fields) is distinct from 'object' then
    perform app.fail('VALIDATION', 'Custom fields are a set of named values.');
  end if;
  v_position := case when changes ? 'position' then app.client_work_position(changes ->> 'position') else v_item.position end;

  if v_title is distinct from v_item.title then v_changed := array_append(v_changed, 'title'); end if;
  if v_notes is distinct from v_item.notes then v_changed := array_append(v_changed, 'notes'); end if;
  if v_planned is distinct from v_item.planned_date then v_changed := array_append(v_changed, 'planned_date'); end if;
  if v_fields is distinct from v_item.custom_fields then v_changed := array_append(v_changed, 'custom_fields'); end if;
  if v_position is distinct from v_item.position then v_changed := array_append(v_changed, 'position'); end if;
  if cardinality(v_changed) > 0 then
    update public.project_items
    set title = v_title, notes = v_notes, planned_date = v_planned, custom_fields = v_fields, position = v_position
    where id = v_item.id;
  end if;
  return v_changed;
end;
$$;

revoke all on function public.item_update(uuid, jsonb) from public, anon;
grant execute on function public.item_update(uuid, jsonb) to authenticated, service_role;

comment on function public.item_update(uuid, jsonb) is
  '7.2 (WORKFLOWS §5.4 items 9, 10): projects.manage on the caller''s clients, the project open or in '
  'progress, the item open or done. changes: title, notes, planned_date (any date, null clears), '
  'custom_fields, position. Returns the keys that changed. Audited by the trigger.';

create function public.item_cancel(item_id uuid, reason text)
returns public.item_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
  v_client public.clients;
  v_reason text;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot cancel items.');
  v_item := app.item_lock(item_cancel.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if v_item.state not in ('open', 'done') then
    perform app.fail('INVALID_STATE', format('This item is %s, so it cannot be cancelled.', v_item.state));
  end if;
  v_reason := nullif(btrim(coalesce(item_cancel.reason, '')), '');
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Cancelling an item needs a reason.');
  end if;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'cancelled', 'meta', jsonb_build_object('from_state', v_item.state))::text, true);
  update public.project_items
  set state = 'cancelled', cancelled_reason = v_reason, cancelled_by = v_caller.id, cancelled_at = now()
  where id = v_item.id;
  perform app.cycle_refresh(v_item.cycle_id);

  -- WORKFLOWS §9 "Item cancelled by an Admin": the Owner (info, never email); the Owner's own
  -- cancel tells nobody (the actor is dropped).
  v_client := app.project_client(v_project);
  perform app.notify(array[app.org_owner_id(v_project.org_id)], 'item_cancelled',
    format('%s cancelled %s', v_caller.full_name, v_item.title),
    format('%s · %s. Reason: %s', v_project.name, v_client.name, v_reason),
    app.project_link(v_project), 'project_items', v_item.id,
    jsonb_build_object('project_id', v_project.id, 'item_id', v_item.id), v_caller.id);
  return 'cancelled';
end;
$$;

revoke all on function public.item_cancel(uuid, text) from public, anon;
grant execute on function public.item_cancel(uuid, text) to authenticated, service_role;

comment on function public.item_cancel(uuid, text) is
  '7.2 (WORKFLOWS §5.3): projects.manage on the caller''s clients (the Owner, the client''s Admin); '
  'open or done -> cancelled with a reason (REASON_REQUIRED). Audited ''cancelled''. An Admin''s '
  'cancel tells the Owner (item_cancelled, info).';

-- Items: work (decisions 6, 7) -------------------------------------------------------------------------------
create function public.item_mark_done(item_id uuid)
returns public.item_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
begin
  v_caller := app.client_work_caller('items.tick', 'You cannot mark items done.');
  v_item := app.item_lock(item_mark_done.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if v_item.state <> 'open' then
    perform app.fail('INVALID_STATE', format('This item is %s, not open.', v_item.state));
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'done')::text, true);
  update public.project_items set state = 'done', done_at = now(), done_by = v_caller.id where id = v_item.id;
  perform app.project_mark_started(v_project.id);
  -- WORKFLOWS §9: nobody is told; the item waits in the approval queue.
  return 'done';
end;
$$;

create function public.item_unmark_done(item_id uuid)
returns public.item_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
begin
  v_caller := app.client_work_caller('items.tick', 'You cannot change items.');
  v_item := app.item_lock(item_unmark_done.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if v_item.state <> 'done' then
    perform app.fail('INVALID_STATE', format('This item is %s, not done.', v_item.state));
  end if;
  -- Decision 6: "Not done" until approved; done_at / done_by cleared (the history keeps them); no reason,
  -- no notification.
  perform set_config('app.audit_override', jsonb_build_object('action', 'not_done')::text, true);
  update public.project_items set state = 'open', done_at = null, done_by = null where id = v_item.id;
  return 'open';
end;
$$;

create function public.item_tick_stage(item_id uuid, stage_id uuid, done boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
  v_stage public.project_stages;
  v_tick public.project_item_stages;
begin
  v_caller := app.client_work_caller('items.tick', 'You cannot tick stages.');
  v_item := app.item_lock(item_tick_stage.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  -- Decision 7: open and done items only; approval locks the ticks, a rejection keeps them.
  if v_item.state not in ('open', 'done') then
    perform app.fail('INVALID_STATE', format('This item is %s, so its stages are locked.', v_item.state));
  end if;
  select s.* into v_stage from public.project_stages s
  where s.id = item_tick_stage.stage_id and s.project_id = v_project.id;
  if v_stage.id is null then
    perform app.fail('NOT_FOUND', 'This stage is not one of the project''s.');
  end if;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was removed.');
  end if;
  if item_tick_stage.done is null then
    perform app.fail('VALIDATION', 'Tick or untick the stage.');
  end if;
  select t.* into v_tick from public.project_item_stages t
  where t.item_id = v_item.id and t.stage_id = v_stage.id for update;

  if item_tick_stage.done then
    if v_tick.done_at is not null then
      return false;
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'ticked', 'meta', jsonb_build_object('stage_id', v_stage.id))::text, true);
    if v_tick.item_id is null then
      insert into public.project_item_stages (item_id, stage_id, org_id, done_at, done_by)
      values (v_item.id, v_stage.id, v_item.org_id, now(), v_caller.id);
    else
      update public.project_item_stages t set done_at = now(), done_by = v_caller.id
      where t.item_id = v_item.id and t.stage_id = v_stage.id;
    end if;
    perform app.project_mark_started(v_project.id);
  else
    if v_tick.done_at is null then
      return false;
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'unticked', 'meta', jsonb_build_object('stage_id', v_stage.id))::text, true);
    update public.project_item_stages t set done_at = null, done_by = null
    where t.item_id = v_item.id and t.stage_id = v_stage.id;
  end if;
  return true;
end;
$$;

revoke all on function public.item_mark_done(uuid), public.item_unmark_done(uuid),
  public.item_tick_stage(uuid, uuid, boolean) from public, anon;
grant execute on function public.item_mark_done(uuid), public.item_unmark_done(uuid),
  public.item_tick_stage(uuid, uuid, boolean) to authenticated, service_role;

comment on function public.item_mark_done(uuid) is
  '7.2 (WORKFLOWS §5.3): items.tick on the caller''s clients, the project open or in progress; open '
  '-> done (done_at, done_by), the project open -> in_progress the first time. Audited ''done''. '
  'Notifies nobody. The project page''s "Mark N done" calls it per id.';
comment on function public.item_unmark_done(uuid) is
  '7.2 (kickoff 7 decision 6): items.tick; done -> open until approved, done_at / done_by cleared. '
  'Audited ''not_done''; no reason, no notification.';
comment on function public.item_tick_stage(uuid, uuid, boolean) is
  '7.2 (kickoff 7 decision 7): items.tick; tick (done true) or untick a project stage on an open or '
  'done item (approved, cancelled and carried items are locked); an archived stage is refused. '
  'Returns false when nothing changed. A tick moves the project open -> in_progress. Audited '
  '''ticked'' / ''unticked''. Notifies nobody. "Tick ‹stage› on N" calls it per id.';

-- Items: approval (amendment C: items.approve, the Owner on any client, the client's Admin on theirs) ---
create function public.item_approve(item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_id uuid;
  v_item public.project_items;
  v_project public.projects;
  v_results jsonb := '[]'::jsonb;
  v_code text;
  v_detail text;
begin
  v_caller := app.client_work_caller('items.approve', 'You cannot approve items.');
  if item_ids is null or cardinality(item_ids) = 0 then
    perform app.fail('VALIDATION', 'Choose the items to approve.');
  end if;
  if cardinality(item_ids) > 500 then
    perform app.fail('VALIDATION', 'Approve at most 500 items at once.');
  end if;
  -- One lock order for every bulk call: by project, then item (no deadlock between two of them).
  for v_id in
    select x.id from unnest(item_ids) as x(id)
    left join public.project_items i on i.id = x.id
    group by x.id, i.project_id
    order by i.project_id nulls last, x.id
  loop
    begin
      v_item := app.item_lock(v_id);
      select p.* into v_project from public.projects p where p.id = v_item.project_id;
      perform app.project_check_writable(v_project);
      if v_item.state <> 'done' then
        perform app.fail('INVALID_STATE', format('This item is %s, not done.', v_item.state));
      end if;
      perform set_config('app.audit_override', jsonb_build_object('action', 'approved')::text, true);
      update public.project_items set state = 'approved', approved_at = now(), approved_by = v_caller.id
      where id = v_item.id;
      insert into public.item_reviews (org_id, item_id, decision, reviewer_id)
      values (v_item.org_id, v_item.id, 'approved', v_caller.id);
      perform app.cycle_refresh(v_item.cycle_id);
      v_results := v_results || jsonb_build_object('id', v_id, 'ok', true, 'state', 'approved');
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
      v_results := v_results || jsonb_build_object('id', v_id, 'ok', false, 'code', v_code, 'message', v_detail);
    end;
  end loop;
  -- WORKFLOWS §9: an approval notifies nobody (the progress line shows it; amendment C6).
  return v_results;
end;
$$;

create function public.item_reject(item_id uuid, reason text)
returns public.item_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
  v_client public.clients;
  v_reason text;
begin
  v_caller := app.client_work_caller('items.approve', 'You cannot send items back.');
  v_item := app.item_lock(item_reject.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if v_item.state <> 'done' then
    perform app.fail('INVALID_STATE', format('This item is %s, not done.', v_item.state));
  end if;
  v_reason := nullif(btrim(coalesce(item_reject.reason, '')), '');
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Sending an item back needs a reason.');
  end if;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;
  -- Decision 7: the ticks stay; done_at / done_by are cleared (the history keeps them).
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'rejected', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.project_items set state = 'open', done_at = null, done_by = null where id = v_item.id;
  insert into public.item_reviews (org_id, item_id, decision, reason, reviewer_id)
  values (v_item.org_id, v_item.id, 'rejected', v_reason, v_caller.id);
  perform app.cycle_refresh(v_item.cycle_id);

  -- WORKFLOWS §9 "Item rejected": the client's Admin with the reason (actionable); never the actor,
  -- so an Admin's own rejection tells nobody.
  v_client := app.project_client(v_project);
  perform app.notify(array[v_client.admin_id], 'item_rejected',
    format('Sent back: %s', v_item.title),
    format('%s · %s. %s: %s', v_project.name, v_client.name, v_caller.full_name, v_reason),
    app.project_link(v_project), 'project_items', v_item.id,
    jsonb_build_object('project_id', v_project.id, 'item_id', v_item.id), v_caller.id);
  return 'open';
end;
$$;

revoke all on function public.item_approve(uuid[]), public.item_reject(uuid, text) from public, anon;
grant execute on function public.item_approve(uuid[]), public.item_reject(uuid, text) to authenticated, service_role;

comment on function public.item_approve(uuid[]) is
  '7.2 (WORKFLOWS §5.3, §5.4 item 16, amendment C): items.approve, each item on a client the caller '
  'may see (the Owner every client, the client''s Admin their own); done -> approved (final), an '
  'item_reviews row each, the cycle re-checked. Bulk: at most 500 ids, locked by project then id; '
  'returns one result per id [{id, ok, state} | {id, ok false, code, message}] (a failed id changes '
  'nothing). Audited ''approved''. Notifies nobody. Counts for revenue whoever approves (ADR-0007 '
  'amendment 2026-10-08).';
comment on function public.item_reject(uuid, text) is
  '7.2 (WORKFLOWS §5.3, §5.4 item 16, amendment C): items.approve; one item, done -> open with a '
  'reason (REASON_REQUIRED), ticks kept, an item_reviews row. Audited ''rejected''. Tells the '
  'client''s Admin (item_rejected, actionable), never the actor.';

-- Cycles ---------------------------------------------------------------------------------------------------
create function public.cycle_start_next(project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_client public.clients;
  v_today date := app.today_ist();
  v_next date;
  v_cycle public.project_cycles;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot start cycles.');
  v_project := app.project_lock(cycle_start_next.project_id);
  perform app.project_check_writable(v_project);
  if v_project.recurrence = 'one_time' then
    perform app.fail('VALIDATION', 'A one-time project has a single cycle.');
  end if;
  v_client := app.project_client(v_project);
  -- Decision 1: cycles only while the client is Active (§4: Paused takes no new cycles).
  if v_client.state <> 'active' then
    perform app.fail('INVALID_STATE', format('%s is not active, so it takes no new cycles.', v_client.name));
  end if;
  -- Decision 3: the next period only, at most 7 days before it begins.
  v_next := app.period_next(v_project.recurrence, app.period_start(v_project.recurrence, v_today));
  if v_next - v_today > 7 then
    perform app.fail('INVALID_STATE', format('%s can start from %s, 7 days before it begins.',
      app.cycle_label(v_project.recurrence, v_next), app.notify_date(v_next - 7)));
  end if;
  if exists (select 1 from public.project_cycles c where c.project_id = v_project.id and c.period_start = v_next) then
    perform app.fail('INVALID_STATE', format('%s has already started.', app.cycle_label(v_project.recurrence, v_next)));
  end if;
  v_cycle := app.cycle_create(v_project, v_next, 'manual', v_caller.id);

  -- WORKFLOWS §9 "Cycle generated": a manual start tells the client's Admin when the Owner starts
  -- it; the starter is the actor (an Admin's own start tells nobody).
  perform app.notify(array[v_client.admin_id], 'cycle_generated',
    format('%s is ready: %s', v_cycle.label, v_project.name),
    format('%s · started by %s. Rename this period''s items where needed.', v_client.name, v_caller.full_name),
    app.project_link(v_project), 'projects', v_project.id,
    jsonb_build_object('project_id', v_project.id, 'cycle_id', v_cycle.id), v_caller.id);
  return v_cycle.id;
end;
$$;

revoke all on function public.cycle_start_next(uuid) from public, anon;
grant execute on function public.cycle_start_next(uuid) to authenticated, service_role;

comment on function public.cycle_start_next(uuid) is
  '7.2 (WORKFLOWS §5.4 item 3): projects.manage on the caller''s clients; a recurring project, open '
  'or in progress, of an Active client: creates the NEXT period''s cycle (generated_by manual, the '
  'item list copied in) at most 7 days before it begins; never a later period, never twice. The '
  'nightly cycle_generate then finds it. Tells the client''s Admin when the Owner starts it '
  '(cycle_generated). Returns the cycle id.';

-- Carry decisions (WORKFLOWS §5.3, §5.4 items 11-13, 16; amendment C: cycles.carry_decide, the Owner on
-- any client, the client's Admin on theirs) -----------------------------------------------------------------
create function public.cycle_carry_decide(item_ids uuid[], decision public.carry_decision, reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_cycle_ids uuid[];
  v_cycle public.project_cycles;
  v_project public.projects;
  v_client public.clients;
  v_today date := app.today_ist();
  v_reason text;
  v_target public.project_cycles;
  v_target_start date;
  v_id uuid;
  v_item public.project_items;
  v_new uuid;
  v_last text;
  v_results jsonb := '[]'::jsonb;
  v_done integer := 0;
  v_code text;
  v_detail text;
  v_title text;
begin
  v_caller := app.client_work_caller('cycles.carry_decide', 'You cannot decide unfinished items.');
  if item_ids is null or cardinality(item_ids) = 0 then
    perform app.fail('VALIDATION', 'Choose the items to decide.');
  end if;
  if cardinality(item_ids) > 100 then
    perform app.fail('VALIDATION', 'A cycle holds at most 100 items.');
  end if;
  if cycle_carry_decide.decision is null then
    perform app.fail('VALIDATION', 'Choose carry forward, close or leave pending.');
  end if;
  -- Decision 16: carry forward and leave pending in bulk per cycle; close one item at a time with a
  -- reason.
  if cycle_carry_decide.decision = 'close' then
    if cardinality(item_ids) <> 1 then
      perform app.fail('VALIDATION', 'Close one item at a time, with a reason.');
    end if;
    v_reason := nullif(btrim(coalesce(cycle_carry_decide.reason, '')), '');
    if v_reason is null then
      perform app.fail('REASON_REQUIRED', 'Closing an item needs a reason.');
    end if;
    if length(v_reason) > 1000 then
      perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
    end if;
  end if;

  select array_agg(distinct i.cycle_id) into v_cycle_ids from public.project_items i
  where i.id = any (item_ids) and i.org_id = v_caller.org_id;
  if v_cycle_ids is null then
    perform app.fail('NOT_FOUND', 'These items are not yours.');
  end if;
  if cardinality(v_cycle_ids) > 1 then
    perform app.fail('VALIDATION', 'Decide the items of one cycle at a time.');
  end if;
  select c.* into v_cycle from public.project_cycles c where c.id = v_cycle_ids[1];
  v_project := app.project_lock(v_cycle.project_id);
  perform app.project_check_writable(v_project);
  select c.* into v_cycle from public.project_cycles c where c.id = v_cycle.id for update;
  -- Items of an ended period only (a one-time project's cycle has none).
  if v_cycle.period_end is null or v_cycle.period_end >= v_today then
    perform app.fail('INVALID_STATE', 'This cycle''s period has not ended, so its items are not decided yet.');
  end if;
  v_client := app.project_client(v_project);
  if cycle_carry_decide.decision = 'carry_forward' then
    -- Decision 13: refused on an Inactive client (Close or Leave pending only); allowed on Paused.
    if v_client.state = 'inactive' then
      perform app.fail('INVALID_STATE', format('%s is closed: close the items or leave them pending.', v_client.name));
    end if;
    -- The next cycle, or the current period's when the next one has already ended (new items never
    -- go into a past cycle, decision 9). Created here when missing (generated_by carry; the nightly
    -- job then finds it).
    v_target_start := greatest(app.period_next(v_project.recurrence, v_cycle.period_start),
                               app.period_start(v_project.recurrence, v_today));
    select c.* into v_target from public.project_cycles c
    where c.project_id = v_project.id and c.period_start = v_target_start;
    if v_target.id is null and exists (
      select 1 from public.project_items i
      where i.id = any (item_ids) and i.cycle_id = v_cycle.id and i.state = 'open'
    ) then
      v_target := app.cycle_create(v_project, v_target_start, 'carry', v_caller.id);
    end if;
  end if;

  for v_id in select distinct x.id from unnest(item_ids) as x(id) order by 1 loop
    begin
      select i.* into v_item from public.project_items i
      where i.id = v_id and i.cycle_id = v_cycle.id
      for update;
      if v_item.id is null then
        perform app.fail('NOT_FOUND', 'This item is not in this cycle.');
      end if;
      -- Decision 11: open items only (done items wait for approval in their own cycle).
      if v_item.state <> 'open' then
        perform app.fail('INVALID_STATE', format('This item is %s, not open.', v_item.state));
      end if;
      if cycle_carry_decide.decision = 'carry_forward' then
        if app.cycle_live_items(v_target.id) >= 100 then
          perform app.fail('VALIDATION', format('%s already holds 100 items.', v_target.label));
        end if;
        -- Decision 12: title, notes, custom fields and the stage ticks (their original times and
        -- people) go along; the planned date does not. origin_cycle_id stays the first cycle.
        select max(i.position collate "C") into v_last from public.project_items i where i.cycle_id = v_target.id;
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'carried_in', 'meta', jsonb_build_object('carried_from_item_id', v_item.id))::text, true);
        insert into public.project_items (
          org_id, project_id, cycle_id, title, position, notes, custom_fields, carried_from_item_id,
          origin_cycle_id, created_by)
        values (
          v_item.org_id, v_item.project_id, v_target.id, v_item.title, app.client_work_next_position(v_last),
          v_item.notes, v_item.custom_fields, v_item.id, v_item.origin_cycle_id, v_caller.id)
        returning id into v_new;
        insert into public.project_item_stages (item_id, stage_id, org_id, done_at, done_by)
        select v_new, s.stage_id, s.org_id, s.done_at, s.done_by
        from public.project_item_stages s
        where s.item_id = v_item.id and s.done_at is not null;
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'carried', 'meta', jsonb_build_object('carried_to_item_id', v_new, 'to_cycle_id', v_target.id))::text, true);
        update public.project_items
        set state = 'carried', carry_decision = 'carry_forward', carry_decided_by = v_caller.id, carry_decided_at = now()
        where id = v_item.id;
      elsif cycle_carry_decide.decision = 'close' then
        perform set_config('app.audit_override', jsonb_build_object('action', 'closed')::text, true);
        update public.project_items
        set state = 'cancelled', cancelled_reason = v_reason, cancelled_by = v_caller.id, cancelled_at = now(),
            carry_decision = 'close', carry_decided_by = v_caller.id, carry_decided_at = now()
        where id = v_item.id;
      else
        perform set_config('app.audit_override', jsonb_build_object('action', 'left_pending')::text, true);
        update public.project_items
        set carry_decision = 'leave_pending', carry_decided_by = v_caller.id, carry_decided_at = now()
        where id = v_item.id;
      end if;
      v_done := v_done + 1;
      v_results := v_results || case when cycle_carry_decide.decision = 'carry_forward'
        then jsonb_build_object('id', v_id, 'ok', true, 'state', 'carried', 'new_item_id', v_new, 'cycle_id', v_target.id)
        else jsonb_build_object('id', v_id, 'ok', true, 'state',
               case when cycle_carry_decide.decision = 'close' then 'cancelled' else 'open' end) end;
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
      v_results := v_results || jsonb_build_object('id', v_id, 'ok', false, 'code', v_code, 'message', v_detail);
    end;
  end loop;
  perform app.cycle_refresh(v_cycle.id);
  if v_target.id is not null then
    perform app.cycle_refresh(v_target.id);
  end if;

  -- WORKFLOWS §9 "Carry decisions made by the Owner": the client's Admin, one combined row per batch
  -- (info); the Admin's own decisions tell nobody (the actor; amendment C6).
  if v_done > 0 then
    v_title := case cycle_carry_decide.decision
      when 'carry_forward' then format('%s carried into %s', case when v_done = 1 then '1 item' else v_done || ' items' end, v_target.label)
      when 'close' then format('1 item closed in %s', v_cycle.label)
      else format('%s left pending in %s', case when v_done = 1 then '1 item' else v_done || ' items' end, v_cycle.label)
    end;
    perform app.notify(array[v_client.admin_id], 'carry_decided', v_title,
      case when cycle_carry_decide.decision = 'close'
        then format('%s · %s. Reason: %s', v_project.name, v_client.name, v_reason)
        else format('%s · %s.', v_project.name, v_client.name) end,
      app.project_link(v_project), 'projects', v_project.id,
      jsonb_build_object('project_id', v_project.id, 'cycle_id', v_cycle.id, 'decision', cycle_carry_decide.decision),
      v_caller.id);
  end if;
  return v_results;
end;
$$;

revoke all on function public.cycle_carry_decide(uuid[], public.carry_decision, text) from public, anon;
grant execute on function public.cycle_carry_decide(uuid[], public.carry_decision, text) to authenticated, service_role;

comment on function public.cycle_carry_decide(uuid[], public.carry_decision, text) is
  '7.2 (WORKFLOWS §5.3, §5.4 items 11-13, 16; amendment C): cycles.carry_decide on the caller''s '
  'clients; the open items of ONE recurring cycle whose period has ended (done items wait for '
  'approval). carry_forward (bulk; refused on an Inactive client): a new item in the next cycle (or '
  'the current period''s when the next has ended), created with generated_by carry when missing, '
  'taking title, notes, custom fields and stage ticks, never the planned date; the original becomes '
  'carried. close (one item, REASON_REQUIRED): cancelled. leave_pending (bulk): stays open, decided '
  'again later. Per-id results like item_approve. Audited (carried_in, carried, closed, '
  'left_pending). The Owner''s decisions tell the client''s Admin, one carry_decided row per call.';

-- The nightly job (WORKFLOWS §8 cycle_generate, kickoff 7 decision 2) --------------------------------------
create function app.cycle_generate(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_today date := app.to_ist_date(p_now);
  v_project public.projects;
  v_client public.clients;
  v_start date;
  v_cycle public.project_cycles;
  v_made jsonb;
  v_admin record;
  v_count integer := 0;
begin
  for v_org in select o.id from public.organizations o order by o.id loop
    -- One run at a time per organisation (a late run and the next cannot both create a cycle).
    perform pg_advisory_xact_lock(hashtext('cycle_generate:' || v_org::text));
    v_made := '[]'::jsonb;
    for v_project in
      select p.* from public.projects p
      join public.clients c on c.id = p.client_id
      where p.org_id = v_org and p.recurrence <> 'one_time' and p.state in ('open', 'in_progress')
        and c.state = 'active'
      order by p.id
    loop
      v_start := app.period_start(v_project.recurrence, v_today);
      continue when exists (
        select 1 from public.project_cycles c where c.project_id = v_project.id and c.period_start = v_start);
      -- The project first (the lock order of every client-work function), then re-checked under it.
      select p.* into v_project from public.projects p where p.id = v_project.id for update;
      continue when v_project.state not in ('open', 'in_progress');
      select c.* into v_client from public.clients c where c.id = v_project.client_id;
      continue when v_client.state <> 'active';
      continue when exists (
        select 1 from public.project_cycles c where c.project_id = v_project.id and c.period_start = v_start);
      v_cycle := app.cycle_create(v_project, v_start, 'schedule', null);
      v_count := v_count + 1;
      v_made := v_made || jsonb_build_object(
        'admin_id', v_client.admin_id, 'label', v_cycle.label, 'project', v_project.name,
        'client', v_client.name, 'link', app.project_link(v_project), 'project_id', v_project.id);
    end loop;

    -- WORKFLOWS §9 "Cycle generated": one combined row per Admin per run (actionable), no actor.
    for v_admin in
      select (x ->> 'admin_id')::uuid as admin_id, count(*) as n,
             min(x ->> 'label') as first_label, max(x ->> 'label') as last_label,
             string_agg((x ->> 'project') || ' (' || (x ->> 'client') || ')', ', '
                        order by x ->> 'client', x ->> 'project') as projects,
             min(x ->> 'link') as link, min(x ->> 'project_id') as project_id
      from jsonb_array_elements(v_made) x
      where x ->> 'admin_id' is not null
      group by 1
    loop
      perform app.notify(array[v_admin.admin_id], 'cycle_generated',
        case
          when v_admin.n = 1 then format('%s is ready: %s', v_admin.first_label, v_admin.projects)
          when v_admin.first_label = v_admin.last_label then format('%s is ready for %s projects', v_admin.first_label, v_admin.n)
          else format('New cycles are ready for %s projects', v_admin.n)
        end,
        case when v_admin.n = 1 then 'Rename this period''s items where needed.'
             else v_admin.projects || '. Rename this period''s items where needed.' end,
        case when v_admin.n = 1 then v_admin.link else '/today' end,
        case when v_admin.n = 1 then 'projects' end,
        case when v_admin.n = 1 then v_admin.project_id::uuid end,
        jsonb_build_object('cycles', v_admin.n), null);
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function app.cycle_generate(timestamptz) from public, anon, authenticated;
grant execute on function app.cycle_generate(timestamptz) to service_role;

comment on function app.cycle_generate(timestamptz) is
  '7.2 (WORKFLOWS §8, kickoff 7 decision 2): pg_cron at 00:00 IST (18:30 UTC) every night. Per '
  'organisation under an advisory lock: for every recurring project, open or in progress, of an '
  'Active client, the CURRENT IST period''s cycle (the period holding to_ist_date(p_now)) when it is '
  'missing: the new cycles on the 1st and on Mondays, a catch-up on any other night (a missed run, a '
  'resumed client); one already made by project_create, cycle_start_next or a carry decision is '
  'skipped. generated_by schedule, the item list copied in. Then one cycle_generated row per Admin '
  '(combined, actionable). Returns the cycles created. Idempotent (unique project_id, period_start).';

select cron.schedule('cycle_generate', '30 18 * * *', $$select app.cycle_generate()$$);
