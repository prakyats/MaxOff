-- 5B 5.4: reachability (WORKFLOWS §9a "Reachability", PERMISSIONS notifications.reachability; owner
-- decisions at kickoff 5 (14) and 2026-10-03, PROGRESS "Slice 8"). Expand-only: two new tables, one
-- notification kind, new functions, one pg_cron job, and the Owner digest's two functions
-- re-created with the same signatures (the payload gains one key; the text one section). No data
-- is rewritten.
--
-- * **What the app says about itself** (owner decision 2026-10-03): member_app_reports holds the
--   latest platform and installed / not installed a member's app reported when it opened
--   (app_open_report, the caller's own row). It decides `ios_not_installed`; the latest sign-in's
--   user agent is the fallback only for someone with no report yet.
-- * **The state** of each tracked member (active, permanent, joined: the Owner included, never an
--   invited person or a freelancer) is app.reachability_state(member), from their push
--   subscriptions and that report.
-- * **The 48 h clock** lives in member_reachability, kept by the hourly job reachability_check:
--   since = the first login (joined_at) for a member it has never seen, the run's time when the
--   state changed. Someone not ok for 48 h raises one member_unreachable alert to the Owner,
--   always emailed, at most once a week per person, never about the Owner (their banner says it).
-- * **Who sees what:** reachability_overview(): the Owner everyone with platform and last success;
--   an Admin the people on their open tasks, state alone; anyone else FORBIDDEN. No endpoint ever.
-- * **The digest** counts the people not ok for 48 h or more (the Owner left out): "Can't be
--   reached: N" under "People".

-- 1. The kind ------------------------------------------------------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('member_unreachable', false, true, true,
   'Someone has not been reachable by push for 48 h (to the Owner, at most weekly per person)');

-- 2. What the app reports when it opens ----------------------------------------------------------------
create table public.member_app_reports (
  member_id uuid primary key references public.members (id) on delete cascade,
  org_id uuid not null references public.organizations (id),
  platform text not null check (platform in ('android', 'ios', 'desktop', 'other')),
  is_standalone boolean not null,
  reported_at timestamptz not null default now()
);
comment on table public.member_app_reports is
  '5B 5.4 (owner decision 2026-10-03): the platform and installed / not installed the member''s app '
  'last reported when it opened (once per app open). No user agent, no IP. Written only by '
  'app_open_report() for the caller; a report that changes nothing writes nothing, so reported_at '
  'is the last change. No API access (RLS on, no policy); read by the reachability functions. '
  'Audited on insert and update; the cascade exists for the local stack''s fixture deletes.';
alter table public.member_app_reports enable row level security;
revoke all on public.member_app_reports from public, anon, authenticated;
create trigger audit_row_change after insert or update on public.member_app_reports
  for each row execute function app.audit_row_change('member_id');

create function public.app_open_report(platform text, is_standalone boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.members;
  v_changed integer;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED', 'Sign in again.');
  end if;
  if platform is null or platform not in ('android', 'ios', 'desktop', 'other') or is_standalone is null then
    perform app.fail('VALIDATION', 'Not a device report.');
  end if;
  insert into public.member_app_reports as r (member_id, org_id, platform, is_standalone, reported_at)
  values (v_me.id, v_me.org_id, app_open_report.platform, app_open_report.is_standalone, now())
  on conflict (member_id) do update
    set platform = excluded.platform, is_standalone = excluded.is_standalone, reported_at = excluded.reported_at
    where (r.platform, r.is_standalone) is distinct from (excluded.platform, excluded.is_standalone);
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;
comment on function public.app_open_report(text, boolean) is
  '5B 5.4 (owner decision 2026-10-03): the app, once per open, says its platform and whether it '
  'runs installed; stored for the caller (an active permanent member) only. Writes only a change; '
  'returns whether it wrote. VALIDATION for anything but the four platforms.';
revoke all on function public.app_open_report(text, boolean) from public, anon;
grant execute on function public.app_open_report(text, boolean) to authenticated, service_role;

-- 3. The state -----------------------------------------------------------------------------------------
create function app.reachability_state(p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with subs as (
    select s.disabled_at, s.disabled_reason, s.failure_count
    from public.push_subscriptions s where s.member_id = p_member
  ),
  report as (
    select r.platform, r.is_standalone from public.member_app_reports r where r.member_id = p_member
  ),
  last_disabled as (
    select s.disabled_reason from subs s
    where s.disabled_at is not null and s.disabled_reason in ('gone', 'expired')
    order by s.disabled_at desc
    limit 1
  ),
  last_login as (
    select e.user_agent from public.session_events e
    where e.member_id = p_member and e.kind = 'login'
    order by e.at desc
    limit 1
  )
  select case
    -- One working device is enough (kickoff 5 decision 9). One error is not "repeated".
    when exists (select 1 from subs where disabled_at is null and failure_count < 2) then 'ok'
    when exists (select 1 from subs where disabled_at is null) then 'failing'
    when exists (select 1 from report where platform = 'ios' and not is_standalone) then 'ios_not_installed'
    when (select disabled_reason from last_disabled) = 'gone' then 'permission_revoked'
    when (select disabled_reason from last_disabled) = 'expired' then 'failing'
    when not exists (select 1 from report)
         and coalesce((select user_agent from last_login), '') ~ '(iPhone|iPad|iPod)' then 'ios_not_installed'
    else 'no_subscription'
  end;
$$;
comment on function app.reachability_state(uuid) is
  '5B 5.4, service_role only: a member''s reachability now, the first that holds: ok (an active '
  'subscription with failure_count < 2), failing (active ones, each failing twice or more), '
  'ios_not_installed (their app report: iOS, not installed), permission_revoked (the latest '
  'disabled subscription went gone), failing (… expired), ios_not_installed (no app report yet and '
  'the latest sign-in was from an iPhone, iPad or iPod), else no_subscription.';
revoke all on function app.reachability_state(uuid) from public, anon, authenticated;
grant execute on function app.reachability_state(uuid) to service_role;

-- 4. The 48 h clock --------------------------------------------------------------------------------------
create table public.member_reachability (
  member_id uuid primary key references public.members (id) on delete cascade,
  org_id uuid not null references public.organizations (id),
  state text not null check (state in ('ok', 'no_subscription', 'permission_revoked', 'ios_not_installed', 'failing')),
  since timestamptz not null,
  alerted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.member_reachability is
  '5B 5.4: each tracked member''s reachability and since when (the 48 h clock), and when the Owner '
  'was last alerted about them (at most weekly). Written only by reachability_check (pg_cron, '
  'hourly), only on a change. No API access (RLS on, no policy): read through '
  'reachability_overview() and the Owner digest. Audited on insert and update.';
create index member_reachability_org_idx on public.member_reachability (org_id);
create trigger set_updated_at before update on public.member_reachability
  for each row execute function app.set_updated_at();
create trigger audit_row_change after insert or update on public.member_reachability
  for each row execute function app.audit_row_change('member_id');
alter table public.member_reachability enable row level security;
revoke all on public.member_reachability from public, anon, authenticated;

create function app.reachability_live(p_org uuid, p_now timestamptz)
returns table (member_id uuid, state text, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, s.state,
         case when r.member_id is null then m.joined_at
              when r.state = s.state then r.since
              else p_now end
  from public.members m
  cross join lateral (select app.reachability_state(m.id) as state) s
  left join public.member_reachability r on r.member_id = m.id
  where m.org_id = p_org and m.status = 'active' and m.engagement = 'permanent' and m.joined_at is not null;
$$;
comment on function app.reachability_live(uuid, timestamptz) is
  '5B 5.4, service_role only: every tracked member of the organisation (active, permanent, joined; '
  'the Owner included) with their state now and since when: the stored since while the state is '
  'the stored one, the first login (joined_at) for a member never stored, else p_now.';
revoke all on function app.reachability_live(uuid, timestamptz) from public, anon, authenticated;
grant execute on function app.reachability_live(uuid, timestamptz) to service_role;

-- What each state means, in the alert's words (the screen says the same: core/notifications/reachability.ts).
create function app.reachability_reason(p_state text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_state
    when 'no_subscription' then 'Notifications never turned on'
    when 'permission_revoked' then 'Notifications blocked on their phone'
    when 'ios_not_installed' then 'iPhone without MaxOff installed'
    when 'failing' then 'Notifications keep failing'
    else 'Reachable' end;
$$;
comment on function app.reachability_reason(text) is
  '5B 5.4, service_role only: a reachability state in plain words, for the Owner''s alert.';
revoke all on function app.reachability_reason(text) from public, anon, authenticated;
grant execute on function app.reachability_reason(text) to service_role;

-- 5. The hourly job ----------------------------------------------------------------------------------------
create function public.reachability_check(p_now timestamptz default now())
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
        and r.since <= p_now - interval '48 hours'
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
comment on function public.reachability_check(timestamptz) is
  '5B 5.4, service_role only (pg_cron reachability_check, hourly): refreshes member_reachability '
  'for every tracked member (writes only a change), then one member_unreachable notification to '
  'the organisation''s Owner (app.notify, always emailed) for each tracked member but the Owner '
  'not ok for 48 h or more and not alerted in the last 7 days. Returns how many alerts it wrote.';
revoke all on function public.reachability_check(timestamptz) from public, anon, authenticated;
grant execute on function public.reachability_check(timestamptz) to service_role;

select cron.schedule('reachability_check', '17 * * * *', $$select public.reachability_check(now())$$);

-- 6. Settings → Notifications -----------------------------------------------------------------------------
create function public.reachability_overview()
returns table (
  member_id uuid,
  full_name text,
  role public.member_role,
  state text,
  since timestamptz,
  platform text,
  last_success_at timestamptz
)
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

  -- The Owner: everyone tracked, with since, platform and the last delivery that worked.
  if app.org_owner_id(v_me.org_id) = v_me.id
     and exists (select 1 from public.role_permissions rp
                 where rp.role = v_me.role and rp.permission = 'notifications.reachability') then
    return query
      select l.member_id, m.full_name, m.role, l.state, l.since,
             coalesce(
               (select r.platform from public.member_app_reports r where r.member_id = l.member_id),
               (select s.platform from public.push_subscriptions s where s.member_id = l.member_id
                order by s.last_seen_at desc nulls last, s.created_at desc limit 1)),
             (select max(s.last_success_at) from public.push_subscriptions s where s.member_id = l.member_id)
      from app.reachability_live(v_me.org_id, now()) l
      join public.members m on m.id = l.member_id
      order by m.full_name, l.member_id;
    return;
  end if;

  if not exists (select 1 from public.role_permissions rp
                 where rp.role = v_me.role and rp.permission = 'notifications.reachability') then
    perform app.fail('FORBIDDEN', 'Only the Owner and Admins can see who can''t be reached.');
  end if;

  -- An Admin: the people on the open tasks they created or approve (a freelancer through their
  -- current coordinator), state alone.
  return query
    with open_tasks as (
      select t.id from public.tasks t
      where t.org_id = v_me.org_id and t.archived_at is null
        and t.state not in ('completed', 'cancelled')
        and (t.created_by = v_me.id or t.approving_admin_id = v_me.id)
    ),
    people as (
      select a.member_id as id from public.task_assignees a
      join open_tasks o on o.id = a.task_id
      where a.removed_at is null
      union
      select c.coordinator_id from public.task_assignees a
      join open_tasks o on o.id = a.task_id
      join public.members f on f.id = a.member_id and f.engagement = 'freelance'
      join public.member_coordinators c on c.member_id = f.id and c.to_at is null
      where a.removed_at is null
    )
    select l.member_id, m.full_name, m.role, l.state,
           null::timestamptz, null::text, null::timestamptz
    from app.reachability_live(v_me.org_id, now()) l
    join people p on p.id = l.member_id
    join public.members m on m.id = l.member_id
    order by m.full_name, l.member_id;
end;
$$;
comment on function public.reachability_overview() is
  '5B 5.4 (PERMISSIONS notifications.reachability): who can be reached by push, live. The '
  'organisation''s Owner: every tracked member with since, platform (the app report''s, else the '
  'latest seen subscription''s) and the last successful delivery. An Admin: the members on open '
  'tasks they created or approve and a freelancer assignee''s current coordinator, state alone '
  '(since, platform, last_success_at null). Anyone else FORBIDDEN. Never an endpoint.';
revoke all on function public.reachability_overview() from public, anon;
grant execute on function public.reachability_overview() to authenticated, service_role;

-- 7. The Owner digest: "Can't be reached" ------------------------------------------------------------------
-- owner_digest_payload re-created from 20261003015912_owner_digest with one key added
-- (`unreachable`); every other line is unchanged.
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
      and r.state <> 'ok' and r.since <= p_now - interval '48 hours'
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
comment on function app.owner_digest_payload(uuid, timestamptz) is
  '5B slice 7, service_role only: the Owner digest''s counts for an organisation at p_now (IST): '
  'attendance yesterday (present, on leave, absent and day not ended, with up to 5 names each by '
  'name then id and the remainder), tasks (approved yesterday, overdue now, waiting for the Owner), '
  'requests waiting (leave, expense claims: counts only), yesterday''s emails held back by the '
  'daily limit by kind, and (5.4) the people not reachable for 48 h or more (the Owner left out; '
  'up to 5 names). Never an amount.';

-- owner_digest_text re-created from 20261003015912_owner_digest: the section "People" before the
-- held-back emails; every other section is unchanged. A payload without `unreachable` (written
-- before 5.4) has no such line.
create or replace function app.owner_digest_text(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_lines text[] := '{}';
  v_section text[];
  v_item jsonb;
  v_names text;
begin
  v_section := '{}';
  if (p #>> '{attendance,present}')::integer > 0 then
    v_section := v_section || ('Present: ' || (p #>> '{attendance,present}'));
  end if;
  if (p #>> '{attendance,on_leave}')::integer > 0 then
    v_section := v_section || ('On leave: ' || (p #>> '{attendance,on_leave}'));
  end if;
  if (p #>> '{attendance,absent}')::integer > 0 then
    select string_agg(x, ', ') into v_names from jsonb_array_elements_text(p #> '{attendance,absent_names}') x;
    v_section := v_section || ('Absent: ' || (p #>> '{attendance,absent}') || ' (' || coalesce(v_names, '')
      || case when (p #>> '{attendance,absent_more}')::integer > 0 then ' +' || (p #>> '{attendance,absent_more}') || ' more' else '' end || ')');
  end if;
  if (p #>> '{attendance,day_not_ended}')::integer > 0 then
    select string_agg(x, ', ') into v_names from jsonb_array_elements_text(p #> '{attendance,day_not_ended_names}') x;
    v_section := v_section || ('Day not ended: ' || (p #>> '{attendance,day_not_ended}') || ' (' || coalesce(v_names, '')
      || case when (p #>> '{attendance,day_not_ended_more}')::integer > 0 then ' +' || (p #>> '{attendance,day_not_ended_more}') || ' more' else '' end || ')');
  end if;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'Attendance yesterday'] || v_section;
  end if;

  v_section := '{}';
  if (p #>> '{tasks,approved_yesterday}')::integer > 0 then
    v_section := v_section || ('Approved yesterday: ' || (p #>> '{tasks,approved_yesterday}'));
  end if;
  if (p #>> '{tasks,overdue}')::integer > 0 then
    v_section := v_section || ('Overdue now: ' || (p #>> '{tasks,overdue}'));
  end if;
  if (p #>> '{tasks,waiting_for_owner}')::integer > 0 then
    v_section := v_section || ('Waiting for your approval: ' || (p #>> '{tasks,waiting_for_owner}'));
  end if;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'Tasks'] || v_section;
  end if;

  v_section := '{}';
  if (p #>> '{requests,leave}')::integer > 0 then
    v_section := v_section || ('Leave requests: ' || (p #>> '{requests,leave}'));
  end if;
  if (p #>> '{requests,expense_claims}')::integer > 0 then
    v_section := v_section || ('Expense claims: ' || (p #>> '{requests,expense_claims}'));
  end if;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'Requests waiting for you'] || v_section;
  end if;

  v_section := '{}';
  if coalesce((p #>> '{unreachable,count}')::integer, 0) > 0 then
    select string_agg(x, ', ') into v_names from jsonb_array_elements_text(p #> '{unreachable,names}') x;
    v_section := v_section || ('Can''t be reached: ' || (p #>> '{unreachable,count}') || ' (' || coalesce(v_names, '')
      || case when coalesce((p #>> '{unreachable,more}')::integer, 0) > 0 then ' +' || (p #>> '{unreachable,more}') || ' more' else '' end || ')');
  end if;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'People'] || v_section;
  end if;

  v_section := '{}';
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'held_back', '[]'::jsonb)) loop
    if (v_item ->> 'count')::integer > 0 then
      v_section := v_section || (coalesce(v_item ->> 'description', v_item ->> 'kind') || ': ' || (v_item ->> 'count'));
    end if;
  end loop;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'Emails held back yesterday by the daily limit'] || v_section;
  end if;

  if cardinality(v_lines) = 0 then
    return 'Nothing needs you today.';
  end if;
  return btrim(array_to_string(v_lines, E'\n'), E'\n');
end;
$$;
comment on function app.owner_digest_text(jsonb) is
  '5B slice 7, service_role only: the digest payload''s lines as plain text (zero lines and empty '
  'sections left out; "Nothing needs you today." when all are zero), the row''s body. 5.4: the '
  'section "People" ("Can''t be reached: N (names +N more)") before the held-back emails; absent '
  'from a payload written before 5.4.';
