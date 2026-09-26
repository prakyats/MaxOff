-- Phase 2 review fixes (2026-09-26), one section per migration:
--   20260926174147_overtime_note_day: attendance_flag_overtime_today() picks the day the logout will.
--   20260926174801_leave_span_cap: app.leave_validate() caps a request at 365 days, for every writer.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

delete from public.attendance_events;
delete from public.attendance_days;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '00000000-0000-4000-8000-000000000001'),
  ('today', '00000000-0000-4000-8000-000000000002'),
  ('late',  '00000000-0000-4000-8000-000000000003'),
  ('gone',  '00000000-0000-4000-8000-000000000004'),
  ('none',  '00000000-0000-4000-8000-000000000005');
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

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner@example.com', 'owner', 'active', now() - interval '30 days'),
  (pg_temp.fx('today'), pg_temp.fx('org'), 'Tara Today', 'today@example.com', 'staff', 'active', now() - interval '30 days'),
  (pg_temp.fx('late'),  pg_temp.fx('org'), 'Lata Late',  'late@example.com',  'staff', 'active', now() - interval '30 days'),
  (pg_temp.fx('gone'),  pg_temp.fx('org'), 'Gopal Gone', 'gone@example.com',  'staff', 'active', now() - interval '30 days'),
  (pg_temp.fx('none'),  pg_temp.fx('org'), 'Nila None',  'none@example.com',  'staff', 'active', now() - interval '30 days');

-- Tara has today's day. Lata has no day today and yesterday's is still open (worked past
-- midnight). Gopal has no day today and yesterday's already holds a logout. Nila has no day at all.
insert into public.attendance_days (member_id, work_date, first_login_at, state, submitted_choice, submitted_at) values
  (pg_temp.fx('today'), app.today_ist(),     now(),                       'pending_review', 'present', now()),
  (pg_temp.fx('late'),  app.today_ist() - 1, now() - interval '10 hours', 'pending_review', 'present', now() - interval '10 hours');
insert into public.attendance_days (member_id, work_date, first_login_at, last_logout_at, state, submitted_choice, submitted_at) values
  (pg_temp.fx('gone'),  app.today_ist() - 1, now() - interval '10 hours', now() - interval '2 hours', 'pending_review', 'present', now() - interval '10 hours');
delete from public.activity_log;

-- attendance_flag_overtime_today ----------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.attendance_flag_overtime_today(text)', 'execute')
          and not has_function_privilege('anon', 'public.attendance_flag_overtime_today(text)', 'execute'),
  'authenticated may execute attendance_flag_overtime_today, anon may not');

select pg_temp.as_member('owner');
select throws_ok($$ select public.attendance_flag_overtime_today('Launch night') $$, 'P0001', 'FORBIDDEN',
  'the Owner has no day to note');

select pg_temp.as_member('today');
select throws_ok($$ select public.attendance_flag_overtime_today('   ') $$, 'P0001', 'VALIDATION',
  'an empty note is refused');
select is(
  public.attendance_flag_overtime_today('Launch night'),
  (select id from public.attendance_days where member_id = pg_temp.fx('today')),
  'with a day today, the note lands on it');
select results_eq(
  $$ select overtime_flag, overtime_reason from public.attendance_days where member_id = pg_temp.fx('today') $$,
  $$ values (true, 'Launch night') $$,
  'today''s day carries the flag and the reason');

select pg_temp.as_member('late');
select is(
  public.attendance_flag_overtime_today('Render ran past midnight'),
  (select id from public.attendance_days where member_id = pg_temp.fx('late')),
  'no day today and yesterday still open: the note lands on yesterday, where the logout will');
select results_eq(
  $$ select work_date = app.today_ist() - 1, overtime_flag, overtime_reason
     from public.attendance_days where member_id = pg_temp.fx('late') $$,
  $$ values (true, true, 'Render ran past midnight') $$,
  'yesterday''s day carries the flag');
select is((select count(*)::integer from public.attendance_days where member_id = pg_temp.fx('late')), 1,
  'no day was opened for today');

select pg_temp.as_member('gone');
select throws_ok($$ select public.attendance_flag_overtime_today('Late again') $$, 'P0001', 'INVALID_STATE',
  'yesterday already logged out and nothing today: refused, as the logout would find no day');

select pg_temp.as_member('none');
select throws_ok($$ select public.attendance_flag_overtime_today('First day') $$, 'P0001', 'INVALID_STATE',
  'no day at all: refused');

select pg_temp.as_system();
select is((select count(*)::integer from public.attendance_events where action = 'overtime_flagged'), 2,
  'one overtime_flagged event per note, through the inner function');
select is((select count(*)::integer from public.activity_log where action = 'overtime_flagged'), 2,
  'one audit row per note');

-- leave_validate: at most 365 days ---------------------------------------------------------------
select pg_temp.as_member('none');
select throws_ok($$ select public.leave_submit('leave', app.today_ist() + 1, app.today_ist() + 366) $$,
  'P0001', 'VALIDATION', 'a request over 366 days is refused');
select lives_ok($$ select public.leave_submit('leave', app.today_ist() + 1, app.today_ist() + 365) $$,
  'a request of exactly 365 days is accepted');
select pg_temp.as_member('owner');
select lives_ok(
  $$ select public.leave_decide((select id from public.leave_requests where member_id = pg_temp.fx('none')), 'approve') $$,
  'the Owner approves it');
select throws_ok(
  $$ select public.leave_owner_edit(
       (select id from public.leave_requests where member_id = pg_temp.fx('none') and state = 'approved'),
       'leave', app.today_ist() + 1, app.today_ist() + 366, 'One more day') $$,
  'P0001', 'VALIDATION', 'the Owner''s edit is held to the same cap');
select pg_temp.as_member('none');
select throws_ok(
  $$ select public.leave_request_change(
       (select id from public.leave_requests where member_id = pg_temp.fx('none') and state = 'approved'),
       'leave', app.today_ist() + 1, app.today_ist() + 366) $$,
  'P0001', 'VALIDATION', 'a change request is held to the same cap');

select * from finish();
rollback;
