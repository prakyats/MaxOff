-- /review-phase 3b (PROGRESS "Phase 3b review decisions", migration 20260928063232):
-- the late End day cutoff (04:59 lands on yesterday, 05:01 is refused with a clear message, never
-- once today's Start day exists), attendance_today_detail per role, comp leave never on a weekly
-- day off or a holiday, comp_leave_dates(), a holiday on a comp leave date cancelling the request
-- and giving the credit back, and the idempotent standalone grant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

-- Fixtures as 25: keep the organization, replace the people. Rolled back at the end.
delete from public.expense_claims;
delete from public.comp_leave_credit_uses;
delete from public.comp_leave_credits;
delete from public.extra_work_notes;
delete from public.attendance_events;
delete from public.attendance_days;
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
-- 4A: task rows and coordinator rows reference members (a Playwright run leaves some behind).
delete from public.task_warnings;
delete from public.task_reviews;
delete from public.task_submissions;
delete from public.task_comments;
delete from public.task_stages;
delete from public.task_assignees;
delete from public.tasks;
delete from public.member_coordinators;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}', end_day_cutoff_time = '05:00';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',   '00000000-0000-4000-8000-000000000401'),
  ('admin',   '00000000-0000-4000-8000-000000000402'),
  ('staff',   '00000000-0000-4000-8000-000000000403'),
  ('early',   '00000000-0000-4000-8000-000000000404'),
  ('tardy',   '00000000-0000-4000-8000-000000000405'),
  ('started', '00000000-0000-4000-8000-000000000406'),
  ('hol',     '00000000-0000-4000-8000-000000000407'),
  ('hol2',    '00000000-0000-4000-8000-000000000408'),
  ('plain',   '00000000-0000-4000-8000-000000000409'),
  ('moved',   '00000000-0000-4000-8000-000000000410');
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

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
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
  select * from public.attendance_days where member_id = pg_temp.fx(k) and work_date = d;
$$;

create function pg_temp.request_on(k text, d date) returns public.leave_requests language sql stable as $$
  select r.* from public.leave_requests r
  where r.member_id = pg_temp.fx(k) and r.start_date = d and r.supersedes_id is null;
$$;

-- The human message app.fail() puts in DETAIL.
create function pg_temp.fail_detail(q text) returns text language plpgsql as $$
declare v text;
begin
  execute q;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return v;
end;
$$;

-- The IST time of day now, moved by some minutes and kept inside the day: "a minute before the
-- cutoff" and "a minute after it" without waiting for 05:00.
create function pg_temp.cutoff_from_now(minutes integer) returns time language sql stable as $$
  select greatest(least(((now() at time zone 'Asia/Kolkata') + make_interval(mins => minutes))::time,
                        time '23:59:59'), time '00:00');
$$;

create function pg_temp.balance(k text) returns numeric language plpgsql as $$
declare v numeric;
begin
  perform pg_temp.as_member(k);
  select available_days into v from public.comp_leave_balance();
  return v;
end;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('staff', 'staff'), ('early', 'staff'),
             ('tardy', 'staff'), ('started', 'staff'), ('hol', 'staff'), ('hol2', 'staff'),
             ('plain', 'staff'), ('moved', 'staff')) as v(k, r);

-- early, tardy and started each left yesterday open; the 00:00 job flagged it.
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at, end_not_recorded)
select pg_temp.fx(k), pg_temp.today() - 1, 'pending_review', 'present',
       app.ist_day_start(pg_temp.today() - 1) + interval '9 hours', app.ist_day_start(pg_temp.today() - 1) + interval '9 hours', true
from unnest(array['early', 'tardy', 'started']) as k;
-- started has also started today.
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at)
values (pg_temp.fx('started'), pg_temp.today(), 'pending_review', 'present', now() - interval '1 hour', now() - interval '1 hour');
delete from public.activity_log;

-- The setting and the rule --------------------------------------------------------------------------
select has_column('public', 'org_settings', 'end_day_cutoff_time', 'org_settings.end_day_cutoff_time exists');
select is((select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'org_settings' and column_name = 'end_day_cutoff_time'),
  $$'05:00:00'::time without time zone$$, 'the cutoff defaults to 05:00');
select ok(has_column_privilege('authenticated', 'public.org_settings', 'end_day_cutoff_time', 'update'),
  'the cutoff is in the API update grant (settings.manage decides by RLS)');
select ok(not has_function_privilege('authenticated', 'app.end_day_cutoff(uuid)', 'execute'), 'the org lookup is internal');
select is(app.end_day_late_allowed(timestamptz '2026-09-29 04:59:00+05:30', time '05:00'), true, '04:59 IST is before the cutoff');
select is(app.end_day_late_allowed(timestamptz '2026-09-29 05:00:00+05:30', time '05:00'), false, '05:00 IST is the cutoff itself');
select is(app.end_day_late_allowed(timestamptz '2026-09-29 05:01:00+05:30', time '05:00'), false, '05:01 IST is past it');
select is(app.end_day_late_allowed(timestamptz '2026-09-28 23:29:00+00:00', time '05:00'), true,
  'the IST clock decides, not UTC: 23:29 UTC is 04:59 IST');

-- Staff: Owner-only settings ---------------------------------------------------------------------
select pg_temp.as_member('staff');
select lives_ok($$ update public.org_settings set end_day_cutoff_time = '09:00' $$, 'a Staff update runs');
select pg_temp.as_system();
select is((select end_day_cutoff_time from public.org_settings limit 1), time '05:00', 'but changes nothing (RLS: settings.manage)');

-- The late End day, a minute before the cutoff ("04:59"): it lands on yesterday ------------------
update public.org_settings set end_day_cutoff_time = pg_temp.cutoff_from_now(1);
select pg_temp.as_member('early');
select is((select yesterday_open_day_id from public.attendance_own_today()), (pg_temp.day_on('early', pg_temp.today() - 1)).id,
  'before the cutoff the strip is offered yesterday''s end');
select results_eq($$ select work_date from public.attendance_end_day() $$,
  $$ values (pg_temp.today() - 1) $$, 'before the cutoff End day lands on yesterday');
select pg_temp.as_system();
select results_eq(
  $$ select d.ended_at is not null, d.end_not_recorded from public.attendance_days d
     where d.member_id = pg_temp.fx('early') and d.work_date = pg_temp.today() - 1 $$,
  $$ values (true, false) $$, 'yesterday has its real end and the flag is cleared');

-- A minute after it ("05:01"): refused, with the reason ----------------------------------------
update public.org_settings set end_day_cutoff_time = pg_temp.cutoff_from_now(-1);
select pg_temp.as_member('tardy');
select is((select yesterday_open_day_id from public.attendance_own_today()), null,
  'past the cutoff the strip no longer offers yesterday''s end');
select throws_ok($$ select * from public.attendance_end_day() $$, 'P0001', 'INVALID_STATE', 'past the cutoff End day is refused');
select matches(pg_temp.fail_detail('select * from public.attendance_end_day()'),
  '^Yesterday''s day can be ended only until [0-2][0-9]:[0-5][0-9]\. It stays "End of day not recorded"; add an overtime note for the late work\.$',
  'the message names the cutoff and the way out');
select lives_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today() - 1, 'Finished the edit at 1 am', 90) $$,
  'the late work goes in an overtime note instead');
select pg_temp.as_system();
select results_eq(
  $$ select d.ended_at is null, d.end_not_recorded from public.attendance_days d
     where d.member_id = pg_temp.fx('tardy') and d.work_date = pg_temp.today() - 1 $$,
  $$ values (true, true) $$, 'yesterday stays "End of day not recorded", nothing made up');
select is((select count(*) from public.activity_log where entity = 'attendance_days' and actor_id = pg_temp.fx('tardy')),
  0::bigint, 'a refused End day writes no history');

-- After today's Start day: never yesterday, whatever the time -----------------------------------
update public.org_settings set end_day_cutoff_time = '23:59:59';
select pg_temp.as_member('started');
select is((select yesterday_open_day_id from public.attendance_own_today()), (pg_temp.day_on('started', pg_temp.today() - 1)).id,
  'the read still reports the open yesterday before the cutoff ...');
select is((select day_id from public.attendance_own_today()), (pg_temp.day_on('started', pg_temp.today())).id,
  '... but today has a day, so the strip shows today (describeTodayStrip needs no day)');
select results_eq($$ select work_date from public.attendance_end_day() $$,
  $$ values (pg_temp.today()) $$, 'End day ends today''s started day, not yesterday''s');
select throws_ok($$ select * from public.attendance_end_day() $$, 'P0001', 'INVALID_STATE',
  'a second End day after today''s Start day is refused, not moved onto yesterday');
select pg_temp.as_system();
select is((pg_temp.day_on('started', pg_temp.today() - 1)).ended_at, null, 'yesterday is never ended once today started');
update public.org_settings set end_day_cutoff_time = '05:00';

-- attendance_today_detail per role -------------------------------------------------------------
select pg_temp.as_member('owner');
select results_eq(
  $$ select t.started_at is not null, t.ended_at is not null, t.end_not_recorded
     from public.attendance_today_detail() t where t.member_id = pg_temp.fx('started') $$,
  $$ values (true, true, false) $$, 'the Owner reads a day''s start, end and flag');
select is((select count(*) from public.attendance_today_detail() t where t.member_id = pg_temp.fx('tardy') and t.started_at is null),
  1::bigint, 'the Owner reads a member who has not started today');
select pg_temp.as_member('admin');
select throws_ok($$ select * from public.attendance_today_detail() $$, 'P0001', 'FORBIDDEN', 'an Admin cannot read everyone''s day');
select pg_temp.as_member('staff');
select throws_ok($$ select * from public.attendance_today_detail() $$, 'P0001', 'FORBIDDEN', 'Staff cannot read everyone''s day');
select pg_temp.as_anon();
select throws_ok($$ select * from public.attendance_today_detail() $$, '42501', null, 'anon cannot call it');

-- Comp leave never on a day off ------------------------------------------------------------------
-- A credit valid for ten days (inserted directly: the grant's month end may be today).
select pg_temp.as_system();
insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on)
select pg_temp.fx(k), 1.0, pg_temp.fx('owner'), pg_temp.today(), pg_temp.today() + 10
from unnest(array['staff', 'hol', 'hol2', 'moved']) as k;
insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on)
values (pg_temp.fx('staff'), 0.5, pg_temp.fx('owner'), pg_temp.today(), pg_temp.today() + 4);

update public.org_settings set weekly_off_days = array[extract(dow from pg_temp.today())::smallint];
select pg_temp.as_member('staff');
select throws_ok($$ select public.leave_submit_comp(pg_temp.today(), false) $$, 'P0001', 'VALIDATION', 'a weekly day off is refused');
select is(pg_temp.fail_detail('select public.leave_submit_comp(app.today_ist(), false)'),
  'That date is a day off. Comp leave is for a working day.', 'with a message that says why');
select pg_temp.as_system();
update public.org_settings set weekly_off_days = '{}';
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), pg_temp.today() + 1, 'Test holiday');
select pg_temp.as_member('staff');
select throws_ok($$ select public.leave_submit_comp(pg_temp.today() + 1, true) $$, 'P0001', 'VALIDATION', 'a holiday is refused, a half day too');
select is((select count(*) from public.leave_requests where member_id = pg_temp.fx('staff')), 0::bigint, 'nothing was requested');
select is(pg_temp.balance('staff'), 1.5::numeric, 'and nothing was reserved');

-- comp_leave_dates: the working days the form offers --------------------------------------------
select pg_temp.as_system();
update public.org_settings set weekly_off_days = array[extract(dow from pg_temp.today() + 2)::smallint];
select pg_temp.as_member('staff');
select is((select min(work_date) from public.comp_leave_dates()), pg_temp.today(), 'the list starts today');
select is((select max(work_date) from public.comp_leave_dates()), pg_temp.today() + 10, 'and ends on the latest use-by date');
select is((select count(*) from public.comp_leave_dates() where work_date in (pg_temp.today() + 1, pg_temp.today() + 2, pg_temp.today() + 9)),
  0::bigint, 'the holiday and the weekly days off are not offered');
select results_eq(
  $$ select available_days from public.comp_leave_dates() where work_date in (pg_temp.today(), pg_temp.today() + 5) order by work_date $$,
  $$ values (1.5::numeric), (1.0::numeric) $$, 'each date carries the free days still valid on it');
select pg_temp.as_member('admin');
select is((select count(*) from public.comp_leave_dates()), 0::bigint, 'no free credit, no dates');
select pg_temp.as_member('owner');
select throws_ok($$ select * from public.comp_leave_dates() $$, 'P0001', 'FORBIDDEN', 'the Owner takes no comp leave');
select pg_temp.as_anon();
select throws_ok($$ select * from public.comp_leave_dates() $$, '42501', null, 'anon cannot call it');

-- A holiday on a comp leave date gives the credit back ---------------------------------------------
select pg_temp.as_system();
update public.org_settings set weekly_off_days = '{}';
select pg_temp.as_member('hol');
select lives_ok($$ select public.leave_submit_comp(pg_temp.today() + 3, false, 'Family visit') $$, 'hol asks for comp leave');
select pg_temp.as_member('hol2');
select lives_ok($$ select public.leave_submit_comp(pg_temp.today() + 3, true) $$, 'hol2 asks for a comp half day');
select pg_temp.as_member('plain');
select lives_ok($$ select public.leave_submit('leave', pg_temp.today() + 3, pg_temp.today() + 3) $$, 'plain asks for ordinary leave');
select pg_temp.as_member('owner');
select lives_ok(format($$ select * from public.leave_decide(%L, 'approve') $$, (pg_temp.request_on('hol', pg_temp.today() + 3)).id),
  'the Owner approves hol''s comp leave');
select is(pg_temp.balance('hol'), 0::numeric, 'hol''s credit is used');
select pg_temp.as_member('owner');
select lives_ok($$ insert into public.holidays (date, name) values (app.today_ist() + 3, 'Dussehra') $$,
  'the Owner adds a holiday on that date');
select pg_temp.as_system();
select results_eq(
  $$ select r.state::text, r.decided_by, r.decision_reason ~ 'became a holiday \(Dussehra\): this comp leave was cancelled and the credit went back\.$'
     from public.leave_requests r where r.member_id in (pg_temp.fx('hol'), pg_temp.fx('hol2')) order by r.member_id $$,
  $$ values ('cancelled', pg_temp.fx('owner'), true), ('cancelled', pg_temp.fx('owner'), true) $$,
  'the approved and the waiting comp requests are cancelled by the Owner''s holiday, with the reason');
select is((pg_temp.request_on('plain', pg_temp.today() + 3)).state::text, 'submitted', 'ordinary leave is untouched');
select is(pg_temp.balance('hol'), 1::numeric, 'hol''s used credit went back');
select is(pg_temp.balance('hol2'), 1::numeric, 'hol2''s reserved credit went back');
select pg_temp.as_system();
select is((select array_agg(u.state order by u.state) from public.comp_leave_credit_uses u
           join public.leave_requests r on r.id = u.leave_request_id
           where r.member_id in (pg_temp.fx('hol'), pg_temp.fx('hol2'))),
  array['released', 'released'], 'both uses are released');
select ok(exists (select 1 from public.activity_log a
                  where a.entity = 'leave_requests' and a.entity_id = (pg_temp.request_on('hol', pg_temp.today() + 3)).id
                    and a.action = 'cancelled' and (a.meta ->> 'holiday')::boolean),
  'the cancellation is audited as the holiday''s');
select ok(exists (select 1 from public.activity_log a
                  where a.entity = 'comp_leave_credits' and a.action = 'released'
                    and a.entity_id = (select c.id from public.comp_leave_credits c where c.member_id = pg_temp.fx('hol'))),
  'the credit''s return is audited');
select pg_temp.as_member('hol');
select ok((select r.decision_reason from public.leave_requests r where r.member_id = pg_temp.fx('hol')) like '%Dussehra%',
  'hol reads why their comp leave was cancelled');

-- Moving a holiday onto a comp date does the same; moving it again does nothing more.
select pg_temp.as_member('moved');
select lives_ok($$ select public.leave_submit_comp(pg_temp.today() + 4, false) $$, 'moved asks for comp leave on another date');
select pg_temp.as_member('owner');
select lives_ok($$ update public.holidays set date = app.today_ist() + 4 where name = 'Dussehra' $$, 'the Owner moves the holiday onto it');
select is((pg_temp.request_on('moved', pg_temp.today() + 4)).state::text, 'cancelled', 'that comp request is cancelled too');
select is(pg_temp.balance('moved'), 1::numeric, 'and its credit went back');
select lives_ok($$ update public.holidays set name = 'Vijayadashami' where name = 'Dussehra' $$, 'a rename changes no date');

-- The standalone grant is idempotent ------------------------------------------------------------
select pg_temp.as_system();
delete from public.comp_leave_credits c where c.member_id = pg_temp.fx('plain');
select pg_temp.as_member('owner');
select is(
  public.comp_leave_grant(pg_temp.fx('plain'), 1.0, 'Thanks', '00000000-0000-4000-8000-00000000abcd'),
  public.comp_leave_grant(pg_temp.fx('plain'), 1.0, 'Thanks', '00000000-0000-4000-8000-00000000abcd'),
  'a double tap with the same key returns the same credit');
select throws_ok(
  $$ select public.comp_leave_grant(pg_temp.fx('plain'), 0.5, null, '00000000-0000-4000-8000-00000000abcd') $$,
  'P0001', 'CONFLICT', 'the same key with another amount is refused');
select pg_temp.as_system();
select is((select count(*) from public.comp_leave_credits c where c.member_id = pg_temp.fx('plain')), 1::bigint, 'one credit, not two');
select is((select count(*) from public.activity_log a where a.entity = 'comp_leave_credits' and a.action = 'granted'
           and a.entity_id in (select c.id from public.comp_leave_credits c where c.member_id = pg_temp.fx('plain'))),
  1::bigint, 'one grant in the history');
select pg_temp.as_member('owner');
select isnt(public.comp_leave_grant(pg_temp.fx('plain'), 0.5, null, '00000000-0000-4000-8000-00000000abce'),
  (select c.id from public.comp_leave_credits c where c.request_key = '00000000-0000-4000-8000-00000000abcd'),
  'a new key is a new grant');
select pg_temp.as_system();
select is((select count(*) from public.comp_leave_credits c where c.member_id = pg_temp.fx('plain')), 2::bigint, 'two credits now');
select pg_temp.as_member('staff');
select throws_ok(
  $$ select public.comp_leave_grant(pg_temp.fx('plain'), 1.0, null, '00000000-0000-4000-8000-00000000abcd') $$,
  'P0001', 'FORBIDDEN', 'a key never lets a member grant');

select * from finish();
rollback;
