-- v7.0 unit 2 (owner Q3, 14 Nov 2026; migration v70_request_keys; DATA-MODEL §1 "v7.0 request keys"):
-- repeat-safe creates. The ledger is closed to every role through the API; each _once function
-- exists with the API's grants; a repeat with the same key returns the first id with exactly one
-- row, one history entry and the same notifications; the same key with other details is CONFLICT;
-- another member's same key is their own; no key behaves as before; and a plain insert's key is
-- refused the second time by its unique index. Neutral names only; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('k1', '30000000-0000-4000-8000-000000000001'),
  ('k2', '30000000-0000-4000-8000-000000000002'),
  ('k3', '30000000-0000-4000-8000-000000000003'),
  ('k4', '30000000-0000-4000-8000-000000000004'),
  ('k5', '30000000-0000-4000-8000-000000000005');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') and kind = 'normal' order by position limit 1;
insert into fx select 'travel', id from public.list_items
  where list_key = 'expense_category' and name = 'Travel' and org_id = (select id from fx where key = 'org');
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

-- 1-8: the ledger, closed to every role (no policy, no grant).
select pg_temp.as_member('owner');
select throws_ok($$ select * from public.request_keys $$, '42501', null, 'the Owner cannot read request_keys');
select throws_ok($$ insert into public.request_keys (member_id, request_key, kind, payload_hash) values (auth.uid(), gen_random_uuid(), 'x', 'x') $$, '42501', null, 'the Owner cannot write request_keys');
select pg_temp.as_member('admin');
select throws_ok($$ select * from public.request_keys $$, '42501', null, 'an Admin cannot read request_keys');
select throws_ok($$ insert into public.request_keys (member_id, request_key, kind, payload_hash) values (auth.uid(), gen_random_uuid(), 'x', 'x') $$, '42501', null, 'an Admin cannot write request_keys');
select pg_temp.as_member('staff');
select throws_ok($$ select * from public.request_keys $$, '42501', null, 'Crew cannot read request_keys');
select throws_ok($$ insert into public.request_keys (member_id, request_key, kind, payload_hash) values (auth.uid(), gen_random_uuid(), 'x', 'x') $$, '42501', null, 'Crew cannot write request_keys');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select * from public.request_keys $$, '42501', null, 'anon cannot read request_keys');
reset role;
select ok(not has_function_privilege('anon', 'app.request_claim(uuid, text, text)', 'execute'), 'anon cannot claim a key');

-- 9-16: every _once function exists, for signed-in members only.
select ok(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), f || ': authenticated only')
from unnest(array[
  'public.task_create_once(uuid, text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb)',
  'public.task_request_create_once(uuid, text, text, uuid)',
  'public.project_create_once(uuid, uuid, text, public.recurrence, text, date, text[], text[], uuid, jsonb)',
  'public.project_create_grouped_once(uuid, uuid, text, public.recurrence, text, date, jsonb, jsonb, uuid, jsonb)',
  'public.item_add_once(uuid, uuid, text, date, text, jsonb)',
  'public.item_add_grouped_once(uuid, uuid, text, date, text, jsonb, jsonb)',
  'public.client_create_once(uuid, jsonb)',
  'public.expense_claim_submit_once(uuid, date, numeric, uuid, text, uuid)'
]) f;

-- 17-22: a task request (Crew): first creates, the repeat returns it; one row, one history entry.
select pg_temp.as_member('staff');
insert into fx values ('req', public.task_request_create_once(pg_temp.fx('k1'), 'Suggested 145', 'Details', null));
select is(public.task_request_create_once(pg_temp.fx('k1'), 'Suggested 145', 'Details', null), pg_temp.fx('req'),
  'the same key returns the first request');
select pg_temp.as_system();
select is((select count(*)::int from public.task_requests where title = 'Suggested 145'), 1, 'one task request, not two');
select is((select count(*)::int from public.activity_log where entity_id = pg_temp.fx('req')), 1, 'one history entry');
select is((select count(*)::int from public.notifications where entity_id = pg_temp.fx('req')),
  (select count(distinct recipient_id)::int from public.notifications where entity_id = pg_temp.fx('req')),
  'no one is told twice');
select pg_temp.as_member('staff');
select throws_ok($$ select public.task_request_create_once(pg_temp.fx('k1'), 'Another title', null, null) $$,
  'P0001', 'CONFLICT', 'the same key with other details is refused');
select isnt(public.task_request_create_once(null, 'Suggested 145 b', null, null),
  public.task_request_create_once(null, 'Suggested 145 b', null, null), 'no key: each call creates, as before');

-- 23-25: another member's same key is theirs (an Admin's request with k1 is a new request).
select pg_temp.as_member('admin');
select isnt(public.task_request_create_once(pg_temp.fx('k1'), 'Suggested 145', 'Details', null), pg_temp.fx('req'),
  'another member''s same key makes their own');
select pg_temp.as_system();
select is((select count(*)::int from public.task_requests where title = 'Suggested 145'), 2, 'one each');
select is((select count(*)::int from public.request_keys where request_key = pg_temp.fx('k1')), 2, 'one ledger row each');

-- 26-28: a task (the Owner).
select pg_temp.as_member('owner');
insert into fx values ('task', public.task_create_once(pg_temp.fx('k2'), 'Task 145', 'Brief', pg_temp.fx('type'),
  null, 'medium', now() + interval '5 days', array[pg_temp.fx('staff')], pg_temp.fx('staff')));
select is(public.task_create_once(pg_temp.fx('k2'), 'Task 145', 'Brief', pg_temp.fx('type'),
  null, 'medium', (select due_at from public.tasks where id = pg_temp.fx('task')), array[pg_temp.fx('staff')], pg_temp.fx('staff')),
  pg_temp.fx('task'), 'a task: the same key returns the first');
select pg_temp.as_system();
select is((select count(*)::int from public.tasks where title = 'Task 145'), 1, 'one task, not two');
select is((select count(*)::int from public.task_assignees where task_id = pg_temp.fx('task')), 1, 'its assignee once');

-- 29-30: an expense claim (Crew; their own, Owner-and-self only as before).
select pg_temp.as_member('staff');
insert into fx values ('claim', public.expense_claim_submit_once(pg_temp.fx('k3'), app.today_ist(), 145, pg_temp.fx('travel'), 'Bus 145'));
select is(public.expense_claim_submit_once(pg_temp.fx('k3'), app.today_ist(), 145, pg_temp.fx('travel'), 'Bus 145'),
  pg_temp.fx('claim'), 'a claim: the same key returns the first');
select throws_ok(format($$ select public.expense_claim_submit_once(%L, app.today_ist(), 146, %L, 'Bus 145') $$, pg_temp.fx('k3'), pg_temp.fx('travel')),
  'P0001', 'CONFLICT', 'a claim: the same key with another amount is refused');

-- 31-32: a client (an Admin).
select pg_temp.as_member('admin');
insert into fx values ('client', public.client_create_once(pg_temp.fx('k4'), '{"name": "Cafe 145"}'));
select is(public.client_create_once(pg_temp.fx('k4'), '{"name": "Cafe 145"}'), pg_temp.fx('client'),
  'a client: the same key returns the first');
select pg_temp.as_system();
select is((select count(*)::int from public.clients where name = 'Cafe 145'), 1, 'one client, not two');

-- 33-34: permissions unchanged: the wrapper refuses whom the function refuses, and keeps no key.
select pg_temp.as_member('staff');
select throws_ok($$ select public.client_create_once(pg_temp.fx('k5'), '{"name": "Cafe 145 b"}') $$,
  'P0001', 'FORBIDDEN', 'Crew still may not create a client');
select pg_temp.as_system();
select is((select count(*)::int from public.request_keys where request_key = pg_temp.fx('k5')), 0,
  'a refused create keeps no key');

-- 35-36: the plain inserts' keys.
insert into public.task_comments (task_id, author_id, body, request_key)
  values (pg_temp.fx('task'), pg_temp.fx('staff'), 'Note 145', pg_temp.fx('k1'));
select throws_ok(format($$ insert into public.task_comments (task_id, author_id, body, request_key) values (%L, %L, 'Note 145', %L) $$,
  pg_temp.fx('task'), pg_temp.fx('staff'), pg_temp.fx('k1')), '23505', null, 'a comment sent twice with its key is refused');
insert into public.client_contacts (org_id, client_id, name, request_key)
  values (pg_temp.fx('org'), pg_temp.fx('client'), 'Contact 145', pg_temp.fx('k1'));
select throws_ok(format($$ insert into public.client_contacts (org_id, client_id, name, request_key) values (%L, %L, 'Contact 145', %L) $$,
  pg_temp.fx('org'), pg_temp.fx('client'), pg_temp.fx('k1')), '23505', null, 'a contact sent twice with its key is refused');

-- 37-38: no key on the plain inserts is as before; the ledger kept the kind.
insert into public.task_comments (task_id, author_id, body) values (pg_temp.fx('task'), pg_temp.fx('staff'), 'Note 145 b');
select lives_ok(format($$ insert into public.task_comments (task_id, author_id, body) values (%L, %L, 'Note 145 b') $$,
  pg_temp.fx('task'), pg_temp.fx('staff')), 'comments without a key are never refused for it');
select is((select kind from public.request_keys where request_key = pg_temp.fx('k2')), 'task_create', 'the ledger names the kind');

-- 39-42: the client work creates (the client's Admin, who made it).
select pg_temp.as_member('admin');
insert into fx values ('k6', '30000000-0000-4000-8000-000000000006'), ('k7', '30000000-0000-4000-8000-000000000007'),
  ('k8', '30000000-0000-4000-8000-000000000008'), ('k9', '30000000-0000-4000-8000-000000000009');
insert into fx values ('project', public.project_create_once(pg_temp.fx('k6'), pg_temp.fx('client'), 'Project 145', 'monthly'));
select is(public.project_create_once(pg_temp.fx('k6'), pg_temp.fx('client'), 'Project 145', 'monthly'),
  pg_temp.fx('project'), 'a project: the same key returns the first');
insert into fx values ('project_g', public.project_create_grouped_once(pg_temp.fx('k7'), pg_temp.fx('client'), 'Project 145 g', 'weekly'));
select is(public.project_create_grouped_once(pg_temp.fx('k7'), pg_temp.fx('client'), 'Project 145 g', 'weekly'),
  pg_temp.fx('project_g'), 'a grouped project: the same key returns the first');
insert into fx select 'cycle', c.id from public.project_cycles c where c.project_id = pg_temp.fx('project') order by c.period_start limit 1;
insert into fx values ('item', public.item_add_once(pg_temp.fx('k8'), pg_temp.fx('cycle'), 'Item 145'));
select is(public.item_add_once(pg_temp.fx('k8'), pg_temp.fx('cycle'), 'Item 145'), pg_temp.fx('item'),
  'a deliverable: the same key returns the first');
insert into fx values ('item_g', public.item_add_grouped_once(pg_temp.fx('k9'), pg_temp.fx('cycle'), 'Item 145 g'));
select is(public.item_add_grouped_once(pg_temp.fx('k9'), pg_temp.fx('cycle'), 'Item 145 g'), pg_temp.fx('item_g'),
  'a grouped deliverable: the same key returns the first');
select pg_temp.as_system();

-- 43-44: a member sends a keyed comment through the API's own grants (the CI catch, v70_comment_key_grant).
select pg_temp.as_member('staff');
select lives_ok(format($$ insert into public.task_comments (task_id, body, request_key) values (%L, 'Keyed by Crew 145', %L) $$,
  pg_temp.fx('task'), pg_temp.fx('k9')), 'Crew on the task send a keyed comment');
select throws_ok(format($$ insert into public.task_comments (task_id, body, request_key) values (%L, 'Keyed by Crew 145', %L) $$,
  pg_temp.fx('task'), pg_temp.fx('k9')), '23505', null, 'and the same key again is refused');
select pg_temp.as_system();

select * from finish();
rollback;
