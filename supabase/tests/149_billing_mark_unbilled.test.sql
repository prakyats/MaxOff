-- v2.5 review (migration revenue_every_day_review): billing_mark_unbilled, the Revenue page's "Mark all N
-- billed". It marks only the lines still not billed (a line billed elsewhere since keeps its day and note),
-- counts only what it changed, audits only those, and checks what billing_mark checks. Owner allowed;
-- the client's Admin, Crew, anon and another organization's Owner refused. Seed members.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('client', '00000000-0000-4000-8000-0000001499a1');
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
-- A cycle's billing row and its "billed" audit rows, read as the system (whoever is calling).
create function pg_temp.status(k text) returns text language sql stable security definer as $$
  select coalesce(b.billing_status::text, 'not_billed') || ' ' || coalesce(b.billed_on::text, '-') || ' ' || coalesce(b.note, '-')
  from (select 1) one left join public.cycle_billing b on b.cycle_id = pg_temp.fx(k);
$$;
create function pg_temp.billed_audits(k text) returns integer language sql stable security definer as $$
  select count(*)::integer from public.activity_log a
  where a.entity = 'cycle_billing' and a.entity_id = pg_temp.fx(k) and a.action = 'billed';
$$;

select ok((select has_function_privilege('authenticated', p.oid, 'execute')
                  and has_function_privilege('service_role', p.oid, 'execute')
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not has_function_privilege('public', p.oid, 'execute')
                  and p.prosecdef and p.proconfig @> array['search_path=""']
                  and p.prosrc like '%finance.edit%'
                  and obj_description(p.oid, 'pg_proc') is not null
           from pg_proc p where p.oid = 'public.billing_mark_unbilled(uuid[], date)'::regprocedure),
  'authenticated and service_role, never anon; SECURITY DEFINER, empty search_path, finance.edit, a comment');

insert into public.clients (id, org_id, name, state, admin_id, activated_at)
select pg_temp.fx('client'), m.org_id, 'Mark all 149', 'active', pg_temp.fx('admin'), now()
from public.members m where m.id = pg_temp.fx('owner');
select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client'), 'Monthly 149', 'monthly', null, null,
  array['Stage 1'], array['A']));
insert into fx values ('q', public.project_create(pg_temp.fx('client'), 'Weekly 149', 'monthly', null, null,
  array['Stage 1'], array['B']));
insert into fx values ('ot', public.project_create(pg_temp.fx('client'), 'Film 149', 'one_time', null, app.today_ist() + 5,
  array['Stage 1'], array['Cut']));
select pg_temp.as_system();
insert into fx select 'c1', c.id from public.project_cycles c where c.project_id = pg_temp.fx('p');
insert into fx select 'c2', c.id from public.project_cycles c where c.project_id = pg_temp.fx('q');
insert into fx select 'c3', c.id from public.project_cycles c where c.project_id = pg_temp.fx('ot');

-- The Owner billed one line already, on another screen, with a day and a note.
select pg_temp.as_member('owner');
select public.billing_mark(array[pg_temp.fx('c1')], true, app.today_ist() - 3, 'Invoice 7');
select is(pg_temp.billed_audits('c1'), 1, 'the line billed elsewhere has its one "billed" row');

-- Refused, and nothing changes.
select is(pg_temp.code($$select public.billing_mark_unbilled(array[]::uuid[], null)$$), 'VALIDATION', 'nothing to mark is refused');
select is(pg_temp.code($$select public.billing_mark_unbilled(array[null]::uuid[], null)$$), 'VALIDATION', 'a list of nulls is nothing to mark');
select is(pg_temp.code($$select public.billing_mark_unbilled(null, null)$$), 'VALIDATION', 'no list at all is nothing to mark');
select is(pg_temp.code($$select public.billing_mark_unbilled(array(select gen_random_uuid() from generate_series(1, 201)), null)$$),
  'VALIDATION', 'more than 200 at a time is refused');
select is(pg_temp.code($$select public.billing_mark_unbilled(array[pg_temp.fx('c2')], app.today_ist() + 1)$$), 'VALIDATION',
  'a billed day in the future is refused');
select is(pg_temp.code($$select public.billing_mark_unbilled(array[pg_temp.fx('c2'), gen_random_uuid()], null)$$), 'NOT_FOUND',
  'an unknown cycle refuses the whole call');
select is(pg_temp.status('c2'), 'not_billed - -', 'and the known one beside it stays Not billed');
select is(pg_temp.billed_audits('c2'), 0, 'with no audit row');

-- Mark all: only the lines still not billed.
select is(public.billing_mark_unbilled(array[pg_temp.fx('c1'), pg_temp.fx('c2'), pg_temp.fx('c3'), pg_temp.fx('c2')], app.today_ist() - 1),
  2, 'it counts only the lines it changed (each cycle once)');
select is(pg_temp.status('c1'), 'billed ' || (app.today_ist() - 3)::text || ' Invoice 7', 'the line billed already keeps its day and its note');
select is(pg_temp.billed_audits('c1'), 1, 'and gets no new audit row');
select is(pg_temp.status('c2'), 'billed ' || (app.today_ist() - 1)::text || ' -', 'a retainer''s cycle is Billed on the day given, with no note');
select is(pg_temp.status('c3'), 'billed ' || (app.today_ist() - 1)::text || ' -', 'a one-time project is Billed through its cycle');
select is(pg_temp.billed_audits('c2') + pg_temp.billed_audits('c3'), 2, 'one "billed" audit row for each line it changed');
select is((select a.actor_id from public.activity_log a where a.entity = 'cycle_billing' and a.entity_id = pg_temp.fx('c2')
             and a.action = 'billed'), pg_temp.fx('owner'), 'the change is the Owner''s');
select is(public.billing_mark_unbilled(array[pg_temp.fx('c1'), pg_temp.fx('c2'), pg_temp.fx('c3')], null), 0,
  'again: nothing is left to mark');
select is(pg_temp.billed_audits('c1') + pg_temp.billed_audits('c2') + pg_temp.billed_audits('c3'), 3, 'and nothing more is audited');

-- Back to Not billed, then Mark all with no day: today (IST).
select public.billing_mark(array[pg_temp.fx('c2')], false, null, null);
select is(public.billing_mark_unbilled(array[pg_temp.fx('c2')], null), 1, 'a line back to Not billed is marked again');
select is(pg_temp.status('c2'), 'billed ' || app.today_ist()::text || ' -', 'on today (IST) when no day is given');

-- Refused for everyone but the Owner.
select public.billing_mark(array[pg_temp.fx('c2')], false, null, null);
select pg_temp.as_member('admin');
select is(pg_temp.code($$select public.billing_mark_unbilled(array[pg_temp.fx('c2')], null)$$), 'FORBIDDEN', 'the client''s Admin is refused');
select pg_temp.as_member('staff');
select is(pg_temp.code($$select public.billing_mark_unbilled(array[pg_temp.fx('c2')], null)$$), 'FORBIDDEN', 'Crew are refused');
select pg_temp.as_anon();
select is(pg_temp.code($$select public.billing_mark_unbilled(array[pg_temp.fx('c2')], null)$$), 'NO_PRIVILEGE', 'anon has no privilege');

-- Another organization's Owner: this organization's cycles are not theirs.
select pg_temp.as_system();
insert into fx values ('org_b', '00000000-0000-4000-8000-000000149910'), ('b_owner', '00000000-0000-4000-8000-000000149911');
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Other org 149');
insert into auth.users (id, email) values (pg_temp.fx('b_owner'), 'b-owner-149@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at) values
  (pg_temp.fx('b_owner'), pg_temp.fx('org_b'), 'Other Owner', 'b-owner-149@example.com', 'owner', 'active', 'permanent', now());
select pg_temp.as_member('b_owner');
select is(pg_temp.code($$select public.billing_mark_unbilled(array[pg_temp.fx('c2')], null)$$), 'NOT_FOUND',
  'another organization''s Owner: NOT_FOUND');
select pg_temp.as_system();
select is(pg_temp.status('c2'), 'not_billed - -', 'and after every refusal the line is still Not billed');
select is(pg_temp.billed_audits('c2'), 2, 'with only the Owner''s two marks audited');

select * from finish();
rollback;
