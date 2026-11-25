-- v2.1 (migration item_mark_done_and_complete; kickoff 9 R1): "Mark done and complete project" for a one-time
-- project's last open deliverable, for the Owner and the client's Admin; another Admin (NOT_FOUND), Crew
-- (FORBIDDEN) and anon (no privilege) refused; every path. Seed members.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('admin2', '00000000-0000-4000-8000-000000147902'),
  ('client', '00000000-0000-4000-8000-0000001479a1');
grant select, insert on fx to authenticated, anon, service_role;
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
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;
create function pg_temp.code(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception
  when sqlstate 'P0001' then return sqlerrm;
  when insufficient_privilege then return 'NO_PRIVILEGE';
end;
$$;
create function pg_temp.item(p uuid, t text) returns uuid language sql stable security definer as $$
  select i.id from public.project_items i where i.project_id = p and i.title = t;
$$;
create function pg_temp.istate(i uuid) returns text language sql stable security definer as $$
  select state::text from public.project_items where id = i;
$$;
create function pg_temp.pstate(p uuid) returns text language sql stable security definer as $$
  select state::text from public.projects where id = p;
$$;
create function pg_temp.entries(p_entity text, p_action text, p_id uuid) returns integer language sql stable security definer as $$
  select count(*)::integer from public.activity_log a where a.entity = p_entity and a.action = p_action and a.entity_id = p_id;
$$;
create function pg_temp.notes(k text, p_kind text, p uuid) returns integer language sql stable security definer as $$
  select count(*)::integer from public.notifications n
  where n.recipient_id = pg_temp.fx(k) and n.kind = p_kind and n.entity_id = p;
$$;

insert into auth.users (id, email) values (pg_temp.fx('admin2'), 'admin2-147@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at)
select pg_temp.fx('admin2'), m.org_id, 'Other Admin 147', 'admin2-147@example.com', 'admin', 'active', 'permanent', now()
from public.members m where m.id = pg_temp.fx('owner');
insert into public.clients (id, org_id, name, state, admin_id, activated_at)
select pg_temp.fx('client'), m.org_id, 'Complete 147', 'active', pg_temp.fx('admin'), now()
from public.members m where m.id = pg_temp.fx('owner');

select has_function('public', 'item_mark_done_and_complete', array['uuid'], 'the function exists');
select ok((select has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                  and p.prosecdef and p.proconfig @> array['search_path=""']
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'item_mark_done_and_complete'),
  'authenticated, never anon; SECURITY DEFINER with an empty search_path');

select pg_temp.as_member('admin');
insert into fx values ('film', public.project_create(pg_temp.fx('client'), 'Film 147', 'one_time', null, app.today_ist() + 20,
  array['Stage 1'], array['Cut 1', 'Cut 2']));
insert into fx values ('film2', public.project_create(pg_temp.fx('client'), 'Second 147', 'one_time', null, app.today_ist() + 20,
  array['Stage 1'], array['Only']));
insert into fx values ('monthly', public.project_create(pg_temp.fx('client'), 'Monthly 147', 'monthly', null, null,
  array['Stage 1'], array['One']));

-- Not the last one: nothing is marked.
select is(pg_temp.code($$select public.item_mark_done_and_complete(pg_temp.item(pg_temp.fx('film'), 'Cut 1'))$$), 'INVALID_STATE',
  'with another deliverable still open the project cannot be completed');
select is(pg_temp.istate(pg_temp.item(pg_temp.fx('film'), 'Cut 1')), 'open', 'and the deliverable is not marked either (one transaction)');
select is(pg_temp.code($$select public.item_mark_done_and_complete(pg_temp.item(pg_temp.fx('monthly'), 'One'))$$), 'VALIDATION',
  'a retainer''s deliverable is refused: one-time projects only');
select is(pg_temp.istate(pg_temp.item(pg_temp.fx('monthly'), 'One')), 'open', 'and stays open');
select is(pg_temp.code($$select public.item_mark_done_and_complete(gen_random_uuid())$$), 'NOT_FOUND', 'an unknown deliverable is NOT_FOUND');

-- Refused roles.
select pg_temp.as_member('admin2');
select is(pg_temp.code($$select public.item_mark_done_and_complete(pg_temp.item(pg_temp.fx('film2'), 'Only'))$$), 'NOT_FOUND',
  'another Admin: NOT_FOUND (not their client)');
select pg_temp.as_member('staff');
select is(pg_temp.code($$select public.item_mark_done_and_complete(pg_temp.item(pg_temp.fx('film2'), 'Only'))$$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_anon();
select is(pg_temp.code($$select public.item_mark_done_and_complete(pg_temp.item(pg_temp.fx('film2'), 'Only'))$$), 'NO_PRIVILEGE', 'anon: no privilege');
select is(pg_temp.pstate(pg_temp.fx('film2')), 'open', 'none of them changed the project');

-- The client's Admin: the last open deliverable.
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.item(pg_temp.fx('film'), 'Cut 1'));
select is(public.item_mark_done_and_complete(pg_temp.item(pg_temp.fx('film'), 'Cut 2'))::text, 'completed',
  'the client''s Admin marks the last one done and completes the project');
select is(pg_temp.istate(pg_temp.item(pg_temp.fx('film'), 'Cut 2')), 'approved', 'the deliverable is done (approved, D3)');
select is(pg_temp.pstate(pg_temp.fx('film')), 'completed', 'the project is completed');
select is(pg_temp.entries('project_items', 'done', pg_temp.item(pg_temp.fx('film'), 'Cut 2')), 1, 'the deliverable''s history has its done entry');
select is(pg_temp.entries('projects', 'completed', pg_temp.fx('film')), 1, 'the project''s history has its completed entry');
select is(pg_temp.notes('owner', 'project_completed', pg_temp.fx('film')), 1, 'the Owner is told the project was completed, as project_complete does');
select is(pg_temp.code($$select public.item_mark_done_and_complete(pg_temp.item(pg_temp.fx('film'), 'Cut 2'))$$), 'INVALID_STATE',
  'a completed project is read-only: a second call is refused');

-- The last deliverable is already done (not open): refused, and the project is not completed by it.
insert into fx values ('film3', public.project_create(pg_temp.fx('client'), 'Third 147', 'one_time', null, app.today_ist() + 20,
  array['Stage 1'], array['Solo']));
select public.item_mark_done(pg_temp.item(pg_temp.fx('film3'), 'Solo'));
select is(pg_temp.code($$select public.item_mark_done_and_complete(pg_temp.item(pg_temp.fx('film3'), 'Solo'))$$), 'INVALID_STATE',
  'a deliverable that is already done is refused (it is not open)');
select is(pg_temp.pstate(pg_temp.fx('film3')), 'in_progress', 'and the project is left as it was, for Complete on the project');

-- The Owner.
select pg_temp.as_member('owner');
select is(public.item_mark_done_and_complete(pg_temp.item(pg_temp.fx('film2'), 'Only'))::text, 'completed', 'the Owner does the same');
select is(pg_temp.notes('admin', 'project_completed', pg_temp.fx('film2')), 1, 'and the client''s Admin is told');
select ok(not exists (select 1 from public.notifications n where n.entity_id in (pg_temp.fx('film'), pg_temp.fx('film2'))
                        and coalesce(n.title, '') || coalesce(n.body, '') ~ '₹'),
  'no notification carries an amount');
-- Money follows: a completed one-time project is Achieved (the Owner's view).
select public.billing_set_project(pg_temp.fx('film2'), 8000, true, null);
select is((select achieved from public.revenue_project_lines_v where project_id = pg_temp.fx('film2')), 8000::numeric,
  'its lump sum counts as Achieved once completed');

select * from finish();
rollback;
