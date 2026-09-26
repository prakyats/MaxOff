-- 2.5 Jobs (WORKFLOWS §1 "Settled in 2.5", §8; DATA-MODEL §3 "Jobs"): app.job_day at the IST
-- boundaries, the pg_cron rows, app.absent_check on every path (a working day, a weekly off day, a
-- holiday, no organization in scope, the Owner, a deactivated and an invited person, someone
-- whose attendance has not started, every day state, idempotency, the 7-day catch-up, the guard
-- on a day still running), app.logout_not_recorded (flagged, not flagged, other dates, twice,
-- the guard) and the late logout that clears the flag.
begin;
create extension if not exists pgtap with schema extensions;
select plan(86);

-- Fixtures as 07: keep the organization, replace the people. Rolled back at the end.
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
-- Every weekday is a working day for this file; the day-off tests set what they need.
update public.org_settings set weekly_off_days = '{}';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',   '00000000-0000-4000-8000-000000000101'),
  ('admin',   '00000000-0000-4000-8000-000000000102'),
  ('staff',   '00000000-0000-4000-8000-000000000103'),
  ('staff2',  '00000000-0000-4000-8000-000000000104'),
  ('worker',  '00000000-0000-4000-8000-000000000105'),
  ('done',    '00000000-0000-4000-8000-000000000106'),
  ('fixed',   '00000000-0000-4000-8000-000000000107'),
  ('offrow',  '00000000-0000-4000-8000-000000000108'),
  ('newbie',  '00000000-0000-4000-8000-000000000109'),
  ('missed',  '00000000-0000-4000-8000-000000000110'),
  ('leaver',  '00000000-0000-4000-8000-000000000111'),
  ('invited', '00000000-0000-4000-8000-000000000112'),
  ('fresh',   '00000000-0000-4000-8000-000000000113'),
  ('lo1',     '00000000-0000-4000-8000-000000000114'),
  ('lo2',     '00000000-0000-4000-8000-000000000115'),
  ('lo3',     '00000000-0000-4000-8000-000000000116'),
  ('lo4',     '00000000-0000-4000-8000-000000000117');
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

-- The job day, and dates relative to it (L = the last date a nightly run covers right now).
create temporary table jd as select app.job_day(now(), '23:59') as l;
grant select on jd to authenticated, anon, service_role;
create function pg_temp.d(offset_days integer) returns date language sql stable as $$
  select l + offset_days from jd;
$$;

create function pg_temp.day_on(k text, d date) returns uuid language sql stable as $$
  select x.id from public.attendance_days x where x.member_id = pg_temp.fx(k) and x.work_date = d;
$$;

-- Fixture rows written as the owner (in_transition() is true, so the guards pass).
create function pg_temp.mk_day(
  k text, d date, st public.attendance_state, ch public.attendance_choice, fs public.day_status,
  proposed boolean, login boolean default true, day_off boolean default false, logout boolean default false)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.attendance_days (
    member_id, work_date, first_login_at, is_day_off, state, submitted_choice, submitted_at,
    proposed_by_system, final_status, decided_at, decided_by, last_logout_at)
  values (
    pg_temp.fx(k), d, case when login then app.ist_day_start(d) + interval '9 hours' end, day_off, st, ch,
    case when ch is not null then app.ist_day_start(d) + interval '9 hours' end, proposed, fs,
    case when st in ('approved', 'corrected') then now() end,
    case when st in ('approved', 'corrected') and not proposed then pg_temp.fx('owner') end,
    case when logout then app.ist_day_start(d) + interval '18 hours' end)
  returning id into v;
  return v;
end;
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

insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, s::public.member_status, j, x
from (values
  ('owner',   'owner', 'active',      now() - interval '30 days', null::timestamptz),
  ('admin',   'admin', 'active',      now() - interval '30 days', null),
  ('staff',   'staff', 'active',      now() - interval '30 days', null),
  ('staff2',  'staff', 'active',      now() - interval '30 days', null),
  ('worker',  'staff', 'active',      now() - interval '30 days', null),
  ('done',    'staff', 'active',      now() - interval '30 days', null),
  ('fixed',   'staff', 'active',      now() - interval '30 days', null),
  ('offrow',  'staff', 'active',      now() - interval '30 days', null),
  -- Joined on L-1: attendance starts on L (WORKFLOWS §1, 2.2).
  ('newbie',  'staff', 'active',      app.ist_day_start(pg_temp.d(-1)) + interval '11 hours', null),
  ('missed',  'staff', 'active',      now() - interval '30 days', null),
  ('leaver',  'staff', 'deactivated', now() - interval '30 days', now() - interval '2 days'),
  ('invited', 'admin', 'invited',     null, null),
  ('fresh',   'staff', 'active',      now() - interval '30 days', null),
  ('lo1',     'staff', 'active',      now() - interval '30 days', null),
  ('lo2',     'staff', 'active',      now() - interval '30 days', null),
  ('lo3',     'staff', 'active',      now() - interval '30 days', null),
  ('lo4',     'staff', 'active',      now() - interval '30 days', null)
) as v(k, r, s, j, x);
delete from public.activity_log; -- the fixture writes are not under test

-- Structure and grants ---------------------------------------------------------------------------
select has_function('app', 'job_day', array['timestamp with time zone', 'time without time zone'], 'app.job_day exists');
select has_function('app', 'attendance_open_day', array['uuid', 'date', 'timestamp with time zone'], 'app.attendance_open_day exists');
select has_function('app', 'absent_check', array['date'], 'app.absent_check exists');
select has_function('app', 'logout_not_recorded', array['date'], 'app.logout_not_recorded exists');
select ok(
  not has_function_privilege('authenticated', 'app.absent_check(date)', 'execute')
  and not has_function_privilege('authenticated', 'app.logout_not_recorded(date)', 'execute')
  and not has_function_privilege('authenticated', 'app.attendance_open_day(uuid, date, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.absent_check(date)', 'execute'),
  'the API role cannot run a job or open another member''s day');
select ok(
  has_function_privilege('service_role', 'app.absent_check(date)', 'execute')
  and has_function_privilege('service_role', 'app.logout_not_recorded(date)', 'execute')
  and has_function_privilege('authenticated', 'app.job_day(timestamptz, time)', 'execute'),
  'service_role may run the jobs; job_day is a plain helper');

select results_eq(
  $$ select jobname::text, schedule, command, active from cron.job
     where jobname in ('absent_check', 'logout_not_recorded') order by jobname $$,
  $$ values ('absent_check', '29 18 * * *', 'select app.absent_check()', true),
            ('logout_not_recorded', '30 18 * * *', 'select app.logout_not_recorded()', true) $$,
  'pg_cron runs absent_check at 23:59 IST and logout_not_recorded at 00:00 IST');

-- job_day: the IST boundaries ------------------------------------------------------------------
select is(app.job_day('2026-09-25 18:29:00+00', '23:59'), date '2026-09-25', '23:59 IST is that day');
select is(app.job_day('2026-09-25 18:28:59+00', '23:59'), date '2026-09-24', 'a second before the cutoff is still yesterday');
select is(app.job_day('2026-09-25 18:30:00+00', '23:59'), date '2026-09-25', '00:00 IST the next day is the day that just ended');
select is(app.job_day('2026-09-26 05:00:00+00', '23:59'), date '2026-09-25', '10:30 IST the next morning is still the day that ended');
select is(app.job_day('2026-09-26 18:29:00+00', '23:59'), date '2026-09-26', 'the next 23:59 moves on');
select is(app.job_day('2026-09-25 15:00:00+00', '20:30'), date '2026-09-25', 'another cutoff (20:30 IST) works the same way');

-- absent_check: the guard and no organization in scope ----------------------------------------
select throws_ok(
  format('select * from app.absent_check(%L)', pg_temp.d(1)),
  'P0001', 'INVALID_STATE', 'a day whose 23:59 has not passed is refused');

-- A second organization makes app.current_org_id() null (undone with a savepoint: the deletes
-- are audited and the audit rows point at the organization).
savepoint two_orgs;
insert into public.organizations (id, name) values ('00000000-0000-4000-8000-0000000000ee', 'Second Org');
select throws_ok(
  format('select * from app.absent_check(%L)', pg_temp.d(-1)),
  'P0001', 'INVALID_STATE', 'with no single organization in scope the check refuses to act');
rollback to savepoint two_orgs;

-- absent_check: a day off writes nothing -------------------------------------------------------
-- worker is on approved leave over L-1 and never logged in: on a day off not even that is written.
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at)
values (pg_temp.fx('worker'), 'leave', pg_temp.d(-1), pg_temp.d(-1), 'approved', 'form', pg_temp.fx('owner'), now());
delete from public.activity_log;

update public.org_settings set weekly_off_days = array[extract(dow from pg_temp.d(-1))::smallint];
select is((select count(*) from app.absent_check(pg_temp.d(-1))), 0::bigint, 'a weekly off day: nothing written');
select is((select count(*) from public.attendance_days), 0::bigint, 'a weekly off day: no day for anyone, the person on leave included');
update public.org_settings set weekly_off_days = '{}';

insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), pg_temp.d(-1), 'Test Holiday');
select is((select count(*) from app.absent_check(pg_temp.d(-1))), 0::bigint, 'a holiday: nothing written');
select is((select count(*) from public.attendance_days), 0::bigint, 'a holiday: no day for anyone');
delete from public.holidays;
delete from public.activity_log;

-- absent_check: a working day (L-1), every state -----------------------------------------------
-- staff: no row. staff2: logged in, never chose. worker: on leave, never logged in.
-- admin: chose Present, waiting. done: approved. fixed: corrected. offrow: awaiting, marked day
-- off. newbie: attendance starts on L. missed: no row (kept for the catch-up). leaver: deactivated.
-- invited: never joined. owner: exempt. fresh and lo1-lo4 (arranged further down) have no row
-- yet either, so they are proposed too.
select pg_temp.mk_day('staff2', pg_temp.d(-1), 'awaiting_choice', null, null, false);
select pg_temp.mk_day('admin',  pg_temp.d(-1), 'pending_review', 'present', null, false);
select pg_temp.mk_day('done',   pg_temp.d(-1), 'approved', 'present', 'present', false);
select pg_temp.mk_day('fixed',  pg_temp.d(-1), 'corrected', null, 'half_day', false, false);
select pg_temp.mk_day('offrow', pg_temp.d(-1), 'awaiting_choice', null, null, false, true, true);
delete from public.activity_log;

create temporary table run1 as select * from app.absent_check(pg_temp.d(-1));

select results_eq(
  $$ select member_id, outcome, work_date from run1 order by member_id $$,
  $$ select pg_temp.fx(k), o, pg_temp.d(-1) from (values
       ('staff', 'proposed_absent'), ('staff2', 'proposed_absent'), ('worker', 'derived_from_leave'),
       ('missed', 'proposed_absent'), ('fresh', 'proposed_absent'), ('lo1', 'proposed_absent'),
       ('lo2', 'proposed_absent'), ('lo3', 'proposed_absent'), ('lo4', 'proposed_absent')) as v(k, o) order by 1 $$,
  'the run reports exactly the days it wrote: a leave-derived day and a proposal for everyone else without one');
select is((select count(*) from run1 where member_id in (select id from fx where key in ('owner', 'admin', 'done', 'fixed', 'offrow', 'newbie', 'leaver', 'invited'))),
  0::bigint, 'nothing for the Owner, a decided or waiting day, a day-off row, an unstarted, deactivated or invited person');
select is((select count(*) from public.attendance_days where member_id in (select id from fx where key in ('owner', 'newbie', 'leaver', 'invited'))),
  0::bigint, 'no day was opened for the Owner, the newcomer, the deactivated or the invited person');

-- staff: no row -> a proposed absence with no login.
select results_eq(
  format($$ select state::text, final_status::text, proposed_by_system, submitted_choice::text, first_login_at, is_day_off, decided_by
            from public.attendance_days where id = %L $$, pg_temp.day_on('staff', pg_temp.d(-1))),
  $$ values ('pending_review', 'absent', true, null::text, null::timestamptz, false, null::uuid) $$,
  'no row: pending_review, absent, proposed by the system, no login');
select is(pg_temp.events(pg_temp.day_on('staff', pg_temp.d(-1))), '{proposed_absent}', 'no row: one proposed_absent event');
select is(pg_temp.audit_actions(pg_temp.day_on('staff', pg_temp.d(-1))), '{proposed_absent}', 'no row: one audit row, labelled proposed_absent');
select is((select actor_id from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day_on('staff', pg_temp.d(-1))),
  null, 'the audit row has no actor: the system');
select is((select to_status::text from public.attendance_events where attendance_day_id = pg_temp.day_on('staff', pg_temp.d(-1))),
  'absent', 'the event says absent');

-- staff2: awaiting_choice -> proposed, the login kept.
select results_eq(
  format($$ select state::text, final_status::text, proposed_by_system, first_login_at is not null
            from public.attendance_days where id = %L $$, pg_temp.day_on('staff2', pg_temp.d(-1))),
  $$ values ('pending_review', 'absent', true, true) $$,
  'awaiting_choice counts as no submission: proposed, first_login_at kept');
select is(pg_temp.events(pg_temp.day_on('staff2', pg_temp.d(-1))), '{proposed_absent}', 'awaiting_choice: one proposed_absent event');
select is(pg_temp.audit_actions(pg_temp.day_on('staff2', pg_temp.d(-1))), '{proposed_absent}', 'awaiting_choice: one audit row');

-- worker: approved leave, never logged in -> a derived day, never proposed absent.
select results_eq(
  format($$ select state::text, final_status::text, proposed_by_system, first_login_at, leave_request_id is not null, decided_at is not null
            from public.attendance_days where id = %L $$, pg_temp.day_on('worker', pg_temp.d(-1))),
  $$ values ('approved', 'leave', true, null::timestamptz, true, true) $$,
  'approved leave becomes an approved leave day with no login');
select is(pg_temp.events(pg_temp.day_on('worker', pg_temp.d(-1))), '{derived_from_leave}', 'leave: one derived_from_leave event');
select is(pg_temp.audit_actions(pg_temp.day_on('worker', pg_temp.d(-1))), '{derived_from_leave}', 'leave: one audit row, labelled derived_from_leave');

-- The untouched ones.
select is((select state::text from public.attendance_days where id = pg_temp.day_on('admin', pg_temp.d(-1))), 'pending_review', 'a submitted day waits as it was');
select is((select state::text || '/' || final_status::text from public.attendance_days where id = pg_temp.day_on('done', pg_temp.d(-1))), 'approved/present', 'an approved day stays');
select is((select state::text || '/' || final_status::text from public.attendance_days where id = pg_temp.day_on('fixed', pg_temp.d(-1))), 'corrected/half_day', 'a corrected day stays');
select is((select state::text from public.attendance_days where id = pg_temp.day_on('offrow', pg_temp.d(-1))), 'awaiting_choice', 'a row marked is_day_off is never proposed absent');
select is((select count(*) from public.activity_log where entity = 'attendance_days'
            and entity_id in (select id from public.attendance_days where member_id in (select id from fx where key in ('admin', 'done', 'fixed', 'offrow')))),
  0::bigint, 'the untouched days got no audit row');

-- Idempotent: the same date again writes nothing.
create temporary table before2 as
  select (select count(*) from public.attendance_days) as days,
         (select count(*) from public.attendance_events) as events,
         (select count(*) from public.activity_log) as audits;
select is((select count(*) from app.absent_check(pg_temp.d(-1))), 0::bigint, 'the same date again reports nothing');
select results_eq(
  $$ select (select count(*) from public.attendance_days), (select count(*) from public.attendance_events), (select count(*) from public.activity_log) $$,
  $$ select days, events, audits from before2 $$,
  'and writes no day, event or audit row');

-- The Owner approves a proposed absence through the existing path (2.1).
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day_on('staff', pg_temp.d(-1)), 'approve'), 'approved', 'the Owner approves the proposed absence');
select pg_temp.as_system();
select results_eq(
  format($$ select state::text, final_status::text, decided_by from public.attendance_days where id = %L $$, pg_temp.day_on('staff', pg_temp.d(-1))),
  format($$ values ('approved', 'absent', %L::uuid) $$, pg_temp.fx('owner')),
  'approved absent, decided by the Owner');
select is(pg_temp.events(pg_temp.day_on('staff', pg_temp.d(-1))), '{proposed_absent,approved}', 'the history reads proposed, then approved');

-- attendance_touch on a day the job opened: first_login_at is set, nothing else moves. (The job
-- never opens today's day before 23:59, so the row is arranged; the touch path is the one 2.5
-- re-created.)
select pg_temp.mk_day('fresh', app.today_ist(), 'pending_review', null, 'absent', true, false);
delete from public.activity_log;
select pg_temp.as_member('fresh');
select results_eq(
  $$ select state::text, gate_required, final_status::text, proposed_by_system from public.attendance_touch() $$,
  $$ values ('pending_review', false, 'absent', true) $$,
  'touch on a job-opened day: no gate, the proposal stands');
select pg_temp.as_system();
select ok((select first_login_at is not null from public.attendance_days where id = pg_temp.day_on('fresh', app.today_ist())),
  'touch stamps first_login_at on the job-opened day');
select is(pg_temp.audit_actions(pg_temp.day_on('fresh', app.today_ist())), '{first_login}', 'audited as first_login');
select is((select count(*) from public.session_events where member_id = pg_temp.fx('fresh') and kind = 'login'), 1::bigint,
  'and the login event is recorded');

-- attendance_touch still opens today's day the 2.4 way (through app.attendance_open_day).
select pg_temp.as_member('staff');
select results_eq(
  $$ select state::text, gate_required from public.attendance_touch() $$,
  $$ values ('awaiting_choice', true) $$,
  'touch opens today''s day awaiting a choice');
select pg_temp.as_system();
select ok((select first_login_at is not null from public.attendance_days where id = pg_temp.day_on('staff', app.today_ist())), 'with the login time');
select is(pg_temp.audit_actions(pg_temp.day_on('staff', app.today_ist())), '{opened}', 'audited as opened');
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at)
values (pg_temp.fx('worker'), 'half_day', app.today_ist(), app.today_ist(), 'approved', 'form', pg_temp.fx('owner'), now());
select pg_temp.as_member('worker');
select results_eq(
  $$ select state::text, gate_required, final_status::text, proposed_by_system, leave_request_id is not null from public.attendance_touch() $$,
  $$ values ('approved', false, 'half_day', true, true) $$,
  'touch derives today''s day from approved leave');
select pg_temp.as_system();
select is(pg_temp.events(pg_temp.day_on('worker', app.today_ist())), '{derived_from_leave}', 'with the derived_from_leave event');
select is(pg_temp.audit_actions(pg_temp.day_on('worker', app.today_ist())), '{derived_from_leave}', 'and audit row');

-- absent_check: the 7-day catch-up -------------------------------------------------------------
-- A missed night: nobody has a row on L-2 (or L-3 .. L-6). The default run covers L-6 .. L, oldest
-- first; L-1 is already processed for the people who have rows there.
delete from public.attendance_events where attendance_day_id in (select id from public.attendance_days where work_date = app.today_ist());
delete from public.attendance_days where work_date = app.today_ist(); -- keep today out of the counts
delete from public.leave_requests where start_date = app.today_ist();
delete from public.activity_log;
create temporary table run2 as select * from app.absent_check();

select is((select min(work_date) from run2), pg_temp.d(-6), 'the catch-up starts six days before the job day');
select is((select max(work_date) from run2), pg_temp.d(0), 'and ends at the job day');
select is((select count(*) from run2 where work_date < pg_temp.d(-6)), 0::bigint, 'nothing before the window');
select is((select outcome from run2 where member_id = pg_temp.fx('missed') and work_date = pg_temp.d(-2)), 'proposed_absent',
  'a missed day two nights back is proposed on the next run');
select is((select count(*) from run2 where member_id = pg_temp.fx('missed')), 6::bigint,
  'every other date of the window is filled for someone with no rows (L-1 was done by the single-date run)');
select is((select count(*) from run2 where work_date = pg_temp.d(-1)), 0::bigint, 'a processed date writes nothing at all');
select is((select count(*) from run2 where member_id = pg_temp.fx('newbie') and work_date < pg_temp.d(0)), 0::bigint,
  'a date before the member''s first attendance day is still skipped');
select is((select outcome from run2 where member_id = pg_temp.fx('newbie') and work_date = pg_temp.d(0)), 'proposed_absent',
  'and their first attendance day is proposed');
select is((select count(*) from run2 where member_id in (select id from fx where key in ('owner', 'leaver', 'invited'))), 0::bigint,
  'the Owner, the deactivated and the invited person are never in a catch-up either');
select is((select count(*) from run2 where outcome = 'derived_from_leave'), 0::bigint,
  'no leave covers the other dates, so every catch-up row is a proposal');

create temporary table before3 as
  select (select count(*) from public.attendance_days) as days,
         (select count(*) from public.attendance_events) as events,
         (select count(*) from public.activity_log) as audits;
select is((select count(*) from app.absent_check()), 0::bigint, 'a fully processed week reports nothing');
select results_eq(
  $$ select (select count(*) from public.attendance_days), (select count(*) from public.attendance_events), (select count(*) from public.activity_log) $$,
  $$ select days, events, audits from before3 $$,
  'and writes nothing');

-- logout_not_recorded ---------------------------------------------------------------------------
-- lo1: login, no logout on L-1 -> flagged. lo2: logged out -> not. lo3: login, no logout on L-2 ->
-- only the catch-up reaches it. staff's proposed row on L-1 has no login -> not. (The catch-up
-- above proposed absences for the lo people; those rows make way for the arranged ones.)
delete from public.attendance_events where attendance_day_id in (select id from public.attendance_days where member_id in (select id from fx where key like 'lo%'));
delete from public.attendance_days where member_id in (select id from fx where key like 'lo%');
select pg_temp.mk_day('lo1', pg_temp.d(-1), 'approved', 'present', 'present', false, true, false, false);
select pg_temp.mk_day('lo2', pg_temp.d(-1), 'approved', 'present', 'present', false, true, false, true);
select pg_temp.mk_day('lo3', pg_temp.d(-2), 'pending_review', 'present', null, false, true, false, false);
delete from public.activity_log;

select throws_ok(
  format('select * from app.logout_not_recorded(%L)', pg_temp.d(1)),
  'P0001', 'INVALID_STATE', 'logout_not_recorded refuses a day still running');

create temporary table lrun1 as select * from app.logout_not_recorded(pg_temp.d(-1));
select results_eq(
  $$ select member_id from lrun1 where member_id in (select id from fx where key like 'lo%') $$,
  $$ select pg_temp.fx('lo1') $$,
  'of the arranged people, the one with a login and no logout is flagged');
select ok((select bool_and(work_date = pg_temp.d(-1)) from lrun1), 'a single-date run reports that date only');
select ok((select logout_not_recorded from public.attendance_days where id = pg_temp.day_on('lo1', pg_temp.d(-1))), 'lo1 is flagged');
select ok((select not logout_not_recorded from public.attendance_days where id = pg_temp.day_on('lo2', pg_temp.d(-1))), 'a day with a logout is not');
select ok((select not logout_not_recorded from public.attendance_days where id = pg_temp.day_on('staff', pg_temp.d(-1))), 'a day with no login is not');
select ok((select not logout_not_recorded from public.attendance_days where id = pg_temp.day_on('lo3', pg_temp.d(-2))), 'another date is not touched by a single-date run');
select is(pg_temp.audit_actions(pg_temp.day_on('lo1', pg_temp.d(-1))), '{logout_not_recorded}', 'audited as logout_not_recorded');
select is((select diff -> 'new' from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day_on('lo1', pg_temp.d(-1))),
  '{"logout_not_recorded": true}'::jsonb, 'the audit diff holds the flag alone');
select is(pg_temp.events(pg_temp.day_on('lo1', pg_temp.d(-1))), '{}', 'no event row: the flag is a column');
select is((select state::text || '/' || final_status::text from public.attendance_days where id = pg_temp.day_on('lo1', pg_temp.d(-1))), 'approved/present',
  'the Owner''s decision is untouched');

select is((select count(*) from app.logout_not_recorded(pg_temp.d(-1))), 0::bigint, 'the same date again flags nothing');
select is((select count(*) from public.activity_log where entity = 'attendance_days' and action = 'logout_not_recorded' and entity_id = pg_temp.day_on('lo1', pg_temp.d(-1))), 1::bigint, 'and writes no second audit row');

create temporary table lrun2 as select * from app.logout_not_recorded();
select results_eq(
  $$ select member_id, work_date from lrun2 $$,
  $$ select pg_temp.fx('lo3'), pg_temp.d(-2) $$,
  'the catch-up reaches the missed date and nothing else');
select is((select count(*) from app.logout_not_recorded()), 0::bigint, 'a processed week flags nothing');

-- A logout after midnight clears the flag (owner decision 2026-09-25). lo4 logged in yesterday
-- (IST), never logged out, the 00:00 job flagged the day; they log out now with no day today.
select pg_temp.mk_day('lo4', app.today_ist() - 1, 'pending_review', 'present', null, false, true, false, false);
select is((select count(*) from app.logout_not_recorded(app.today_ist() - 1) where member_id = pg_temp.fx('lo4')), 1::bigint, 'lo4''s day is flagged');
delete from public.activity_log;
select pg_temp.as_member('lo4');
select lives_ok('select public.session_logout()', 'lo4 logs out after midnight');
select pg_temp.as_system();
select results_eq(
  format($$ select last_logout_at is not null, logout_not_recorded, state::text from public.attendance_days where id = %L $$, pg_temp.day_on('lo4', app.today_ist() - 1)),
  $$ values (true, false, 'pending_review') $$,
  'the late logout is recorded on yesterday''s day and clears the flag; the state is untouched');
select is(
  (select (diff -> 'new') - 'last_logout_at'::text from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day_on('lo4', app.today_ist() - 1) and action = 'logout'),
  '{"logout_not_recorded": false}'::jsonb, 'the logout audit diff holds last_logout_at and the cleared flag, nothing else');
select is(pg_temp.events(pg_temp.day_on('lo4', app.today_ist() - 1)), '{logout}', 'with the logout event');
select is((select count(*) from public.attendance_days where member_id = pg_temp.fx('lo4') and work_date = app.today_ist()), 0::bigint, 'no day was opened for today');

select * from finish();
rollback;
