-- v2.0 X3 (b) (2026-11-06, migration attendance_hours_once; DATA-MODEL §1 "v2.0 X3"): the Owner's Today
-- board reads the organisation's settings and the day's working-day rule once per call, through
-- app.attendance_hours_on, and app.attendance_hours is a wrapper over the same body. The proof
-- (the advisor, #89): app.attendance_hours equal to a reference copy of its old body for EVERY
-- member over 50 days, with fixtures for a holiday, full leave, a morning and an afternoon half day,
-- a freelancer, a member who joined today, a shoot that ends late and a Stay until, with working
-- hours on and off; and attendance_hours_today() equal to its old body as the Owner. Who may call
-- attendance_hours_on (service_role only, as attendance_hours). Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- The references: the old bodies exactly (today's calls the old attendance_hours).
create function pg_temp.ref_attendance_hours(p_member uuid, p_date date)
returns table(rules_on boolean, late_applies boolean, early_applies boolean, half text, start_at timestamp with time zone, late_after timestamp with time zone, end_at timestamp with time zone, end_source text, stay_until timestamp with time zone, shoot_end timestamp with time zone)
language plpgsql stable security definer set search_path = ''
as $ref$
declare
  v_set public.org_settings;
  v_day public.attendance_days;
  v_leave public.leave_requests;
  v_on boolean;
  v_rules boolean;
  v_shoot timestamptz;
  v_end timestamptz;
  v_source text := 'work';
begin
  select s.* into v_set
  from public.org_settings s join public.members m on m.org_id = s.org_id
  where m.id = p_member;
  select d.* into v_day from public.attendance_days d where d.member_id = p_member and d.work_date = p_date;
  v_leave := app.leave_covering(p_member, p_date);
  v_on := coalesce(v_set.working_hours_on, false);
  -- No rules on a weekly off, a holiday, a day marked off, or a day of approved full or comp leave
  -- (null from is_working_day() means "unknown", which is not a day off).
  v_rules := v_on and app.is_working_day(p_date) is not false and not coalesce(v_day.is_day_off, false)
             and (v_leave.id is null or v_leave.type = 'half_day');

  select max(t.event_end_at) into v_shoot
  from public.tasks t
  join public.task_assignees a on a.task_id = t.id and a.member_id = p_member and a.removed_at is null
  where t.event_date = p_date and t.event_end_at is not null and t.state <> 'cancelled' and t.archived_at is null;

  v_end := app.ist_day_start(p_date) + (v_set.work_end_time - time '00:00');
  -- A shoot only moves the end later, never earlier (owner 2026-10-07 (a)); then the Owner's Stay until.
  if v_shoot > v_end then
    v_end := v_shoot;
    v_source := 'shoot';
  end if;
  if v_day.stay_until > v_end then
    v_end := v_day.stay_until;
    v_source := 'stay';
  end if;

  return query select
    v_on,
    -- A morning half day (off in the morning) is never Late; an afternoon one never an early leave;
    -- a half day with no half recorded has neither rule (owner 2026-10-07 (c)).
    coalesce(v_rules and (v_leave.id is null or v_leave.half = 'afternoon'), false),
    coalesce(v_rules and (v_leave.id is null or v_leave.half = 'morning'), false),
    case when v_leave.type = 'half_day' then v_leave.half end,
    app.ist_day_start(p_date) + (v_set.work_start_time - time '00:00'),
    app.ist_day_start(p_date) + (v_set.work_start_time - time '00:00') + make_interval(mins => v_set.late_grace_minutes),
    v_end, v_source, v_day.stay_until, v_shoot;
end;
$ref$;

create function pg_temp.ref_attendance_hours_today()
returns table(member_id uuid, full_name text, rules_on boolean, started_at timestamp with time zone, ended_at timestamp with time zone, late_minutes integer, late_reason text, end_at timestamp with time zone, end_source text, stay_until timestamp with time zone, early_leave_id uuid, early_leave_state text, early_leave_reason text, early_leave_requested_at timestamp with time zone, left_early boolean, ended_after_end boolean)
language plpgsql stable security definer set search_path = ''
as $ref$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.to_ist_date(app.now());
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'Everyone''s working hours are the Owner''s.');
  end if;
  return query
  select m.id, m.full_name, h.rules_on, d.started_at, d.ended_at, d.late_minutes, d.late_reason,
         h.end_at, h.end_source, h.stay_until, e.id, e.state, e.reason, e.requested_at,
         coalesce(e.state in ('approved', 'left_unanswered', 'corrected'), false),
         coalesce(d.ended_at > h.end_at, false)
  from public.members m
  cross join lateral pg_temp.ref_attendance_hours(m.id, v_today) h
  left join public.attendance_days d on d.member_id = m.id and d.work_date = v_today
  left join lateral (
    select x.* from public.early_leave_requests x where x.day_id = d.id order by x.requested_at desc limit 1) e on true
  where m.org_id = v_org and m.status = 'active' and m.engagement = 'permanent'
    and app.to_ist_date(m.joined_at) < v_today
    and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'attendance.self')
  order by m.full_name, m.id;
end;
$ref$;

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('free',  '00000000-0000-4000-8000-000000014201'),
  ('new',   '00000000-0000-4000-8000-000000014202');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') and kind = 'normal' order by position limit 1;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;

-- Fixtures.
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at) values
  (pg_temp.fx('free'), pg_temp.fx('org'), 'Hours freelancer 142', null, 'staff', 'active', 'freelance', now() - interval '40 days');
insert into auth.users (id, email) values (pg_temp.fx('new'), 'new-14202@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at) values
  (pg_temp.fx('new'), pg_temp.fx('org'), 'Hours new 142', 'new-14202@example.com', 'staff', 'active', 'permanent', now());
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), app.today_ist() + 3, 'Hours holiday 142');
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_at, half) values
  (pg_temp.fx('staff'), 'leave', app.today_ist() + 5, app.today_ist() + 7, 'approved', 'form', now(), null),
  (pg_temp.fx('admin'), 'half_day', app.today_ist() + 10, app.today_ist() + 10, 'approved', 'form', now(), 'morning'),
  (pg_temp.fx('staff'), 'half_day', app.today_ist() + 11, app.today_ist() + 11, 'approved', 'form', now(), 'afternoon');
insert into public.attendance_days (member_id, work_date, state, stay_until) values
  (pg_temp.fx('staff'), app.today_ist(), 'awaiting_choice', app.ist_day_start(app.today_ist()) + interval '21 hours');
with t as (
  insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id,
                            event_date, event_start_at, event_end_at)
  values (pg_temp.fx('org'), 'Hours shoot 142', pg_temp.fx('type'), 'medium', now() + interval '5 days', 'todo',
          pg_temp.fx('owner'), pg_temp.fx('staff'), app.today_ist() + 2,
          app.ist_day_start(app.today_ist() + 2) + interval '18 hours', app.ist_day_start(app.today_ist() + 2) + interval '23 hours')
  returning id)
insert into public.task_assignees (task_id, member_id, is_primary) select id, pg_temp.fx('staff'), true from t;

create temporary table days as select app.today_ist() + n as d from generate_series(-20, 29) n;
create function pg_temp.mismatches() returns bigint language sql as $$
  select count(*) from public.members m cross join days x
  where (select to_jsonb(a) from app.attendance_hours(m.id, x.d) a) is distinct from
        (select to_jsonb(b) from pg_temp.ref_attendance_hours(m.id, x.d) b);
$$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
end;
$$;
create function pg_temp.today_equal() returns boolean language sql as $$
  select coalesce((select jsonb_agg(to_jsonb(a) order by o) from public.attendance_hours_today() with ordinality a(member_id, full_name,
                     rules_on, started_at, ended_at, late_minutes, late_reason, end_at, end_source, stay_until, early_leave_id,
                     early_leave_state, early_leave_reason, early_leave_requested_at, left_early, ended_after_end, o)), '[]'::jsonb)
       = coalesce((select jsonb_agg(to_jsonb(b) order by o) from pg_temp.ref_attendance_hours_today() with ordinality b(member_id, full_name,
                     rules_on, started_at, ended_at, late_minutes, late_reason, end_at, end_source, stay_until, early_leave_id,
                     early_leave_state, early_leave_reason, early_leave_requested_at, left_early, ended_after_end, o)), '[]'::jsonb);
$$;

-- 1. Working hours off (as the seed has them) -------------------------------------------------------
update public.org_settings set working_hours_on = false where org_id = pg_temp.fx('org');
select is(pg_temp.mismatches(), 0::bigint, 'working hours off: attendance_hours equals its old body for every member over 50 days');
select pg_temp.as_member('owner');
select ok(pg_temp.today_equal(), 'working hours off: attendance_hours_today equals its old body (the Owner)');
select set_config('request.jwt.claim.sub', '', true);

-- 2. Working hours on ------------------------------------------------------------------------------
update public.org_settings set working_hours_on = true where org_id = pg_temp.fx('org');
select is(pg_temp.mismatches(), 0::bigint, 'working hours on: attendance_hours equals its old body for every member over 50 days');
select pg_temp.as_member('owner');
select ok(pg_temp.today_equal(), 'working hours on: attendance_hours_today equals its old body (the Owner)');
select ok((select count(*) from public.attendance_hours_today()) > 0, '... and it lists the members (not vacuous)');
select set_config('request.jwt.claim.sub', '', true);

-- 3. Not vacuous: each fixture changes the answer, by the reference -----------------------------------
select ok((select rules_on and not late_applies and not early_applies
           from pg_temp.ref_attendance_hours(pg_temp.fx('staff'), app.today_ist() + 3)),
  'the holiday: no rules that day (neither Late nor leaving early)');
select ok((select not late_applies and not early_applies from pg_temp.ref_attendance_hours(pg_temp.fx('staff'), app.today_ist() + 6)),
  'full leave: neither rule');
select is((select half from pg_temp.ref_attendance_hours(pg_temp.fx('admin'), app.today_ist() + 10)), 'morning', 'the morning half day');
select is((select end_source from pg_temp.ref_attendance_hours(pg_temp.fx('staff'), app.today_ist() + 2)), 'shoot', 'the shoot moves the end');
select is((select end_source from pg_temp.ref_attendance_hours(pg_temp.fx('staff'), app.today_ist())), 'stay', 'the Stay until moves the end');

-- 4. Another organisation (the advisor, #89): never its members, and the caller's org's settings -----
select pg_temp.as_member('owner');
select set_config('request.jwt.claim.sub', '', true);
insert into public.organizations (id, name) values ('00000000-0000-4000-8000-000000014210', 'Other org 142');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000014211', 'other-14211@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at) values
  ('00000000-0000-4000-8000-000000014211', '00000000-0000-4000-8000-000000014210', 'Other org member 142', 'other-14211@example.com',
   'staff', 'active', 'permanent', now() - interval '40 days');
select ok(exists (select 1 from public.org_settings where org_id = '00000000-0000-4000-8000-000000014210'),
  'org B has its own settings row (the updates below change a real row)');
-- Opposite settings: org A off, org B on.
update public.org_settings set working_hours_on = false where org_id = pg_temp.fx('org');
update public.org_settings set working_hours_on = true where org_id = '00000000-0000-4000-8000-000000014210';
select pg_temp.as_member('owner');
select is((select count(*) from public.attendance_hours_today() h where h.member_id = '00000000-0000-4000-8000-000000014211'),
  0::bigint, 'org A''s Owner never sees an org B member');
select ok((select bool_and(not h.rules_on) from public.attendance_hours_today() h) and pg_temp.today_equal(),
  'org A off, org B on: every row reads org A''s settings (no rules), and equals the old body');
select set_config('request.jwt.claim.sub', '', true);
-- Swapped: org A on, org B off.
update public.org_settings set working_hours_on = true where org_id = pg_temp.fx('org');
update public.org_settings set working_hours_on = false where org_id = '00000000-0000-4000-8000-000000014210';
select pg_temp.as_member('owner');
select ok((select bool_and(h.rules_on) from public.attendance_hours_today() h) and pg_temp.today_equal(),
  'org A on, org B off: every row reads org A''s settings (rules on), and equals the old body');
select is((select count(*) from public.attendance_hours_today() h where h.member_id = '00000000-0000-4000-8000-000000014211'),
  0::bigint, '... and still no org B member');
select set_config('request.jwt.claim.sub', '', true);
select is(pg_temp.mismatches(), 0::bigint,
  'with org B and its own settings: attendance_hours equals its old body for every member of both');

-- 5. Who may call the new helper -----------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'app.attendance_hours_on(uuid, date, public.org_settings, boolean)', 'execute')
          and not has_function_privilege('anon', 'app.attendance_hours_on(uuid, date, public.org_settings, boolean)', 'execute')
          and has_function_privilege('service_role', 'app.attendance_hours_on(uuid, date, public.org_settings, boolean)', 'execute'),
  'attendance_hours_on is internal: service_role only (never anon or authenticated), as attendance_hours');
select is((select proacl::text from pg_proc where oid = 'app.attendance_hours_on(uuid, date, public.org_settings, boolean)'::regprocedure),
  '{postgres=X/postgres,service_role=X/postgres}', 'attendance_hours_on: exactly that grant');
select is((select proacl::text from pg_proc where oid = 'app.attendance_hours(uuid,date)'::regprocedure),
  '{postgres=X/postgres,service_role=X/postgres}', 'attendance_hours keeps its grants');

select * from finish();
rollback;
