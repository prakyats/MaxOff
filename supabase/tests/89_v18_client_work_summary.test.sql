-- v1.8 speed fix 3 (2026-10-23, migration v18_client_work_summary; DATA-MODEL §5 "client_work_summary";
-- ARCHITECTURE §19): public.client_work_summary() is the Clients list's one read for each client's
-- running deliverables. Who may call it (authenticated only, anon refused), that it runs as the
-- caller (security invoker), what each role reads (the Owner every client, an Admin their own, Crew
-- nothing), and each path of its sums: the states counted in total, done and closed (carried left
-- out), late and next planned around on_date, a finished project's items left out, a cycle that
-- does not cover the day left out (and counted for a day it covers), a client with no running item
-- left out. Dates come from app.today_ist(), so the file holds on any day. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '10000000-0000-4000-8000-000000000001'),
  ('admin',    '10000000-0000-4000-8000-000000000002'),
  ('staff',    '10000000-0000-4000-8000-000000000003'),
  ('admin2',   '00000000-0000-4000-8000-000000008902'),
  ('client_a', '00000000-0000-4000-8000-0000000089a1'),
  ('client_b', '00000000-0000-4000-8000-0000000089b1'),
  ('client_c', '00000000-0000-4000-8000-0000000089c1'),
  ('client_e', '00000000-0000-4000-8000-0000000089e1');
insert into fx select 'org', id from public.organizations limit 1;
grant select, insert on fx to authenticated, anon;

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
create function pg_temp.item(t text) returns uuid language sql stable security definer as $$
  select i.id from public.project_items i where i.title = $1 order by i.created_at desc, i.id limit 1;
$$;
-- This file's clients' rows only (the seed has clients of its own), as "key:total/done/closed/late/next".
create function pg_temp.summary(on_date date default app.today_ist()) returns text[] language sql stable as $$
  select coalesce(array_agg(f.key || ':' || s.total || '/' || s.done || '/' || s.closed || '/' || s.late || '/'
                            || coalesce(s.next_planned::text, '-') order by f.key), '{}')
  from public.client_work_summary(on_date) s join fx f on f.id = s.client_id;
$$;

-- Fixtures, written as the migration owner -------------------------------------------------------------
insert into auth.users (id, email) values (pg_temp.fx('admin2'), 'admin2-8902@example.com');
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('admin2'), pg_temp.fx('org'), 'Second Admin', 'admin2-8902@example.com', 'admin', 'active', now());
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Summary Alpha',   'active', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Summary Bravo',   'active', pg_temp.fx('admin2'), now()),
  (pg_temp.fx('client_c'), pg_temp.fx('org'), 'Summary Charlie', 'active', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_e'), pg_temp.fx('org'), 'Summary Echo',    'active', pg_temp.fx('admin'),  now());

select pg_temp.as_member('admin');
select public.project_create(pg_temp.fx('client_a'), 'Alpha film', 'one_time', null, app.today_ist() + 20,
  '{}'::text[], array['A late', 'A soon', 'A later', 'A done', 'A closed', 'A undated', 'A carried']);
select public.project_create(pg_temp.fx('client_a'), 'Alpha dropped', 'one_time', null, app.today_ist() + 20,
  '{}'::text[], array['Dropped one', 'Dropped two']);
select public.project_create(pg_temp.fx('client_c'), 'Charlie film', 'one_time', null, app.today_ist() + 20,
  '{}'::text[], array['C one']);
select public.project_create(pg_temp.fx('client_e'), 'Echo reels', 'monthly', null, null,
  '{}'::text[], array['E reel']);
select public.item_update(pg_temp.item('A late'),  jsonb_build_object('planned_date', app.today_ist() - 2));
select public.item_update(pg_temp.item('A soon'),  jsonb_build_object('planned_date', app.today_ist() + 3));
select public.item_update(pg_temp.item('A later'), jsonb_build_object('planned_date', app.today_ist() + 5));
select public.item_update(pg_temp.item('A done'),  jsonb_build_object('planned_date', app.today_ist() + 1));
select public.item_mark_done(pg_temp.item('A done'));
select public.item_cancel(pg_temp.item('A closed'), 'Not needed');
select pg_temp.as_member('admin2');
select public.project_create(pg_temp.fx('client_b'), 'Bravo film', 'one_time', null, app.today_ist() + 20,
  '{}'::text[], array['B one']);
select pg_temp.as_system();
-- A carried item (carry_forward), a cancelled project and a completed one, as the system.
update public.project_items
set state = 'carried', carry_decision = 'carry_forward', carry_decided_by = pg_temp.fx('owner'), carry_decided_at = now()
where id = pg_temp.item('A carried');
update public.projects set state = 'cancelled', cancelled_at = now(), cancelled_by = pg_temp.fx('owner'),
  cancelled_reason = 'Dropped'
where name = 'Alpha dropped';
update public.projects set state = 'completed', completed_at = now(), completed_by = pg_temp.fx('owner')
where name = 'Charlie film';

-- Who may call it ---------------------------------------------------------------------------------------
select has_function('public', 'client_work_summary', array['date'], 'client_work_summary(date) exists');
select is((select prosecdef from pg_proc where oid = 'public.client_work_summary(date)'::regprocedure), false,
  'client_work_summary() is security invoker: RLS decides every row it adds up');
select ok(has_function_privilege('authenticated', 'public.client_work_summary(date)', 'execute'),
  'authenticated may execute client_work_summary()');
select ok(not has_function_privilege('anon', 'public.client_work_summary(date)', 'execute'),
  'anon may not execute client_work_summary()');
select ok(not has_function_privilege('service_role', 'public.client_work_summary(date)', 'execute'),
  'service_role may not execute client_work_summary()');
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select throws_ok($$ select * from public.client_work_summary() $$, '42501', null, 'anon is refused');
select pg_temp.as_system();

-- The Owner: every client ------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(pg_temp.summary(),
  array['client_a:5/1/1/1/' || (app.today_ist() + 3), 'client_b:1/0/0/0/-', 'client_e:1/0/0/0/-'],
  'Owner: every client with running deliverables, each added up');
select is((select total from public.client_work_summary() where client_id = pg_temp.fx('client_a')), 5,
  'total: open, done and approved items; not the cancelled or carried one');
select is((select done from public.client_work_summary() where client_id = pg_temp.fx('client_a')), 1,
  'done: the item marked done (approved at once, amendment D3)');
select is((select closed from public.client_work_summary() where client_id = pg_temp.fx('client_a')), 1,
  'closed: the cancelled item');
select is((select late from public.client_work_summary() where client_id = pg_temp.fx('client_a')), 1,
  'late: the open item planned before today (the done one planned later is not open)');
select is((select next_planned from public.client_work_summary() where client_id = pg_temp.fx('client_a')),
  app.today_ist() + 3, 'next planned: the earliest open item from today on');
select is((select next_planned from public.client_work_summary() where client_id = pg_temp.fx('client_b')),
  null::date, 'next planned is null when no open item is dated');
select ok(not exists (select 1 from public.client_work_summary() where client_id = pg_temp.fx('client_c')),
  'a client whose only project is completed has no row');
select is(pg_temp.summary(app.today_ist() - 3), array['client_a:5/1/1/0/' || (app.today_ist() - 2),
  'client_b:1/0/0/0/-', 'client_e:1/0/0/0/-'],
  'on_date moves late and next planned (three days ago nothing was late yet)');
select pg_temp.as_system();

-- An Admin: their own clients only --------------------------------------------------------------------
select pg_temp.as_member('admin');
select is(pg_temp.summary(), array['client_a:5/1/1/1/' || (app.today_ist() + 3), 'client_e:1/0/0/0/-'],
  'Admin: their own clients, added up the same; not another Admin''s');
select pg_temp.as_member('admin2');
select is(pg_temp.summary(), array['client_b:1/0/0/0/-'], 'the other Admin: their client only');
select pg_temp.as_system();
update public.client_admin_assignments set to_at = now() where client_id = pg_temp.fx('client_b') and to_at is null;
update public.clients set admin_id = null where id = pg_temp.fx('client_b');
select pg_temp.as_member('admin2');
select is(pg_temp.summary(), '{}'::text[], 'an Admin no longer assigned reads nothing of that client');
select pg_temp.as_system();

-- Crew: nothing ---------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is((select count(*) from public.client_work_summary())::integer, 0, 'Crew: no row (no projects.manage)');
select pg_temp.as_system();

-- A recurring project's cycle counts only on a day its period covers ---------------------------------
update public.project_cycles
set period_start = app.today_ist() - 60, period_end = app.today_ist() - 31
where project_id = (select id from public.projects where name = 'Echo reels');
select pg_temp.as_member('owner');
select ok(not exists (select 1 from public.client_work_summary() where client_id = pg_temp.fx('client_e')),
  'a cycle whose period ended is not a current one: no row');
select is((select total from public.client_work_summary(app.today_ist() - 45) where client_id = pg_temp.fx('client_e')),
  1, 'and on a day its period covers, it counts');
select pg_temp.as_system();

-- A project back in progress counts again; a cycle with no item has no row ----------------------------
update public.projects set state = 'in_progress', cancelled_at = null, cancelled_by = null, cancelled_reason = null
where name = 'Alpha dropped';
select pg_temp.as_member('owner');
select is((select total from public.client_work_summary() where client_id = pg_temp.fx('client_a')), 7,
  'an in-progress project''s items count with the open one''s');
select pg_temp.as_system();
update public.project_items set state = 'cancelled', cancelled_at = now(), cancelled_by = pg_temp.fx('owner'),
  cancelled_reason = 'Gone'
where title = 'B one';
select pg_temp.as_member('owner');
select is((select total || '/' || closed from public.client_work_summary() where client_id = pg_temp.fx('client_b')),
  '0/1', 'a client whose running items are all closed: total 0, closed 1 (the list shows no line for it)');
select pg_temp.as_system();

select * from finish();
rollback;
