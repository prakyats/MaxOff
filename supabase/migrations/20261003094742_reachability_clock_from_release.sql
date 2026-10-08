-- 5B 5.4 follow-up (owner, 2026-10-03): each person's 48 h "can't be reached" clock starts at the
-- release, the moment this migration runs, not at their first login. Without it the first hourly
-- run on release day would alert the Owner about everyone already unreachable who joined more
-- than 48 h ago. Expand-only: one nullable column on org_settings, set once here to now(), and
-- three functions re-created with the same signatures (the clock floored at it):
--   * app.reachability_live: a member never recorded starts at greatest(first login, the release);
--   * public.reachability_check: alerts when greatest(since, the release) is 48 h or more ago (a
--     row the job recorded before this ran, as on staging, waits for the release too);
--   * app.owner_digest_payload: the "Can't be reached" count uses the same clock.
-- A state change still restarts the clock at that moment (it is always after the release).
-- On production both 5.4 migrations run in the same deploy, seconds apart; an hourly run (minute
-- 17) would have to fall exactly between them to alert early.

alter table public.org_settings add column reachability_clock_from timestamptz null;
comment on column public.org_settings.reachability_clock_from is
  '5B 5.4 (owner 2026-10-03): no one''s 48 h reachability clock starts before this moment (the '
  'release of 5.4, set by its follow-up migration). Null: no floor.';
update public.org_settings set reachability_clock_from = now() where reachability_clock_from is null;

create or replace function app.reachability_live(p_org uuid, p_now timestamptz)
returns table (member_id uuid, state text, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, s.state,
         case when r.member_id is null then greatest(m.joined_at, coalesce(o.reachability_clock_from, m.joined_at))
              when r.state = s.state then r.since
              else p_now end
  from public.members m
  cross join lateral (select app.reachability_state(m.id) as state) s
  left join public.member_reachability r on r.member_id = m.id
  left join public.org_settings o on o.org_id = m.org_id
  where m.org_id = p_org and m.status = 'active' and m.engagement = 'permanent' and m.joined_at is not null;
$$;

create or replace function public.reachability_check(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_owner uuid;
  v_row record;
  v_count integer := 0;
begin
  for v_org in select o.id from public.organizations o order by o.id loop
    -- One run at a time per organisation: two overlapping runs cannot both alert.
    perform pg_advisory_xact_lock(hashtext('reachability_check:' || v_org.id::text));

    -- The clock: a new row starts at the first login; a changed state restarts it; the same state
    -- writes nothing (so every audit entry is a change).
    insert into public.member_reachability as r (member_id, org_id, state, since)
    select l.member_id, v_org.id, l.state, l.since from app.reachability_live(v_org.id, p_now) l
    on conflict (member_id) do update
      set state = excluded.state, since = excluded.since, org_id = excluded.org_id
      where r.state is distinct from excluded.state;

    -- The alert: never about the Owner (their own banner says it), at most once a week per person.
    v_owner := app.org_owner_id(v_org.id);
    if v_owner is null then
      continue;
    end if;
    for v_row in
      select r.member_id, r.state, r.since, m.full_name
      from public.member_reachability r
      join public.members m on m.id = r.member_id
      where r.org_id = v_org.id and m.org_id = v_org.id
        and m.status = 'active' and m.engagement = 'permanent' and m.joined_at is not null
        and r.member_id <> v_owner
        and r.state <> 'ok'
        and greatest(r.since, (select o.reachability_clock_from from public.org_settings o where o.org_id = v_org.id))
            <= p_now - interval '48 hours'
        and (r.alerted_at is null or r.alerted_at <= p_now - interval '7 days')
      order by m.full_name, r.member_id
    loop
      perform app.notify(array[v_owner], 'member_unreachable',
        v_row.full_name || ' can''t be reached',
        app.reachability_reason(v_row.state) || ' since ' || app.notify_date(app.to_ist_date(v_row.since)) || '.',
        '/settings/notifications', null, null,
        jsonb_build_object('member_id', v_row.member_id, 'state', v_row.state), null);
      update public.member_reachability set alerted_at = p_now where member_id = v_row.member_id;
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

create or replace function app.owner_digest_payload(p_org uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.to_ist_date(p_now);
  v_yesterday date := app.to_ist_date(p_now) - 1;
  v_from timestamptz := app.ist_day_start(app.to_ist_date(p_now) - 1);
  v_to timestamptz := app.ist_day_start(app.to_ist_date(p_now));
  v_owner uuid := app.org_owner_id(p_org);
  v_attendance jsonb;
  v_tasks jsonb;
  v_requests jsonb;
  v_held jsonb;
  v_unreachable jsonb;
begin
  -- Attendance yesterday: the days of the organisation's active members. A day still waiting for
  -- the Owner counts by what it stands at (the choice made, else the system's proposal: the
  -- `coalesce(submitted_choice, final_status)` that attendance_decide approves and Start day reads).
  with days as (
    select m.id, m.full_name, d.end_not_recorded,
           case when d.state = 'pending_review'
                then coalesce(d.submitted_choice::text::public.day_status, d.final_status)
                else d.final_status end as status
    from public.attendance_days d
    join public.members m on m.id = d.member_id
    where m.org_id = p_org and m.status = 'active' and d.work_date = v_yesterday
  ),
  absent as (
    select d.full_name, row_number() over (order by d.full_name, d.id) as n
    from days d where d.status = 'absent'
  ),
  not_ended as (
    select d.full_name, row_number() over (order by d.full_name, d.id) as n
    from days d where d.end_not_recorded
  )
  select jsonb_build_object(
    'present', (select count(*) from days where status = 'present'),
    'on_leave', (select count(*) from days where status in ('leave', 'half_day', 'comp_leave')),
    'absent', (select count(*) from absent),
    'absent_names', coalesce((select jsonb_agg(a.full_name order by a.n) from absent a where a.n <= 5), '[]'::jsonb),
    'absent_more', greatest((select count(*) from absent) - 5, 0),
    'day_not_ended', (select count(*) from not_ended),
    'day_not_ended_names', coalesce((select jsonb_agg(e.full_name order by e.n) from not_ended e where e.n <= 5), '[]'::jsonb),
    'day_not_ended_more', greatest((select count(*) from not_ended) - 5, 0))
  into v_attendance;

  -- Tasks: approved (completed) yesterday; overdue now (tasks/domain isOverdue: not completed or
  -- cancelled, past due_at); waiting for the Owner (task_counts().to_decide for the Owner).
  select jsonb_build_object(
    'approved_yesterday', (
      select count(*) from public.tasks t
      where t.org_id = p_org and t.archived_at is null and t.completed_at >= v_from and t.completed_at < v_to),
    'overdue', (
      select count(*) from public.tasks t
      where t.org_id = p_org and t.archived_at is null
        and t.state not in ('completed', 'cancelled') and t.due_at < p_now),
    'waiting_for_owner', (
      select count(*) from public.tasks t
      where t.org_id = p_org and v_owner is not null
        and ((exists (select 1 from public.role_permissions rp
                      where rp.role = 'owner' and rp.permission = 'tasks.approve_final')
              and t.state = 'admin_approved')
          or (exists (select 1 from public.role_permissions rp
                      where rp.role = 'owner' and rp.permission = 'tasks.approve_admin')
              and t.state = 'submitted' and t.approving_admin_id = v_owner
              and not exists (select 1 from public.task_assignees a
                              where a.task_id = t.id and a.member_id = v_owner and a.removed_at is null)))))
  into v_tasks;

  -- Requests waiting for the Owner: leave (countPendingRequests: submitted, not the attendance
  -- prompt's) and expense claims (countPendingClaims: submitted). A count only: no amount is read.
  select jsonb_build_object(
    'leave', (
      select count(*) from public.leave_requests r
      join public.members m on m.id = r.member_id
      where m.org_id = p_org and r.state = 'submitted' and r.source <> 'attendance'),
    'expense_claims', (
      select count(*) from public.expense_claims c
      join public.members m on m.id = c.member_id
      where m.org_id = p_org and c.state = 'submitted'))
  into v_requests;

  -- Emails the daily limit held back yesterday, by kind (the dispatcher's skipped_cap rows).
  select coalesce(jsonb_agg(jsonb_build_object('kind', h.kind, 'description', h.description, 'count', h.n)
                            order by h.n desc, h.kind), '[]'::jsonb)
  into v_held
  from (
    select n.kind, k.description, count(*) as n
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    join public.notification_kinds k on k.kind = n.kind
    where n.org_id = p_org and d.channel = 'email' and d.state = 'skipped_cap'
      and d.created_at >= v_from and d.created_at < v_to
    group by n.kind, k.description
  ) h;

  -- 5.4: the tracked people (not the Owner) not reachable for 48 h or more, as the hourly
  -- reachability_check last recorded them.
  with unreachable as (
    select m.full_name, row_number() over (order by m.full_name, m.id) as n
    from public.member_reachability r
    join public.members m on m.id = r.member_id
    where m.org_id = p_org and m.status = 'active' and m.engagement = 'permanent' and m.joined_at is not null
      and m.id is distinct from v_owner
      and r.state <> 'ok' and greatest(r.since, (select o.reachability_clock_from from public.org_settings o where o.org_id = p_org))
          <= p_now - interval '48 hours'
  )
  select jsonb_build_object(
    'count', (select count(*) from unreachable),
    'names', coalesce((select jsonb_agg(u.full_name order by u.n) from unreachable u where u.n <= 5), '[]'::jsonb),
    'more', greatest((select count(*) from unreachable) - 5, 0))
  into v_unreachable;

  return jsonb_build_object(
    'date', v_today,
    'yesterday', v_yesterday,
    'attendance', v_attendance,
    'tasks', v_tasks,
    'requests', v_requests,
    'held_back', v_held,
    'unreachable', v_unreachable);
end;
$$;
