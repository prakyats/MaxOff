-- 2.4 Owner review (20260924155937_attendance_owner_review.sql): attendance_today() for each role
-- and each bucket, leave_owner_edit's new (new_id, kept_dates), and the re-created Owner functions
-- on the paths their new "whose row is it, then lock" preamble added (NOT_FOUND, FORBIDDEN). The
-- rest of their behaviour is 07's, which runs against the re-created bodies unchanged. The lock
-- order itself is 12's (dblink).
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

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
  ('owner',    '00000000-0000-4000-8000-000000000001'),
  ('admin',    '00000000-0000-4000-8000-000000000002'),
  ('waiting',  '00000000-0000-4000-8000-000000000003'),
  ('nochoice', '00000000-0000-4000-8000-000000000004'),
  ('notin',    '00000000-0000-4000-8000-000000000005'),
  ('present',  '00000000-0000-4000-8000-000000000006'),
  ('onleave',  '00000000-0000-4000-8000-000000000007'),
  ('newbie',   '00000000-0000-4000-8000-000000000008'),
  ('gone',     '00000000-0000-4000-8000-000000000009'),
  ('invited',  '00000000-0000-4000-8000-000000000010');
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

insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),    pg_temp.fx('org'), 'Test Owner', 'owner@example.com',    'owner', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('admin'),    pg_temp.fx('org'), 'Asha Admin', 'admin@example.com',    'admin', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('waiting'),  pg_temp.fx('org'), 'Bala Wait',  'waiting@example.com',  'staff', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('nochoice'), pg_temp.fx('org'), 'Chitra Gate','nochoice@example.com', 'staff', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('notin'),    pg_temp.fx('org'), 'Dev Away',   'notin@example.com',    'staff', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('present'),  pg_temp.fx('org'), 'Esha Here',  'present@example.com',  'staff', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('onleave'),  pg_temp.fx('org'), 'Farah Off',  'onleave@example.com',  'staff', 'active',      now() - interval '30 days', null),
  (pg_temp.fx('newbie'),   pg_temp.fx('org'), 'Gita New',   'newbie@example.com',   'staff', 'active',      now(),                      null),
  (pg_temp.fx('gone'),     pg_temp.fx('org'), 'Hari Gone',  'gone@example.com',     'staff', 'deactivated', now() - interval '30 days', now()),
  (pg_temp.fx('invited'),  pg_temp.fx('org'), 'Isha Asked', 'invited@example.com',  'staff', 'invited',     null,                       null);

-- Today: Asha (Admin) and Bala wait for a decision, Chitra signed in without choosing, Dev has
-- not signed in, Esha is approved Present, Farah has approved leave and has not signed in.
-- Today is a working day whatever the calendar says: the weekly day off is tomorrow's weekday and
-- no holiday falls today (the seed's Sunday would otherwise break this file on a Sunday).
update public.org_settings
set weekly_off_days = array[((extract(dow from app.today_ist())::integer + 1) % 7)::smallint];
delete from public.holidays where date = app.today_ist();

insert into public.attendance_days (member_id, work_date, first_login_at, state, submitted_choice, submitted_at) values
  (pg_temp.fx('admin'),   app.today_ist(), now(), 'pending_review', 'present', now()),
  (pg_temp.fx('waiting'), app.today_ist(), now(), 'pending_review', 'present', now());
insert into public.attendance_days (member_id, work_date, first_login_at, state) values
  (pg_temp.fx('nochoice'), app.today_ist(), now(), 'awaiting_choice');
insert into public.attendance_days (member_id, work_date, first_login_at, state, submitted_choice, submitted_at,
                                    final_status, decided_by, decided_at, overtime_flag, overtime_reason) values
  (pg_temp.fx('present'), app.today_ist(), now(), 'approved', 'present', now(), 'present',
   pg_temp.fx('owner'), now(), true, 'Launch night');
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at) values
  (pg_temp.fx('onleave'), 'leave', app.today_ist() - 1, app.today_ist() + 1, 'approved', 'form', pg_temp.fx('owner'), now());
delete from public.activity_log;

-- attendance_today: who may call it -------------------------------------------------------------
select has_function('public', 'attendance_today', array[]::text[], 'attendance_today exists');
select ok(has_function_privilege('authenticated', 'public.attendance_today()', 'execute')
          and not has_function_privilege('anon', 'public.attendance_today()', 'execute'),
  'authenticated may execute attendance_today, anon may not');

select pg_temp.as_member('admin');
select throws_ok($$ select * from public.attendance_today() $$, 'P0001', 'FORBIDDEN',
  'an Admin cannot read everyone''s day');
select pg_temp.as_member('waiting');
select throws_ok($$ select * from public.attendance_today() $$, 'P0001', 'FORBIDDEN',
  'Staff cannot read everyone''s day');

-- attendance_today: the rows -------------------------------------------------------------------
select pg_temp.as_member('owner');
select results_eq(
  $$ select full_name from public.attendance_today() $$,
  $$ values ('Asha Admin'), ('Bala Wait'), ('Chitra Gate'), ('Dev Away'), ('Esha Here'), ('Farah Off'), ('Gita New') $$,
  'active members who mark attendance, by name: not the Owner, not deactivated, not invited');
select is((select started from public.attendance_today() where member_id = pg_temp.fx('newbie')), false,
  'attendance has not started on the joining day');
select is((select count(*)::integer from public.attendance_today() where started), 6,
  'everyone else has started');
select results_eq(
  $$ select state::text, submitted_choice::text from public.attendance_today()
     where member_id in (pg_temp.fx('admin'), pg_temp.fx('waiting')) $$,
  $$ values ('pending_review', 'present'), ('pending_review', 'present') $$,
  'a day waiting for the Owner, an Admin''s included');
select results_eq(
  $$ select day_id is not null, state::text from public.attendance_today() where member_id = pg_temp.fx('nochoice') $$,
  $$ values (true, 'awaiting_choice') $$,
  'signed in without choosing: the day is awaiting_choice');
select results_eq(
  $$ select day_id, state::text, on_leave from public.attendance_today() where member_id = pg_temp.fx('notin') $$,
  $$ values (null::uuid, null::text, false) $$,
  'not signed in yet: no day, not on leave');
select results_eq(
  $$ select state::text, final_status::text, overtime_flag, first_login_at is not null
     from public.attendance_today() where member_id = pg_temp.fx('present') $$,
  $$ values ('approved', 'present', true, true) $$,
  'an approved Present with its overtime flag and first login');
select results_eq(
  $$ select day_id, on_leave, leave_type::text from public.attendance_today() where member_id = pg_temp.fx('onleave') $$,
  $$ values (null::uuid, true, 'leave') $$,
  'approved leave covering today counts even before the person signs in');
select is((select count(*)::integer from public.attendance_today() where is_day_off), 0,
  'a working day');

-- A day off: every row without a day follows the working-day rule; a day row keeps its own.
select pg_temp.as_system();
update public.org_settings set weekly_off_days = array[extract(dow from app.today_ist())::smallint];
select pg_temp.as_member('owner');
select results_eq(
  $$ select full_name, is_day_off from public.attendance_today() order by full_name $$,
  $$ values ('Asha Admin', false), ('Bala Wait', false), ('Chitra Gate', false), ('Dev Away', true),
            ('Esha Here', false), ('Farah Off', true), ('Gita New', true) $$,
  'on a day off, the people with no day row are off; a day opened earlier keeps its own flag');
select pg_temp.as_system();
update public.org_settings
set weekly_off_days = array[((extract(dow from app.today_ist())::integer + 1) % 7)::smallint];

-- The preamble's NOT_FOUND and FORBIDDEN on every re-created Owner function ---------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.attendance_decide(gen_random_uuid(), 'approve') $$,
  'P0001', 'NOT_FOUND', 'attendance_decide: an unknown day');
select throws_ok($$ select * from public.leave_decide(gen_random_uuid(), 'approve') $$,
  'P0001', 'NOT_FOUND', 'leave_decide: an unknown request');
select throws_ok($$ select * from public.leave_owner_edit(gen_random_uuid(), 'leave', app.today_ist(), app.today_ist()) $$,
  'P0001', 'NOT_FOUND', 'leave_owner_edit: an unknown request');
select throws_ok($$ select public.leave_owner_cancel(gen_random_uuid(), 'x') $$,
  'P0001', 'NOT_FOUND', 'leave_owner_cancel: an unknown request');

select pg_temp.as_member('admin');
select throws_ok(
  format($$ select public.attendance_decide(%L, 'approve') $$,
         (select id from public.attendance_days where member_id = pg_temp.fx('waiting'))),
  'P0001', 'FORBIDDEN', 'an Admin cannot approve a day');
select throws_ok(
  format($$ select * from public.leave_owner_edit(%L, 'leave', app.today_ist(), app.today_ist()) $$,
         (select id from public.leave_requests where member_id = pg_temp.fx('onleave'))),
  'P0001', 'FORBIDDEN', 'an Admin cannot edit approved leave');

-- The Owner approves and corrects through the new preamble, from the Approvals list.
select pg_temp.as_member('owner');
select is(
  public.attendance_decide((select id from public.attendance_days where member_id = pg_temp.fx('waiting')), 'approve'),
  'approved'::public.attendance_state, 'the Owner approves a waiting day');
select throws_ok(
  format($$ select public.attendance_decide(%L, 'approve') $$,
         (select id from public.attendance_days where member_id = pg_temp.fx('waiting'))),
  'P0001', 'INVALID_STATE', 'a second approve (a stale row, or the bulk after a single) is INVALID_STATE');
select throws_ok(
  format($$ select public.attendance_decide(%L, 'correct', 'absent') $$,
         (select id from public.attendance_days where member_id = pg_temp.fx('admin'))),
  'P0001', 'REASON_REQUIRED', 'a correction without a reason');
select is(
  public.attendance_decide((select id from public.attendance_days where member_id = pg_temp.fx('admin')), 'correct', 'half_day', 'Left at 2'),
  'corrected'::public.attendance_state, 'the Owner corrects a waiting day with a reason');
select results_eq(
  $$ select state::text, final_status::text from public.attendance_today() where member_id = pg_temp.fx('admin') $$,
  $$ values ('corrected', 'half_day') $$,
  'the board reads the correction');

-- leave_owner_edit returns (new_id, kept_dates) --------------------------------------------------
-- Farah's leave covered yesterday..tomorrow. Yesterday the Owner had corrected her to Present;
-- that decision stays when the Owner moves the leave, and its date comes back.
select pg_temp.as_system();
insert into public.attendance_days (member_id, work_date, first_login_at, state, final_status,
                                    decided_by, decided_at, decision_reason) values
  (pg_temp.fx('onleave'), app.today_ist() - 1, now() - interval '1 day', 'corrected', 'present',
   pg_temp.fx('owner'), now() - interval '1 day', 'Came in after all');
select pg_temp.as_member('owner');
create temporary table edited as
select * from public.leave_owner_edit(
  (select id from public.leave_requests where member_id = pg_temp.fx('onleave') and state = 'approved'),
  'leave', app.today_ist() - 2, app.today_ist() + 1, 'Started a day earlier');
select is((select array_length(kept_dates, 1) from edited), 1, 'one kept date');
select is((select kept_dates[1] from edited), app.today_ist() - 1, 'the day the Owner had corrected');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, source::text, start_date, end_date from public.leave_requests
     where id = (select new_id from edited) $$,
  $$ values ('approved', 'owner', app.today_ist() - 2, app.today_ist() + 1) $$,
  'new_id is the approved Owner row with the new dates');
select results_eq(
  $$ select state::text, final_status::text from public.attendance_days
     where member_id = pg_temp.fx('onleave') and work_date = app.today_ist() - 1 $$,
  $$ values ('corrected', 'present') $$,
  'the kept day is untouched');
select pg_temp.as_member('owner');
select is(
  (select array_length(kept_dates, 1) from public.leave_owner_edit((select new_id from edited), 'leave',
     app.today_ist() + 3, app.today_ist() + 3, 'Only next week')),
  null, 'an edit over no decided day returns an empty kept_dates');

-- leave_withdraw still behaves under its new lock ------------------------------------------------
select pg_temp.as_member('notin');
select lives_ok(
  $$ select public.leave_submit('leave', app.today_ist() + 10, app.today_ist() + 10) $$,
  'a member asks for leave');
select is(
  public.leave_withdraw((select id from public.leave_requests where member_id = pg_temp.fx('notin'))),
  'withdrawn'::public.leave_state, 'and withdraws it');
select throws_ok(
  format($$ select public.leave_withdraw(%L) $$, (select id from public.leave_requests where member_id = pg_temp.fx('onleave') limit 1)),
  'P0001', 'NOT_FOUND', 'never someone else''s request');

select pg_temp.as_system();
select * from finish();
rollback;
