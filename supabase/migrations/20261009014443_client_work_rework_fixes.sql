-- The 7B rework's review fixes (architecture review of af3319e..03b7821, 2026-10-09). Same signatures,
-- same grants; nothing dropped, no row rewritten. EXPAND-ONLY: create or replace of existing functions,
-- three new internal helpers and comments. Append-only: never edit once applied.
--
-- S3  Duplicate stage names: `app.client_work_stage_names` refuses a name listed twice (case-insensitive,
--     VALIDATION), which every stage list entering through `project_create`, `project_blueprint_update`,
--     `app.item_stage_list_init` (`item_add`, `app.cycle_create`, `app.cycle_copy_item_list`) passes;
--     7A's `project_stage_add` / `_update` refuse a name already active on the project (CONFLICT, as
--     `item_stage_add` does on an item).
-- S4  The 7A functions amendment D left unused: `item_tick_stage` refuses (INVALID_STATE, after its
--     permission and scope checks: use the item's own stages); `item_tick_stage`, `item_approve`,
--     `item_reject` and `item_unmark_done` are marked unused, to drop in a contract migration.
-- S5  The end-of-day report after D3: a rejection row is the Owner's send-back (`sent_back`) or an
--     Admin's own reopen (`reopened`, new); "approved" stays (approvals made apart before D3).
-- S7  The activity reads return only entries the history describes (`app.client_work_activity_shown`,
--     the same list as `describeProjectActivity` in modules/client-work/domain/activity.ts), so a page
--     of 20 is 20 lines and an item's "Last change" is always a sentence.

-- S3. Stage names, once each -----------------------------------------------------------------------------------
create or replace function app.client_work_stage_names(p_names text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text;
  v_out text[] := '{}';
begin
  if cardinality(coalesce(p_names, '{}')) > 12 then
    perform app.fail('VALIDATION', 'An item has at most 12 stages.');
  end if;
  foreach v_name in array coalesce(p_names, '{}') loop
    v_name := app.client_work_text(v_name, 120, 'Each stage needs a name of up to 120 characters.');
    if exists (select 1 from unnest(v_out) as o(name) where lower(o.name) = lower(v_name)) then
      perform app.fail('VALIDATION', format('The stage %s is listed twice: each stage needs its own name.', v_name));
    end if;
    v_out := v_out || v_name;
  end loop;
  return v_out;
end;
$$;

comment on function app.client_work_stage_names(text[]) is
  'Internal (amendment D2; review fix 2026-10-09): stage names checked (at most 12, each 1..120 '
  'characters trimmed, no name twice ignoring case), VALIDATION otherwise.';

-- No two active default stages of one project share a name (case-insensitive).
create function app.project_stage_name_free(p_project_id uuid, p_name text, p_except uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.project_stages s
             where s.project_id = p_project_id and s.archived_at is null and s.id is distinct from p_except
               and lower(s.name) = lower(p_name)) then
    perform app.fail('CONFLICT', format('This project already has a default stage called %s.', p_name));
  end if;
end;
$$;

revoke all on function app.project_stage_name_free(uuid, text, uuid) from public, anon, authenticated;
grant execute on function app.project_stage_name_free(uuid, text, uuid) to service_role;

comment on function app.project_stage_name_free(uuid, text, uuid) is
  'Internal (review fix 2026-10-09): CONFLICT when another active default stage of the project '
  '(not p_except) has the name, ignoring case.';

create or replace function public.project_create(
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
  v_item_id uuid;
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
  -- Review fix: each default stage once (case-insensitive), as an item's own (VALIDATION).
  v_stages := app.client_work_stage_names(v_stages);
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
              v_position, v_cycle.id, v_caller.id)
      returning id into v_item_id;
      -- Amendment D2: each item starts with the project's default stages.
      perform app.item_stage_list_init(v_item_id, app.project_default_stages(v_project.id));
    end loop;
  else
    foreach v_text in array v_items loop
      v_position := app.client_work_next_position(v_position);
      -- Amendment D2: each line of the item list carries its own stages, the defaults to start.
      insert into public.project_item_blueprints (org_id, project_id, title, position, stages)
      values (v_caller.org_id, v_project.id,
              app.client_work_text(v_text, 200, 'Each item needs a title of up to 200 characters.'), v_position,
              app.project_default_stages(v_project.id));
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

create or replace function public.project_stage_add(project_id uuid, name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_last text;
  v_name text;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_stage_add.project_id);
  perform app.project_check_writable(v_project);
  if (select count(*) from public.project_stages s where s.project_id = v_project.id and s.archived_at is null) >= 12 then
    perform app.fail('VALIDATION', 'A project has at most 12 stages.');
  end if;
  v_name := app.client_work_text(project_stage_add.name, 120, 'Give the stage a name of up to 120 characters.');
  -- Review fix: a name the project's active default stages do not have yet (case-insensitive).
  perform app.project_stage_name_free(v_project.id, v_name, null);
  select max(s.position collate "C") into v_last from public.project_stages s where s.project_id = v_project.id;
  insert into public.project_stages (org_id, project_id, name, position)
  values (v_project.org_id, v_project.id, v_name, app.client_work_next_position(v_last))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.project_stage_update(stage_id uuid, changes jsonb)
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
  if v_name is distinct from v_stage.name then
    -- Review fix: never to a name another active default stage of the project has.
    perform app.project_stage_name_free(v_project.id, v_name, v_stage.id);
    v_changed := array_append(v_changed, 'name');
  end if;
  if v_position is distinct from v_stage.position then v_changed := array_append(v_changed, 'position'); end if;
  if cardinality(v_changed) > 0 then
    update public.project_stages set name = v_name, position = v_position where id = v_stage.id;
  end if;
  return v_changed;
end;
$$;

comment on function public.project_stage_add(uuid, text) is
  '7.2 (WORKFLOWS §5.4 item 8; amendment D2: the project''s default stages): projects.manage on the '
  'caller''s clients, the project open or in progress; a stage at the end of the list (at most 12 '
  'active; a name the active stages do not have yet, ignoring case, CONFLICT otherwise). Returns its id.';
comment on function public.project_stage_update(uuid, jsonb) is
  '7.2 (decision 8; amendment D2): rename or reorder a default stage (changes: name, position; never '
  'to a name another active stage has, CONFLICT). Returns the changed keys.';

-- S4. The 7A functions amendment D left unused --------------------------------------------------------------
-- Same signature and grants. The permission and scope checks stay first (Crew FORBIDDEN, another
-- Admin's item NOT_FOUND), then the refusal: the ticks live on the item's own stages now.
create or replace function public.item_tick_stage(item_id uuid, stage_id uuid, done boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
begin
  v_caller := app.client_work_caller('items.tick', 'You cannot tick stages.');
  v_item := app.item_lock(item_tick_stage.item_id);
  perform app.fail('INVALID_STATE', 'Stages are ticked on the item''s own stages now: use the item''s own stages.');
  return false;
end;
$$;

comment on function public.item_tick_stage(uuid, uuid, boolean) is
  'Unused since amendment D (2026-10-09); kept for expand-only; drop in a contract migration. Checks '
  'items.tick and the item''s scope, then refuses (INVALID_STATE): ticks are on the item''s own stages '
  '(item_stage_tick).';
comment on function public.item_approve(uuid[]) is
  'Unused since amendment D (2026-10-09); kept for expand-only; drop in a contract migration. (7.2, '
  'amendment C: items.approve; done -> approved per id, at most 500 ids, one result per id. Mark done '
  'is the approval since D3.)';
comment on function public.item_reject(uuid, text) is
  'Unused since amendment D (2026-10-09); kept for expand-only; drop in a contract migration. (7.2, '
  'amendment C: items.approve; done -> open with a reason. item_reopen is the send-back / reopen since '
  'D3.)';
comment on function public.item_unmark_done(uuid) is
  'Unused since amendment D (2026-10-09); kept for expand-only; drop in a contract migration. (7.2, '
  'decision 6: items.tick; a legacy done item -> open. item_reopen takes a done item back since D3.)';

-- S5. The end-of-day report: sent back (the Owner) and reopened (an Admin) -----------------------------------
create or replace function app.eod_report_payload(p_org uuid, p_date date, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := app.ist_day_start(p_date);
  v_to timestamptz := app.ist_day_start(p_date + 1);
  v_holiday text;
  v_weekly_off boolean;
  v_attendance jsonb;
  v_decisions jsonb;
  v_tasks jsonb;
  v_approvals jsonb;
  v_tomorrow jsonb;
  v_client_work jsonb;
  v_empty constant jsonb := '{"count": 0, "more": 0, "items": []}'::jsonb;
  v_owner uuid := app.org_owner_id(p_org);
begin
  select h.name into v_holiday from public.holidays h where h.org_id = p_org and h.date = p_date;
  select extract(dow from p_date)::int = any (s.weekly_off_days) into v_weekly_off
  from public.org_settings s where s.org_id = p_org;

  -- Attendance: every active employee (never the Owner, never a freelancer: they have no day) with
  -- a day on the date: their times, what the day stands at, and the flags. A day still waiting for
  -- the Owner counts by its choice or the system's proposal, as the digest and Start day read it.
  with days as (
    select m.id, m.full_name,
           case when d.state = 'pending_review'
                then coalesce(d.submitted_choice::text::public.day_status, d.final_status)
                else d.final_status end as status,
           d.state = 'pending_review' as waiting,
           d.proposed_by_system and d.state = 'pending_review' as proposed,
           d.started_at, d.ended_at, d.end_not_recorded, d.overtime_flag, d.overtime_reason
    from public.members m
    join public.attendance_days d on d.member_id = m.id and d.work_date = p_date
    where m.org_id = p_org and m.status = 'active' and m.role <> 'owner' and m.engagement = 'permanent'
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'present', count(*) filter (where status = 'present'),
      'on_leave', count(*) filter (where status in ('leave', 'half_day', 'comp_leave')),
      'absent', count(*) filter (where status = 'absent'),
      'proposed_absent', count(*) filter (where status = 'absent' and proposed),
      'waiting', count(*) filter (where waiting),
      'end_not_recorded', count(*) filter (where end_not_recorded),
      'overtime', count(*) filter (where overtime_flag)),
    'people', coalesce(jsonb_agg(jsonb_build_object(
      'member_id', id, 'name', full_name, 'status', status, 'waiting', waiting, 'proposed', proposed,
      'started_at', started_at, 'ended_at', ended_at, 'end_not_recorded', end_not_recorded,
      'overtime', overtime_flag, 'overtime_reason', overtime_reason)
      order by full_name, id), '[]'::jsonb))
  into v_attendance
  from days;

  -- The decisions made that day: the Owner's attendance decisions (events with an actor: the
  -- automatic ones have none), leave decided, comp leave granted, revoked or reviewed, and expense
  -- claims decided or paid as a count (never an amount).
  select jsonb_build_object(
    'attendance', (
      select count(*) from public.attendance_events e
      join public.attendance_days d on d.id = e.attendance_day_id
      join public.members m on m.id = d.member_id
      where m.org_id = p_org and e.action in ('approved', 'corrected') and e.actor_id is not null
        and e.at >= v_from and e.at < v_to),
    'leave', jsonb_build_object(
      'approved', (
        select count(*) from public.leave_requests r join public.members m on m.id = r.member_id
        where m.org_id = p_org and r.state = 'approved' and r.decided_at >= v_from and r.decided_at < v_to),
      'rejected', (
        select count(*) from public.leave_requests r join public.members m on m.id = r.member_id
        where m.org_id = p_org and r.state = 'rejected' and r.decided_at >= v_from and r.decided_at < v_to)),
    'comp_leave', jsonb_build_object(
      'granted', (
        select count(*) from public.comp_leave_credits c join public.members m on m.id = c.member_id
        where m.org_id = p_org and c.granted_at >= v_from and c.granted_at < v_to),
      'revoked', (
        select count(*) from public.comp_leave_credits c join public.members m on m.id = c.member_id
        where m.org_id = p_org and c.revoked_at >= v_from and c.revoked_at < v_to),
      'reviewed', (
        select count(*) from public.extra_work_notes n join public.members m on m.id = n.member_id
        where m.org_id = p_org and n.decided_at >= v_from and n.decided_at < v_to)),
    'expense_claims', (
      select count(*) from public.expense_claims c join public.members m on m.id = c.member_id
      where m.org_id = p_org
        and ((c.decided_at >= v_from and c.decided_at < v_to) or (c.paid_at >= v_from and c.paid_at < v_to))))
  into v_decisions;

  -- Tasks: completed (Owner-approved) that day; handed in and waiting now; overdue now with the
  -- primary owner's late reason; cancelled that day with the reason; created that day. Freelancers
  -- are counted separately (the primary owner's engagement). Lists of up to 50, then a count.
  with t as (
    select t.id, t.title, t.state, t.due_at, t.late_reason, t.cancelled_reason, t.completed_at,
           t.cancelled_at, t.created_at, t.submitted_at,
           m.full_name as owner_name, m.engagement = 'freelance' as freelance
    from public.tasks t
    join public.members m on m.id = t.primary_owner_id
    where t.org_id = p_org and t.archived_at is null
  ),
  groups as (
    select 'completed' as grp, t.* from t where t.completed_at >= v_from and t.completed_at < v_to
    union all
    select 'handed_in', t.* from t where t.state in ('submitted', 'admin_approved')
    union all
    select 'overdue', t.* from t where t.state not in ('completed', 'cancelled') and t.due_at < p_now
    union all
    select 'cancelled', t.* from t where t.cancelled_at >= v_from and t.cancelled_at < v_to
    union all
    select 'created', t.* from t where t.created_at >= v_from and t.created_at < v_to
  ),
  numbered as (
    select g.*, row_number() over (partition by g.grp order by g.due_at, g.title, g.id) as n from groups g
  ),
  per_group as (
    select grp,
           count(*) as total,
           count(*) filter (where freelance) as freelance_total,
           coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', id, 'title', title, 'owner', owner_name, 'freelance', freelance,
             'due_at', case when grp = 'overdue' then due_at end,
             'late_reason', case when grp = 'overdue' then late_reason end,
             'since', case when grp = 'handed_in' then submitted_at end,
             'reason', case when grp = 'cancelled' then cancelled_reason end))
             order by n) filter (where n <= 50), '[]'::jsonb) as items
    from numbered
    group by grp
  ),
  shaped as (
    select grp, jsonb_build_object(
      'count', total, 'freelance', freelance_total, 'more', greatest(total - 50, 0), 'items', items) as value
    from per_group
  )
  select jsonb_build_object(
    'completed', coalesce((select value from shaped where grp = 'completed'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'handed_in', coalesce((select value from shaped where grp = 'handed_in'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'overdue', coalesce((select value from shaped where grp = 'overdue'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'cancelled', coalesce((select value from shaped where grp = 'cancelled'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'created', coalesce((select value from shaped where grp = 'created'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb))
  into v_tasks;

  -- Approvals: a count per approver at each step that day (an approval, or changes requested).
  select coalesce(jsonb_agg(jsonb_build_object(
    'reviewer_id', a.reviewer_id, 'name', a.name, 'step', a.step,
    'approved', a.approved, 'changes_requested', a.changes_requested)
    order by a.step desc, a.name, a.reviewer_id), '[]'::jsonb)
  into v_approvals
  from (
    select r.reviewer_id, coalesce(m.full_name, 'Someone') as name, r.step,
           count(*) filter (where r.decision = 'approved') as approved,
           count(*) filter (where r.decision = 'rejected') as changes_requested
    from public.task_reviews r
    join public.tasks t on t.id = r.task_id
    left join public.members m on m.id = r.reviewer_id
    where t.org_id = p_org and r.at >= v_from and r.at < v_to
    group by r.reviewer_id, m.full_name, r.step
  ) a;

  -- Tomorrow's events: the event tasks on the next IST date, with their people.
  select jsonb_build_object(
    'date', p_date + 1,
    'events', coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'start_at', e.event_start_at, 'end_at', e.event_end_at,
      'location', e.location, 'people', e.people)
      order by e.event_start_at nulls first, e.title, e.id), '[]'::jsonb))
  into v_tomorrow
  from (
    select t.id, t.title, t.event_start_at, t.event_end_at, t.location,
           coalesce((select jsonb_agg(m.full_name order by m.full_name)
                     from public.task_assignees a join public.members m on m.id = a.member_id
                     where a.task_id = t.id and a.removed_at is null), '[]'::jsonb) as people
    from public.tasks t
    where t.org_id = p_org and t.archived_at is null and t.state <> 'cancelled' and t.event_date = p_date + 1
  ) e;


  -- Client work (7.4, kickoff 7 decision 25): what happened to client items that IST day, per client
  -- Admin (the one who ran the client at that moment; null: a client with no Admin, the Owner's own).
  -- Done = the history's `done` entries ("Not done" and a rejection clear done_at); approved = the
  -- reviews' approvals (before amendment D3); sent back = the Owner's rejections, reopened = an Admin's
  -- (D3: the client's Admin reopening a done item); closed = cancelled that day (a cancel, a carry "close", a project cancel);
  -- carried = carried forward that day; projects completed = the history's `completed` entries. An
  -- item counts once per group however often it moved. Lists of up to 50, then a count. No amount.
  with ev as (
    select distinct on (e.grp, e.id) e.*
    from (
      select 'done'::text as grp, i.id, i.title, p.name as project, c.name as client, p.client_id,
             a.at, null::text as reason
      from public.activity_log a
      join public.project_items i on i.id = a.entity_id
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where a.org_id = p_org and a.entity = 'project_items' and a.action = 'done'
        and a.at >= v_from and a.at < v_to
      union all
      -- Review fix (amendment D3): a rejection is the Owner's send-back or an Admin's own reopen.
      select case when r.decision = 'approved' then 'approved'
                  when r.reviewer_id = v_owner then 'sent_back'
                  else 'reopened' end, i.id, i.title,
             p.name, c.name, p.client_id, r.at, case when r.decision = 'rejected' then r.reason end
      from public.item_reviews r
      join public.project_items i on i.id = r.item_id
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where r.org_id = p_org and r.at >= v_from and r.at < v_to
      union all
      select 'closed', i.id, i.title, p.name, c.name, p.client_id, i.cancelled_at, i.cancelled_reason
      from public.project_items i
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where i.org_id = p_org and i.cancelled_at >= v_from and i.cancelled_at < v_to
      union all
      select 'carried', i.id, i.title, p.name, c.name, p.client_id, i.carry_decided_at, null
      from public.project_items i
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where i.org_id = p_org and i.carry_decision = 'carry_forward'
        and i.carry_decided_at >= v_from and i.carry_decided_at < v_to
      union all
      select 'projects_completed', p.id, p.name, p.name, c.name, p.client_id, a.at, null
      from public.activity_log a
      join public.projects p on p.id = a.entity_id
      join public.clients c on c.id = p.client_id
      where a.org_id = p_org and a.entity = 'projects' and a.action = 'completed'
        and a.at >= v_from and a.at < v_to
    ) e
    order by e.grp, e.id, e.at desc
  ),
  attributed as (
    select ev.*, (
      select s.admin_id from public.client_admin_assignments s
      where s.client_id = ev.client_id and s.from_at <= ev.at and (s.to_at is null or s.to_at > ev.at)
      order by s.from_at desc limit 1) as admin_id
    from ev
  ),
  numbered as (
    select x.*, row_number() over (partition by x.admin_id, x.grp order by x.at, x.title, x.id) as n
    from attributed x
  ),
  per_group as (
    select admin_id, grp, jsonb_build_object(
      'count', count(*), 'more', greatest(count(*) - 50, 0),
      'items', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id, 'title', title, 'project', case when grp <> 'projects_completed' then project end,
        'client', client, 'reason', reason)) order by n) filter (where n <= 50), '[]'::jsonb)) as value
    from numbered
    group by admin_id, grp
  ),
  per_admin as (
    select g.admin_id, m.full_name as name, jsonb_object_agg(g.grp, g.value) as groups
    from per_group g
    left join public.members m on m.id = g.admin_id
    group by g.admin_id, m.full_name
  )
  select jsonb_build_object(
    'admins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'admin_id', a.admin_id, 'name', a.name,
        'done', coalesce(a.groups -> 'done', v_empty),
        'approved', coalesce(a.groups -> 'approved', v_empty),
        'sent_back', coalesce(a.groups -> 'sent_back', v_empty),
        'reopened', coalesce(a.groups -> 'reopened', v_empty),
        'closed', coalesce(a.groups -> 'closed', v_empty),
        'carried', coalesce(a.groups -> 'carried', v_empty),
        'projects_completed', coalesce(a.groups -> 'projects_completed', v_empty))
        order by a.name nulls last, a.admin_id)
      from per_admin a), '[]'::jsonb),
    'counts', (
      select jsonb_build_object(
        'done', count(*) filter (where grp = 'done'),
        'approved', count(*) filter (where grp = 'approved'),
        'sent_back', count(*) filter (where grp = 'sent_back'),
        'reopened', count(*) filter (where grp = 'reopened'),
        'closed', count(*) filter (where grp = 'closed'),
        'carried', count(*) filter (where grp = 'carried'),
        'projects_completed', count(*) filter (where grp = 'projects_completed'))
      from attributed))
  into v_client_work;

  return jsonb_build_object(
    'date', p_date,
    'day_off', jsonb_build_object('holiday', v_holiday, 'weekly_off', coalesce(v_weekly_off, false)),
    'attendance', v_attendance,
    'decisions', v_decisions,
    'tasks', v_tasks,
    'approvals', v_approvals,
    'tomorrow', v_tomorrow,
    'client_work', v_client_work);
end;
$$;

create or replace function app.eod_report_zero(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((p #>> '{attendance,counts,present}')::int, 0) = 0
     and coalesce((p #>> '{attendance,counts,on_leave}')::int, 0) = 0
     and coalesce((p #>> '{attendance,counts,absent}')::int, 0) = 0
     and coalesce((p #>> '{attendance,counts,waiting}')::int, 0) = 0
     and coalesce((p #>> '{attendance,counts,end_not_recorded}')::int, 0) = 0
     and coalesce((p #>> '{attendance,counts,overtime}')::int, 0) = 0
     and coalesce(jsonb_array_length(p #> '{attendance,people}'), 0) = 0
     and coalesce((p #>> '{decisions,attendance}')::int, 0) = 0
     and coalesce((p #>> '{decisions,leave,approved}')::int, 0) = 0
     and coalesce((p #>> '{decisions,leave,rejected}')::int, 0) = 0
     and coalesce((p #>> '{decisions,comp_leave,granted}')::int, 0) = 0
     and coalesce((p #>> '{decisions,comp_leave,revoked}')::int, 0) = 0
     and coalesce((p #>> '{decisions,comp_leave,reviewed}')::int, 0) = 0
     and coalesce((p #>> '{decisions,expense_claims}')::int, 0) = 0
     and coalesce((p #>> '{tasks,completed,count}')::int, 0) = 0
     and coalesce((p #>> '{tasks,handed_in,count}')::int, 0) = 0
     and coalesce((p #>> '{tasks,overdue,count}')::int, 0) = 0
     and coalesce((p #>> '{tasks,cancelled,count}')::int, 0) = 0
     and coalesce((p #>> '{tasks,created,count}')::int, 0) = 0
     and coalesce(jsonb_array_length(p -> 'approvals'), 0) = 0
     and coalesce(jsonb_array_length(p #> '{tomorrow,events}'), 0) = 0
     -- 7.4: the Client work section (absent from reports saved before it).
     and coalesce((p #>> '{client_work,counts,done}')::int, 0) = 0
     and coalesce((p #>> '{client_work,counts,approved}')::int, 0) = 0
     and coalesce((p #>> '{client_work,counts,sent_back}')::int, 0) = 0
     and coalesce((p #>> '{client_work,counts,reopened}')::int, 0) = 0
     and coalesce((p #>> '{client_work,counts,closed}')::int, 0) = 0
     and coalesce((p #>> '{client_work,counts,carried}')::int, 0) = 0
     and coalesce((p #>> '{client_work,counts,projects_completed}')::int, 0) = 0;
$$;

create or replace function app.eod_report_text(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
  v_tasks text[] := '{}';
  v_items text[] := '{}';
begin
  if (p #>> '{attendance,counts,present}')::int > 0 then
    v_parts := v_parts || ((p #>> '{attendance,counts,present}') || ' present');
  end if;
  if (p #>> '{attendance,counts,on_leave}')::int > 0 then
    v_parts := v_parts || ((p #>> '{attendance,counts,on_leave}') || ' on leave');
  end if;
  if (p #>> '{attendance,counts,absent}')::int > 0 then
    v_parts := v_parts || ((p #>> '{attendance,counts,absent}') || ' absent');
  end if;
  if (p #>> '{attendance,counts,end_not_recorded}')::int > 0 then
    v_parts := v_parts || ((p #>> '{attendance,counts,end_not_recorded}') || ' end not recorded');
  end if;
  if (p #>> '{tasks,completed,count}')::int > 0 then
    v_tasks := v_tasks || ((p #>> '{tasks,completed,count}') || ' completed');
  end if;
  if (p #>> '{tasks,overdue,count}')::int > 0 then
    v_tasks := v_tasks || ((p #>> '{tasks,overdue,count}') || ' overdue');
  end if;
  if (p #>> '{tasks,handed_in,count}')::int > 0 then
    v_tasks := v_tasks || ((p #>> '{tasks,handed_in,count}') || ' waiting');
  end if;
  if cardinality(v_tasks) > 0 then
    v_parts := v_parts || ('Tasks: ' || array_to_string(v_tasks, ', '));
  end if;
  -- 7.4: the client items (counts only).
  if (p #>> '{client_work,counts,done}')::int > 0 then
    v_items := v_items || ((p #>> '{client_work,counts,done}') || ' done');
  end if;
  if (p #>> '{client_work,counts,approved}')::int > 0 then
    v_items := v_items || ((p #>> '{client_work,counts,approved}') || ' approved');
  end if;
  if (p #>> '{client_work,counts,sent_back}')::int > 0 then
    v_items := v_items || ((p #>> '{client_work,counts,sent_back}') || ' sent back');
  end if;
  if (p #>> '{client_work,counts,reopened}')::int > 0 then
    v_items := v_items || ((p #>> '{client_work,counts,reopened}') || ' reopened');
  end if;
  if cardinality(v_items) > 0 then
    v_parts := v_parts || ('Client items: ' || array_to_string(v_items, ', '));
  end if;
  if (p #>> '{tomorrow,events}') is not null and jsonb_array_length(p #> '{tomorrow,events}') > 0 then
    v_parts := v_parts || (jsonb_array_length(p #> '{tomorrow,events}')::text
      || case when jsonb_array_length(p #> '{tomorrow,events}') = 1 then ' event tomorrow' else ' events tomorrow' end);
  end if;
  if cardinality(v_parts) = 0 then
    return 'A quiet day.';
  end if;
  return array_to_string(v_parts, ' · ');
end;
$$;

comment on function app.eod_report_payload(uuid, date, timestamptz) is
  '6.5, service_role only: the end-of-day report for an organisation and IST date, built at p_now '
  '(the same builder for the saved row and the live view): the day off, attendance (counts and '
  'each employee''s times and flags), the decisions made that day (attendance, leave, comp leave, '
  'expense claims as a count), tasks (completed that day, handed in now, overdue now with the late '
  'reason, cancelled and created that day; freelancers counted separately), approvals per approver '
  'and step, tomorrow''s events, and since 7.4 the client work per client Admin (items done, '
  'approved (before amendment D3), sent back by the Owner and reopened by an Admin with the reason '
  '(review fix 2026-10-09), closed with the reason, carried forward, projects completed that day; '
  'counts and titles). Never an amount.';

-- S7. The activity reads return only what the history describes -----------------------------------------------
-- The same list as describeProjectActivity (modules/client-work/domain/activity.ts): change both together.
create function app.client_work_activity_shown(p_entity text, p_action text, p_diff jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_entity
    when 'projects' then
      p_action in ('insert', 'started', 'completed', 'cancelled', 'reopened')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['delivery_date', 'name', 'description', 'custom_fields'])
    when 'project_stages' then
      p_action in ('insert', 'archived')
      or (p_action = 'update' and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['name', 'position'])
    when 'project_item_blueprints' then
      p_action in ('insert', 'archived')
      or (p_action = 'update' and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['title', 'position', 'stages'])
    when 'project_item_stage_list' then
      p_action in ('insert', 'archived', 'ticked', 'unticked')
      or (p_action = 'update' and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['name', 'position'])
    when 'project_cycles' then
      p_action in ('generated', 'insert', 'item_list_added')
    when 'project_items' then
      p_action in ('insert', 'done', 'not_done', 'approved', 'rejected', 'sent_back', 'reopened', 'cancelled',
                   'closed', 'carried', 'carried_in', 'left_pending')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['title', 'notes', 'planned_date', 'custom_fields', 'position'])
    when 'project_item_stages' then
      p_action in ('ticked', 'unticked')
  end, false);
$$;

revoke all on function app.client_work_activity_shown(text, text, jsonb) from public, anon;
grant execute on function app.client_work_activity_shown(text, text, jsonb) to authenticated, service_role;

comment on function app.client_work_activity_shown(text, text, jsonb) is
  'Internal (review fix 2026-10-09): whether the project''s history describes an audit entry: the '
  'same list as describeProjectActivity in modules/client-work/domain/activity.ts (an item''s '
  'starting stages, a cycle settling, a change of internal keys only and anything else it has no '
  'sentence for are false). Read by project_activity and item_last_changes; change both together.';

create or replace function public.project_activity(
  project_id uuid,
  kind text default 'all',
  item_id uuid default null,
  before_at timestamptz default null,
  before_id bigint default null,
  max_rows integer default 20
)
returns table (id bigint, actor_id uuid, entity text, entity_id uuid, action text, diff jsonb, meta jsonb, at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if project_activity.kind is null or project_activity.kind not in ('all', 'items', 'stages', 'project') then
    perform app.fail('VALIDATION', 'Choose all, items, stages or project.');
  end if;
  if (project_activity.before_at is null) <> (project_activity.before_id is null) then
    perform app.fail('VALIDATION', 'A page starts after an entry: give its time and its id.');
  end if;
  return query
    select a.id, a.actor_id, a.entity, a.entity_id, a.action, a.diff, a.meta, a.at
    from public.activity_log a
    where ((project_activity.item_id is null
            and a.entity in ('projects', 'project_cycles', 'project_item_blueprints', 'project_stages')
            and a.entity_id = project_activity.project_id)
           or (a.entity in ('project_items', 'project_item_stage_list', 'project_item_stages')
               and a.entity_id in (
                 select i.id from public.project_items i
                 where i.project_id = project_activity.project_id
                   and (project_activity.item_id is null or i.id = project_activity.item_id))))
      and case project_activity.kind
            when 'items' then a.entity = 'project_items'
            when 'stages' then a.entity in ('project_stages', 'project_item_stage_list', 'project_item_stages')
            when 'project' then a.entity in ('projects', 'project_cycles', 'project_item_blueprints')
            else true
          end
      and app.client_work_activity_shown(a.entity, a.action, a.diff)
      and (project_activity.before_at is null
           or (a.at, a.id) < (project_activity.before_at, project_activity.before_id))
    order by a.at desc, a.id desc
    limit least(greatest(coalesce(project_activity.max_rows, 20), 1), 100);
end;
$$;

create or replace function public.item_last_changes(item_ids uuid[])
returns table (id bigint, actor_id uuid, entity text, entity_id uuid, action text, diff jsonb, meta jsonb, at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if cardinality(coalesce(item_last_changes.item_ids, '{}')) > 200 then
    perform app.fail('VALIDATION', 'At most 200 items at once.');
  end if;
  return query
    select distinct on (a.entity_id) a.id, a.actor_id, a.entity, a.entity_id, a.action, a.diff, a.meta, a.at
    from public.activity_log a
    where a.entity in ('project_items', 'project_item_stage_list', 'project_item_stages')
      and a.entity_id = any (coalesce(item_last_changes.item_ids, '{}'))
      and app.client_work_activity_shown(a.entity, a.action, a.diff)
    order by a.entity_id, a.at desc, a.id desc;
end;
$$;

comment on function public.project_activity(uuid, text, uuid, timestamptz, bigint, integer) is
  'The project page''s Activity panel (owner 2026-10-09): a project''s history, or one item''s '
  '(item_id), newest first, at most max_rows (1..100, default 20) entries before the (before_at, '
  'before_id) cursor; kind all | items | stages | project. Security invoker: RLS decides (the Owner, '
  'the client''s Admin; never Crew). Only the entries the history describes '
  '(app.client_work_activity_shown, review fix 2026-10-09), so a page is a page of lines.';
comment on function public.item_last_changes(uuid[]) is
  'The item sheet''s "Last change" (owner 2026-10-09): for each item (at most 200), its latest '
  'history entry the history describes (app.client_work_activity_shown), under RLS (security invoker).';
