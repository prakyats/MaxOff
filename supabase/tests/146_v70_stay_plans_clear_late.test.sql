-- v7.0 (migration v70_stay_plans_clear_late): "Stay until" ahead of time (owner 12 Nov; Q1-Q4 25 Nov) and
-- Clear Late (owner Q2, 14 Nov). For each role, allowed and denied: the Owner sets, changes and clears a
-- plan, it is applied when the day starts, refused on a leave day; Admins and Crew may not set or clear
-- one, and read only their own; a Late start's offline note is the person's own, once, before the start;
-- only the Owner clears a Late (and undoes it), a correction beside the original; the month's Late count
-- leaves a cleared one out. On fixed instants through app.now()'s test clock; everything rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'staff2', m.id from public.members m
  where m.role = 'staff' and m.status = 'active' and m.engagement = 'permanent'
    and m.id <> '10000000-0000-4000-8000-000000000003' order by m.id limit 1;
grant select, insert on fx to authenticated, anon;

create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.ist(t text) returns timestamptz language sql immutable as $$
  select (t::timestamp at time zone 'Asia/Kolkata');
$$;
create function pg_temp.at(t text) returns void language sql as $$
  select set_config('app.test_now', pg_temp.ist(t)::text, true);
$$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
grant execute on function pg_temp.at(text) to authenticated;
grant execute on function pg_temp.ist(text) to authenticated;

-- A clean slate on the test days (Tue 1 and Wed 2 Dec 2026), working hours on (10:00-18:00, grace 15).
update public.org_settings set working_hours_on = true, work_start_time = '10:00', work_end_time = '18:00',
  late_grace_minutes = 15 where org_id = pg_temp.fx('org');
delete from public.attendance_days where work_date in ('2026-12-01', '2026-12-02')
  and member_id in (pg_temp.fx('staff'), pg_temp.fx('staff2'), pg_temp.fx('admin'));
delete from public.holidays where date in ('2026-12-01', '2026-12-02');

-- A. Stay until ahead of time -------------------------------------------------------------------------
select pg_temp.at('2026-12-01 08:00');
select pg_temp.as_member('owner');
insert into fx values ('plan', public.attendance_stay_plan_set(pg_temp.fx('staff'), '2026-12-02', pg_temp.ist('2026-12-02 20:00')));
select ok(pg_temp.fx('plan') is not null, 'the Owner sets a Stay until for tomorrow');
select throws_ok($$ select public.attendance_stay_plan_set(pg_temp.fx('staff'), '2026-11-30', pg_temp.ist('2026-11-30 20:00')) $$,
  'P0001', 'VALIDATION', 'never for a day already past');
select throws_ok($$ select public.attendance_stay_plan_set(pg_temp.fx('staff'), '2026-12-02', pg_temp.ist('2026-12-02 17:00')) $$,
  'P0001', 'VALIDATION', 'only after the end time');
select throws_ok($$ select public.attendance_stay_plan_set(pg_temp.fx('staff'), '2026-12-02', pg_temp.ist('2026-12-03 19:00')) $$,
  'P0001', 'VALIDATION', 'on that day');
-- A change replaces the live plan; the first is kept, cleared.
insert into fx values ('plan2', public.attendance_stay_plan_set(pg_temp.fx('staff'), '2026-12-02', pg_temp.ist('2026-12-02 20:30')));
select pg_temp.as_system();
select is((select count(*)::int from public.attendance_stay_plans where member_id = pg_temp.fx('staff') and work_date = '2026-12-02'), 2,
  'a change keeps the first plan');
select ok((select cleared_at is not null from public.attendance_stay_plans where id = pg_temp.fx('plan')), 'and clears it');
select is((select count(*)::int from public.notifications where entity_id in (pg_temp.fx('plan'), pg_temp.fx('plan2'))
             and recipient_id = pg_temp.fx('staff') and kind = 'stay_until_set'), 2, 'the person is told each time');

-- Denied: Admins and Crew neither set nor clear; each reads only their own; anon nothing.
select pg_temp.as_member('admin');
select throws_ok($$ select public.attendance_stay_plan_set(pg_temp.fx('staff'), '2026-12-02', pg_temp.ist('2026-12-02 20:00')) $$,
  'P0001', 'FORBIDDEN', 'an Admin may not set one');
select throws_ok($$ select public.attendance_stay_plan_clear(pg_temp.fx('plan2')) $$, 'P0001', 'FORBIDDEN', 'nor clear one');
select is((select count(*)::int from public.attendance_stay_plans), 0, 'an Admin reads none of another''s');
select pg_temp.as_member('staff');
select throws_ok($$ select public.attendance_stay_plan_set(pg_temp.fx('staff'), '2026-12-02', pg_temp.ist('2026-12-02 21:00')) $$,
  'P0001', 'FORBIDDEN', 'Crew may not set their own');
select is((select count(*)::int from public.attendance_stay_plans where member_id = pg_temp.fx('staff')), 2, 'Crew read their own');
select throws_ok($$ insert into public.attendance_stay_plans (org_id, member_id, work_date, until, set_by)
  values (pg_temp.fx('org'), pg_temp.fx('staff'), '2026-12-03', now(), pg_temp.fx('staff')) $$, '42501', null, 'and write none');
select pg_temp.as_member('staff2');
select is((select count(*)::int from public.attendance_stay_plans where member_id = pg_temp.fx('staff')), 0, 'another Crew member reads none');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select * from public.attendance_stay_plans $$, '42501', null, 'anon reads nothing');
reset role;

-- Applied when the day starts (Wed 2 Dec, 9:55): the day's Stay until is the plan's.
select pg_temp.at('2026-12-02 09:55');
select pg_temp.as_member('staff');
select public.attendance_start_day();
select pg_temp.as_system();
select is((select stay_until from public.attendance_days where member_id = pg_temp.fx('staff') and work_date = '2026-12-02'),
  pg_temp.ist('2026-12-02 20:30'), 'the plan is the day''s Stay until once it starts');
select is((select applied_day_id from public.attendance_stay_plans where id = pg_temp.fx('plan2')),
  (select id from public.attendance_days where member_id = pg_temp.fx('staff') and work_date = '2026-12-02'), 'and is marked applied');

-- Back to 6:00 pm before it applies; a leave day refuses one.
select pg_temp.as_member('owner');
insert into fx values ('plan3', public.attendance_stay_plan_set(pg_temp.fx('staff2'), '2026-12-03', pg_temp.ist('2026-12-03 19:00')));
select lives_ok($$ select public.attendance_stay_plan_clear(pg_temp.fx('plan3')) $$, 'the Owner clears a waiting plan');
select throws_ok($$ select public.attendance_stay_plan_clear(pg_temp.fx('plan2')) $$, 'P0001', 'INVALID_STATE', 'an applied one is changed from Today');
select pg_temp.as_system();
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at)
  values (pg_temp.fx('staff2'), 'leave', '2026-12-04', '2026-12-04', 'approved', 'owner', pg_temp.fx('owner'), now());
select pg_temp.as_member('owner');
select throws_ok($$ select public.attendance_stay_plan_set(pg_temp.fx('staff2'), '2026-12-04', pg_temp.ist('2026-12-04 19:00')) $$,
  'P0001', 'INVALID_STATE', 'refused on an approved leave day');

-- B. Clear Late --------------------------------------------------------------------------------------
-- staff2 starts Tue 1 Dec at 10:40: Late 40 min; the phone first tried at 9:58.
select pg_temp.as_system();
select pg_temp.at('2026-12-01 10:40');
select pg_temp.as_member('staff2');
select public.attendance_start_day();
select throws_ok($$ select public.attendance_note_offline_try(pg_temp.ist('2026-12-01 10:45')) $$,
  'P0001', 'VALIDATION', 'a try after the start is refused');
select lives_ok($$ select public.attendance_note_offline_try(pg_temp.ist('2026-12-01 09:58')) $$, 'the person notes the try');
select public.attendance_note_offline_try(pg_temp.ist('2026-12-01 09:30'));
select pg_temp.as_system();
insert into fx select 'day', id from public.attendance_days where member_id = pg_temp.fx('staff2') and work_date = '2026-12-01';
select is((select offline_tried_at from public.attendance_days where id = pg_temp.fx('day')), pg_temp.ist('2026-12-01 09:58'),
  'only the first note counts');

select pg_temp.as_member('admin');
select throws_ok($$ select public.attendance_clear_late(pg_temp.fx('day')) $$, 'P0001', 'FORBIDDEN', 'an Admin may not clear a Late');
select pg_temp.as_member('staff2');
select throws_ok($$ select public.attendance_clear_late(pg_temp.fx('day')) $$, 'P0001', 'FORBIDDEN', 'nor the person');
select pg_temp.as_member('owner');
select lives_ok($$ select public.attendance_clear_late(pg_temp.fx('day')) $$, 'the Owner clears it in one call');
select pg_temp.as_system();
select is((select row(late_minutes is not null, late_clear_reason)::text from public.attendance_days where id = pg_temp.fx('day')),
  row(true, 'No network at the start; tried 9:58 am by the phone''s clock.')::text,
  'the Late minutes stay, with the reason written beside them');
select pg_temp.as_member('owner');
select is((select late_days from public.month_summary_hours('2026-12-01', pg_temp.fx('staff2'))), 0,
  'a cleared Late leaves the month''s Late days');
select public.attendance_clear_late(pg_temp.fx('day'), true);
select pg_temp.as_system();
select is((select array_agg(action order by at, id) from public.attendance_events where attendance_day_id = pg_temp.fx('day')
             and action like 'late_%'), array['late_cleared', 'late_clear_undone'], 'Undo is another event, history kept');

select * from finish();
rollback;
