-- Phase 3 review: a member who is no longer an Admin reads none of their former clients, a member
-- who runs a client cannot be demoted or deactivated, and client_hand_over() moves their clients
-- first (every path, every role).
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- The local seed holds an organization and sign-ins. Keep the organization; replace the people
-- with fixtures. Rolled back at the end. Order follows the foreign keys.
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.expense_claims;
delete from public.comp_leave_credit_uses;
delete from public.comp_leave_credits;
delete from public.extra_work_notes;
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
delete from public.activity_log; -- again: the deletes above were audited

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000000001'),
  ('ravi',     '00000000-0000-4000-8000-000000000002'),
  ('asha',     '00000000-0000-4000-8000-000000000003'),
  ('staff',    '00000000-0000-4000-8000-000000000004'),
  ('meena',    '00000000-0000-4000-8000-000000000005'),
  ('client_a', '00000000-0000-4000-8000-0000000000a1'),
  ('client_b', '00000000-0000-4000-8000-0000000000b1'),
  ('client_c', '00000000-0000-4000-8000-0000000000c1'),
  ('contact',  '00000000-0000-4000-8000-0000000000d1');
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

-- The human sentence app.fail() puts in the error's detail.
create function pg_temp.detail_of(sql text) returns text language plpgsql as $$
declare d text;
begin
  execute sql;
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end;
$$;

create function pg_temp.moves(variadic pairs text[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('client_id', pg_temp.fx(pairs[i]), 'admin_id', pg_temp.fx(pairs[i + 1])))
  from generate_series(1, array_length(pairs, 1), 2) i;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key in ('owner', 'ravi', 'asha', 'staff', 'meena');

insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner@example.com', 'owner', 'active', now()),
  (pg_temp.fx('ravi'),  pg_temp.fx('org'), 'Ravi',       'ravi@example.com',  'admin', 'active', now()),
  (pg_temp.fx('asha'),  pg_temp.fx('org'), 'Asha',       'asha@example.com',  'admin', 'active', now()),
  (pg_temp.fx('staff'), pg_temp.fx('org'), 'Test Staff', 'staff@example.com', 'staff', 'active', now()),
  (pg_temp.fx('meena'), pg_temp.fx('org'), 'Meena',      'meena@example.com', 'admin', 'active', now());
insert into public.clients (id, org_id, name, admin_id) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', pg_temp.fx('ravi')),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery',     pg_temp.fx('ravi')),
  (pg_temp.fx('client_c'), pg_temp.fx('org'), 'Hill Cafe',       pg_temp.fx('meena'));
insert into public.client_contacts (id, client_id, name) values
  (pg_temp.fx('contact'), pg_temp.fx('client_c'), 'Mr Hill');
delete from public.activity_log; -- the fixture writes are not under test

-- Structure --------------------------------------------------------------------------------------
select has_function('public', 'client_hand_over', array['uuid', 'jsonb'], 'client_hand_over exists');
select ok(
  not has_function_privilege('anon', 'public.client_hand_over(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.client_hand_over(uuid, jsonb)', 'execute'),
  'anon cannot call client_hand_over; the function checks the rest');
select has_trigger('public', 'members', 'client_admin_guard', 'the members guard exists');

-- An Admin who runs clients cannot be demoted or deactivated ------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ update public.members set role = 'staff' where id = pg_temp.fx('ravi') $$,
  'P0001', 'CONFLICT', 'the Owner cannot demote an Admin who runs clients');
select is(pg_temp.detail_of($$ update public.members set role = 'staff' where id = pg_temp.fx('ravi') $$),
  'Move Ravi''s 2 clients to another Admin first.', 'the refusal names the person and the count');
select throws_ok($$ select public.member_deactivate(pg_temp.fx('ravi')) $$,
  'P0001', 'CONFLICT', 'nor deactivate them');
select lives_ok($$ update public.members set full_name = 'Ravi K' where id = pg_temp.fx('ravi') $$,
  'any other edit of that person is untouched');
select lives_ok($$ update public.members set role = 'staff' where id = pg_temp.fx('asha') $$,
  'an Admin who runs no client is demoted as before');
select lives_ok($$ update public.members set role = 'admin' where id = pg_temp.fx('asha') $$,
  'and promoted back');

-- client_hand_over: who may call it -----------------------------------------------------------------
select pg_temp.as_member('asha');
select throws_ok($$ select public.client_hand_over(pg_temp.fx('ravi'), pg_temp.moves('client_a', 'asha')) $$,
  'P0001', 'FORBIDDEN', 'Admin denied: only the Owner hands clients over');
select pg_temp.as_member('staff');
select throws_ok($$ select public.client_hand_over(pg_temp.fx('ravi'), pg_temp.moves('client_a', 'asha')) $$,
  'P0001', 'FORBIDDEN', 'Staff denied');

-- client_hand_over: every refusal ---------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.client_hand_over(pg_temp.fx('ravi'), '[]'::jsonb) $$,
  'P0001', 'VALIDATION', 'an empty move list is refused');
select throws_ok($$ select public.client_hand_over(pg_temp.fx('ravi'), '{}'::jsonb) $$,
  'P0001', 'VALIDATION', 'a move list must be an array');
select throws_ok($$ select public.client_hand_over(pg_temp.fx('ravi'), pg_temp.moves('client_c', 'asha')) $$,
  'P0001', 'VALIDATION', 'a client the person does not run is refused');
select throws_ok($$ select public.client_hand_over(pg_temp.fx('ravi'), pg_temp.moves('client_a', 'staff')) $$,
  'P0001', 'VALIDATION', 'a client goes only to an active Admin');
select throws_ok($$ select public.client_hand_over(pg_temp.fx('ravi'), pg_temp.moves('client_a', 'ravi')) $$,
  'P0001', 'INVALID_STATE', 'a client cannot be handed to the person who already runs it');
select throws_ok(
  $$ select public.client_hand_over(pg_temp.fx('ravi'), pg_temp.moves('client_a', 'asha', 'client_c', 'asha')) $$,
  'P0001', 'VALIDATION', 'one bad move refuses the whole hand-over');
select is((select admin_id from public.clients where id = pg_temp.fx('client_a')), pg_temp.fx('ravi'),
  'and nothing moved (one transaction)');

-- client_hand_over: the path -------------------------------------------------------------------
select is(public.client_hand_over(pg_temp.fx('ravi'), pg_temp.moves('client_a', 'asha')), 1,
  'the Owner moves one client');
select is(pg_temp.detail_of($$ update public.members set role = 'staff' where id = pg_temp.fx('ravi') $$),
  'Move Ravi K''s 1 client to another Admin first.', 'one client left: still refused');
select is(public.client_hand_over(pg_temp.fx('ravi'), pg_temp.moves('client_b', 'meena')), 1,
  'the last one goes to another Admin');
select lives_ok($$ update public.members set role = 'staff' where id = pg_temp.fx('ravi') $$,
  'with no client left, the demotion goes through');
select results_eq(
  $$ select c.name, c.admin_id from public.clients c where c.id in (pg_temp.fx('client_a'), pg_temp.fx('client_b')) order by c.name $$,
  $$ values ('Blue Bakery'::text, pg_temp.fx('meena')), ('Sharma Weddings'::text, pg_temp.fx('asha')) $$,
  'each client has its new Admin: none is left without one');
select is(
  (select count(*) from public.client_admin_assignments
   where client_id in (pg_temp.fx('client_a'), pg_temp.fx('client_b')) and to_at is null),
  2::bigint, 'the assignment history opened one row per client');
select is(
  (select count(*) from public.activity_log where entity = 'clients' and action = 'admin_assigned'),
  2::bigint, 'each move is audited as admin_assigned');

-- Deactivation goes the same way ------------------------------------------------------------------
select is(public.client_hand_over(pg_temp.fx('meena'), pg_temp.moves('client_b', 'asha', 'client_c', 'asha')), 2,
  'the Owner moves all of Meena''s clients at once');
select is(public.member_deactivate(pg_temp.fx('meena')), 'deactivated', 'then deactivates her');

-- The access check: a member without clients.edit_assigned reads nothing, even as admin_id ---------
-- (the guard makes this state unreachable; it is forced here to prove RLS does not rely on it)
select pg_temp.as_system();
alter table public.members disable trigger client_admin_guard;
update public.members set role = 'staff' where id = pg_temp.fx('asha');
alter table public.members enable trigger client_admin_guard;
select pg_temp.as_member('asha');
select is((select count(*) from public.clients), 0::bigint, 'a demoted Admin reads none of their clients');
select is((select count(*) from public.client_contacts), 0::bigint, 'nor their contacts');
select is((select count(*) from public.client_brand), 0::bigint, 'nor their brand');
select is((select count(*) from public.client_admin_assignments), 0::bigint, 'nor their assignments');
select is((select count(*) from public.activity_log where entity like 'client%'), 0::bigint, 'nor their activity');
select is((select count(*) from app.admin_client_ids()), 0::bigint, 'app.admin_client_ids() is empty');
select pg_temp.as_system();
update public.members set role = 'admin' where id = pg_temp.fx('asha');
select pg_temp.as_member('asha');
select is((select count(*) from public.clients), 3::bigint, 'an Admin again: the three clients are back');

select pg_temp.as_system();
select * from finish();
rollback;
