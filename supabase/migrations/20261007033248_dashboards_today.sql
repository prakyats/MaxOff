-- 6A (6.1–6.3, Kickoff 6 decisions 6, 8, 10 and 23): the dashboards' live updates and the three
-- reads behind their risk rows that the API cannot make itself. Expand-only: one publication
-- grows, three read functions are added; no table, column, policy or existing function changes.
--
-- 1. Realtime (decision 8, ARCHITECTURE §10). The supabase_realtime publication grows by exactly
--    `tasks`, `task_assignees`, `attendance_days` and `leave_requests`, so Today (Owner, Admin) and
--    My Day re-read when one changes. Realtime authorises each change with the subscriber's own RLS
--    (the same rows the API already lets them select), and the browser treats an event as a signal
--    to re-read the screen, never as data to show. Replica identity stays the default (an UPDATE
--    sends the new row only). No money table is published (ADR-0007, pgTAP 46).
--
-- 2. public.dashboard_not_noted() (decision 6): the Owner's "not noted past the Owner escalation"
--    rows, on 5.3's own clock (greatest(assigned_at, armed_at) + ack_escalate_owner_hours over the
--    armed tasks, the conditions app.reminders_tick's section d uses), so the row and the
--    escalation always agree. `task_reminder_arms` has no API grant, hence a function.
--
-- 3. public.dashboard_unreachable() (decisions 6 and 10): the people on open work who can't be
--    reached, by 5.4's 48-hour status (member_reachability, the one the Owner's alert and the
--    digest use, never the live one); a freelancer assignee counts through their current
--    coordinator. The Owner: every open task; an Admin with notifications.reachability: the open
--    tasks they created or approve (5.4's Admin scope, reachability_overview()). The table has no
--    API grant, hence a function.
--
-- 4. public.emails_held_today() (decision 23): today's (IST) emails the daily limit held back, by
--    the limit that held them (the dispatcher's skipped_cap deliveries, last_error 'org_cap' or
--    'member_cap'). settings.manage only (the Owner). `notification_deliveries` has no API access.

-- 1. The publication -------------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach v_table in array array['tasks', 'task_assignees', 'attendance_days', 'leave_requests'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

-- 2. Not noted past the Owner escalation -----------------------------------------------------------
create function public.dashboard_not_noted()
returns table (task_id uuid, member_id uuid, waiting_since timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED', 'Sign in again.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'Only the Owner sees the team''s risks.');
  end if;

  return query
    select a.task_id, a.member_id, greatest(a.assigned_at, arm.armed_at)
    from public.task_assignees a
    join public.tasks t on t.id = a.task_id
    join public.task_reminder_arms arm on arm.task_id = t.id
    join public.org_settings s on s.org_id = t.org_id
    join public.members m on m.id = a.member_id and m.status = 'active'
    where t.org_id = v_me.org_id and t.archived_at is null
      and a.removed_at is null and a.acknowledged_at is null
      and t.state not in ('completed', 'cancelled')
      and now() >= greatest(a.assigned_at, arm.armed_at) + make_interval(hours => s.ack_escalate_owner_hours)
    order by greatest(a.assigned_at, arm.armed_at), a.task_id, a.member_id;
end;
$$;
comment on function public.dashboard_not_noted() is
  '6.2 (Kickoff 6 decision 6, attendance.view_all: the Owner): the active assignees of open, armed '
  'tasks who have not tapped Task Noted for ack_escalate_owner_hours, on 5.3''s clock '
  '(greatest(assigned_at, armed_at), reminders_tick section d''s conditions), so Today''s row and the '
  'Owner''s escalation agree. waiting_since is that clock''s start. Anyone else FORBIDDEN.';
revoke all on function public.dashboard_not_noted() from public, anon;
grant execute on function public.dashboard_not_noted() to authenticated, service_role;

-- 3. Can't be reached, on open work ---------------------------------------------------------------
create function public.dashboard_unreachable()
returns table (member_id uuid, full_name text, state text, since timestamptz, open_tasks integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members;
  v_owner boolean;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED', 'Sign in again.');
  end if;
  if not app.has_permission('notifications.reachability') then
    perform app.fail('FORBIDDEN', 'Only the Owner and Admins can see who can''t be reached.');
  end if;
  v_owner := app.org_owner_id(v_me.org_id) = v_me.id;

  return query
    with open_tasks as (
      select t.id from public.tasks t
      where t.org_id = v_me.org_id and t.archived_at is null
        and t.state not in ('completed', 'cancelled')
        and (v_owner or t.created_by = v_me.id or t.approving_admin_id = v_me.id)
    ),
    -- Who answers for each task's people: the assignee, or a freelancer's current coordinator.
    people as (
      select a.task_id, case when f.engagement = 'freelance' then c.coordinator_id else a.member_id end as id
      from public.task_assignees a
      join open_tasks o on o.id = a.task_id
      join public.members f on f.id = a.member_id
      left join public.member_coordinators c
        on c.member_id = a.member_id and c.to_at is null and f.engagement = 'freelance'
      where a.removed_at is null
    )
    select r.member_id, m.full_name, r.state,
           case when v_owner then greatest(r.since, o.reachability_clock_from) end,
           count(distinct p.task_id)::integer
    from people p
    join public.member_reachability r on r.member_id = p.id
    join public.members m on m.id = r.member_id
    join public.org_settings o on o.org_id = m.org_id
    where m.org_id = v_me.org_id and m.status = 'active' and m.engagement = 'permanent'
      and m.joined_at is not null and m.id is distinct from app.org_owner_id(v_me.org_id)
      and r.state <> 'ok'
      and greatest(r.since, o.reachability_clock_from) <= now() - interval '48 hours'
    group by r.member_id, m.full_name, r.state, r.since, o.reachability_clock_from
    order by m.full_name, r.member_id;
end;
$$;
comment on function public.dashboard_unreachable() is
  '6.2 / 6.3 (Kickoff 6 decisions 6 and 10, notifications.reachability): the people on open work '
  'whose 5.4 48-hour status says they can''t be reached (member_reachability not ok for 48 h, from '
  'reachability_clock_from), a freelancer assignee through their current coordinator, with how many '
  'open tasks in scope they answer for. The organisation''s Owner: every open task, with since; an '
  'Admin: the open tasks they created or approve, since null (reachability_overview''s scope). '
  'Anyone else FORBIDDEN.';
revoke all on function public.dashboard_unreachable() from public, anon;
grant execute on function public.dashboard_unreachable() to authenticated, service_role;

-- 4. Emails held back today ------------------------------------------------------------------------
create function public.emails_held_today()
returns table (cap text, held integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED', 'Sign in again.');
  end if;
  if not app.has_permission('settings.manage') then
    perform app.fail('FORBIDDEN', 'Only the Owner sees the email limits.');
  end if;

  return query
    select d.last_error, count(*)::integer
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    where n.org_id = v_me.org_id and d.channel = 'email' and d.state = 'skipped_cap'
      and d.last_error in ('org_cap', 'member_cap')
      and d.created_at >= app.ist_day_start(app.today_ist())
      and d.created_at < app.ist_day_start(app.today_ist() + 1)
    group by d.last_error
    order by d.last_error;
end;
$$;
comment on function public.emails_held_today() is
  '6.2 (Kickoff 6 decision 23, settings.manage: the Owner): today''s (IST) emails the daily limit '
  'held back, by the limit that held them: org_cap (email_daily_cap_org, the email plan''s daily '
  'limit) or member_cap (email_daily_cap_per_member). Counts only. Anyone else FORBIDDEN.';
revoke all on function public.emails_held_today() from public, anon;
grant execute on function public.emails_held_today() to authenticated, service_role;
