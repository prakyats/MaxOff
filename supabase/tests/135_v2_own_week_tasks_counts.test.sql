-- v2.0 X3 step 3, /tasks (2026-11-05, migration own_week_tasks_counts; DATA-MODEL §1 "v2.0 X3";
-- advisor on #89: the own_week alternative): own_week() gains requests_to_decide
-- (app.requests_to_decide_count(): countRequestsToDecide, never the caller's own) and the
-- organisation's ack_escalate_hours and ack_escalate_owner_hours (getSettings' org_settings row,
-- under RLS). The helper's grants; a DRIFT GUARD: the helper and the RLS count side by side over a
-- mixed fixture (every state, no client, the Admin's client, another Admin's client) for every
-- role, an Admin without task_requests.decide, a handover and no session; each role's own_week
-- keys equal to the reads they replace; the earlier keys stay (132, 134). Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('mine',  '00000000-0000-4000-8000-000000013501'),
  ('other', '00000000-0000-4000-8000-000000013502');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') order by position limit 1;
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
-- The reads the new keys replace, as the caller (the same filters, RLS deciding).
create function pg_temp.rls_count() returns integer language sql stable as $$
  select count(*)::integer from public.task_requests r where r.state = 'pending' and r.requested_by <> auth.uid();
$$;
create function pg_temp.api_settings() returns jsonb language sql stable as $$
  select jsonb_build_object('h', s.ack_escalate_hours, 'o', s.ack_escalate_owner_hours) from public.org_settings s limit 1;
$$;
create function pg_temp.week() returns jsonb language sql stable as $$
  select public.own_week(app.today_ist(), app.today_ist());
$$;
create function pg_temp.week_settings() returns jsonb language sql stable as $$
  select jsonb_build_object('h', w->'ack_escalate_hours', 'o', w->'ack_escalate_owner_hours') from pg_temp.week() w;
$$;
-- The drift guard: the helper, own_week's key and the RLS count, all three equal.
create function pg_temp.agree() returns boolean language sql stable as $$
  select app.requests_to_decide_count() = pg_temp.rls_count()
     and (pg_temp.week()->>'requests_to_decide')::integer = pg_temp.rls_count();
$$;

-- What already waits on this database (the seed, or an earlier file's rows), read as the Owner.
select pg_temp.as_member('owner');
create temporary table fx_base as select pg_temp.rls_count() as n;
select pg_temp.as_system();
grant select on fx_base to authenticated;

-- A mixed fixture: every state; pending with no client from Crew and from the Admin; pending
-- labelled with the Admin's client and with another Admin's client; a declined and a withdrawn one
-- (never counted), and a converted one (its task).
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('mine'),  pg_temp.fx('org'), 'Client mine 135',  'active', pg_temp.fx('admin'), now()),
  (pg_temp.fx('other'), pg_temp.fx('org'), 'Client other 135', 'active',
   (select m.id from public.members m where m.role = 'admin' and m.status = 'active' and m.id <> pg_temp.fx('admin') limit 1), now());
insert into public.task_requests (org_id, requested_by, title, client_id) values
  (pg_temp.fx('org'), pg_temp.fx('staff'), 'Rq crew 135', null),
  (pg_temp.fx('org'), pg_temp.fx('admin'), 'Rq admin 135', null),
  (pg_temp.fx('org'), pg_temp.fx('staff'), 'Rq crew mine 135', pg_temp.fx('mine')),
  (pg_temp.fx('org'), pg_temp.fx('staff'), 'Rq crew other 135', pg_temp.fx('other')),
  -- X6 review (20261111030554): another Admin's no-client request is the Owner's to decide, never
  -- this Admin's to count (app.task_request_visible).
  (pg_temp.fx('org'), (select admin_id from public.clients where id = pg_temp.fx('other')), 'Rq admin2 135', null);
insert into public.task_requests (org_id, requested_by, title, client_id, state, decided_by, decided_at, decision_reason) values
  (pg_temp.fx('org'), pg_temp.fx('staff'), 'Rq declined 135', null, 'declined', pg_temp.fx('owner'), now(), 'Not needed'),
  (pg_temp.fx('org'), pg_temp.fx('staff'), 'Rq withdrawn 135', pg_temp.fx('mine'), 'withdrawn', null, null, null);
insert into public.tasks (id, org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id) values
  ('00000000-0000-4000-8000-000000013510', pg_temp.fx('org'), 'Rq task 135', pg_temp.fx('type'), 'medium', now() + interval '3 days',
   'todo', pg_temp.fx('owner'), pg_temp.fx('staff'));
insert into public.task_requests (org_id, requested_by, title, client_id, state, decided_by, decided_at, task_id) values
  (pg_temp.fx('org'), pg_temp.fx('staff'), 'Rq converted 135', null, 'converted', pg_temp.fx('owner'), now(),
   '00000000-0000-4000-8000-000000013510');

-- 1. The helper's grants ------------------------------------------------------------------------------
select is((select prosecdef from pg_proc where oid = 'app.requests_to_decide_count()'::regprocedure), true,
  'the helper is security definer, as task_counts() is');
select ok(has_function_privilege('authenticated', 'app.requests_to_decide_count()', 'execute'), 'authenticated may call it');
select ok(not has_function_privilege('anon', 'app.requests_to_decide_count()', 'execute'), 'anon may not');
select is((select proconfig from pg_proc where oid = 'app.requests_to_decide_count()'::regprocedure), array['search_path=""'],
  'the empty search_path');
select is((select prosecdef from pg_proc where oid = 'public.own_week(date, date)'::regprocedure), false,
  'own_week stays security invoker');

-- 2. The drift guard, each role -----------------------------------------------------------------------
select pg_temp.as_member('owner');
select ok(pg_temp.agree(), 'Owner: the helper, own_week and the RLS count agree');
select is(app.requests_to_decide_count(), (select n from fx_base) + 5, 'Owner: every pending one, no other state');
select pg_temp.as_member('admin');
select ok(pg_temp.agree(), 'Admin: the helper, own_week and the RLS count agree');
select is(app.requests_to_decide_count(), (select n from fx_base) + 2,
  'Admin: Crew''s with no client and with their client; never their own, nor another Admin''s client''s');
select is((select count(*)::integer from public.task_requests r where r.title in ('Rq crew mine 135', 'Rq crew other 135')), 1,
  'Admin: RLS shows their client''s request and not the other''s (the fixture holds)');
select is((select count(*)::integer from public.task_requests r where r.title = 'Rq admin2 135'), 0,
  'Admin: RLS never shows another Admin''s no-client request (the Owner''s to decide)');
select is(app.requests_to_decide_count(), (select n from fx_base) + 2,
  'Admin: another Admin''s no-client request is not counted either (X6 review)');
select pg_temp.as_member('staff');
select ok(pg_temp.agree(), 'Crew: the helper, own_week and the RLS count agree');
select is(app.requests_to_decide_count(), 0, 'Crew: 0 (they see only their own, never counted)');

-- An Admin without task_requests.decide: RLS shows them their own only, so 0 both ways.
select pg_temp.as_system();
delete from public.role_permissions where role = 'admin' and permission = 'task_requests.decide';
select pg_temp.as_member('admin');
select ok(pg_temp.agree(), 'Admin without task_requests.decide: the helper and the RLS count agree');
select is(app.requests_to_decide_count(), 0, 'Admin without task_requests.decide: 0');
select pg_temp.as_system();
insert into public.role_permissions (role, permission) values ('admin', 'task_requests.decide');

-- A client handed over to the other Admin leaves the Admin's count, both ways.
update public.clients set admin_id = (select admin_id from public.clients where id = pg_temp.fx('other'))
where id = pg_temp.fx('mine');
select pg_temp.as_member('admin');
select ok(pg_temp.agree(), 'after a handover: the helper and the RLS count agree');
select is(app.requests_to_decide_count(), (select n from fx_base) + 1, 'after a handover: their client''s request leaves the count');

-- Deciding one takes it out, both ways.
select pg_temp.as_system();
update public.task_requests set state = 'declined', decided_by = pg_temp.fx('owner'), decided_at = now(), decision_reason = 'No'
where title = 'Rq crew 135';
select pg_temp.as_member('owner');
select ok(pg_temp.agree(), 'after a decision: the helper and the RLS count agree');
select is(app.requests_to_decide_count(), (select n from fx_base) + 4, 'after a decision: one fewer');

-- 3. own_week's thresholds, each role ------------------------------------------------------------------
select is(pg_temp.week_settings(), pg_temp.api_settings(), 'Owner: the thresholds equal org_settings');
select pg_temp.as_member('admin');
select is(pg_temp.week_settings(), pg_temp.api_settings(), 'Admin: the thresholds equal org_settings');
select pg_temp.as_member('staff');
select is(pg_temp.week_settings(), pg_temp.api_settings(), 'Crew: the thresholds equal org_settings');
select isnt(pg_temp.week()->'ack_escalate_hours', 'null'::jsonb, 'Crew: a value, not null');

-- 4. No session: nothing counted, no thresholds -------------------------------------------------------
select pg_temp.as_system();
select set_config('role', 'authenticated', true);
select is(app.requests_to_decide_count(), 0, 'no session: 0');
select ok(pg_temp.agree(), 'no session: agree');
select is(pg_temp.week()->'ack_escalate_hours', 'null'::jsonb, 'no session: no thresholds (read the usual way)');

-- 5. The keys ------------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select ok(pg_temp.week() ?& array['holidays', 'events', 'leave', 'freelancers'], 'the earlier keys stay');
select ok(pg_temp.week() ?& array['requests_to_decide', 'ack_escalate_hours', 'ack_escalate_owner_hours'], 'the three new keys');
select ok(not (public.session_early() ?| array['requests_to_decide', 'ack_escalate_hours']), 'session_early untouched');
select ok((select count(*) from information_schema.parameters p join information_schema.routines r on r.specific_name = p.specific_name
           where r.routine_schema = 'public' and r.routine_name = 'session_bundle' and p.parameter_mode = 'OUT') = 10,
  'session_bundle untouched: its ten columns');

select * from finish();
rollback;
