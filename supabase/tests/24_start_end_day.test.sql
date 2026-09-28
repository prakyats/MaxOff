-- 3b.1 Start day / End day (WORKFLOWS §1 "Settled in 3b.1", §8; DATA-MODEL §3 "3b.1"): the new
-- columns and constraint, attendance_own_today, attendance_start_day on every path (the Owner, the
-- joining day, a day off with and without a row, the ordinary morning, twice, a full-leave day, a
-- half-day leave day, a 2.x gate Present, a leave chosen, a decided absence), the prompt's leave
-- choice, attendance_end_day (no start, ends, twice, after midnight clearing the flag),
-- app.end_not_recorded on every path, app.end_day_reminder_due, session_sign_out touching no day,
-- attendance_today_detail and the cron row. The 2.x functions are untouched (expand-only), which
-- 07, 08, 09, 12 and 13 keep proving.
begin;
create extension if not exists pgtap with schema extensions;
select plan(106);

-- Fixtures as 13: keep the organization, replace the people. Rolled back at the end.
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.comp_leave_credit_uses;
delete from public.comp_leave_credits;
delete from public.extra_work_notes;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.field_definitions;
delete from public.client_contacts;
delete from public.client_admin_assignments;
delete from public.client_brand;
delete from public.client_private;
delete from public.clients;
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',   '00000000-0000-4000-8000-000000000201'),
  ('admin',   '00000000-0000-4000-8000-000000000202'),
  ('staff',   '00000000-0000-4000-8000-000000000203'),
  ('halfer',  '00000000-0000-4000-8000-000000000204'),
  ('leaver',  '00000000-0000-4000-8000-000000000205'),
  ('gated',   '00000000-0000-4000-8000-000000000206'),
  ('chose',   '00000000-0000-4000-8000-000000000207'),
  ('absent',  '00000000-0000-4000-8000-000000000208'),
  ('newbie',  '00000000-0000-4000-8000-000000000209'),
  ('offrow',  '00000000-0000-4000-8000-000000000210'),
  ('late',    '00000000-0000-4000-8000-000000000211'),
  ('done',    '00000000-0000-4000-8000-000000000212'),
  ('open',    '00000000-0000-4000-8000-000000000213'),
  ('quit',    '00000000-0000-4000-8000-000000000214'),
  ('twice',   '00000000-0000-4000-8000-000000000215');
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

create function pg_temp.today() returns date language sql stable as $$ select app.today_ist() $$;

create function pg_temp.day_on(k text, d date) returns public.attendance_days language sql stable as $$
  select x.* from public.attendance_days x where x.member_id = pg_temp.fx(k) and x.work_date = d;
$$;

create function pg_temp.audit_actions(day uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(a.action order by a.id), '{}')
  from public.activity_log a where a.entity = 'attendance_days' and a.entity_id = day;
$$;

create function pg_temp.events(day uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(e.action order by e.id), '{}')
  from public.attendance_events e where e.attendance_day_id = day;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', j
from (values
  ('owner',  'owner', now() - interval '30 days'),
  ('admin',  'admin', now() - interval '30 days'),
  ('staff',  'staff', now() - interval '30 days'),
  ('halfer', 'staff', now() - interval '30 days'),
  ('leaver', 'staff', now() - interval '30 days'),
  ('gated',  'staff', now() - interval '30 days'),
  ('chose',  'staff', now() - interval '30 days'),
  ('absent', 'staff', now() - interval '30 days'),
  -- Joined today: attendance starts tomorrow (WORKFLOWS §1, 2.2).
  ('newbie', 'staff', now()),
  ('offrow', 'staff', now() - interval '30 days'),
  ('late',   'staff', now() - interval '30 days'),
  ('done',   'staff', now() - interval '30 days'),
  ('open',   'staff', now() - interval '30 days'),
  ('quit',   'staff', now() - interval '30 days'),
  ('twice',  'staff', now() - interval '30 days')
) as v(k, r, j);

-- Approved leave for today: leaver a full day, halfer a half day.
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at)
values (pg_temp.fx('leaver'), 'leave', pg_temp.today(), pg_temp.today(), 'approved', 'form', pg_temp.fx('owner'), now()),
       (pg_temp.fx('halfer'), 'half_day', pg_temp.today(), pg_temp.today(), 'approved', 'form', pg_temp.fx('owner'), now());
-- gated chose Present at the 2.x gate this morning (main's app on the shared staging database).
insert into public.attendance_days (member_id, work_date, first_login_at, state, submitted_choice, submitted_at)
values (pg_temp.fx('gated'), pg_temp.today(), now() - interval '2 hours', 'pending_review', 'present', now() - interval '2 hours');
-- chose picked leave this morning (pending, a source = attendance request behind it).
insert into public.attendance_days (member_id, work_date, first_login_at, state, submitted_choice, submitted_at)
values (pg_temp.fx('chose'), pg_temp.today(), now() - interval '2 hours', 'pending_review', 'leave', now() - interval '2 hours');
-- absent: the Owner already corrected today to absent.
insert into public.attendance_days (member_id, work_date, state, final_status, decided_by, decided_at, decision_reason)
values (pg_temp.fx('absent'), pg_temp.today(), 'corrected', 'absent', pg_temp.fx('owner'), now(), 'no show');
-- offrow opened the app on a day off under 2.x: a row marked is_day_off, no choice.
insert into public.attendance_days (member_id, work_date, first_login_at, is_day_off)
values (pg_temp.fx('offrow'), pg_temp.today(), now() - interval '1 hour', true);
-- late started yesterday and never ended; the 00:00 job flagged it.
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at, end_not_recorded)
values (pg_temp.fx('late'), pg_temp.today() - 1, 'pending_review', 'present',
        app.ist_day_start(pg_temp.today() - 1) + interval '9 hours', app.ist_day_start(pg_temp.today() - 1) + interval '9 hours', true);
-- done started and ended today already.
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at, ended_at)
values (pg_temp.fx('done'), pg_temp.today(), 'pending_review', 'present', now() - interval '8 hours',
        now() - interval '8 hours', now() - interval '1 hour');
-- twice left yesterday open (flagged) and started and ended today: a second End day tap (another
-- device, a stale tab) must not land on yesterday (architecture review of 3bA, must-fix).
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at, end_not_recorded)
values (pg_temp.fx('twice'), pg_temp.today() - 1, 'pending_review', 'present',
        app.ist_day_start(pg_temp.today() - 1) + interval '9 hours', app.ist_day_start(pg_temp.today() - 1) + interval '9 hours', true);
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at, ended_at)
values (pg_temp.fx('twice'), pg_temp.today(), 'pending_review', 'present', now() - interval '8 hours',
        now() - interval '8 hours', now() - interval '1 hour');
delete from public.activity_log; -- the fixture writes are not under test

-- Structure -------------------------------------------------------------------------------------
select has_column('public', 'attendance_days', 'started_at', 'attendance_days.started_at exists');
select has_column('public', 'attendance_days', 'ended_at', 'attendance_days.ended_at exists');
select has_column('public', 'attendance_days', 'end_not_recorded', 'attendance_days.end_not_recorded exists');
select col_default_is('public', 'attendance_days', 'end_not_recorded', 'false', 'end_not_recorded defaults to false (expand-only)');
select throws_ok(
  format($$ update public.attendance_days set ended_at = now() where member_id = %L $$, pg_temp.fx('gated')),
  '23514', null, 'an end without a start is refused by the check constraint');
select has_function('public', 'attendance_own_today', '{}'::text[], 'attendance_own_today exists');
select has_function('public', 'attendance_start_day', '{}'::text[], 'attendance_start_day exists');
select has_function('public', 'attendance_choose_leave_today', array['attendance_choice', 'text'], 'attendance_choose_leave_today exists');
select has_function('public', 'attendance_end_day', array['text', 'integer'], 'attendance_end_day exists (3b.2 added the optional overtime note)');
select has_function('public', 'session_sign_out', array['text', 'text'], 'session_sign_out exists');
select has_function('public', 'attendance_today_detail', '{}'::text[], 'attendance_today_detail exists');
select has_function('app', 'end_not_recorded', array['date'], 'app.end_not_recorded exists');
select has_function('app', 'end_day_reminder_due', array['timestamp with time zone'], 'app.end_day_reminder_due exists');
-- Expand-only: the 2.x functions are still there with their signatures.
select has_function('public', 'attendance_touch', array['text', 'text'], 'attendance_touch (2.x) is kept for main');
select has_function('public', 'session_logout', array['text', 'text'], 'session_logout (2.x) is kept for main');
select has_function('app', 'attendance_logout', array['uuid'], 'app.attendance_logout (2.x) is kept for main');
select has_function('public', 'attendance_today', '{}'::text[], 'attendance_today (2.x) is kept for main');
select ok(
  not has_function_privilege('authenticated', 'app.end_not_recorded(date)', 'execute')
  and not has_function_privilege('authenticated', 'app.end_day_reminder_due(timestamptz)', 'execute')
  and has_function_privilege('service_role', 'app.end_not_recorded(date)', 'execute')
  and has_function_privilege('service_role', 'app.end_day_reminder_due(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.attendance_start_day()', 'execute')
  and has_function_privilege('authenticated', 'public.attendance_start_day()', 'execute'),
  'the job and the reminder list are service_role only; the API role starts and ends days');
select results_eq(
  $$ select jobname::text, schedule, command, active from cron.job where jobname = 'end_not_recorded' $$,
  $$ values ('end_not_recorded', '30 18 * * *', 'select app.end_not_recorded()', true) $$,
  'pg_cron runs end_not_recorded at 00:00 IST');

-- attendance_own_today ---------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok('select * from public.attendance_own_today()', 'P0001', 'FORBIDDEN', 'the Owner has no day: attendance_own_today refuses');
select pg_temp.as_member('staff');
select results_eq(
  $$ select work_date, attendance_started, is_working_day, day_id, is_day_off, started_at, yesterday_open_day_id
     from public.attendance_own_today() $$,
  $$ select pg_temp.today(), true, true, null::uuid, false, null::timestamptz, null::uuid $$,
  'no row yet: today, attendance started, a working day, no day, nothing open from yesterday');
select pg_temp.as_member('newbie');
select is((select attendance_started from public.attendance_own_today()), false, 'the joining day: attendance has not started');
select pg_temp.as_member('late');
select is((select yesterday_open_day_id from public.attendance_own_today()),
          (pg_temp.day_on('late', pg_temp.today() - 1)).id, 'a started, unended yesterday is reported for the late End day');
select pg_temp.as_member('gated');
select results_eq(
  $$ select state::text, submitted_choice::text, first_login_at is not null, started_at from public.attendance_own_today() $$,
  $$ values ('pending_review', 'present', true, null::timestamptz) $$,
  'a 2.x gate choice is read as it is: Present waiting, signed in, not started');
select pg_temp.as_member('halfer');
select results_eq(
  $$ select state::text, final_status::text, proposed_by_system, leave_type::text, covering_leave_type::text from public.attendance_own_today() $$,
  $$ values (null, null, false, null, 'half_day') $$,
  'a leave day nobody has opened yet has no row, but the covering leave is reported (no prompt)');
select pg_temp.as_member('staff');
select is((select covering_leave_type from public.attendance_own_today()), null, 'no leave covering today: nothing reported');

-- attendance_start_day: refusals -----------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok('select public.attendance_start_day()', 'P0001', 'FORBIDDEN', 'the Owner does not start a day');
select pg_temp.as_member('newbie');
select throws_ok('select public.attendance_start_day()', 'P0001', 'INVALID_STATE', 'the joining day: attendance starts tomorrow');
select is((select count(*) from public.attendance_days where member_id = pg_temp.fx('newbie')), 0::bigint, 'and no row was opened');

select pg_temp.as_system();
update public.org_settings set weekly_off_days = array[extract(dow from pg_temp.today())::smallint];
select pg_temp.as_member('staff');
select throws_ok('select public.attendance_start_day()', 'P0001', 'INVALID_STATE', 'a day off (no row): Start day is refused, the note is the way');
select is((select count(*) from public.attendance_days where member_id = pg_temp.fx('staff')), 0::bigint, 'and no row was opened on the day off');
select throws_ok(
  $$ select public.attendance_choose_leave_today('leave') $$, 'P0001', 'INVALID_STATE', 'a leave choice on a day off is refused too');
select pg_temp.as_system();
update public.org_settings set weekly_off_days = '{}';
select pg_temp.as_member('offrow');
select throws_ok('select public.attendance_start_day()', 'P0001', 'INVALID_STATE', 'a row marked is_day_off (a 2.x day-off sign-in): Start day is refused');

select pg_temp.as_member('chose');
select throws_ok('select public.attendance_start_day()', 'P0001', 'INVALID_STATE', 'leave chosen this morning: Start day is refused');
select pg_temp.as_member('absent');
select throws_ok('select public.attendance_start_day()', 'P0001', 'INVALID_STATE', 'a decided absence: Start day is refused');

-- attendance_start_day: the ordinary morning -----------------------------------------------------
select pg_temp.as_member('staff');
select lives_ok('select public.attendance_start_day()', 'staff starts the day');
select results_eq(
  $$ select state::text, submitted_choice::text, first_login_at, started_at is not null, submitted_at = started_at, is_day_off
     from public.attendance_days where member_id = pg_temp.fx('staff') $$,
  $$ values ('pending_review', 'present', null::timestamptz, true, true, false) $$,
  'the day is opened and waits for the Owner as Present; the tap is the start; no sign-in time is invented');
select is(pg_temp.events((pg_temp.day_on('staff', pg_temp.today())).id), array['started'], 'one started event');
select is(pg_temp.audit_actions((pg_temp.day_on('staff', pg_temp.today())).id), array['opened', 'started'],
  'audited as opened then started');
select is((select actor_id from public.attendance_events where attendance_day_id = (pg_temp.day_on('staff', pg_temp.today())).id),
          pg_temp.fx('staff'), 'the member is the actor of their start');
select throws_ok('select public.attendance_start_day()', 'P0001', 'INVALID_STATE', 'a second Start day is refused');
select results_eq(
  $$ select state::text, started_at is not null, ended_at, yesterday_open_day_id from public.attendance_own_today() $$,
  $$ values ('pending_review', true, null::timestamptz, null::uuid) $$,
  'own_today reads the started day');
-- Two devices at once cannot give two starts: the second waits on the leave: lock and then sees
-- started_at (the row lock is under it); proved by the refusal above and pgTAP 12's lock order.

-- attendance_start_day: on approved leave -------------------------------------------------------
select pg_temp.as_member('leaver');
select lives_ok('select public.attendance_start_day()', 'a person on approved full leave who comes in starts their day');
select results_eq(
  $$ select d.state::text, d.submitted_choice::text, d.final_status, d.proposed_by_system, d.leave_request_id is not null, d.started_at is not null
     from public.attendance_days d where d.member_id = pg_temp.fx('leaver') $$,
  $$ values ('pending_review', 'present', null::public.day_status, false, true, true) $$,
  '"I''m working today": Present waits for the Owner, the leave request stays linked and untouched');
select is(pg_temp.events((pg_temp.day_on('leaver', pg_temp.today())).id), array['derived_from_leave', 'started'],
  'the day was derived from the leave, then started (from leave to present)');
select is((select to_status from public.attendance_events where attendance_day_id = (pg_temp.day_on('leaver', pg_temp.today())).id and action = 'started'),
          'present'::public.day_status, 'the started event records the move to present');
select is((select state from public.leave_requests where member_id = pg_temp.fx('leaver')), 'approved'::public.leave_state,
  'the leave itself is not altered (PRODUCT §4.2)');

select pg_temp.as_member('halfer');
select lives_ok('select public.attendance_start_day()', 'a half-day leave day: Start day is recorded');
select results_eq(
  $$ select d.state::text, d.final_status::text, d.proposed_by_system, d.submitted_choice, d.started_at is not null
     from public.attendance_days d where d.member_id = pg_temp.fx('halfer') $$,
  $$ values ('approved', 'half_day', true, null::public.attendance_choice, true) $$,
  'the half day stays a half day: only the start time moves');
select is(pg_temp.events((pg_temp.day_on('halfer', pg_temp.today())).id), array['derived_from_leave', 'started'], 'derived, then started');
select is((select leave_type from public.attendance_own_today()), 'half_day'::public.leave_type, 'own_today reports the half-day leave');

-- attendance_start_day: a 2.x gate Present (shared staging) ---------------------------------------
select pg_temp.as_member('gated');
select lives_ok('select public.attendance_start_day()', 'Present chosen at the 2.x gate, then Start day in 3b');
select results_eq(
  $$ select d.state::text, d.submitted_choice::text, d.first_login_at is not null, d.started_at is not null
     from public.attendance_days d where d.member_id = pg_temp.fx('gated') $$,
  $$ values ('pending_review', 'present', true, true) $$,
  'the gate choice stands, the sign-in time stays, the start is added (decision 28: either counts)');
select is(pg_temp.audit_actions((pg_temp.day_on('gated', pg_temp.today())).id), array['started'], 'one audit row, started');

-- attendance_choose_leave_today -----------------------------------------------------------------
select pg_temp.as_member('open');
select throws_ok($$ select public.attendance_choose_leave_today('present') $$, 'P0001', 'VALIDATION', 'present is not a leave choice');
select throws_ok($$ select public.attendance_choose_leave_today('comp_leave') $$, 'P0001', 'VALIDATION',
  'comp leave is not offered at the prompt (decision 16)');
select is((select count(*) from public.attendance_days where member_id = pg_temp.fx('open')), 0::bigint, 'a refused choice opens no row');
select is(public.attendance_choose_leave_today('half_day', 'Dentist'), 'pending_review'::public.attendance_state, 'a half day chosen at the prompt');
select results_eq(
  $$ select d.state::text, d.submitted_choice::text, d.first_login_at, d.started_at, r.source, r.state::text, r.reason
     from public.attendance_days d join public.leave_requests r on r.id = d.leave_request_id
     where d.member_id = pg_temp.fx('open') $$,
  $$ values ('pending_review', 'half_day', null::timestamptz, null::timestamptz, 'attendance', 'submitted', 'Dentist') $$,
  'the day is opened (no sign-in, no start) and the 2.1 source = attendance request is behind it');
select is(pg_temp.events((pg_temp.day_on('open', pg_temp.today())).id), array['submitted'], 'the event is the 2.1 submitted one');
select throws_ok($$ select public.attendance_choose_leave_today('leave') $$, 'P0001', 'INVALID_STATE', 'a second choice is refused (2.1 rule)');
-- A half day chosen at the prompt is still half a working day: Start and End stay available.
select lives_ok('select public.attendance_start_day()', 'a Start day after choosing a half day is recorded');
select results_eq(
  $$ select d.state::text, d.submitted_choice::text, d.started_at is not null from public.attendance_days d where d.member_id = pg_temp.fx('open') $$,
  $$ values ('pending_review', 'half_day', true) $$,
  'the half-day choice stands; only the start moves');
select pg_temp.as_member('newbie');
select throws_ok($$ select public.attendance_choose_leave_today('leave') $$, 'P0001', 'INVALID_STATE', 'the joining day cannot choose leave either');

-- attendance_end_day -----------------------------------------------------------------------------
select pg_temp.as_member('chose');
select throws_ok('select * from public.attendance_end_day()', 'P0001', 'INVALID_STATE', 'no started day: "Start your day first"');
select pg_temp.as_member('done');
select throws_ok('select * from public.attendance_end_day()', 'P0001', 'INVALID_STATE', 'a day that ended cannot end again (no resume)');
select is((select count(*) from public.attendance_events where attendance_day_id = (pg_temp.day_on('done', pg_temp.today())).id), 0::bigint,
  'and nothing was written');
select pg_temp.as_member('twice');
select throws_ok('select * from public.attendance_end_day()', 'P0001', 'INVALID_STATE',
  'today ended: a second End day is refused even with yesterday still open');
select is((pg_temp.day_on('twice', pg_temp.today() - 1)).ended_at, null::timestamptz, 'yesterday gets no made-up end');
select is((pg_temp.day_on('twice', pg_temp.today() - 1)).end_not_recorded, true, 'and keeps its flag');

select pg_temp.as_member('staff');
select results_eq(
  'select work_date from public.attendance_end_day()',
  $$ select pg_temp.today() $$,
  'staff ends today');
select results_eq(
  $$ select d.state::text, d.submitted_choice::text, d.ended_at is not null, d.ended_at >= d.started_at, d.end_not_recorded
     from public.attendance_days d where d.member_id = pg_temp.fx('staff') $$,
  $$ values ('pending_review', 'present', true, true, false) $$,
  'the end is recorded; the standing is untouched');
select is(pg_temp.events((pg_temp.day_on('staff', pg_temp.today())).id), array['started', 'ended'], 'started then ended');
select is((select (a.diff -> 'new') ? 'ended_at' and not ((a.diff -> 'new') ? 'end_not_recorded') and not ((a.diff -> 'new') ? 'state')
           from public.activity_log a where a.entity = 'attendance_days' and a.action = 'ended'
             and a.entity_id = (pg_temp.day_on('staff', pg_temp.today())).id),
          true, 'the ended audit diff holds ended_at alone (the flag was not set)');
select throws_ok('select * from public.attendance_end_day()', 'P0001', 'INVALID_STATE', 'End day is final: a second call is refused');
select throws_ok('select public.attendance_start_day()', 'P0001', 'INVALID_STATE', 'and there is no resume through Start day');
select is((select ended_at is not null from public.attendance_own_today()), true, 'own_today reads the end');

-- The late End day after midnight: no started day today, yesterday's open one is closed.
select pg_temp.as_member('late');
select results_eq(
  'select work_date from public.attendance_end_day()',
  $$ select pg_temp.today() - 1 $$,
  'an End day after midnight lands on yesterday''s day');
select results_eq(
  $$ select d.ended_at is not null, d.end_not_recorded, d.state::text from public.attendance_days d where d.member_id = pg_temp.fx('late') $$,
  $$ values (true, false, 'pending_review') $$,
  'yesterday''s day is ended and the 00:00 flag is cleared; nothing else moves');
select is((select (a.diff -> 'new') ? 'ended_at' and (a.diff -> 'new') ? 'end_not_recorded'
           from public.activity_log a where a.entity = 'attendance_days' and a.action = 'ended'
             and a.entity_id = (pg_temp.day_on('late', pg_temp.today() - 1)).id),
          true, 'the late end''s audit diff carries the cleared flag');
select throws_ok('select * from public.attendance_end_day()', 'P0001', 'INVALID_STATE', 'nothing left to end: "Start your day first"');

-- The Owner's correction of a started day leaves the start and end alone (protect_columns) -------
select pg_temp.as_member('owner');
select lives_ok(
  format($$ select public.attendance_decide(%L, 'correct', 'absent', 'Was not in') $$, (pg_temp.day_on('staff', pg_temp.today())).id),
  'the Owner corrects a started day');
select results_eq(
  $$ select d.state::text, d.final_status::text, d.started_at is not null, d.ended_at is not null
     from public.attendance_days d where d.member_id = pg_temp.fx('staff') $$,
  $$ values ('corrected', 'absent', true, true) $$,
  'the correction keeps the recorded start and end');

-- Direct writes to the new columns are refused for the API role (protect_columns + no grant) -----
select pg_temp.as_member('gated');
select throws_ok(
  format($$ update public.attendance_days set ended_at = now() where member_id = %L $$, pg_temp.fx('gated')),
  '42501', null, 'a member cannot end their own day by writing the column');

-- session_sign_out --------------------------------------------------------------------------------
select pg_temp.as_member('gated');
select lives_ok($$ select public.session_sign_out('Pixel', null) $$, 'sign out of this device records the logout event');
select is((select count(*) from public.session_events where member_id = pg_temp.fx('gated') and kind = 'logout'), 1::bigint, 'one logout event');
select results_eq(
  $$ select d.last_logout_at, d.ended_at, d.started_at is not null from public.attendance_days d where d.member_id = pg_temp.fx('gated') $$,
  $$ values (null::timestamptz, null::timestamptz, true) $$,
  'signing out touches no attendance day: neither the 2.x logout time nor the end');
select pg_temp.as_system();
select throws_ok($$ select public.session_sign_out() $$, 'P0001', 'UNAUTHENTICATED', 'nobody signed in: refused');

-- app.end_not_recorded ----------------------------------------------------------------------------
select pg_temp.as_system();
select throws_ok(
  format('select * from app.end_not_recorded(%L)', pg_temp.today() + 1),
  'P0001', 'INVALID_STATE', 'a day whose 23:59 has not passed is refused');
-- Yesterday: quit started and never ended; gated (today) and late (ended) are not flagged.
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at)
values (pg_temp.fx('quit'), pg_temp.today() - 1, 'pending_review', 'present',
        app.ist_day_start(pg_temp.today() - 1) + interval '10 hours', app.ist_day_start(pg_temp.today() - 1) + interval '10 hours');
-- halfer: a day for yesterday with no start (a leave day): never flagged.
insert into public.attendance_days (member_id, work_date, state, final_status, proposed_by_system, decided_at)
values (pg_temp.fx('halfer'), pg_temp.today() - 1, 'approved', 'leave', true, now());
delete from public.activity_log;
select results_eq(
  format('select member_id from app.end_not_recorded(%L)', pg_temp.today() - 1),
  $$ select pg_temp.fx('quit') $$,
  'exactly the started, unended day of that date is flagged');
select is((pg_temp.day_on('quit', pg_temp.today() - 1)).end_not_recorded, true, 'the flag is set');
select is((pg_temp.day_on('quit', pg_temp.today() - 1)).ended_at, null, 'no end time is made up');
select is(pg_temp.events((pg_temp.day_on('quit', pg_temp.today() - 1)).id), '{}'::text[], 'no event: the flag is a column, the audit row is its history');
select is(pg_temp.audit_actions((pg_temp.day_on('quit', pg_temp.today() - 1)).id), array['end_not_recorded'], 'audited as end_not_recorded');
select is((pg_temp.day_on('late', pg_temp.today() - 1)).end_not_recorded, false, 'a day that was ended late is left alone');
select is((pg_temp.day_on('halfer', pg_temp.today() - 1)).end_not_recorded, false, 'a day with no start is left alone');
select is((select count(*) from app.end_not_recorded(pg_temp.today() - 1)), 0::bigint, 'running twice writes nothing');
select is((select count(*) from app.end_not_recorded()), 0::bigint,
  'the default run (the last 7 dates up to the job day) finds nothing more');
-- A late End day after the job ran clears the flag (the 2.5 rule carried over).
select pg_temp.as_member('quit');
select lives_ok('select * from public.attendance_end_day()', 'quit ends yesterday after the job flagged it');
select is((pg_temp.day_on('quit', pg_temp.today() - 1)).end_not_recorded, false, 'the flag is cleared by the late end');

-- app.end_day_reminder_due -----------------------------------------------------------------------
select pg_temp.as_system();
select results_eq(
  'select member_id from app.end_day_reminder_due()',
  $$ select pg_temp.fx('gated') union all select pg_temp.fx('halfer') union all select pg_temp.fx('leaver') union all select pg_temp.fx('open') order by 1 $$,
  'the 20:30 reminder goes to everyone with a start and no end today (gated, halfer, leaver, open), not to staff or done');
select results_eq($$ select member_id from app.end_day_reminder_due(app.ist_day_start(pg_temp.today() - 1) + interval '20 hours 30 minutes') $$,
  $$ select pg_temp.fx('twice') $$,
  'for yesterday at 20:30 only twice is still due (both late ends were recorded; twice''s refused one was not)');

-- attendance_today_detail --------------------------------------------------------------------------
select pg_temp.as_member('staff');
select throws_ok('select * from public.attendance_today_detail()', 'P0001', 'FORBIDDEN', 'a member cannot read everyone''s day');
select pg_temp.as_member('owner');
select results_eq(
  $$ select started_at is not null, ended_at is not null, end_not_recorded
     from public.attendance_today_detail() where member_id = pg_temp.fx('staff') $$,
  $$ values (true, true, false) $$,
  'the Owner''s board reads the start and the end');
select results_eq(
  $$ select started, day_id is null, on_leave from public.attendance_today_detail() where member_id = pg_temp.fx('newbie') $$,
  $$ values (false, true, false) $$,
  'a person on their joining day: not started, no day');
select is((select count(*) from public.attendance_today_detail()),
          (select count(*) from public.attendance_today()),
          'the detail read lists the same people as the 2.4 read (expand-only)');

select * from finish();
rollback;
