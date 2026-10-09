-- 3c.1 Contract migration (20260928131234_contract_phase3b): the 2.x day gate is gone from the
-- database (columns, functions, cron row), the logout event is closed for new rows, and comp leave
-- without a credit is refused on every route (leave_submit, attendance_submit,
-- leave_request_change) for the roles that can reach them. The re-created readers are covered
-- where they were: 07 (open_day), 11 (attendance_today_detail), 13 (absent_check), 15
-- (attendance_flag_overtime_today), 24 (attendance_own_today, attendance_start_day).
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

delete from public.attendance_events;
delete from public.attendance_days;
delete from public.expense_claims;
delete from public.comp_leave_credit_uses;
delete from public.comp_leave_credits;
delete from public.extra_work_notes;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
-- 7A: client work rows reference clients and members, and the presets the organization (a
-- Playwright run leaves some behind).
delete from public.item_reviews;
delete from public.project_item_stage_list;
delete from public.project_item_stages;
delete from public.project_items;
delete from public.project_cycles;
delete from public.project_item_blueprints;
delete from public.project_stages;
delete from public.projects;
delete from public.project_templates;
delete from public.stage_presets;
-- 4A: task rows and coordinator rows reference members (a Playwright run leaves some behind).
delete from public.task_requests;
delete from public.task_warnings;
delete from public.task_reviews;
delete from public.task_submissions;
delete from public.task_comments;
delete from public.task_stages;
delete from public.task_assignees;
delete from public.tasks;
delete from public.task_templates;
delete from public.member_coordinators;
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

-- Today is a working day whatever the calendar says.
update public.org_settings
set weekly_off_days = array[((extract(dow from app.today_ist())::integer + 1) % 7)::smallint];
delete from public.holidays where date = app.today_ist();

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '00000000-0000-4000-8000-000000000001'),
  ('admin', '00000000-0000-4000-8000-000000000002'),
  ('staff', '00000000-0000-4000-8000-000000000003');
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
create function pg_temp.day(k text) returns uuid language sql stable as $$
  select d.id from public.attendance_days d where d.member_id = pg_temp.fx(k) and d.work_date = app.today_ist();
$$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner@example.com', 'owner', 'active', now() - interval '30 days'),
  (pg_temp.fx('admin'), pg_temp.fx('org'), 'Test Admin', 'admin@example.com', 'admin', 'active', now() - interval '30 days'),
  (pg_temp.fx('staff'), pg_temp.fx('org'), 'Test Staff', 'staff@example.com', 'staff', 'active', now() - interval '30 days');
delete from public.activity_log;

-- The 2.x shape is gone -----------------------------------------------------------------------------
select hasnt_column('public', 'attendance_days', 'first_login_at', 'attendance_days.first_login_at is gone');
select hasnt_column('public', 'attendance_days', 'last_logout_at', 'attendance_days.last_logout_at is gone');
select hasnt_column('public', 'attendance_days', 'logout_not_recorded', 'attendance_days.logout_not_recorded is gone');
select has_column('public', 'attendance_days', 'started_at', 'started_at stays');
select has_column('public', 'attendance_days', 'ended_at', 'ended_at stays');
select has_column('public', 'attendance_days', 'end_not_recorded', 'end_not_recorded stays');
select hasnt_function('public', 'attendance_touch', array['text', 'text'], 'attendance_touch is gone');
select hasnt_function('public', 'session_logout', array['text', 'text'], 'session_logout is gone');
select hasnt_function('app', 'attendance_logout', array['uuid'], 'app.attendance_logout is gone');
select hasnt_function('public', 'attendance_today', '{}'::text[], 'attendance_today is gone');
select hasnt_function('app', 'logout_not_recorded', array['date'], 'app.logout_not_recorded is gone');
select hasnt_function('app', 'attendance_open_day', array['uuid', 'date', 'timestamp with time zone'],
  'the three-argument attendance_open_day is gone');
select has_function('app', 'attendance_open_day', array['uuid', 'date'], 'attendance_open_day(member, date) exists');
select is((select count(*) from cron.job where jobname = 'logout_not_recorded'), 0::bigint, 'the logout_not_recorded cron row is gone');
select results_eq(
  $$ select jobname::text from cron.job where jobname in ('absent_check', 'end_not_recorded') order by 1 $$,
  $$ values ('absent_check'), ('end_not_recorded') $$,
  'the two jobs that stay are scheduled');
select is(
  (select count(*) from public.attendance_days where ended_at is not null and started_at is null), 0::bigint,
  'no day carries an end without a start (the backfill kept the check)');
select ok(
  (select array_to_string(tgargs_list, ',') !~ 'first_login_at|last_logout_at|logout_not_recorded'
   from (select regexp_split_to_array(encode(t.tgargs, 'escape'), '\\000') as tgargs_list
         from pg_trigger t where t.tgrelid = 'public.attendance_days'::regclass and t.tgname = 'protect_columns') x),
  'protect_columns no longer names the dropped columns');

-- The logout event is closed for new rows; history that carries it stays readable --------------------
select pg_temp.as_system();
insert into public.attendance_days (member_id, work_date, state) values (pg_temp.fx('staff'), app.today_ist(), 'awaiting_choice');
select throws_ok(
  format($$ insert into public.attendance_events (attendance_day_id, action, actor_id) values (%L, 'logout', %L) $$,
         pg_temp.day('staff'), pg_temp.fx('staff')),
  '23514', null, 'a new logout event is refused by the check');
select lives_ok(
  format($$ insert into public.attendance_events (attendance_day_id, action, actor_id) values (%L, 'started', %L) $$,
         pg_temp.day('staff'), pg_temp.fx('staff')),
  'a started event is still accepted');
select is((select convalidated from pg_constraint where conname = 'attendance_events_action_check'), false,
  'the check is NOT VALID, so rows written by the 2.x logout are kept (never destroy history)');
delete from public.attendance_events;
delete from public.attendance_days;

-- Comp leave without a credit: leave_submit ----------------------------------------------------------
select pg_temp.as_member('staff');
select throws_ok($$ select public.leave_submit('comp_leave', app.today_ist() + 1, app.today_ist() + 1) $$, 'P0001', 'VALIDATION',
  'Staff: leave_submit(comp_leave) is refused');
select pg_temp.as_member('admin');
select throws_ok($$ select public.leave_submit('comp_leave', app.today_ist() + 1, app.today_ist() + 1) $$, 'P0001', 'VALIDATION',
  'Admin: leave_submit(comp_leave) is refused');
select pg_temp.as_member('owner');
select throws_ok($$ select public.leave_submit('comp_leave', app.today_ist() + 1, app.today_ist() + 1) $$, 'P0001', 'FORBIDDEN',
  'the Owner has no leave (FORBIDDEN before the type is looked at)');
select pg_temp.as_system();
select is((select count(*) from public.leave_requests), 0::bigint, 'nothing was written');

-- Comp leave without a credit: attendance_submit -----------------------------------------------------
insert into public.attendance_days (member_id, work_date, state) values
  (pg_temp.fx('staff'), app.today_ist(), 'awaiting_choice'),
  (pg_temp.fx('admin'), app.today_ist(), 'awaiting_choice');
select pg_temp.as_member('staff');
select throws_ok($$ select public.attendance_submit('comp_leave') $$, 'P0001', 'VALIDATION',
  'Staff: attendance_submit(comp_leave) is refused');
select pg_temp.as_member('admin');
select throws_ok($$ select public.attendance_submit('comp_leave', 'Worked Sunday', app.today_ist()) $$, 'P0001', 'VALIDATION',
  'Admin: attendance_submit(comp_leave) is refused, with a reason and a date too');
select throws_ok($$ select public.attendance_choose_leave_today('comp_leave') $$, 'P0001', 'VALIDATION',
  'and the prompt''s choice never reaches it');
select pg_temp.as_system();
select results_eq(
  $$ select state::text from public.attendance_days order by member_id $$,
  $$ values ('awaiting_choice'), ('awaiting_choice') $$,
  'both days are untouched');
select is((select count(*) from public.leave_requests), 0::bigint, 'and no request was made');

-- Comp leave without a credit: leave_request_change --------------------------------------------------
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at) values
  (pg_temp.fx('staff'), 'leave', app.today_ist() + 5, app.today_ist() + 5, 'approved', 'form', pg_temp.fx('owner'), now()),
  (pg_temp.fx('admin'), 'leave', app.today_ist() + 5, app.today_ist() + 5, 'approved', 'form', pg_temp.fx('owner'), now());
select pg_temp.as_member('staff');
select throws_ok(
  format($$ select public.leave_request_change(%L, 'comp_leave', app.today_ist() + 6, app.today_ist() + 6, 'Swap') $$,
         (select id from public.leave_requests where member_id = pg_temp.fx('staff'))),
  'P0001', 'VALIDATION', 'Staff: a change to comp_leave is refused');
select pg_temp.as_member('admin');
select throws_ok(
  format($$ select public.leave_request_change(%L, 'comp_leave', app.today_ist() + 6, app.today_ist() + 6, 'Swap') $$,
         (select id from public.leave_requests where member_id = pg_temp.fx('admin'))),
  'P0001', 'VALIDATION', 'Admin: a change to comp_leave is refused');
select pg_temp.as_member('owner');
select throws_ok(
  format($$ select public.leave_request_change(%L, 'comp_leave', app.today_ist() + 6, app.today_ist() + 6, 'Swap') $$,
         (select id from public.leave_requests where member_id = pg_temp.fx('staff'))),
  'P0001', 'FORBIDDEN', 'the Owner has no leave to change (FORBIDDEN before the type is looked at)');
select pg_temp.as_member('staff');
select lives_ok(
  format($$ select public.leave_request_change(%L, 'leave', app.today_ist() + 6, app.today_ist() + 6, 'Moved') $$,
         (select id from public.leave_requests where member_id = pg_temp.fx('staff'))),
  'a change to another date, same type, still goes through');
select pg_temp.as_system();
select is((select count(*) from public.leave_requests where type = 'comp_leave'), 0::bigint, 'no comp leave row exists');

select * from finish();
rollback;
