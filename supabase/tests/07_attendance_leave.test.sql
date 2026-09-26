-- 2.1 Attendance and leave: the three tables for every role, and every transition function on
-- every path (touch, submit, decide, logout, overtime, leave submit / withdraw / change / decide /
-- Owner edit / Owner cancel), with the audit and history rows each one writes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(261);

-- The local seed holds an organization (with its org_settings and job titles) and five sign-ins.
-- Keep the organization; replace the people with fixtures. Rolled back at the end.
-- Children first (attendance_days → members), activity_log before members (actor_id).
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log; -- again: the member deletes were audited

-- Today is a working day whatever the calendar says (this file went red on its first IST
-- Sunday, 2026-09-27): the weekly day off is tomorrow's weekday and no holiday falls today.
-- The day-off tests below set what they need and restore this.
update public.org_settings
set weekly_off_days = array[((extract(dow from app.today_ist())::integer + 1) % 7)::smallint];
delete from public.holidays where date = app.today_ist();

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',       '00000000-0000-4000-8000-000000000001'),
  ('admin',       '00000000-0000-4000-8000-000000000002'),
  ('staff',       '00000000-0000-4000-8000-000000000003'),
  ('deactivated', '00000000-0000-4000-8000-000000000004'),
  ('invited',     '00000000-0000-4000-8000-000000000005'),
  ('staff2',      '00000000-0000-4000-8000-000000000006'),
  ('worker',      '00000000-0000-4000-8000-000000000007'),
  ('nobody',      '00000000-0000-4000-8000-000000000009');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon, service_role;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;

create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
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

-- Today's day of a fixture member.
create function pg_temp.day(k text, offset_days integer default 0) returns uuid language sql stable as $$
  select d.id from public.attendance_days d
  where d.member_id = pg_temp.fx(k) and d.work_date = app.today_ist() + offset_days;
$$;

-- Fixture rows written as the owner (in_transition() is true, so the guards pass).
create function pg_temp.mk_day(
  k text, offset_days integer, st public.attendance_state, ch public.attendance_choice,
  fs public.day_status, proposed boolean, req uuid default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.attendance_days (
    member_id, work_date, first_login_at, state, submitted_choice, submitted_at, proposed_by_system,
    final_status, decided_at, decided_by, leave_request_id)
  values (
    pg_temp.fx(k), app.today_ist() + offset_days, now(), st, ch,
    case when ch is not null then now() end, proposed, fs,
    case when st in ('approved', 'corrected') then now() end,
    case when st in ('approved', 'corrected') and not proposed then pg_temp.fx('owner') end, req)
  returning id into v;
  return v;
end;
$$;

create function pg_temp.mk_leave(
  k text, t public.leave_type, from_offset integer, to_offset integer, st public.leave_state,
  src text default 'form', supersedes uuid default null, cancel boolean default false)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.leave_requests (
    member_id, type, start_date, end_date, state, source, supersedes_id, requests_cancellation,
    decided_by, decided_at)
  values (
    pg_temp.fx(k), t, app.today_ist() + from_offset, app.today_ist() + to_offset, st, src, supersedes, cancel,
    case when st in ('approved', 'rejected', 'cancelled') then pg_temp.fx('owner') end,
    case when st in ('approved', 'rejected', 'cancelled') then now() end)
  returning id into v;
  return v;
end;
$$;

create function pg_temp.reset_attendance() returns void language sql as $$
  delete from public.attendance_events;
  delete from public.attendance_days;
  delete from public.leave_requests;
  delete from public.activity_log where entity in ('attendance_days', 'leave_requests');
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org', 'nobody');

insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),       pg_temp.fx('org'), 'Test Owner',  'owner@example.com',       'owner', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('admin'),       pg_temp.fx('org'), 'Test Admin',  'admin@example.com',       'admin', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('staff'),       pg_temp.fx('org'), 'Test Staff',  'staff@example.com',       'staff', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('staff2'),      pg_temp.fx('org'), 'Other Staff', 'staff2@example.com',      'staff', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('worker'),      pg_temp.fx('org'), 'Works Leave', 'worker@example.com',      'staff', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('deactivated'), pg_temp.fx('org'), 'Gone Staff',  'deactivated@example.com', 'staff', 'deactivated', now(), now()),
  (pg_temp.fx('invited'),     pg_temp.fx('org'), 'New Admin',   'invited@example.com',     'admin', 'invited',     null,  null);
delete from public.activity_log; -- the fixture writes are not under test

-- Structure and grants ---------------------------------------------------------------------------
select has_table('public', 'attendance_days', 'attendance_days exists');
select has_table('public', 'attendance_events', 'attendance_events exists');
select has_table('public', 'leave_requests', 'leave_requests exists');
select has_type('public', 'attendance_choice', 'attendance_choice enum exists');
select has_type('public', 'day_status', 'day_status enum exists');
select has_type('public', 'attendance_state', 'attendance_state enum exists');
select has_type('public', 'leave_type', 'leave_type enum exists');
select has_type('public', 'leave_state', 'leave_state enum exists');
select has_column('public', 'leave_requests', 'requests_cancellation', 'leave_requests.requests_cancellation exists');
select has_function('public', 'attendance_touch', array['text', 'text'], 'attendance_touch exists');
select has_function('public', 'attendance_submit', array['attendance_choice', 'text', 'date'], 'attendance_submit exists');
select has_function('public', 'attendance_decide', array['uuid', 'text', 'day_status', 'text'], 'attendance_decide exists');
select has_function('public', 'attendance_flag_overtime', array['uuid', 'text'], 'attendance_flag_overtime exists');
select has_function('app', 'attendance_logout', array['uuid'], 'app.attendance_logout exists');
select has_function('public', 'leave_submit', array['leave_type', 'date', 'date', 'text'], 'leave_submit exists');
select has_function('public', 'leave_withdraw', array['uuid'], 'leave_withdraw exists');
select has_function('public', 'leave_request_change', array['uuid', 'leave_type', 'date', 'date', 'text', 'boolean'], 'leave_request_change exists');
select has_function('public', 'leave_decide', array['uuid', 'text', 'text'], 'leave_decide exists');
select has_function('public', 'leave_owner_edit', array['uuid', 'leave_type', 'date', 'date', 'text'], 'leave_owner_edit exists');
select has_function('public', 'leave_owner_cancel', array['uuid', 'text'], 'leave_owner_cancel exists');

select ok(not has_table_privilege('anon', 'public.attendance_days', 'select'), 'anon has nothing on attendance_days');
select ok(not has_table_privilege('anon', 'public.attendance_events', 'select'), 'anon has nothing on attendance_events');
select ok(not has_table_privilege('anon', 'public.leave_requests', 'select'), 'anon has nothing on leave_requests');
select ok(has_table_privilege('authenticated', 'public.attendance_days', 'select'), 'authenticated may select attendance_days');
select ok(not has_table_privilege('authenticated', 'public.attendance_days', 'insert, update, delete, truncate, references, trigger'),
  'authenticated cannot write attendance_days at all');
select ok(not has_table_privilege('authenticated', 'public.attendance_events', 'insert, update, delete, truncate, references, trigger'),
  'authenticated cannot write attendance_events at all');
select ok(not has_table_privilege('authenticated', 'public.leave_requests', 'insert, update, delete, truncate, references, trigger'),
  'authenticated cannot write leave_requests at all');

select ok(
  has_function_privilege('authenticated', 'public.attendance_touch(text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.attendance_submit(public.attendance_choice, text, date)', 'execute')
  and has_function_privilege('authenticated', 'public.attendance_decide(uuid, text, public.day_status, text)', 'execute')
  and has_function_privilege('authenticated', 'public.attendance_flag_overtime(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.leave_submit(public.leave_type, date, date, text)', 'execute')
  and has_function_privilege('authenticated', 'public.leave_withdraw(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.leave_request_change(uuid, public.leave_type, date, date, text, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.leave_decide(uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.leave_owner_edit(uuid, public.leave_type, date, date, text)', 'execute')
  and has_function_privilege('authenticated', 'public.leave_owner_cancel(uuid, text)', 'execute'),
  'authenticated may execute every attendance and leave function');
select ok(
  not has_function_privilege('anon', 'public.attendance_touch(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.attendance_submit(public.attendance_choice, text, date)', 'execute')
  and not has_function_privilege('anon', 'public.attendance_decide(uuid, text, public.day_status, text)', 'execute')
  and not has_function_privilege('anon', 'public.attendance_flag_overtime(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.leave_submit(public.leave_type, date, date, text)', 'execute')
  and not has_function_privilege('anon', 'public.leave_withdraw(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.leave_request_change(uuid, public.leave_type, date, date, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.leave_decide(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.leave_owner_edit(uuid, public.leave_type, date, date, text)', 'execute')
  and not has_function_privilege('anon', 'public.leave_owner_cancel(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'app.attendance_logout(uuid)', 'execute')
  and not has_function_privilege('anon', 'app.attendance_apply_leave(public.leave_requests)', 'execute')
  and not has_function_privilege('anon', 'app.attendance_release_leave(public.leave_requests, date, date)', 'execute'),
  'anon may execute none of them');
select ok(
  not has_function_privilege('authenticated', 'app.attendance_logout(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.attendance_event(uuid, text, public.day_status, public.day_status, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.attendance_apply_leave(public.leave_requests)', 'execute')
  and not has_function_privilege('authenticated', 'app.attendance_release_leave(public.leave_requests, date, date)', 'execute')
  and not has_function_privilege('authenticated', 'app.leave_covering(uuid, date)', 'execute')
  and not has_function_privilege('authenticated', 'app.leave_overlaps(uuid, date, date, uuid)', 'execute'),
  'the internal helpers are closed to the API role (only security definer functions call them)');
select pg_temp.as_member('staff');
select throws_ok($$ select app.attendance_logout(pg_temp.fx('staff2')) $$, '42501', null,
  'a member cannot stamp someone else''s logout through the helper');
select pg_temp.as_system();

select is(app.ist_day_start(date '2026-09-23'), timestamptz '2026-09-22 18:30:00+00', 'ist_day_start is midnight IST as an instant');

-- RLS: who reads what ----------------------------------------------------------------------------
select pg_temp.as_system();
select pg_temp.mk_day('staff', 0, 'awaiting_choice', null, null, false);
select pg_temp.mk_day('staff2', 0, 'awaiting_choice', null, null, false);
select pg_temp.mk_leave('staff', 'leave', 3, 4, 'submitted');
select pg_temp.mk_leave('staff2', 'leave', 3, 4, 'submitted');
insert into public.attendance_events (attendance_day_id, action, actor_id) values
  (pg_temp.day('staff'), 'logout', pg_temp.fx('staff')),
  (pg_temp.day('staff2'), 'logout', pg_temp.fx('staff2'));

select pg_temp.as_member('staff');
select is((select count(*) from public.attendance_days), 1::bigint, 'Staff read only their own days');
select is((select member_id from public.attendance_days), pg_temp.fx('staff'), 'and it is theirs');
select is((select count(*) from public.attendance_events), 1::bigint, 'Staff read only the events of their own days');
select is((select count(*) from public.leave_requests), 1::bigint, 'Staff read only their own leave requests');
select throws_ok($$ insert into public.attendance_days (member_id, work_date) values (pg_temp.fx('staff'), app.today_ist() + 1) $$,
  '42501', null, 'Staff cannot insert a day directly');
select throws_ok($$ update public.attendance_days set overtime_flag = true $$, '42501', null, 'Staff cannot update a day directly');
select throws_ok($$ insert into public.leave_requests (member_id, type, start_date, end_date, source) values (pg_temp.fx('staff'), 'leave', app.today_ist(), app.today_ist(), 'form') $$,
  '42501', null, 'Staff cannot insert a leave request directly');
select throws_ok($$ insert into public.attendance_events (attendance_day_id, action) values (pg_temp.day('staff'), 'logout') $$,
  '42501', null, 'Staff cannot write history directly');

select pg_temp.as_member('admin');
select is((select count(*) from public.attendance_days), 0::bigint, 'an Admin reads only their own days: none here');
select is((select count(*) from public.leave_requests), 0::bigint, 'an Admin reads only their own leave requests');

select pg_temp.as_member('owner');
select is((select count(*) from public.attendance_days), 2::bigint, 'the Owner reads every day (attendance.view_all)');
select is((select count(*) from public.attendance_events), 2::bigint, 'the Owner reads every event');
select is((select count(*) from public.leave_requests), 2::bigint, 'the Owner reads every leave request');
select throws_ok($$ update public.attendance_days set state = 'approved' where id = pg_temp.day('staff') $$,
  '42501', null, 'even the Owner cannot set a state directly (no column grant at all)');
select throws_ok($$ delete from public.leave_requests $$, '42501', null, 'even the Owner cannot delete a leave request');

select pg_temp.as_member('deactivated');
select is((select count(*) from public.attendance_days), 0::bigint, 'a deactivated member reads nothing');
select pg_temp.as_member('invited');
select is((select count(*) from public.leave_requests), 0::bigint, 'an invited member reads nothing');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select count(*) from public.attendance_days $$, '42501', null, 'anon cannot read attendance_days');
select pg_temp.as_system();

-- protect_columns holds even where a grant would exist (belt and braces).
select pg_temp.as_system();
select pg_temp.reset_attendance();

-- attendance_touch -------------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select * from public.attendance_touch() $$, '42501', null, 'anon cannot call attendance_touch');
select pg_temp.as_system();
select pg_temp.as_member('deactivated');
select throws_ok($$ select * from public.attendance_touch() $$, 'P0001', 'UNAUTHENTICATED', 'a deactivated member is refused');
select pg_temp.as_member('invited');
select throws_ok($$ select * from public.attendance_touch() $$, 'P0001', 'UNAUTHENTICATED', 'an invited member is refused');

select pg_temp.as_member('owner');
select results_eq(
  $$ select day_id, gate_required, state::text from public.attendance_touch('ua', null) $$,
  $$ values (null::uuid, false, null::text) $$,
  'the Owner gets no day and no gate');
select pg_temp.as_system();
select is((select count(*) from public.attendance_days where member_id = pg_temp.fx('owner')), 0::bigint,
  'no attendance day is ever created for the Owner');
select is((select count(*) from public.session_events where member_id = pg_temp.fx('owner') and kind = 'login'), 1::bigint,
  'the Owner''s touch recorded the missing login of the day');
select pg_temp.as_member('owner');
select lives_ok($$ select * from public.attendance_touch() $$, 'a second touch is fine');
select pg_temp.as_system();
select is((select count(*) from public.session_events where member_id = pg_temp.fx('owner') and kind = 'login'), 1::bigint,
  'and adds no second login');

select pg_temp.as_member('staff');
select results_eq(
  $$ select work_date, state::text, gate_required, is_day_off, final_status::text, proposed_by_system, leave_request_id
     from public.attendance_touch('Mozilla', 'abc') $$,
  $$ select app.today_ist(), 'awaiting_choice', true, false, null::text, false, null::uuid $$,
  'the first touch of a working day opens an awaiting_choice day and the gate asks');
select pg_temp.as_system();
select is((select count(*) from public.attendance_days where member_id = pg_temp.fx('staff')), 1::bigint, 'one day row');
select ok((select first_login_at is not null from public.attendance_days where id = pg_temp.day('staff')), 'first_login_at is stamped');
select is((select count(*) from public.session_events where member_id = pg_temp.fx('staff') and kind = 'login'), 1::bigint,
  'a login event was recorded because none existed today');
select is((select user_agent from public.session_events where member_id = pg_temp.fx('staff') and kind = 'login'), 'Mozilla',
  'with the user agent given');
select is(
  (select action from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day('staff') order by id limit 1),
  'opened', 'opening the day is audited as opened');

select pg_temp.as_member('staff');
select is((select day_id from public.attendance_touch()), pg_temp.day('staff'), 'a second touch returns the same day');
select pg_temp.as_system();
select is((select count(*) from public.attendance_days where member_id = pg_temp.fx('staff')), 1::bigint, 'and creates no second row');
select is((select count(*) from public.session_events where member_id = pg_temp.fx('staff') and kind = 'login'), 1::bigint,
  'and no second login');

-- A real sign-in already wrote the login: touch must not double it.
select pg_temp.as_member('admin');
select lives_ok($$ select public.session_login('ua', null) $$, 'the Admin signs in');
select lives_ok($$ select * from public.attendance_touch() $$, 'and touches');
select pg_temp.as_system();
select is((select count(*) from public.session_events where member_id = pg_temp.fx('admin') and kind = 'login'), 1::bigint,
  'touch after session_login adds no second login');

-- A day off: the gate still asks, and the row remembers it was a day off.
select pg_temp.as_system();
update public.org_settings set weekly_off_days = array[extract(dow from app.today_ist())::smallint];
select pg_temp.as_member('staff2');
select results_eq(
  $$ select gate_required, is_day_off from public.attendance_touch() $$,
  $$ values (true, true) $$,
  'on a weekly off day the gate still asks and is_day_off is true');
select pg_temp.as_system();
-- Back to the file's working-day pin (tomorrow's weekday off), never the seed's Sunday.
update public.org_settings
set weekly_off_days = array[((extract(dow from app.today_ist())::integer + 1) % 7)::smallint];
insert into public.holidays (org_id, date, name)
values (pg_temp.fx('org'), app.today_ist(), 'Fixture holiday')
on conflict (org_id, date) do nothing;
delete from public.attendance_events where attendance_day_id = pg_temp.day('staff2');
delete from public.attendance_days where id = pg_temp.day('staff2');
select pg_temp.as_member('staff2');
select is((select is_day_off from public.attendance_touch()), true, 'a holiday is a day off too');
select pg_temp.as_system();
delete from public.holidays where date = app.today_ist() and name = 'Fixture holiday';
select is((select is_day_off from public.attendance_days where id = pg_temp.day('staff2')), true,
  'deleting the holiday afterwards does not rewrite the day');

-- Approved leave covering today: the day is derived and there is no gate.
select pg_temp.as_system();
select pg_temp.mk_leave('worker', 'leave', -1, 1, 'approved');
select pg_temp.as_member('worker');
select results_eq(
  $$ select state::text, gate_required, final_status::text, proposed_by_system,
            leave_request_id = (select id from public.leave_requests where member_id = pg_temp.fx('worker'))
     from public.attendance_touch() $$,
  $$ values ('approved', false, 'leave', true, true) $$,
  'approved leave covering today derives an approved day with no gate');
select pg_temp.as_system();
select results_eq(
  $$ select action, from_status::text, to_status::text, actor_id from public.attendance_events
     where attendance_day_id = pg_temp.day('worker') $$,
  $$ values ('derived_from_leave', null::text, 'leave', null::uuid) $$,
  'with a derived_from_leave event by the system');
select is(
  (select action from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day('worker') order by id limit 1),
  'derived_from_leave', 'audited as derived_from_leave');
select ok((select first_login_at is not null from public.attendance_days where id = pg_temp.day('worker')),
  'the first login is still recorded on a leave day');
select pg_temp.as_system();
delete from public.attendance_events where attendance_day_id = pg_temp.day('worker');
delete from public.attendance_days where id = pg_temp.day('worker');
update public.leave_requests set type = 'half_day', start_date = app.today_ist(), end_date = app.today_ist()
  where member_id = pg_temp.fx('worker');
select pg_temp.as_member('worker');
select results_eq(
  $$ select state::text, gate_required, final_status::text from public.attendance_touch() $$,
  $$ values ('approved', false, 'half_day') $$,
  'an approved half day derives a half_day day with no gate');
select pg_temp.as_system();
update public.leave_requests set type = 'leave', start_date = app.today_ist() - 1, end_date = app.today_ist() + 1
  where member_id = pg_temp.fx('worker');

-- attendance_submit ------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.attendance_submit('present', null) $$, 'P0001', 'FORBIDDEN', 'the Owner does not mark attendance');
select pg_temp.as_member('deactivated');
select throws_ok($$ select public.attendance_submit('present', null) $$, 'P0001', 'UNAUTHENTICATED', 'a deactivated member cannot submit');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select public.attendance_submit('present', null) $$, '42501', null, 'anon cannot call attendance_submit');
select pg_temp.as_system();

select pg_temp.as_member('staff');
select throws_ok(format($$ select public.attendance_submit('present', %L) $$, repeat('x', 1001)),
  'P0001', 'VALIDATION', 'a reason over 1000 characters is refused');
select is(public.attendance_submit('present', '  '), 'pending_review', 'Staff submit Present');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, submitted_choice::text, submitted_at is not null, final_status::text, leave_request_id
     from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values ('pending_review', 'present', true, null::text, null::uuid) $$,
  'the day is pending review with the choice and no leave request');
select results_eq(
  $$ select action, from_status::text, to_status::text, reason, actor_id from public.attendance_events
     where attendance_day_id = pg_temp.day('staff') order by id $$,
  $$ values ('submitted', null::text, 'present', null::text, pg_temp.fx('staff')) $$,
  'with a submitted event by the member and a blank reason stored as null');
select results_eq(
  $$ select action, actor_id, meta from public.activity_log
     where entity = 'attendance_days' and entity_id = pg_temp.day('staff') order by id desc limit 1 $$,
  $$ select 'submitted', pg_temp.fx('staff'), '{"choice": "present", "reason": null}'::jsonb $$,
  'audited as submitted with the choice');
select pg_temp.as_member('staff');
select throws_ok($$ select public.attendance_submit('present', null) $$, 'P0001', 'INVALID_STATE', 'submitting twice is refused');
select pg_temp.as_system();
select pg_temp.mk_day('staff', -3, 'corrected', 'present', 'absent', false);
select pg_temp.as_member('staff');
select throws_ok($$ select public.attendance_submit('present', null) $$, 'P0001', 'INVALID_STATE',
  'a corrected day cannot be re-submitted either (and submit is today only)');
select pg_temp.as_system();
delete from public.attendance_days where id = pg_temp.day('staff', -3);

select pg_temp.as_member('staff2');
select is(public.attendance_submit('leave', 'Fever'), 'pending_review', 'Staff submit Leave with a reason');
select pg_temp.as_system();
select results_eq(
  $$ select r.type::text, r.start_date, r.end_date, r.reason, r.state::text, r.source
     from public.attendance_days d join public.leave_requests r on r.id = d.leave_request_id
     where d.id = pg_temp.day('staff2') $$,
  $$ select 'leave', app.today_ist(), app.today_ist(), 'Fever', 'submitted', 'attendance' $$,
  'a leave choice creates a linked leave request for today, source attendance');
select is(
  (select action from public.activity_log where entity = 'leave_requests'
     and entity_id = (select leave_request_id from public.attendance_days where id = pg_temp.day('staff2'))),
  'submitted', 'the request is audited as submitted');

select pg_temp.as_member('admin');
select is(public.attendance_submit('half_day', null), 'pending_review', 'an Admin submits a half day');
select pg_temp.as_system();
select is(
  (select r.type::text from public.attendance_days d join public.leave_requests r on r.id = d.leave_request_id
     where d.id = pg_temp.day('admin')),
  'half_day', 'as a half_day request');

-- A member with no day for today (never touched) cannot submit.
select pg_temp.as_system();
delete from public.attendance_events where attendance_day_id = pg_temp.day('worker');
delete from public.attendance_days where id = pg_temp.day('worker');
select pg_temp.as_member('worker');
select throws_ok($$ select public.attendance_submit('present', null) $$, 'P0001', 'NOT_FOUND', 'no day today means nothing to submit');

-- attendance_decide ------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select throws_ok($$ select public.attendance_decide(pg_temp.day('staff'), 'approve') $$, 'P0001', 'FORBIDDEN', 'an Admin cannot decide attendance');
select pg_temp.as_member('staff');
select throws_ok($$ select public.attendance_decide(pg_temp.day('staff'), 'approve') $$, 'P0001', 'FORBIDDEN', 'Staff cannot decide their own day');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select public.attendance_decide(pg_temp.day('staff'), 'approve') $$, '42501', null, 'anon cannot call attendance_decide');
select pg_temp.as_system();

select pg_temp.as_member('owner');
select throws_ok($$ select public.attendance_decide(pg_temp.day('staff'), 'maybe') $$, 'P0001', 'VALIDATION', 'the decision must be approve or correct');
select throws_ok($$ select public.attendance_decide(pg_temp.fx('nobody'), 'approve') $$, 'P0001', 'NOT_FOUND', 'an unknown day is NOT_FOUND');
select is(public.attendance_decide(pg_temp.day('staff'), 'approve'), 'approved', 'the Owner approves a submitted Present');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, final_status::text, decided_by, decided_at is not null, decision_reason, worked_on_leave
     from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ select 'approved', 'present', pg_temp.fx('owner'), true, null::text, false $$,
  'the day is approved as present by the Owner');
select is(
  (select count(*) from public.attendance_events where attendance_day_id = pg_temp.day('staff') and action = 'approved'
     and from_status is null and to_status = 'present' and actor_id = pg_temp.fx('owner')),
  1::bigint, 'with an approved event by the Owner');
select is(
  (select meta from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day('staff') order by id desc limit 1),
  '{"reason": null, "status": "present", "worked_on_leave": false}'::jsonb, 'audited as approved with the status');
select pg_temp.as_member('owner');
select throws_ok($$ select public.attendance_decide(pg_temp.day('staff'), 'approve') $$, 'P0001', 'INVALID_STATE', 'approving twice is refused');

-- Approving a Leave choice approves the gate's request with it.
select is(public.attendance_decide(pg_temp.day('staff2'), 'approve', null, 'ok'), 'approved', 'the Owner approves a Leave choice');
select pg_temp.as_system();
select results_eq(
  $$ select d.final_status::text, r.state::text, r.decided_by, r.decision_reason
     from public.attendance_days d join public.leave_requests r on r.id = d.leave_request_id where d.id = pg_temp.day('staff2') $$,
  $$ select 'leave', 'approved', pg_temp.fx('owner'), 'ok' $$,
  'the day is leave and the linked request is approved in the same call');

-- Correcting a Half-day choice to Present rejects the gate's request with the same reason.
select pg_temp.as_member('owner');
select throws_ok($$ select public.attendance_decide(pg_temp.day('admin'), 'correct', 'present', null) $$,
  'P0001', 'REASON_REQUIRED', 'a correction without a reason is refused');
select throws_ok($$ select public.attendance_decide(pg_temp.day('admin'), 'correct', null, 'You were here') $$,
  'P0001', 'VALIDATION', 'a correction without a status is refused');
select is(public.attendance_decide(pg_temp.day('admin'), 'correct', 'present', 'You were here'), 'corrected', 'the Owner corrects a half day to present');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, final_status::text, decision_reason, leave_request_id, proposed_by_system
     from public.attendance_days where id = pg_temp.day('admin') $$,
  $$ values ('corrected', 'present', 'You were here', null::uuid, false) $$,
  'the day is corrected to present and unlinked');
select results_eq(
  $$ select state::text, decision_reason from public.leave_requests where member_id = pg_temp.fx('admin') $$,
  $$ values ('rejected', 'You were here') $$,
  'and the half-day request was rejected with the same reason');
select results_eq(
  $$ select action, from_status::text, to_status::text, reason, actor_id from public.attendance_events
     where attendance_day_id = pg_temp.day('admin') order by id desc limit 1 $$,
  $$ select 'corrected', null::text, 'present', 'You were here', pg_temp.fx('owner') $$,
  'with a corrected event');

-- Correcting to a leave type with nothing behind it creates an approved Owner request.
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('staff'), 'correct', 'comp_leave', 'Worked Sunday, took Monday'), 'corrected',
  'the Owner corrects an approved day again, to comp leave');
select pg_temp.as_system();
select results_eq(
  $$ select d.state::text, d.final_status::text, r.type::text, r.state::text, r.source, r.start_date, r.end_date, r.decided_by, r.reason
     from public.attendance_days d join public.leave_requests r on r.id = d.leave_request_id where d.id = pg_temp.day('staff') $$,
  $$ select 'corrected', 'comp_leave', 'comp_leave', 'approved', 'owner', app.today_ist(), app.today_ist(), pg_temp.fx('owner'), 'Worked Sunday, took Monday' $$,
  'an approved source = owner request for that date is created and linked');
select is((select count(*) from public.attendance_events where attendance_day_id = pg_temp.day('staff')), 3::bigint,
  'submitted, approved, corrected: nothing overwritten');

-- Correcting a corrected day again keeps the history growing.
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('staff'), 'correct', 'absent', 'Was not seen'), 'corrected', 'a corrected day can be corrected again');
select pg_temp.as_system();
select is((select final_status::text from public.attendance_days where id = pg_temp.day('staff')), 'absent', 'now absent');
select is((select count(*) from public.attendance_events where attendance_day_id = pg_temp.day('staff') and action = 'corrected'), 2::bigint,
  'two corrected events');

-- The 23:59 proposal (2.5 writes it; here inserted as the system) is approved as absent.
select pg_temp.as_system();
select pg_temp.mk_day('staff2', -1, 'pending_review', null, 'absent', true);
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('staff2', -1), 'approve'), 'approved', 'the Owner approves a proposed absence');
select pg_temp.as_system();
select is((select final_status::text from public.attendance_days where id = pg_temp.day('staff2', -1)), 'absent', 'as absent');

-- An awaiting_choice day may be corrected (the gate then stops asking), never approved.
select pg_temp.as_system();
select pg_temp.mk_day('staff', -1, 'awaiting_choice', null, null, false);
select pg_temp.as_member('owner');
select throws_ok($$ select public.attendance_decide(pg_temp.day('staff', -1), 'approve') $$, 'P0001', 'INVALID_STATE',
  'there is nothing to approve on an awaiting_choice day');
select is(public.attendance_decide(pg_temp.day('staff', -1), 'correct', 'present', 'Forgot to choose'), 'corrected',
  'but the Owner may correct it');

-- Logout -----------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select isnt(public.session_logout('ua', null), null, 'Staff log out');
select pg_temp.as_system();
select ok((select last_logout_at is not null from public.attendance_days where id = pg_temp.day('staff')), 'last_logout_at is stamped on today''s day');
select is((select count(*) from public.attendance_events where attendance_day_id = pg_temp.day('staff') and action = 'logout' and actor_id = pg_temp.fx('staff')),
  1::bigint, 'with a logout event');
select is(
  (select action from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day('staff') order by id desc limit 1),
  'logout', 'audited as logout');
select is((select count(*) from public.session_events where member_id = pg_temp.fx('staff') and kind = 'logout'), 1::bigint,
  'and the session event is still written');

select pg_temp.as_member('owner');
select isnt(public.session_logout('ua', null), null, 'the Owner logs out');
select pg_temp.as_system();
select is((select count(*) from public.attendance_days where member_id = pg_temp.fx('owner')), 0::bigint,
  'the Owner''s logout touches no attendance day');

-- Worked past midnight: no day for today, yesterday's day has a login and no logout.
select pg_temp.as_system();
delete from public.attendance_events where attendance_day_id = pg_temp.day('admin');
delete from public.attendance_days where id = pg_temp.day('admin');
select pg_temp.mk_day('admin', -1, 'approved', 'present', 'present', false);
select pg_temp.as_member('admin');
select lives_ok($$ select public.session_logout('ua', null) $$, 'the Admin logs out after midnight');
select pg_temp.as_system();
select results_eq(
  $$ select last_logout_at is not null, state::text, final_status::text, decided_by, submitted_choice::text
     from public.attendance_days where id = pg_temp.day('admin', -1) $$,
  $$ select true, 'approved', 'present', pg_temp.fx('owner'), 'present' $$,
  'yesterday''s approved day takes the logout time and nothing else changes');
select is((select count(*) from public.attendance_days where member_id = pg_temp.fx('admin') and work_date = app.today_ist()), 0::bigint,
  'no day is opened for today by a logout');
select is(
  (select diff -> 'new' from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day('admin', -1) and action = 'logout'),
  (select jsonb_build_object('last_logout_at', to_jsonb(last_logout_at)) from public.attendance_days where id = pg_temp.day('admin', -1)),
  'the audit diff holds last_logout_at alone');
select pg_temp.as_member('admin');
select lives_ok($$ select public.session_logout('ua', null) $$, 'a second logout');
select pg_temp.as_system();
select is((select count(*) from public.attendance_events where attendance_day_id = pg_temp.day('admin', -1) and action = 'logout'), 1::bigint,
  'does not land on yesterday twice (it already has a logout)');

-- attendance_flag_overtime -----------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(public.attendance_flag_overtime(pg_temp.day('staff'), 'Client call ran late'), true, 'Staff flag overtime on their own day');
select pg_temp.as_system();
select results_eq(
  $$ select overtime_flag, overtime_reason from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values (true, 'Client call ran late') $$,
  'the flag and reason are stored');
select is((select count(*) from public.attendance_events where attendance_day_id = pg_temp.day('staff') and action = 'overtime_flagged'), 1::bigint,
  'with an overtime_flagged event');
select pg_temp.as_member('staff');
select is(public.attendance_flag_overtime(pg_temp.day('staff'), 'Render queue'), true, 'a second flag');
select pg_temp.as_system();
select is((select overtime_reason from public.attendance_days where id = pg_temp.day('staff')), 'Render queue', 'replaces the reason');
select pg_temp.as_member('staff2');
select throws_ok($$ select public.attendance_flag_overtime(pg_temp.day('staff'), 'x') $$, 'P0001', 'NOT_FOUND', 'someone else''s day is NOT_FOUND');
select pg_temp.as_member('owner');
select throws_ok($$ select public.attendance_flag_overtime(pg_temp.day('staff'), 'x') $$, 'P0001', 'FORBIDDEN', 'the Owner has no day to flag');

-- leave_submit -----------------------------------------------------------------------------------
select pg_temp.as_system();
select pg_temp.reset_attendance();

select pg_temp.as_member('owner');
select throws_ok($$ select public.leave_submit('leave', app.today_ist(), app.today_ist()) $$, 'P0001', 'FORBIDDEN', 'the Owner does not request leave');
select throws_ok($$ select public.leave_withdraw(pg_temp.fx('nobody')) $$, 'P0001', 'FORBIDDEN', 'the Owner has nothing to withdraw');
select throws_ok($$ select public.leave_request_change(pg_temp.fx('nobody'), 'leave', app.today_ist(), app.today_ist()) $$,
  'P0001', 'FORBIDDEN', 'the Owner has nothing to change');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select public.leave_submit('leave', app.today_ist(), app.today_ist()) $$, '42501', null, 'anon cannot call leave_submit');
select pg_temp.as_system();

select pg_temp.as_member('staff');
select throws_ok($$ select public.leave_submit('leave', app.today_ist() + 2, app.today_ist() + 1) $$, 'P0001', 'VALIDATION', 'end before start is refused');
select throws_ok($$ select public.leave_submit('half_day', app.today_ist() + 1, app.today_ist() + 2) $$, 'P0001', 'VALIDATION', 'a half day over two dates is refused');
select throws_ok($$ select public.leave_submit('leave', app.today_ist() - 1, app.today_ist()) $$, 'P0001', 'VALIDATION', 'leave in the past is refused');
select throws_ok($$ select public.leave_submit(null, app.today_ist(), app.today_ist()) $$, 'P0001', 'VALIDATION', 'a missing type is refused');
select throws_ok(format($$ select public.leave_submit('leave', app.today_ist(), app.today_ist(), %L) $$, repeat('x', 1001)),
  'P0001', 'VALIDATION', 'an overlong reason is refused');
select isnt(public.leave_submit('leave', app.today_ist() + 7, app.today_ist() + 9, 'Wedding'), null, 'Staff request three days of leave');
select pg_temp.as_system();
select results_eq(
  $$ select type::text, start_date, end_date, reason, state::text, source, supersedes_id, requests_cancellation, decided_at
     from public.leave_requests where member_id = pg_temp.fx('staff') $$,
  $$ select 'leave', app.today_ist() + 7, app.today_ist() + 9, 'Wedding', 'submitted', 'form', null::uuid, false, null::timestamptz $$,
  'the request is submitted from the form');
select is(
  (select action from public.activity_log where entity = 'leave_requests' and entity_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff'))),
  'submitted', 'audited as submitted');
select pg_temp.as_member('staff');
select throws_ok($$ select public.leave_submit('half_day', app.today_ist() + 8, app.today_ist() + 8) $$, 'P0001', 'CONFLICT',
  'a request overlapping an open one is refused');
select isnt(public.leave_submit('half_day', app.today_ist() + 10, app.today_ist() + 10), null, 'a request next to it is fine');

-- Closed requests never block: rejected, withdrawn, superseded and cancelled rows on the same dates.
select pg_temp.as_system();
select pg_temp.mk_leave('staff2', 'leave', 20, 22, 'rejected');
select pg_temp.mk_leave('staff2', 'leave', 20, 22, 'withdrawn');
select pg_temp.mk_leave('staff2', 'leave', 20, 22, 'superseded');
select pg_temp.mk_leave('staff2', 'leave', 20, 22, 'cancelled');
select pg_temp.as_member('staff2');
select isnt(public.leave_submit('leave', app.today_ist() + 21, app.today_ist() + 21), null,
  'rejected, withdrawn, superseded and cancelled requests on the same dates do not block a new one');
select pg_temp.as_system();
delete from public.leave_requests where member_id = pg_temp.fx('staff2');

-- leave_withdraw ---------------------------------------------------------------------------------
select pg_temp.as_member('staff2');
select throws_ok(
  format($$ select public.leave_withdraw(%L) $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'leave' and source = 'form')),
  'P0001', 'NOT_FOUND', 'someone else''s request is NOT_FOUND');
select pg_temp.as_member('staff');
select is(
  public.leave_withdraw((select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'half_day')),
  'withdrawn', 'Staff withdraw a waiting request');
select pg_temp.as_system();
select is((select state::text from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'half_day'), 'withdrawn', 'it is withdrawn');
select is(
  (select action from public.activity_log where entity = 'leave_requests'
     and entity_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'half_day') order by id desc limit 1),
  'withdrawn', 'audited as withdrawn');
select pg_temp.as_member('staff');
select throws_ok(
  format($$ select public.leave_withdraw(%L) $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'half_day')),
  'P0001', 'INVALID_STATE', 'withdrawing twice is refused');
select isnt(public.leave_submit('half_day', app.today_ist() + 10, app.today_ist() + 10), null, 'the withdrawn dates can be requested again');
select pg_temp.as_system();
select pg_temp.mk_leave('staff', 'leave', 0, 0, 'submitted', 'attendance');
select pg_temp.as_member('staff');
select throws_ok(
  format($$ select public.leave_withdraw(%L) $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'attendance')),
  'P0001', 'INVALID_STATE', 'the gate''s request cannot be withdrawn: the attendance day decides it');

-- leave_decide -----------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select throws_ok(
  format($$ select public.leave_decide(%L, 'approve') $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'leave' and source = 'form')),
  'P0001', 'FORBIDDEN', 'Staff cannot decide leave');
select pg_temp.as_member('admin');
select throws_ok(
  format($$ select public.leave_decide(%L, 'approve') $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'leave' and source = 'form')),
  'P0001', 'FORBIDDEN', 'an Admin cannot decide leave');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select public.leave_decide(pg_temp.fx('nobody'), 'approve') $$, '42501', null, 'anon cannot call leave_decide');
select pg_temp.as_system();

select pg_temp.as_member('owner');
select throws_ok($$ select public.leave_decide(pg_temp.fx('nobody'), 'approve') $$, 'P0001', 'NOT_FOUND', 'an unknown request is NOT_FOUND');
select throws_ok(
  format($$ select public.leave_decide(%L, 'defer') $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'leave' and source = 'form')),
  'P0001', 'VALIDATION', 'the decision must be approve or reject');
select throws_ok(
  format($$ select public.leave_decide(%L, 'approve') $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'attendance')),
  'P0001', 'INVALID_STATE', 'the gate''s request is decided from the attendance day, not here');
select throws_ok(
  format($$ select public.leave_decide(%L, 'reject') $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'half_day' and state = 'submitted')),
  'P0001', 'REASON_REQUIRED', 'a rejection needs a reason');
select is(
  (select state from public.leave_decide((select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'half_day' and state = 'submitted'), 'reject', 'Shoot that day')),
  'rejected', 'the Owner rejects with a reason');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, decided_by, decision_reason, decided_at is not null from public.leave_requests
     where member_id = pg_temp.fx('staff') and type = 'half_day' and state = 'rejected' $$,
  $$ select 'rejected', pg_temp.fx('owner'), 'Shoot that day', true $$,
  'the rejection is recorded');
select pg_temp.as_member('owner');
select is(
  (select state from public.leave_decide((select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'leave' and source = 'form'), 'approve')),
  'approved', 'the Owner approves the three-day leave');
select pg_temp.as_system();
select is((select state::text from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'leave' and source = 'form'), 'approved', 'it is approved');
select is(
  (select action from public.activity_log where entity = 'leave_requests'
     and entity_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'leave' and source = 'form') order by id desc limit 1),
  'approved', 'audited as approved');
select pg_temp.as_member('owner');
select throws_ok(
  format($$ select public.leave_decide(%L, 'approve') $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and type = 'leave' and source = 'form')),
  'P0001', 'INVALID_STATE', 'deciding twice is refused');

-- "A later leave wins": a Present still waiting is corrected by the system; since 2.2 a day the
-- Owner already decided (approved or corrected) is kept (08 covers kept_dates).
select pg_temp.as_system();
select pg_temp.reset_attendance();
select pg_temp.mk_day('staff', 0, 'pending_review', 'present', null, false);
select pg_temp.mk_day('staff2', 0, 'approved', 'present', 'present', false);
select pg_temp.mk_day('admin', 0, 'awaiting_choice', null, null, false);
select pg_temp.mk_day('worker', 0, 'corrected', 'present', 'absent', false);
select pg_temp.as_member('staff');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist() + 1), null, 'Staff request leave from today');
select pg_temp.as_member('staff2');
select isnt(public.leave_submit('half_day', app.today_ist(), app.today_ist()), null, 'the other Staff request a half day today');
select pg_temp.as_member('admin');
select isnt(public.leave_submit('comp_leave', app.today_ist(), app.today_ist()), null, 'the Admin requests comp leave today');
select pg_temp.as_member('worker');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist()), null, 'the corrected member requests leave today');
select pg_temp.as_member('owner');
select lives_ok($$ select public.leave_decide(r.id, 'approve') from public.leave_requests r where r.state = 'submitted' $$,
  'the Owner approves all four');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, final_status::text, decided_by, decision_reason, proposed_by_system,
            leave_request_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff'))
     from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values ('corrected', 'leave', null::uuid, 'leave approved', true, true) $$,
  'a pending Present is corrected to leave by the system');
select results_eq(
  $$ select action, from_status::text, to_status::text, reason, actor_id from public.attendance_events
     where attendance_day_id = pg_temp.day('staff') $$,
  $$ values ('corrected', null::text, 'leave', 'leave approved', null::uuid) $$,
  'with a corrected event by the system');
select is(
  (select meta ->> 'reason' from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day('staff') order by id desc limit 1),
  'leave approved', 'audited as a correction with reason "leave approved"');
select results_eq(
  $$ select state::text, final_status::text, decided_by from public.attendance_days where id = pg_temp.day('staff2') $$,
  $$ values ('approved', 'present', pg_temp.fx('owner')) $$,
  'an approved Present stays as the Owner decided it (2.2)');
select results_eq(
  $$ select state::text, final_status::text, proposed_by_system, decided_by from public.attendance_days where id = pg_temp.day('admin') $$,
  $$ values ('approved', 'comp_leave', true, null::uuid) $$,
  'an awaiting_choice day becomes the derived day (no gate any more)');
select is((select action from public.attendance_events where attendance_day_id = pg_temp.day('admin')), 'derived_from_leave',
  'with a derived_from_leave event');
select results_eq(
  $$ select state::text, final_status::text from public.attendance_days where id = pg_temp.day('worker') $$,
  $$ values ('corrected', 'absent') $$,
  'a day the Owner already corrected is left alone');

-- "I'm working today" on a derived day, and its approval flags "1 day worked".
select pg_temp.as_member('admin');
select throws_ok($$ select public.attendance_submit('leave', null) $$, 'P0001', 'INVALID_STATE',
  'on an approved-leave day only Present can be submitted');
select is(public.attendance_submit('present', 'Came in for the shoot'), 'pending_review', 'the Admin says "I''m working today"');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, submitted_choice::text, proposed_by_system, final_status::text,
            leave_request_id = (select id from public.leave_requests where member_id = pg_temp.fx('admin'))
     from public.attendance_days where id = pg_temp.day('admin') $$,
  $$ values ('pending_review', 'present', false, null::text, true) $$,
  'the day is pending review and keeps its leave request');
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('admin'), 'approve'), 'approved', 'the Owner approves the day worked');
select pg_temp.as_system();
select results_eq(
  $$ select d.final_status::text, d.worked_on_leave, r.state::text
     from public.attendance_days d join public.leave_requests r on r.id = d.leave_request_id where d.id = pg_temp.day('admin') $$,
  $$ values ('present', true, 'approved') $$,
  'present, flagged as 1 day worked, and the leave request is untouched');
select pg_temp.as_member('admin');
select throws_ok($$ select public.attendance_submit('present', null) $$, 'P0001', 'INVALID_STATE',
  'an approved day that a person submitted cannot be re-submitted');
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('admin'), 'correct', 'present', 'Same status, better note'), 'corrected',
  'the Owner re-corrects the day worked to present');
select pg_temp.as_system();
select is((select worked_on_leave from public.attendance_days where id = pg_temp.day('admin')), true,
  'and "1 day worked" survives a correction that keeps present');

-- Change requests: new row supersedes the original once approved.
select pg_temp.as_member('staff');
select throws_ok(
  format($$ select public.leave_request_change(%L, 'leave', app.today_ist(), app.today_ist() + 2) $$,
         (select id from public.leave_requests where member_id = pg_temp.fx('staff2'))),
  'P0001', 'NOT_FOUND', 'someone else''s request cannot be changed');
select throws_ok(
  format($$ select public.leave_request_change(%L, 'leave', app.today_ist() - 2, app.today_ist() + 2) $$,
         (select id from public.leave_requests where member_id = pg_temp.fx('staff'))),
  'P0001', 'VALIDATION', 'a change cannot move the start into the past');
select throws_ok(
  format($$ select public.leave_request_change(%L, 'half_day', app.today_ist() - 1, app.today_ist() - 1) $$,
         (select id from public.leave_requests where member_id = pg_temp.fx('staff'))),
  'P0001', 'VALIDATION', 'a change must end today or later');
select isnt(
  public.leave_request_change((select id from public.leave_requests where member_id = pg_temp.fx('staff')), 'leave', app.today_ist(), app.today_ist() + 3, 'One more day'),
  null, 'Staff ask to extend their leave');
select pg_temp.as_system();
select results_eq(
  $$ select n.state::text, n.type::text, n.start_date, n.end_date, n.requests_cancellation, o.state::text
     from public.leave_requests n join public.leave_requests o on o.id = n.supersedes_id where n.member_id = pg_temp.fx('staff') $$,
  $$ select 'submitted', 'leave', app.today_ist(), app.today_ist() + 3, false, 'approved' $$,
  'the change is a submitted row and the original stays approved');
select is(
  (select action from public.activity_log where entity = 'leave_requests'
     and entity_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff') and supersedes_id is not null)),
  'change_requested', 'audited as change_requested');
select pg_temp.as_member('staff');
select throws_ok(
  format($$ select public.leave_request_change(%L, 'leave', app.today_ist(), app.today_ist() + 4) $$,
         (select id from public.leave_requests where member_id = pg_temp.fx('staff') and supersedes_id is null)),
  'P0001', 'CONFLICT', 'a second change while one is waiting is refused');
select throws_ok(
  format($$ select public.leave_request_change(%L, 'leave', app.today_ist(), app.today_ist() + 4) $$,
         (select id from public.leave_requests where member_id = pg_temp.fx('staff') and supersedes_id is not null)),
  'P0001', 'INVALID_STATE', 'only approved leave can be changed');
select pg_temp.as_member('owner');
select is(
  (select state from public.leave_decide((select id from public.leave_requests where member_id = pg_temp.fx('staff') and supersedes_id is not null), 'approve')),
  'approved', 'the Owner approves the change');
select pg_temp.as_system();
select results_eq(
  $$ select state::text from public.leave_requests where member_id = pg_temp.fx('staff') order by supersedes_id is not null $$,
  $$ values ('superseded'), ('approved') $$,
  'the original is superseded and the change approved');
select is((select action from public.activity_log where entity = 'leave_requests'
     and entity_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff') and state = 'superseded') order by id desc limit 1),
  'superseded', 'the original is audited as superseded');

-- The leave wins over the gate's own request too: a leave choice at the gate while a form request
-- covering today is waiting, then the Owner approves the form request.
select pg_temp.as_system();
select pg_temp.reset_attendance();
select pg_temp.as_member('staff2');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist() + 1, 'Form first'), null, 'a form request covering today is waiting');
select is((select gate_required from public.attendance_touch()), true, 'the gate still asks (nothing approved yet)');
select is(public.attendance_submit('half_day', 'Gate second'), 'pending_review', 'a half day is chosen at the gate');
select pg_temp.as_member('owner');
select is((select state from public.leave_decide((select id from public.leave_requests where member_id = pg_temp.fx('staff2') and source = 'form'), 'approve')),
  'approved', 'the Owner approves the form request');
select pg_temp.as_system();
select results_eq(
  $$ select source, state::text from public.leave_requests where member_id = pg_temp.fx('staff2') order by source $$,
  $$ values ('attendance', 'superseded'), ('form', 'approved') $$,
  'the gate''s request is superseded by the approved leave: nothing is left without a door');
select results_eq(
  $$ select state::text, final_status::text, leave_request_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff2') and source = 'form')
     from public.attendance_days where id = pg_temp.day('staff2') $$,
  $$ values ('corrected', 'leave', true) $$,
  'and the day follows the approved leave');
select is(
  (select meta from public.activity_log where entity = 'leave_requests'
     and entity_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff2') and source = 'attendance') order by id desc limit 1),
  jsonb_build_object('by', (select id from public.leave_requests where member_id = pg_temp.fx('staff2') and source = 'form'), 'system', true),
  'audited as superseded by the system');
select is(
  (select meta ->> 'system' from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day('staff2') order by id desc limit 1),
  'true', 'the system correction says so in the audit meta');

-- Approved leave already covering the dates at approve time is CONFLICT (the Owner sorts it out).
select pg_temp.as_system();
select pg_temp.mk_leave('staff', 'leave', 12, 13, 'submitted');
select pg_temp.mk_leave('staff', 'comp_leave', 13, 13, 'approved', 'owner');
select pg_temp.as_member('owner');
select throws_ok(
  format($$ select public.leave_decide(%L, 'approve') $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and state = 'submitted')),
  'P0001', 'CONFLICT', 'approving a request over already-approved leave is refused');

-- A change whose original was cancelled meanwhile is approved as a fresh request.
select pg_temp.as_system();
select pg_temp.reset_attendance();
select pg_temp.mk_leave('staff', 'leave', 12, 13, 'approved');
select pg_temp.as_member('staff');
select isnt(
  public.leave_request_change((select id from public.leave_requests where member_id = pg_temp.fx('staff')), 'leave', app.today_ist() + 12, app.today_ist() + 14),
  null, 'Staff ask to extend');
select pg_temp.as_member('owner');
select throws_ok(
  format($$ select public.leave_owner_edit(%L, 'leave', app.today_ist() + 12, app.today_ist() + 12) $$,
         (select id from public.leave_requests where member_id = pg_temp.fx('staff') and supersedes_id is null)),
  'P0001', 'CONFLICT', 'the Owner cannot edit a leave while the person''s change to it is waiting');
select is(public.leave_owner_cancel((select id from public.leave_requests where member_id = pg_temp.fx('staff') and supersedes_id is null), 'Plans off'),
  'cancelled', 'the Owner cancels the original meanwhile');
select is((select state from public.leave_decide((select id from public.leave_requests where member_id = pg_temp.fx('staff') and supersedes_id is not null), 'approve')),
  'approved', 'the change is then approved on its own');
select pg_temp.as_system();
select results_eq(
  $$ select state::text from public.leave_requests where member_id = pg_temp.fx('staff') order by supersedes_id is not null $$,
  $$ values ('cancelled'), ('approved') $$,
  'the original stays cancelled and the change is approved as a fresh request');

-- Cancellation requests: refused, then granted; today's untouched derived day goes back to the gate.
select pg_temp.as_system();
-- A clean derived day for the worker.
select pg_temp.reset_attendance();
select pg_temp.mk_leave('worker', 'leave', -1, 1, 'approved');
select pg_temp.mk_day('worker', -1, 'approved', null, 'leave', true, (select id from public.leave_requests where member_id = pg_temp.fx('worker')));
select pg_temp.as_member('worker');
select is((select gate_required from public.attendance_touch()), false, 'the worker is on leave today: no gate');
select isnt(
  public.leave_request_change((select id from public.leave_requests where member_id = pg_temp.fx('worker')), null, null, null, 'Plans changed', true),
  null, 'the worker asks to cancel the leave');
select pg_temp.as_system();
select results_eq(
  $$ select n.type::text, n.start_date, n.end_date, n.requests_cancellation, n.state::text, n.reason
     from public.leave_requests n where n.member_id = pg_temp.fx('worker') and n.supersedes_id is not null $$,
  $$ select 'leave', app.today_ist() - 1, app.today_ist() + 1, true, 'submitted', 'Plans changed' $$,
  'the cancellation copies the dates and is flagged');
select is(
  (select action from public.activity_log where entity = 'leave_requests'
     and entity_id = (select id from public.leave_requests where member_id = pg_temp.fx('worker') and supersedes_id is not null)),
  'cancellation_requested', 'audited as cancellation_requested');
select pg_temp.as_member('owner');
select is(
  (select state from public.leave_decide((select id from public.leave_requests where member_id = pg_temp.fx('worker') and supersedes_id is not null), 'reject', 'Take the rest')),
  'rejected', 'the Owner refuses the cancellation');
select pg_temp.as_system();
select is((select state::text from public.leave_requests where member_id = pg_temp.fx('worker') and supersedes_id is null), 'approved',
  'the original stays approved');
select is((select state::text from public.attendance_days where id = pg_temp.day('worker')), 'approved', 'and the day stays derived');
select pg_temp.as_member('worker');
select isnt(
  public.leave_request_change((select id from public.leave_requests where member_id = pg_temp.fx('worker') and supersedes_id is null), null, null, null, null, true),
  null, 'the worker asks again');
select pg_temp.as_member('owner');
select is(
  (select state from public.leave_decide((select id from public.leave_requests where member_id = pg_temp.fx('worker') and supersedes_id is not null and state = 'submitted'), 'approve')),
  'cancelled', 'the Owner grants the cancellation');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, count(*) from public.leave_requests where member_id = pg_temp.fx('worker') group by 1 $$,
  $$ values ('cancelled', 2::bigint), ('rejected', 1::bigint) $$,
  'the original and the cancellation end cancelled; nothing is approved any more');
select results_eq(
  $$ select state::text, final_status::text, proposed_by_system, leave_request_id, decided_at, first_login_at is not null
     from public.attendance_days where id = pg_temp.day('worker') $$,
  $$ values ('awaiting_choice', null::text, false, null::uuid, null::timestamptz, true) $$,
  'today''s untouched derived day is back to awaiting_choice');
select results_eq(
  $$ select action, from_status::text, to_status::text, reason, actor_id from public.attendance_events
     where attendance_day_id = pg_temp.day('worker') order by id $$,
  $$ values ('derived_from_leave', null::text, 'leave', null::text, null::uuid),
            ('corrected', 'leave', null::text, 'leave cancelled', null::uuid) $$,
  'with a system correction "leave cancelled" after the derivation');
select is(
  (select meta ->> 'reason' from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day('worker') order by id desc limit 1),
  'leave cancelled', 'audited as a correction with reason "leave cancelled"');
select results_eq(
  $$ select state::text, final_status::text from public.attendance_days where id = pg_temp.day('worker', -1) $$,
  $$ values ('approved', 'leave') $$,
  'yesterday''s derived day is history and stays');
select pg_temp.as_member('worker');
select is((select gate_required from public.attendance_touch()), true, 'the gate asks the worker again');

-- leave_owner_edit / leave_owner_cancel ----------------------------------------------------------
select pg_temp.as_system();
select pg_temp.reset_attendance();
select pg_temp.mk_leave('staff', 'leave', 0, 2, 'approved');
select pg_temp.mk_day('staff', 0, 'approved', null, 'leave', true, (select id from public.leave_requests where member_id = pg_temp.fx('staff')));
select pg_temp.mk_leave('staff2', 'leave', 5, 6, 'approved');
select pg_temp.mk_leave('staff2', 'leave', 8, 9, 'submitted');

select pg_temp.as_member('staff');
select throws_ok(
  format($$ select public.leave_owner_edit(%L, 'leave', app.today_ist(), app.today_ist()) $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff'))),
  'P0001', 'FORBIDDEN', 'Staff cannot use the Owner''s edit');
select pg_temp.as_member('admin');
select throws_ok(
  format($$ select public.leave_owner_edit(%L, 'leave', app.today_ist(), app.today_ist()) $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff'))),
  'P0001', 'FORBIDDEN', 'an Admin cannot use the Owner''s edit');
select throws_ok(
  format($$ select public.leave_owner_cancel(%L, 'x') $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff'))),
  'P0001', 'FORBIDDEN', 'an Admin cannot cancel approved leave');
-- Moving the leave to next week hands today's untouched derived day back to the gate.
select pg_temp.as_member('owner');
select isnt(
  public.leave_owner_edit((select id from public.leave_requests where member_id = pg_temp.fx('staff')), 'leave', app.today_ist() + 7, app.today_ist() + 9, 'Next week instead'),
  null, 'the Owner moves the leave to next week');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, final_status::text, leave_request_id from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values ('awaiting_choice', null::text, null::uuid) $$,
  'today''s derived day is released because the leave no longer covers it');
select is((select count(*) from public.attendance_events where attendance_day_id = pg_temp.day('staff') and reason = 'leave cancelled'), 1::bigint,
  'with a "leave cancelled" correction');
-- Put the fixture back for the edit-within-range test below.
delete from public.attendance_events where attendance_day_id = pg_temp.day('staff');
delete from public.attendance_days where id = pg_temp.day('staff');
delete from public.leave_requests where member_id = pg_temp.fx('staff');
delete from public.activity_log where entity in ('attendance_days', 'leave_requests');
select pg_temp.mk_leave('staff', 'leave', 0, 2, 'approved');
select pg_temp.mk_day('staff', 0, 'approved', null, 'leave', true, (select id from public.leave_requests where member_id = pg_temp.fx('staff')));
select pg_temp.as_member('owner');
select throws_ok(
  format($$ select public.leave_owner_edit(%L, 'leave', app.today_ist() + 8, app.today_ist() + 8) $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff2') and state = 'submitted')),
  'P0001', 'INVALID_STATE', 'only approved leave can be edited');
select throws_ok(
  format($$ select public.leave_owner_edit(%L, 'leave', app.today_ist() + 6, app.today_ist() + 8) $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff2') and state = 'approved')),
  'P0001', 'CONFLICT', 'an edit overlapping the person''s other open request is refused');
select isnt(
  public.leave_owner_edit((select id from public.leave_requests where member_id = pg_temp.fx('staff')), 'half_day', app.today_ist(), app.today_ist(), 'Only the morning'),
  null, 'the Owner shortens the leave to a half day today');
select pg_temp.as_system();
select results_eq(
  $$ select o.state::text, n.state::text, n.type::text, n.start_date, n.end_date, n.source, n.decided_by, n.reason
     from public.leave_requests n join public.leave_requests o on o.id = n.supersedes_id where n.member_id = pg_temp.fx('staff') $$,
  $$ select 'superseded', 'approved', 'half_day', app.today_ist(), app.today_ist(), 'owner', pg_temp.fx('owner'), 'Only the morning' $$,
  'the original is superseded by an approved Owner request');
select results_eq(
  $$ select state::text, final_status::text, leave_request_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'owner')
     from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values ('approved', 'half_day', true) $$,
  'today''s untouched derived day follows the edit');
select is((select count(*) from public.attendance_events where attendance_day_id = pg_temp.day('staff') and action = 'derived_from_leave'), 1::bigint,
  'with a derived_from_leave event');

select pg_temp.as_member('owner');
select throws_ok(
  format($$ select public.leave_owner_cancel(%L, null) $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'owner')),
  'P0001', 'REASON_REQUIRED', 'the Owner''s cancellation needs a reason');
select is(
  public.leave_owner_cancel((select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'owner'), 'Shoot moved'),
  'cancelled', 'the Owner cancels the half day');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, decision_reason from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'owner' $$,
  $$ values ('cancelled', 'Shoot moved') $$,
  'it is cancelled with the reason');
select is((select state::text from public.attendance_days where id = pg_temp.day('staff')), 'awaiting_choice',
  'and today''s untouched derived day is back to the gate');
select pg_temp.as_member('owner');
select throws_ok(
  format($$ select public.leave_owner_cancel(%L, 'again') $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'owner')),
  'P0001', 'INVALID_STATE', 'cancelling twice is refused');
select pg_temp.as_member('staff');
select throws_ok(
  format($$ select public.leave_owner_cancel(%L, 'x') $$, (select id from public.leave_requests where member_id = pg_temp.fx('staff2') and state = 'approved')),
  'P0001', 'FORBIDDEN', 'Staff cannot cancel approved leave directly');

-- activity_log: members read the entries about their own days and requests --------------------
select pg_temp.as_member('staff');
select ok((select count(*) > 0 from public.activity_log where entity = 'attendance_days'), 'Staff read the audit entries about their own days');
select ok((select count(*) > 0 from public.activity_log where entity = 'leave_requests'), 'and about their own leave requests');
select pg_temp.as_member('staff2');
select is((select count(*) from public.activity_log where entity = 'leave_requests'), 0::bigint,
  'but someone else reads nothing about those requests');
select is((select count(*) from public.activity_log where entity = 'attendance_days'), 0::bigint,
  'a member with no day reads no attendance entries');
select pg_temp.as_member('owner');
select ok((select count(*) from public.activity_log where entity = 'leave_requests'
             and entity_id in (select id from public.leave_requests where member_id = pg_temp.fx('staff'))) > 0,
  'the Owner reads everyone''s entries');

-- The override never leaks: a plain edit after a transition is a plain 'update' row.
select pg_temp.as_member('owner');
update public.members set full_name = 'Test Staff Renamed' where id = pg_temp.fx('staff');
select pg_temp.as_system();
select is(
  (select action from public.activity_log where entity = 'members' and entity_id = pg_temp.fx('staff') order by id desc limit 1),
  'update', 'a plain edit after a transition is audited as a plain update');

select * from finish();
rollback;
