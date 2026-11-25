-- v3.0 Reports (task 9.3; kickoff 9 decisions 12–14, the 14 Nov refresh's OWNER ANSWERS R7 and Q5;
-- DATA-MODEL §8 "v3.0 report functions"): the Owner's reports read through four functions.
--
--   report_people(p_from, p_to)          one row per person: completed tasks (Owner-approved,
--                                         every active assignee), on time (the primary owner's first
--                                         hand-in on or before the deadline, of their completed),
--                                         revision loops (send-backs on the tasks completed in the
--                                         period), the median hours from assignment to the first
--                                         hand-in, the acknowledgement lag (median hours, notes
--                                         tapped in the period), open and overdue work now;
--   report_task_delays(p_from, p_to)     the tasks due in the period that were handed in late or
--                                         are still past their deadline (never a held one), with the
--                                         primary owner's late reason, type and client label;
--   report_stage_durations(p_from, p_to) deliverable stages ticked in the period, grouped by stage
--                                         name ignoring case (R7: groups and revision rounds are just
--                                         stages), overall (project_id null) and per project: count
--                                         and median days since the previous tick on that
--                                         deliverable (or its cycle's start, or its creation);
--   report_client_work(p_from, p_to)     per client: deliverables planned in the period, of those
--                                         done and done on time, done in the period, overdue now,
--                                         on hold now, projects completed in the period.
--
-- Every function is security invoker (each table's policy decides), stable, with an empty
-- search_path, and refuses anyone without reports.all (the Owner) with FORBIDDEN: an Admin's scoped
-- report (reports.scoped) is computed from its own reads and never calls these. A period is IST
-- dates, at most 366 days (decision 12). No money: none of the tables read is a money table
-- (invariant 2); the client-work report's revenue, once v2.1 lands, is read through
-- modules/revenue, never here. Nothing reads activity_log. Read only, new functions only
-- (expand-only).

create function app.report_window(p_from date, p_to date)
returns tstzrange
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app.has_permission('reports.all') then
    perform app.fail('FORBIDDEN', 'Only the Owner can open this report.');
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    perform app.fail('VALIDATION', 'Choose a period.');
  end if;
  if p_to - p_from + 1 > 366 then
    perform app.fail('VALIDATION', 'A period is at most 366 days.');
  end if;
  return tstzrange(app.ist_day_start(p_from), app.ist_day_start(p_to + 1), '[)');
end;
$$;

comment on function app.report_window(date, date) is
  'v3.0: the guard of the Owner''s report functions: reports.all or FORBIDDEN, a period of IST '
  'dates of at most 366 days or VALIDATION; returns the period as [start, end) instants.';

revoke all on function app.report_window(date, date) from public, anon;
grant execute on function app.report_window(date, date) to authenticated, service_role;

-- Indexes (EXPLAIN on scripts/measure-seed.sql + measure-seed-work.sql: a year of tasks and client
-- work): each report reaches its rows by the period through an index, so the row policies run only
-- on the period's rows, never on every task or stage.
create index tasks_org_completed_at_idx on public.tasks (org_id, completed_at) where state = 'completed';
create index task_assignees_acknowledged_at_idx on public.task_assignees (acknowledged_at)
  where acknowledged_at is not null and removed_at is null;
create index tasks_org_open_idx on public.tasks (org_id, due_at)
  where archived_at is null
    and state in ('todo', 'in_progress', 'submitted', 'admin_approved', 'changes_requested');
create index project_item_stage_list_org_done_at_idx on public.project_item_stage_list (org_id, done_at)
  where done_at is not null and archived_at is null;

-- 1. People ---------------------------------------------------------------------------------------

create function public.report_people(p_from date, p_to date)
returns table (
  member_id uuid,
  completed integer,
  on_time integer,
  owned_completed integer,
  revision_loops integer,
  hand_in_hours numeric,
  ack_lag_hours numeric,
  open_now integer,
  overdue_now integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_window tstzrange := app.report_window(p_from, p_to);
  v_org uuid := (select m.org_id from app.current_member() m);
begin
  return query
  with done as materialized (
    select t.id, t.primary_owner_id, t.due_at,
      (select s.at from public.task_submissions s where s.task_id = t.id
        order by s.version limit 1) as first_hand_in,
      (select count(*) from public.task_reviews r
        where r.task_id = t.id and r.decision = 'rejected')::integer as sent_back
    from public.tasks t
    where t.org_id = v_org and t.state = 'completed'
      and t.completed_at >= lower(v_window) and t.completed_at < upper(v_window)
  ),
  -- Each completed task's active assignees, read once: credits and the primary owner's facts.
  done_people as materialized (
    select d.*, a.member_id, a.assigned_at
    from done d
    cross join jsonb_to_recordset((
      select jsonb_agg(jsonb_build_object('member_id', x.member_id, 'assigned_at', x.assigned_at))
      from public.task_assignees x
      where x.task_id = d.id and x.removed_at is null
    )) as a(member_id uuid, assigned_at timestamptz)
  ),
  credited as (
    select x.member_id, count(*)::integer as completed, sum(x.sent_back)::integer as loops
    from done_people x
    group by x.member_id
  ),
  owned as (
    select x.member_id,
      count(*)::integer as owned_completed,
      count(*) filter (where x.first_hand_in <= x.due_at)::integer as on_time,
      percentile_cont(0.5) within group (
        order by extract(epoch from x.first_hand_in - x.assigned_at) / 3600
      ) as hand_in_hours
    from done_people x
    where x.member_id = x.primary_owner_id
    group by x.member_id
  ),
  noted as (
    select a.member_id,
      percentile_cont(0.5) within group (
        order by greatest(0, extract(epoch from a.acknowledged_at - a.assigned_at)) / 3600
      ) as lag_hours
    from public.task_assignees a
    where a.removed_at is null
      and a.acknowledged_at >= lower(v_window) and a.acknowledged_at < upper(v_window)
    group by a.member_id
  ),
  -- The open tasks first, then each one's assignees by its id (a correlated read the planner keeps
  -- as one index lookup per task): joined plainly it scans every assignee row, each through the
  -- row policy (EXPLAIN on the measure seeds: 1.6 s against 10 ms).
  open_tasks as materialized (
    select t.id, t.held_at, t.due_at
    from public.tasks t
    where t.org_id = v_org and t.archived_at is null
      and t.state in ('todo', 'in_progress', 'submitted', 'admin_approved', 'changes_requested')
  ),
  open_work as (
    select a.member_id, count(*)::integer as open_now,
      count(*) filter (where t.held_at is null and t.due_at < now())::integer as overdue_now
    from open_tasks t
    cross join unnest((
      select array_agg(x.member_id) from public.task_assignees x
      where x.task_id = t.id and x.removed_at is null
    )) as a(member_id)
    group by a.member_id
  ),
  people as (
    select m.id from public.members m where m.status = 'active' and m.role <> 'owner'
    union select c.member_id from credited c
    union select o.member_id from owned o
    union select n.member_id from noted n
    union select w.member_id from open_work w
  )
  select p.id,
    coalesce(c.completed, 0),
    coalesce(o.on_time, 0),
    coalesce(o.owned_completed, 0),
    coalesce(c.loops, 0),
    round(o.hand_in_hours::numeric, 1),
    round(n.lag_hours::numeric, 1),
    coalesce(w.open_now, 0),
    coalesce(w.overdue_now, 0)
  from people p
  left join credited c on c.member_id = p.id
  left join owned o on o.member_id = p.id
  left join noted n on n.member_id = p.id
  left join open_work w on w.member_id = p.id
  order by p.id;
end;
$$;

comment on function public.report_people(date, date) is
  'v3.0 (9.3, kickoff 9 decision 13): the people report''s task facts per person for an IST period: '
  'completed (Owner-approved, every active assignee), on_time of owned_completed (the primary '
  'owner''s first hand-in on or before the deadline), revision_loops (send-backs on those tasks), '
  'hand_in_hours (median, assignment to first hand-in), ack_lag_hours (median, notes tapped in the '
  'period), open_now and overdue_now (never a held task). Raw facts, never a score. reports.all '
  'only; security invoker.';

revoke all on function public.report_people(date, date) from public, anon, service_role;
grant execute on function public.report_people(date, date) to authenticated;

-- 2. Delays ---------------------------------------------------------------------------------------

create function public.report_task_delays(p_from date, p_to date)
returns table (
  task_id uuid,
  title text,
  primary_owner_id uuid,
  type_name text,
  client_name text,
  due_at timestamptz,
  handed_in_at timestamptz,
  open boolean,
  late_reason text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_window tstzrange := app.report_window(p_from, p_to);
  v_org uuid := (select m.org_id from app.current_member() m);
begin
  return query
  select t.id, t.title, t.primary_owner_id, ty.name, c.name, t.due_at, f.first_hand_in,
    t.state not in ('completed', 'cancelled'), t.late_reason
  from public.tasks t
  left join public.task_types ty on ty.id = t.task_type_id
  left join public.clients c on c.id = t.client_id
  cross join lateral (
    select min(s.at) as first_hand_in from public.task_submissions s where s.task_id = t.id
  ) f
  where t.org_id = v_org
    and t.state in ('todo', 'in_progress', 'submitted', 'admin_approved', 'changes_requested', 'completed')
    and t.due_at >= lower(v_window) and t.due_at < upper(v_window)
    and t.archived_at is null
    and (
      f.first_hand_in > t.due_at
      or (f.first_hand_in is null and t.state <> 'completed' and t.held_at is null
          and t.due_at < now())
    )
  order by t.due_at, t.id
  limit 500;
end;
$$;

comment on function public.report_task_delays(date, date) is
  'v3.0 (9.3, kickoff 9 decision 14): the tasks due in an IST period handed in after their deadline '
  'or still not handed in past it (never a held or cancelled one), with the late reason, type and '
  'client label; at most 500, by deadline. reports.all only; security invoker.';

revoke all on function public.report_task_delays(date, date) from public, anon, service_role;
grant execute on function public.report_task_delays(date, date) to authenticated;

-- 3. Stage durations ------------------------------------------------------------------------------

create function public.report_stage_durations(p_from date, p_to date)
returns table (
  project_id uuid,
  project_name text,
  client_name text,
  stage_key text,
  stage_name text,
  ticks integer,
  median_days numeric,
  longest_days numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_window tstzrange := app.report_window(p_from, p_to);
  v_org uuid := (select m.org_id from app.current_member() m);
begin
  return query
  with touched as (
    select distinct s.item_id
    from public.project_item_stage_list s
    where s.org_id = v_org and s.archived_at is null
      and s.done_at >= lower(v_window) and s.done_at < upper(v_window)
  ),
  ordered as (
    select s.item_id, s.project_id, s.name, s.done_at,
      max(s.done_at) over (
        partition by s.item_id
        order by (s.group_label is not null),
          coalesce(s.group_position, '') collate "C",
          coalesce(s.group_label, '') collate "C",
          s.position collate "C",
          s.id
        rows between unbounded preceding and 1 preceding
      ) as previous_tick
    from public.project_item_stage_list s
    join touched x on x.item_id = s.item_id
    where s.archived_at is null
  ),
  spans as (
    select o.project_id, lower(btrim(o.name)) as stage_key, o.name,
      greatest(0, extract(epoch from o.done_at - coalesce(
        case when o.previous_tick <= o.done_at then o.previous_tick end,
        app.ist_day_start(cy.period_start),
        i.created_at
      )) / 86400) as days
    from ordered o
    join public.project_items i on i.id = o.item_id
    left join public.project_cycles cy on cy.id = i.cycle_id
    where o.done_at <@ v_window
  ),
  grouped as (
    select g.project_id, g.stage_key, min(g.name) as stage_name, count(*)::integer as ticks,
      percentile_cont(0.5) within group (order by g.days) as median_days,
      max(g.days) as longest_days
    from spans g
    group by grouping sets ((g.stage_key), (g.project_id, g.stage_key))
  )
  select g.project_id, p.name, c.name, g.stage_key, g.stage_name, g.ticks,
    round(g.median_days::numeric, 1), round(g.longest_days::numeric, 1)
  from grouped g
  left join public.projects p on p.id = g.project_id
  left join public.clients c on c.id = p.client_id
  order by g.project_id nulls first, g.median_days desc, g.ticks desc, g.stage_key;
end;
$$;

comment on function public.report_stage_durations(date, date) is
  'v3.0 (9.3, R7): deliverable stages ticked in an IST period, grouped by stage name ignoring case, '
  'overall (project_id null) and per project: ticks, median_days and longest_days since the '
  'previous tick on the deliverable in stage order (else its cycle''s start, else its creation). '
  'Groups and revision rounds are just stages. reports.all only; security invoker.';

revoke all on function public.report_stage_durations(date, date) from public, anon, service_role;
grant execute on function public.report_stage_durations(date, date) to authenticated;

-- 4. Client work ----------------------------------------------------------------------------------

create function public.report_client_work(p_from date, p_to date)
returns table (
  client_id uuid,
  client_name text,
  planned integer,
  done integer,
  done_on_time integer,
  done_in_period integer,
  overdue_now integer,
  on_hold integer,
  projects_completed integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_window tstzrange := app.report_window(p_from, p_to);
  v_today date := app.today_ist();
begin
  return query
  with items as (
    select p.client_id,
      (i.planned_date between p_from and p_to and i.state not in ('cancelled', 'carried'))
        as is_planned,
      i.state in ('done', 'approved') as is_done,
      (i.state = 'approved'
        and (i.approved_at at time zone 'Asia/Kolkata')::date <= i.planned_date) as is_on_time,
      (i.state in ('done', 'approved') and coalesce(i.approved_at, i.done_at) <@ v_window)
        as done_now,
      (i.state = 'open' and p.held_at is null and p.state in ('open', 'in_progress')
        and i.planned_date < v_today) as is_overdue,
      (i.state = 'open' and p.held_at is not null) as is_held
    from public.project_items i
    join public.projects p on p.id = i.project_id
    where (i.planned_date between p_from and p_to)
       or coalesce(i.approved_at, i.done_at) <@ v_window
       or (i.state = 'open' and (p.held_at is not null or i.planned_date < v_today))
  ),
  per_client as (
    select x.client_id,
      count(*) filter (where x.is_planned)::integer as planned,
      count(*) filter (where x.is_planned and x.is_done)::integer as done,
      count(*) filter (where x.is_planned and x.is_on_time)::integer as done_on_time,
      count(*) filter (where x.done_now)::integer as done_in_period,
      count(*) filter (where x.is_overdue)::integer as overdue_now,
      count(*) filter (where x.is_held)::integer as on_hold
    from items x
    group by x.client_id
  ),
  completed as (
    select p.client_id, count(*)::integer as projects_completed
    from public.projects p
    where p.state = 'completed' and p.completed_at <@ v_window
    group by p.client_id
  )
  select c.id, c.name,
    coalesce(w.planned, 0), coalesce(w.done, 0), coalesce(w.done_on_time, 0),
    coalesce(w.done_in_period, 0), coalesce(w.overdue_now, 0), coalesce(w.on_hold, 0),
    coalesce(k.projects_completed, 0)
  from public.clients c
  left join per_client w on w.client_id = c.id
  left join completed k on k.client_id = c.id
  where w.client_id is not null or k.client_id is not null
  order by lower(c.name), c.id;
end;
$$;

comment on function public.report_client_work(date, date) is
  'v3.0 (9.3): per client, for an IST period: deliverables planned in it (not cancelled or carried), '
  'of those done and done on time (approved on or before the planned date), done in the period, '
  'overdue now (open, past the planned date, project working and not held), on hold now, projects '
  'completed in the period. Counts only, never money (revenue joins through modules/revenue). '
  'reports.all only; security invoker.';

revoke all on function public.report_client_work(date, date) from public, anon, service_role;
grant execute on function public.report_client_work(date, date) to authenticated;
