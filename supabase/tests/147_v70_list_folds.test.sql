-- v7.0 list folds (migration v70_list_folds): tasks_list_all and task_requests_list return what the
-- two reads they replace returned, under each role's own RLS (security invoker), with the finished
-- half capped; anon may not call them. Neutral names only; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') and kind = 'normal' order by position limit 1;
grant select, insert on fx to authenticated;

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

-- What the two old reads returned, as the caller sees it.
create function pg_temp.tasks_by_two_reads(lim integer) returns setof uuid language sql stable as $$
  select id from public.tasks where state not in ('completed', 'cancelled')
  union all
  (select id from public.tasks where state in ('completed', 'cancelled') order by updated_at desc limit lim);
$$;
create function pg_temp.requests_by_two_reads(lim integer) returns setof uuid language sql stable as $$
  select id from public.task_requests where state = 'pending'
  union all
  (select id from public.task_requests where state <> 'pending' order by updated_at desc limit lim);
$$;

select ok(not p.prosecdef, 'tasks_list_all is security invoker')
from pg_proc p where p.oid = 'public.tasks_list_all(integer)'::regprocedure;
select ok(not p.prosecdef, 'task_requests_list is security invoker')
from pg_proc p where p.oid = 'public.task_requests_list(integer)'::regprocedure;

-- A task for the Crew member, one only the Admin is on, and a suggestion from each of them.
select pg_temp.as_member('owner');
insert into fx values ('staff_task', public.task_create('Fold 147 crew', 'Brief', pg_temp.fx('type'),
  null, 'medium', now() + interval '5 days', array[pg_temp.fx('staff')], pg_temp.fx('staff')));
insert into fx values ('admin_task', public.task_create('Fold 147 admin', 'Brief', pg_temp.fx('type'),
  null, 'medium', now() + interval '5 days', array[pg_temp.fx('admin')], pg_temp.fx('admin')));
select pg_temp.as_member('staff');
insert into fx values ('staff_req', public.task_request_create_once(gen_random_uuid(), 'Fold 147 crew idea', 'Details', null));
select pg_temp.as_member('admin');
insert into fx values ('admin_req', public.task_request_create_once(gen_random_uuid(), 'Fold 147 admin idea', 'Details', null));

-- Each role: the fold returns exactly what the two reads returned.
select pg_temp.as_member('owner');
select set_eq('select id from public.tasks_list_all(300)', 'select * from pg_temp.tasks_by_two_reads(300)',
  'Owner: the task fold is the two reads');
select set_eq('select id from public.task_requests_list(50)', 'select * from pg_temp.requests_by_two_reads(50)',
  'Owner: the request fold is the two reads');
select ok(pg_temp.fx('admin_task') in (select id from public.tasks_list_all(300)), 'Owner: sees every task');

select pg_temp.as_member('admin');
select set_eq('select id from public.tasks_list_all(300)', 'select * from pg_temp.tasks_by_two_reads(300)',
  'Admin: the task fold is the two reads');
select set_eq('select id from public.task_requests_list(50)', 'select * from pg_temp.requests_by_two_reads(50)',
  'Admin: the request fold is the two reads');

select pg_temp.as_member('staff');
select set_eq('select id from public.tasks_list_all(300)', 'select * from pg_temp.tasks_by_two_reads(300)',
  'Crew: the task fold is the two reads');
select set_eq('select id from public.task_requests_list(50)', 'select * from pg_temp.requests_by_two_reads(50)',
  'Crew: the request fold is the two reads');
select ok(pg_temp.fx('staff_task') in (select id from public.tasks_list_all(300)), 'Crew: sees their own task');
select ok(pg_temp.fx('admin_task') not in (select id from public.tasks_list_all(300)),
  'Crew: never a task they are not on (RLS)');
select ok(pg_temp.fx('staff_req') in (select id from public.task_requests_list(50)), 'Crew: sees their own suggestion');
select ok(pg_temp.fx('admin_req') not in (select id from public.task_requests_list(50)),
  'Crew: never someone else''s suggestion (RLS)');

-- The finished half is capped: none asked, none given; open rows are always all there.
select pg_temp.as_member('owner');
select is((select count(*) from public.tasks_list_all(0) where state in ('completed', 'cancelled')), 0::bigint,
  'a finished limit of 0 gives no finished task');
select is((select count(*) from public.tasks_list_all(0)),
  (select count(*) from public.tasks where state not in ('completed', 'cancelled')),
  'every open task, whatever the limit');
select is((select count(*) from public.task_requests_list(-5) where state <> 'pending'), 0::bigint,
  'a negative decided limit gives no decided request');

-- Anon may not call either.
select pg_temp.as_system();
set local role anon;
select throws_ok('select * from public.tasks_list_all(10)', '42501', null, 'anon: tasks_list_all refused');
select throws_ok('select * from public.task_requests_list(10)', '42501', null, 'anon: task_requests_list refused');

select * from finish();
rollback;
