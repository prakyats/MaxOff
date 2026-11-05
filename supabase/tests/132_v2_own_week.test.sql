-- v2.0 X3 step 3 (2026-11-05, migration own_week; DATA-MODEL §1 "v2.0 X3"; advisor-approved on
-- #89): public.own_week(from_date, to_date) is the week strip's holidays and event tasks in one
-- read. Who may call it (authenticated only), security invoker (RLS decides every task, exactly as
-- for the tasks API read: the week strip keeps the reader's own), the events equal to the API read it replaces (event date in
-- the window, not cancelled, current assignees only), a task at 23:30 IST in its own day, holidays
-- in the window only, and the window refused outside 1..62 days. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') limit 1;
grant select on fx to authenticated, anon;

create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.ist(d date, t text) returns timestamptz language sql immutable as $$
  select (d::text || ' ' || t)::timestamp at time zone 'Asia/Kolkata';
$$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
-- The API read own_week replaces, as the caller (the same filters, RLS deciding).
create function pg_temp.api_events(from_date date, to_date date) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(t.id order by t.event_date, t.event_start_at nulls first, t.id), '[]'::jsonb)
  from public.tasks t
  where t.event_date between from_date and to_date and t.state <> 'cancelled';
$$;
create function pg_temp.week_events(from_date date, to_date date) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(e->'id' order by ord), '[]'::jsonb)
  from jsonb_array_elements(public.own_week(from_date, to_date)->'events') with ordinality as x(e, ord);
$$;
create function pg_temp.ids(variadic titles text[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(t.id) order by t.event_date, t.event_start_at nulls first, t.id), '[]'::jsonb)
  from public.tasks t where t.title = any(titles);
$$;
grant execute on function pg_temp.api_events(date, date) to authenticated;

-- Fixtures, as the migration owner ---------------------------------------------------------------
create temporary table d as select app.today_ist() as today;
grant select on d to authenticated;
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id,
                          event_date, event_start_at, event_end_at) values
  (pg_temp.fx('org'), 'Wk late shoot 132', pg_temp.fx('type'), 'medium', pg_temp.ist((select today from d) + 1, '23:45'), 'todo',
   pg_temp.fx('owner'), pg_temp.fx('staff'), (select today from d) + 1, pg_temp.ist((select today from d) + 1, '23:30'), null),
  (pg_temp.fx('org'), 'Wk admin event 132', pg_temp.fx('type'), 'medium', pg_temp.ist((select today from d) + 2, '18:00'), 'todo',
   pg_temp.fx('admin'), pg_temp.fx('admin'), (select today from d) + 2, null, null),
  (pg_temp.fx('org'), 'Wk far 132', pg_temp.fx('type'), 'medium', pg_temp.ist((select today from d) + 70, '18:00'), 'todo',
   pg_temp.fx('owner'), pg_temp.fx('staff'), (select today from d) + 70, null, null);
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id,
                          event_date, cancelled_at, cancelled_reason) values
  (pg_temp.fx('org'), 'Wk cancelled 132', pg_temp.fx('type'), 'medium', pg_temp.ist((select today from d) + 1, '18:00'), 'cancelled',
   pg_temp.fx('owner'), pg_temp.fx('staff'), (select today from d) + 1, now(), 'Not needed');
insert into public.task_assignees (task_id, member_id, is_primary)
select t.id, t.primary_owner_id, true from public.tasks t where t.title like 'Wk % 132';
-- A removed assignee on the late shoot: never in its assignee_ids.
insert into public.task_assignees (task_id, member_id, is_primary, removed_at)
select t.id, pg_temp.fx('admin'), false, now() from public.tasks t where t.title = 'Wk late shoot 132';
insert into public.holidays (org_id, date, name) values
  (pg_temp.fx('org'), (select today from d) + 3, 'Wk holiday 132'),
  (pg_temp.fx('org'), (select today from d) + 80, 'Wk far holiday 132');

-- 1. Who may call it ------------------------------------------------------------------------------
select has_function('public', 'own_week', array['date', 'date'], 'own_week(date, date) exists');
select is((select prosecdef from pg_proc where oid = 'public.own_week(date, date)'::regprocedure), false,
  'it runs as the caller (security invoker): RLS decides every row');
select ok(has_function_privilege('authenticated', 'public.own_week(date, date)', 'execute'), 'authenticated may call it');
select ok(not has_function_privilege('anon', 'public.own_week(date, date)', 'execute'), 'anon may not');

-- 2. Each role: the events equal the API read it replaces ------------------------------------------
select pg_temp.as_member('staff');
select is(pg_temp.week_events((select today from d), (select today from d) + 6),
  pg_temp.api_events((select today from d), (select today from d) + 6), 'Crew: the events equal the API read');
select ok(pg_temp.week_events((select today from d), (select today from d) + 6) @> pg_temp.ids('Wk late shoot 132'),
  'Crew: their own shoot');
-- Event tasks are visible as the tasks API shows them (the week strip then keeps the reader's own:
-- `ownWeek`), so own_week widens nothing: it is the same rows as the read it replaces.
select is(jsonb_array_length(pg_temp.week_events((select today from d), (select today from d) + 6)),
  jsonb_array_length(pg_temp.api_events((select today from d), (select today from d) + 6)),
  'Crew: no more rows than the API read shows them');
select pg_temp.as_member('admin');
select is(pg_temp.week_events((select today from d), (select today from d) + 6),
  pg_temp.api_events((select today from d), (select today from d) + 6), 'Admin: the events equal the API read');
select ok(pg_temp.week_events((select today from d), (select today from d) + 6) @> pg_temp.ids('Wk admin event 132'),
  'Admin: their own event');
select pg_temp.as_member('owner');
select is(pg_temp.week_events((select today from d), (select today from d) + 6),
  pg_temp.api_events((select today from d), (select today from d) + 6), 'Owner: the events equal the API read');
select ok(pg_temp.week_events((select today from d), (select today from d) + 6)
          @> pg_temp.ids('Wk late shoot 132', 'Wk admin event 132'), 'Owner: every event');

-- 3. The rows: not cancelled, in the window, current assignees, 23:30 IST in its own day -----------
select ok(not (pg_temp.week_events((select today from d), (select today from d) + 6) @> pg_temp.ids('Wk cancelled 132')),
  'a cancelled task is left out');
select ok(not (pg_temp.week_events((select today from d), (select today from d) + 61) @> pg_temp.ids('Wk far 132')),
  'a task past the window is left out');
select ok(pg_temp.week_events((select today from d) + 1, (select today from d) + 1) @> pg_temp.ids('Wk late shoot 132'),
  'a shoot at 23:30 IST is in its own day');
select ok(not (pg_temp.week_events((select today from d) + 2, (select today from d) + 2) @> pg_temp.ids('Wk late shoot 132')),
  '... and not in the next');
select is(
  (select e->'assignee_ids' from jsonb_array_elements(public.own_week((select today from d), (select today from d) + 6)->'events') e
   where e->>'title' = 'Wk late shoot 132'),
  jsonb_build_array(pg_temp.fx('staff')), 'only current assignees (a removed one is left out)');
select is(
  (select e->>'event_start_at' from jsonb_array_elements(public.own_week((select today from d), (select today from d) + 6)->'events') e
   where e->>'title' = 'Wk late shoot 132')::timestamptz,
  pg_temp.ist((select today from d) + 1, '23:30'), 'the start is kept as the instant it is');

-- 4. Holidays: the window's only ------------------------------------------------------------------
select ok((public.own_week((select today from d), (select today from d) + 6)->'holidays')
          @> jsonb_build_array(jsonb_build_object('date', (select today from d) + 3, 'name', 'Wk holiday 132')),
  'the holiday in the window');
select ok(not exists (select 1 from jsonb_array_elements(public.own_week((select today from d), (select today from d) + 61)->'holidays') h
                      where h->>'name' = 'Wk far holiday 132'), 'a holiday past the window is left out');

-- 5. The window ----------------------------------------------------------------------------------
select lives_ok($$ select public.own_week((select today from d), (select today from d) + 61) $$, '62 days is allowed');
select throws_ok($$ select public.own_week((select today from d), (select today from d) + 62) $$, 'P0001', null,
  '63 days is refused');
select throws_ok($$ select public.own_week((select today from d) + 1, (select today from d)) $$, 'P0001', null,
  'to before from is refused');
select throws_ok($$ select public.own_week(null, (select today from d)) $$, 'P0001', null, 'a missing date is refused');
select is((select count(*)::int from jsonb_object_keys(public.own_week((select today from d), (select today from d)))),
  2, 'two keys: holidays, events');

select * from finish();
rollback;
