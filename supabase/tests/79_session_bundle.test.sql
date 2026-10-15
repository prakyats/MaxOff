-- P2 item 3 (2026-10-15, migration p2_session_bundle; DATA-MODEL §1 "P2 session reads"; ARCHITECTURE
-- §19): public.session_bundle() is the shell's one read for the nav counts and the unread count.
-- Who may call it (authenticated only, anon refused), that it runs as the caller (security
-- invoker), and that each number equals the read the layout made before (task_counts(), the API
-- counts under RLS) for the Owner, an Admin and a Crew member on the
-- seeded people with fixtures that make every count non-zero; the Owner's counts are null for anyone
-- else; a deactivated or invited member gets zeros and nulls. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',   '10000000-0000-4000-8000-000000000001'),
  ('admin',   '10000000-0000-4000-8000-000000000002'),
  ('staff',   '10000000-0000-4000-8000-000000000003'),
  ('gone',    '00000000-0000-4000-8000-000000007901'),
  ('invited', '00000000-0000-4000-8000-000000007902');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon;

create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
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

-- Fixtures, written as the migration owner (in_transition() is true here, as in the other files) ---------
insert into auth.users (id, email) values
  (pg_temp.fx('gone'), 'gone-7901@example.com'), (pg_temp.fx('invited'), 'invited-7902@example.com');
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('gone'),    pg_temp.fx('org'), 'Gone Person',    'gone-7901@example.com',    'staff', 'deactivated', now() - interval '30 days', now()),
  (pg_temp.fx('invited'), pg_temp.fx('org'), 'Invited Person', 'invited-7902@example.com', 'staff', 'invited',     null,                       null);

-- Two days and one request (not from attendance) and one note and one claim wait for the Owner; a
-- request from attendance does not count towards the badge.
insert into public.attendance_days (member_id, work_date, started_at, state, submitted_choice, submitted_at) values
  (pg_temp.fx('admin'), app.today_ist() - 40, now() - interval '40 days', 'pending_review', 'present', now()),
  (pg_temp.fx('staff'), app.today_ist() - 40, now() - interval '40 days', 'pending_review', 'present', now());
insert into public.leave_requests (member_id, type, start_date, end_date, state, source) values
  (pg_temp.fx('staff'), 'leave', app.today_ist() + 30, app.today_ist() + 31, 'submitted', 'form'),
  (pg_temp.fx('admin'), 'leave', app.today_ist() + 40, app.today_ist() + 40, 'submitted', 'attendance');
insert into public.extra_work_notes (member_id, work_date, kind, duration_minutes, note) values
  (pg_temp.fx('staff'), app.today_ist() - 41, 'overtime', 60, 'Late edit');
insert into public.expense_claims (member_id, expense_date, amount, category_id, note) values
  (pg_temp.fx('staff'), app.today_ist() - 1, 120,
   (select id from public.list_items where list_key = 'expense_category' and org_id = pg_temp.fx('org') limit 1),
   'Auto to the shoot');
-- Notifications: two unread and one read for Crew, one unread for the Owner.
insert into public.notifications (org_id, recipient_id, kind, title, read_at)
select pg_temp.fx('org'), pg_temp.fx(r.who), (select kind from public.notification_kinds limit 1), 'Something', r.read_at
from (values ('staff', null::timestamptz), ('staff', null), ('staff', now()), ('owner', null)) r(who, read_at);

-- A task the Admin gives Crew: not noted yet, so Crew's badge counts it.
select pg_temp.as_member('admin');
select public.task_create(
  title => 'Bundle check', description => null,
  task_type_id => (select id from public.task_types where org_id = pg_temp.fx('org') and archived_at is null order by position limit 1),
  client_id => null, priority => 'medium', due_at => now() + interval '3 days',
  assignee_ids => array[pg_temp.fx('staff')], primary_owner_id => pg_temp.fx('staff'),
  approving_admin_id => null);
select pg_temp.as_system();

-- Every unread row by recipient, read as the system (not through RLS), for the "own only" check.
create temporary table fx_unread as
select f.key as who, n.id from public.notifications n join fx f on f.id = n.recipient_id
where n.read_at is null;
grant select on fx_unread to authenticated;

-- Who may call it ---------------------------------------------------------------------------------------
select has_function('public', 'session_bundle', array[]::text[], 'session_bundle() exists');
select is((select prosecdef from pg_proc where oid = 'public.session_bundle()'::regprocedure), false,
  'session_bundle() is security invoker: RLS decides every row it counts');
select ok(has_function_privilege('authenticated', 'public.session_bundle()', 'execute'),
  'authenticated may execute session_bundle()');
select ok(not has_function_privilege('anon', 'public.session_bundle()', 'execute'),
  'anon may not execute session_bundle()');
select ok(not has_function_privilege('service_role', 'public.session_bundle()', 'execute'),
  'service_role may not execute session_bundle() (it is the signed-in shell''s read only)');

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select throws_ok($$ select * from public.session_bundle() $$, '42501', null, 'anon is refused');
select pg_temp.as_system();

-- The Owner ---------------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is((select count(*) from public.session_bundle())::integer, 1, 'Owner: one row');
select results_eq(
  $$ select not_noted, changes_requested, badge, to_decide from public.session_bundle() $$,
  $$ select not_noted, changes_requested, badge, to_decide from public.task_counts() $$,
  'Owner: the task counts are task_counts()''s');
select is((select unread from public.session_bundle()),
  (select count(*)::integer from public.notifications where read_at is null),
  'Owner: unread is the API''s unread count');
select is((select pending_days from public.session_bundle()),
  (select count(*)::integer from public.attendance_days where state = 'pending_review'),
  'Owner: pending days are the API''s count');
select is((select pending_requests from public.session_bundle()),
  (select count(*)::integer from public.leave_requests where state = 'submitted' and source <> 'attendance'),
  'Owner: pending requests are the API''s count (not from attendance)');
select is((select pending_notes from public.session_bundle()),
  (select count(*)::integer from public.extra_work_notes where state = 'submitted'),
  'Owner: pending notes are the API''s count');
select is((select pending_claims from public.session_bundle()),
  (select count(*)::integer from public.expense_claims where state = 'submitted'),
  'Owner: pending claims are the API''s count');
select ok((select pending_days >= 2 and pending_requests >= 1 and pending_notes >= 1 and pending_claims >= 1
                  and unread >= 1 from public.session_bundle()),
  'Owner: the fixtures are counted (not a comparison of zeros)');
select pg_temp.as_system();

-- An Admin ----------------------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select results_eq(
  $$ select not_noted, changes_requested, badge, to_decide from public.session_bundle() $$,
  $$ select not_noted, changes_requested, badge, to_decide from public.task_counts() $$,
  'Admin: the task counts are task_counts()''s');
select is((select unread from public.session_bundle()),
  (select count(*)::integer from public.notifications where read_at is null),
  'Admin: unread is the API''s unread count');
select ok((select pending_days is null and pending_requests is null and pending_notes is null
                  and pending_claims is null from public.session_bundle()),
  'Admin: the Owner''s counts are null (attendance.decide is the Owner''s)');
select pg_temp.as_system();

-- Crew --------------------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select results_eq(
  $$ select not_noted, changes_requested, badge, to_decide from public.session_bundle() $$,
  $$ select not_noted, changes_requested, badge, to_decide from public.task_counts() $$,
  'Crew: the task counts are task_counts()''s');
select ok((select badge >= 1 from public.session_bundle()), 'Crew: the task not noted is in the badge');
select is((select unread from public.session_bundle()),
  (select count(*)::integer from public.notifications where read_at is null),
  'Crew: unread is the API''s unread count');
select is((select unread from public.session_bundle()),
  (select count(*)::integer from fx_unread where who = 'staff'),
  'Crew: their own unread (the two fixtures and the task''s), never the Owner''s');
select ok((select pending_days is null and pending_requests is null and pending_notes is null
                  and pending_claims is null from public.session_bundle()),
  'Crew: the Owner''s counts are null');
select pg_temp.as_system();

-- A deactivated and an invited member: zeros and nulls, nothing of anyone's ------------------------------
select pg_temp.as_member('gone');
select is((select count(*) from public.session_bundle())::integer, 1, 'deactivated: one row');
select ok((select not_noted is null and badge is null and to_decide is null from public.session_bundle()),
  'deactivated: no task counts');
select is((select unread from public.session_bundle()), 0, 'deactivated: no unread');
select ok((select pending_days is null and pending_claims is null from public.session_bundle()),
  'deactivated: no Owner counts');
select pg_temp.as_system();

select pg_temp.as_member('invited');
select ok((select badge is null and unread = 0 and pending_days is null and pending_claims is null
           from public.session_bundle()),
  'invited: zeros and nulls');
select pg_temp.as_system();

-- Nothing about money: no column carries an amount -----------------------------------------------------
select is(
  (select count(*)::integer from information_schema.parameters p
   join information_schema.routines r on r.specific_name = p.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'session_bundle'
     and p.parameter_mode = 'OUT' and p.data_type = 'numeric'),
  0, 'no numeric (money) column in the result');
select is(
  (select array_agg(p.parameter_name::text order by p.ordinal_position) from information_schema.parameters p
   join information_schema.routines r on r.specific_name = p.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'session_bundle' and p.parameter_mode = 'OUT'),
  array['not_noted', 'changes_requested', 'badge', 'to_decide', 'unread', 'pending_days',
        'pending_requests', 'pending_notes', 'pending_claims'],
  'the result''s columns are exactly the counts');

select * from finish();
rollback;
