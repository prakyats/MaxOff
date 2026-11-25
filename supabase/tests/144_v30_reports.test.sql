-- v3.0 Reports (9.3, migration v30_reports; DATA-MODEL §8 "v3.0 report functions"): the Owner's four
-- report functions. Who may call them (the Owner only: an Admin, Crew and a freelancer get
-- FORBIDDEN, anon and service_role have no execute; security invoker), the period guard, and each
-- figure on fixed fixtures: the people report (completed for every assignee, on time, revision
-- loops, hand-in hours, acknowledgement lag, open and overdue now with a held task left out), the
-- delays (late and still overdue, never held or cancelled), stage durations grouped by name
-- ignoring case (R7) overall and per project, and the client-work counts. Fixtures sit in a fixed
-- past month (March 2025), so the file holds on any day. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '10000000-0000-4000-8000-000000000001'),
  ('admin',  '10000000-0000-4000-8000-000000000002'),
  ('staff',  '10000000-0000-4000-8000-000000000003'),
  ('p1',     '00000000-0000-4000-8000-000000144001'),
  ('p2',     '00000000-0000-4000-8000-000000144002'),
  ('free',   '00000000-0000-4000-8000-000000144003'),
  ('client', '00000000-0000-4000-8000-000000144010'),
  ('client2','00000000-0000-4000-8000-000000144011'),
  ('proj',   '00000000-0000-4000-8000-000000144020'),
  ('proj2',  '00000000-0000-4000-8000-000000144021'),
  ('held',   '00000000-0000-4000-8000-000000144022'),
  ('cycle',  '00000000-0000-4000-8000-000000144030'),
  ('cycle2', '00000000-0000-4000-8000-000000144031'),
  ('cycleh', '00000000-0000-4000-8000-000000144032'),
  ('t1',     '00000000-0000-4000-8000-000000144101'),
  ('t2',     '00000000-0000-4000-8000-000000144102'),
  ('t3',     '00000000-0000-4000-8000-000000144103'),
  ('t4',     '00000000-0000-4000-8000-000000144104'),
  ('t5',     '00000000-0000-4000-8000-000000144105'),
  ('t6',     '00000000-0000-4000-8000-000000144106'),
  ('i1',     '00000000-0000-4000-8000-000000144201'),
  ('i2',     '00000000-0000-4000-8000-000000144202'),
  ('i3',     '00000000-0000-4000-8000-000000144203'),
  ('i4',     '00000000-0000-4000-8000-000000144204'),
  ('i5',     '00000000-0000-4000-8000-000000144205');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'type', id from public.task_types where archived_at is null order by position limit 1;
grant select on fx to authenticated;

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
-- An IST instant in March 2025.
create function pg_temp.at(t text) returns timestamptz language sql immutable as $$
  select (('2025-03-' || t) || '+05:30')::timestamptz;
$$;

-- Fixtures (written as the database owner: RLS and the transition guards are not what is tested here).
alter table public.tasks disable trigger user;
alter table public.task_assignees disable trigger user;
alter table public.task_submissions disable trigger user;
alter table public.task_reviews disable trigger user;
alter table public.projects disable trigger user;
alter table public.project_cycles disable trigger user;
alter table public.project_items disable trigger user;
alter table public.project_item_stage_list disable trigger user;

insert into public.members (id, org_id, full_name, email, role, engagement, status, joined_at) values
  (pg_temp.fx('p1'), pg_temp.fx('org'), 'Report person one', 'r144-1@maxoff.local', 'staff', 'permanent', 'active', now()),
  (pg_temp.fx('p2'), pg_temp.fx('org'), 'Report person two', 'r144-2@maxoff.local', 'staff', 'permanent', 'active', now()),
  (pg_temp.fx('free'), pg_temp.fx('org'), 'Report freelancer', null, 'staff', 'freelance', 'active', now());

insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Report client 144', 'active', pg_temp.fx('admin'), now()),
  (pg_temp.fx('client2'), pg_temp.fx('org'), 'Report client 144 b', 'active', pg_temp.fx('admin'), now());

-- Tasks. t1: p1 primary, p2 too; due 10 Mar, handed in 9 Mar (on time), one send-back, completed 12 Mar.
-- t2: p1 primary; due 5 Mar, handed in 7 Mar (late, "Waited for files"), completed 8 Mar.
-- t3: p2 primary; due 20 Mar, never handed in, still open: overdue now.
-- t4: p2 primary; due 21 Mar, never handed in, held: neither overdue nor a delay.
-- t5: p1 primary; due 22 Mar, cancelled: never a delay.
-- t6: the freelancer's; completed in April: not in March.
insert into public.tasks (id, org_id, title, task_type_id, client_id, primary_owner_id, created_by, due_at, state,
  completed_at, held_at, held_by, hold_reason, late_reason, cancelled_at, cancelled_reason) values
  (pg_temp.fx('t1'), pg_temp.fx('org'), 'Task 144 one', pg_temp.fx('type'), pg_temp.fx('client'), pg_temp.fx('p1'),
    pg_temp.fx('owner'), pg_temp.at('10 18:00'), 'completed', pg_temp.at('12 12:00'), null, null, null, null, null, null),
  (pg_temp.fx('t2'), pg_temp.fx('org'), 'Task 144 two', pg_temp.fx('type'), null, pg_temp.fx('p1'),
    pg_temp.fx('owner'), pg_temp.at('05 18:00'), 'completed', pg_temp.at('08 12:00'), null, null, null, 'Waited for files', null, null),
  (pg_temp.fx('t3'), pg_temp.fx('org'), 'Task 144 three', pg_temp.fx('type'), pg_temp.fx('client'), pg_temp.fx('p2'),
    pg_temp.fx('owner'), pg_temp.at('20 18:00'), 'todo', null, null, null, null, null, null, null),
  (pg_temp.fx('t4'), pg_temp.fx('org'), 'Task 144 four', pg_temp.fx('type'), null, pg_temp.fx('p2'),
    pg_temp.fx('owner'), pg_temp.at('21 18:00'), 'todo', null, now(), pg_temp.fx('owner'), 'Waiting on the client', null, null, null),
  (pg_temp.fx('t5'), pg_temp.fx('org'), 'Task 144 five', pg_temp.fx('type'), null, pg_temp.fx('p1'),
    pg_temp.fx('owner'), pg_temp.at('22 18:00'), 'cancelled', null, null, null, null, null, now(), 'Not needed'),
  (pg_temp.fx('t6'), pg_temp.fx('org'), 'Task 144 six', pg_temp.fx('type'), null, pg_temp.fx('free'),
    pg_temp.fx('owner'), '2025-04-02 18:00+05:30', 'completed', '2025-04-03 12:00+05:30', null, null, null, null, null, null);

insert into public.task_assignees (task_id, member_id, is_primary, assigned_at, acknowledged_at, acknowledged_by) values
  (pg_temp.fx('t1'), pg_temp.fx('p1'), true,  pg_temp.at('01 10:00'), pg_temp.at('01 12:00'), pg_temp.fx('p1')),
  (pg_temp.fx('t1'), pg_temp.fx('p2'), false, pg_temp.at('01 10:00'), pg_temp.at('01 14:00'), pg_temp.fx('p2')),
  (pg_temp.fx('t2'), pg_temp.fx('p1'), true,  pg_temp.at('02 10:00'), pg_temp.at('02 11:00'), pg_temp.fx('p1')),
  (pg_temp.fx('t3'), pg_temp.fx('p2'), true,  pg_temp.at('15 10:00'), null, null),
  (pg_temp.fx('t4'), pg_temp.fx('p2'), true,  pg_temp.at('15 10:00'), null, null),
  (pg_temp.fx('t5'), pg_temp.fx('p1'), true,  pg_temp.at('15 10:00'), null, null),
  (pg_temp.fx('t6'), pg_temp.fx('free'), true, '2025-04-01 10:00+05:30', '2025-04-01 10:30+05:30', pg_temp.fx('free'));

insert into public.task_submissions (task_id, submitted_by, at, version) values
  (pg_temp.fx('t1'), pg_temp.fx('p1'), pg_temp.at('08 10:00'), 1),
  (pg_temp.fx('t1'), pg_temp.fx('p1'), pg_temp.at('09 10:00'), 2),
  (pg_temp.fx('t2'), pg_temp.fx('p1'), pg_temp.at('07 10:00'), 1);
-- t1's first hand-in is 8 Mar (on time, 168 h after assignment), its second follows a send-back.
insert into public.task_reviews (task_id, step, decision, reviewer_id, at, reason) values
  (pg_temp.fx('t1'), 'owner', 'rejected', pg_temp.fx('owner'), pg_temp.at('08 15:00'), 'Tighter cut'),
  (pg_temp.fx('t1'), 'owner', 'approved', pg_temp.fx('owner'), pg_temp.at('12 12:00'), null),
  (pg_temp.fx('t2'), 'owner', 'approved', pg_temp.fx('owner'), pg_temp.at('08 12:00'), null);

-- Client work. proj (client): a monthly project, March's cycle from 1 Mar. i1 planned 10 Mar, done
-- 9 Mar (on time); i2 planned 12 Mar, done 14 Mar (late); i3 planned 15 Mar, open (overdue now);
-- i4 planned 16 Mar, cancelled (not planned). proj2 (client2): completed 20 Mar. held (client2): on
-- hold, i5 open (on hold, never overdue).
insert into public.projects (id, org_id, client_id, name, recurrence, state, created_by, completed_at, completed_by,
  held_at, held_by, hold_reason) values
  (pg_temp.fx('proj'), pg_temp.fx('org'), pg_temp.fx('client'), 'Report project 144', 'monthly', 'in_progress',
    pg_temp.fx('owner'), null, null, null, null, null),
  (pg_temp.fx('proj2'), pg_temp.fx('org'), pg_temp.fx('client2'), 'Report project 144 b', 'monthly', 'completed',
    pg_temp.fx('owner'), pg_temp.at('20 12:00'), pg_temp.fx('owner'), null, null, null),
  (pg_temp.fx('held'), pg_temp.fx('org'), pg_temp.fx('client2'), 'Report project 144 held', 'monthly', 'in_progress',
    pg_temp.fx('owner'), null, null, now(), pg_temp.fx('owner'), 'Client paused');
insert into public.project_cycles (id, org_id, project_id, period_start, period_end, label, state, generated_by) values
  (pg_temp.fx('cycle'), pg_temp.fx('org'), pg_temp.fx('proj'), '2025-03-01', '2025-03-31', 'March', 'open', 'manual'),
  (pg_temp.fx('cycle2'), pg_temp.fx('org'), pg_temp.fx('proj2'), '2025-03-01', '2025-03-31', 'March', 'settled', 'manual'),
  (pg_temp.fx('cycleh'), pg_temp.fx('org'), pg_temp.fx('held'), '2025-03-01', '2025-03-31', 'March', 'open', 'manual');
insert into public.project_items (id, org_id, project_id, cycle_id, origin_cycle_id, title, position, planned_date,
  state, done_at, done_by, approved_at, approved_by, cancelled_at, cancelled_by, cancelled_reason, close_kind, created_at) values
  (pg_temp.fx('i1'), pg_temp.fx('org'), pg_temp.fx('proj'), pg_temp.fx('cycle'), pg_temp.fx('cycle'), 'Reel 144 a', 'a',
    '2025-03-10', 'approved', pg_temp.at('09 12:00'), pg_temp.fx('admin'), pg_temp.at('09 12:00'), pg_temp.fx('admin'),
    null, null, null, null, pg_temp.at('01 09:00')),
  (pg_temp.fx('i2'), pg_temp.fx('org'), pg_temp.fx('proj'), pg_temp.fx('cycle'), pg_temp.fx('cycle'), 'Reel 144 b', 'b',
    '2025-03-12', 'approved', pg_temp.at('14 12:00'), pg_temp.fx('admin'), pg_temp.at('14 12:00'), pg_temp.fx('admin'),
    null, null, null, null, pg_temp.at('01 09:00')),
  (pg_temp.fx('i3'), pg_temp.fx('org'), pg_temp.fx('proj'), pg_temp.fx('cycle'), pg_temp.fx('cycle'), 'Reel 144 c', 'c',
    '2025-03-15', 'open', null, null, null, null, null, null, null, null, pg_temp.at('01 09:00')),
  (pg_temp.fx('i4'), pg_temp.fx('org'), pg_temp.fx('proj'), pg_temp.fx('cycle'), pg_temp.fx('cycle'), 'Reel 144 d', 'd',
    '2025-03-16', 'cancelled', null, null, null, null, pg_temp.at('05 09:00'), pg_temp.fx('admin'), 'Not needed',
    'not_needed', pg_temp.at('01 09:00')),
  (pg_temp.fx('i5'), pg_temp.fx('org'), pg_temp.fx('held'), pg_temp.fx('cycleh'), pg_temp.fx('cycleh'), 'Reel 144 e', 'a',
    '2025-03-18', 'open', null, null, null, null, null, null, null, null, pg_temp.at('01 09:00'));

-- Stages. i1: Shoot ticked 3 Mar 00:00 (2 days from the cycle's start, 1 Mar 00:00 IST), Edit ticked
-- 7 Mar 00:00 (4 days). i2: "shoot" ticked 5 Mar 00:00 (4 days), "EDIT" ticked 13 Mar 00:00 (8 days).
-- An archived stage never counts.
insert into public.project_item_stage_list (org_id, project_id, item_id, name, position, done_at, done_by, archived_at) values
  (pg_temp.fx('org'), pg_temp.fx('proj'), pg_temp.fx('i1'), 'Shoot', 'a', pg_temp.at('03 00:00'), pg_temp.fx('admin'), null),
  (pg_temp.fx('org'), pg_temp.fx('proj'), pg_temp.fx('i1'), 'Edit',  'b', pg_temp.at('07 00:00'), pg_temp.fx('admin'), null),
  (pg_temp.fx('org'), pg_temp.fx('proj'), pg_temp.fx('i2'), 'shoot', 'a', pg_temp.at('05 00:00'), pg_temp.fx('admin'), null),
  (pg_temp.fx('org'), pg_temp.fx('proj'), pg_temp.fx('i2'), 'EDIT',  'b', pg_temp.at('13 00:00'), pg_temp.fx('admin'), null),
  (pg_temp.fx('org'), pg_temp.fx('proj'), pg_temp.fx('i2'), 'Old',   'c', pg_temp.at('13 00:00'), pg_temp.fx('admin'), now());

alter table public.tasks enable trigger user;
alter table public.task_assignees enable trigger user;
alter table public.task_submissions enable trigger user;
alter table public.task_reviews enable trigger user;
alter table public.projects enable trigger user;
alter table public.project_cycles enable trigger user;
alter table public.project_items enable trigger user;
alter table public.project_item_stage_list enable trigger user;

-- 1. Who may call them ---------------------------------------------------------------------------------
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('report_people', 'report_task_delays', 'report_stage_durations',
    'report_client_work') and not p.prosecdef), 4, 'the four functions exist and run as the caller (security invoker)');
select ok(has_function_privilege('authenticated', 'public.report_people(date, date)', 'execute'), 'authenticated may call report_people');
select ok(not has_function_privilege('anon', 'public.report_people(date, date)', 'execute'), 'anon may not call report_people');
select ok(not has_function_privilege('anon', 'public.report_task_delays(date, date)', 'execute'), 'anon may not call report_task_delays');
select ok(not has_function_privilege('anon', 'public.report_stage_durations(date, date)', 'execute'), 'anon may not call report_stage_durations');
select ok(not has_function_privilege('anon', 'public.report_client_work(date, date)', 'execute'), 'anon may not call report_client_work');
select ok(not has_function_privilege('service_role', 'public.report_client_work(date, date)', 'execute'), 'service_role may not');

select pg_temp.as_member('admin');
select throws_ok($$ select * from public.report_people('2025-03-01', '2025-03-31') $$, 'P0001', null, 'Admin: report_people refused');
select throws_ok($$ select * from public.report_task_delays('2025-03-01', '2025-03-31') $$, 'P0001', null, 'Admin: report_task_delays refused');
select throws_ok($$ select * from public.report_stage_durations('2025-03-01', '2025-03-31') $$, 'P0001', null, 'Admin: report_stage_durations refused');
select throws_ok($$ select * from public.report_client_work('2025-03-01', '2025-03-31') $$, 'P0001', null, 'Admin: report_client_work refused');
select pg_temp.as_member('staff');
select throws_ok($$ select * from public.report_people('2025-03-01', '2025-03-31') $$, 'P0001', null, 'Crew: report_people refused');
select throws_ok($$ select * from public.report_task_delays('2025-03-01', '2025-03-31') $$, 'P0001', null, 'Crew: report_task_delays refused');
select throws_ok($$ select * from public.report_stage_durations('2025-03-01', '2025-03-31') $$, 'P0001', null, 'Crew: report_stage_durations refused');
select throws_ok($$ select * from public.report_client_work('2025-03-01', '2025-03-31') $$, 'P0001', null, 'Crew: report_client_work refused');
select pg_temp.as_member('free');
select throws_ok($$ select * from public.report_people('2025-03-01', '2025-03-31') $$, 'P0001', null, 'a freelancer: report_people refused');
select throws_ok($$ select * from public.report_client_work('2025-03-01', '2025-03-31') $$, 'P0001', null, 'a freelancer: report_client_work refused');

-- 2. The period guard --------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select * from public.report_people('2025-03-31', '2025-03-01') $$, 'P0001', null, 'a period that ends before it starts: refused');
select throws_ok($$ select * from public.report_people('2025-01-01', '2026-01-02') $$, 'P0001', null, 'more than 366 days: refused');
select lives_ok($$ select * from public.report_people('2025-01-01', '2026-01-01') $$, '366 days: allowed');

-- 3. People ------------------------------------------------------------------------------------------
create temporary table people as select * from public.report_people('2025-03-01', '2025-03-31');
select is((select completed from people where member_id = pg_temp.fx('p1')), 2, 'p1: two completed (t1, t2)');
select is((select completed from people where member_id = pg_temp.fx('p2')), 1, 'p2: one completed (assignee on t1, every assignee counts)');
select is((select owned_completed from people where member_id = pg_temp.fx('p1')), 2, 'p1: owns both');
select is((select on_time from people where member_id = pg_temp.fx('p1')), 1, 'p1: one on time (t1 handed in before its deadline; t2 late)');
select is((select revision_loops from people where member_id = pg_temp.fx('p1')), 1, 'p1: one revision loop (t1 sent back once)');
select is((select revision_loops from people where member_id = pg_temp.fx('p2')), 1, 'p2: the same loop as an assignee');
select is((select hand_in_hours from people where member_id = pg_temp.fx('p1')), 144.0::numeric,
  'p1: median hours from assignment to the first hand-in: 168 h (t1) and 120 h (t2) → 144');
select is((select ack_lag_hours from people where member_id = pg_temp.fx('p1')), 1.5::numeric, 'p1: acknowledgement lag median 1.5 h (2 h and 1 h)');
select is((select ack_lag_hours from people where member_id = pg_temp.fx('p2')), 4.0::numeric, 'p2: acknowledgement lag 4 h');
select is((select open_now from people where member_id = pg_temp.fx('p2')), 2, 'p2: two open now (t3, the held t4)');
select is((select overdue_now from people where member_id = pg_temp.fx('p2')), 1, 'p2: one overdue now (the held t4 is not)');
select is((select completed from people where member_id = pg_temp.fx('free')), 0, 'the freelancer: nothing completed in March (t6 is April)');
select ok(not exists (select 1 from people where member_id = pg_temp.fx('owner')), 'the Owner is not a row (nothing assigned)');

-- 4. Delays ------------------------------------------------------------------------------------------
create temporary table delays as select * from public.report_task_delays('2025-03-01', '2025-03-31');
select is((select array_agg(title order by due_at) from delays), array['Task 144 two', 'Task 144 three'],
  'delays: t2 (handed in late) and t3 (still overdue); never on-time t1, held t4 or cancelled t5');
select is((select late_reason from delays where task_id = pg_temp.fx('t2')), 'Waited for files', 'delays: the late reason');
select is((select client_name from delays where task_id = pg_temp.fx('t3')), 'Report client 144', 'delays: the client label');
select is((select open from delays where task_id = pg_temp.fx('t3')), true, 'delays: t3 is still open');

-- 5. Stage durations (R7) ---------------------------------------------------------------------------
create temporary table stages as select * from public.report_stage_durations('2025-03-01', '2025-03-31');
select is((select ticks from stages where project_id is null and stage_key = 'shoot'), 2, 'overall: "Shoot" and "shoot" are one stage');
select is((select median_days from stages where project_id is null and stage_key = 'shoot'), 3.0::numeric,
  'overall: Shoot median 3 days (2 and 4, from the cycle''s start)');
select is((select median_days from stages where project_id is null and stage_key = 'edit'), 6.0::numeric,
  'overall: Edit median 6 days (4 and 8, from the previous tick)');
select is((select longest_days from stages where project_id is null and stage_key = 'edit'), 8.0::numeric, 'overall: Edit longest 8 days');
select is((select project_name from stages where project_id = pg_temp.fx('proj') and stage_key = 'edit'), 'Report project 144',
  'per project: the project''s own row, with its name');
select ok(not exists (select 1 from stages where stage_key = 'old'), 'an archived stage never counts');
select is((select stage_key from stages where project_id is null order by median_days desc limit 1), 'edit', 'slowest first');

-- 6. Client work -------------------------------------------------------------------------------------
create temporary table work as select * from public.report_client_work('2025-03-01', '2025-03-31');
select is((select row(planned, done, done_on_time, done_in_period, overdue_now, on_hold, projects_completed)::text
  from work where client_id = pg_temp.fx('client')), '(3,2,1,2,1,0,0)',
  'client: 3 planned (i4 cancelled), 2 done, 1 on time, 2 done in March, 1 overdue now, none on hold');
select is((select row(planned, overdue_now, on_hold, projects_completed)::text from work where client_id = pg_temp.fx('client2')),
  '(1,0,1,1)', 'client 2: the held deliverable is on hold, never overdue; one project completed');
select is((select count(*)::integer from work where client_name like 'Report client 144%'), 2, 'one row per client with work');

-- 7. Nothing written --------------------------------------------------------------------------------
select is((select provolatile from pg_proc where oid = 'public.report_client_work(date, date)'::regprocedure), 's',
  'read only (stable)');

select * from finish();
rollback;
