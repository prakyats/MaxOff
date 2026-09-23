-- 1.4 follow-ups: list_item_move() for every role, and app.is_working_day() with no single
-- organization in scope.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

delete from public.session_events;
delete from public.activity_log;
delete from public.members;
delete from public.list_items
  where list_key <> 'job_title' or name not in ('Video Editor', 'Graphic Designer');
update public.list_items set archived_at = null where archived_at is not null;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '00000000-0000-4000-8000-000000000001'),
  ('admin', '00000000-0000-4000-8000-000000000002'),
  ('staff', '00000000-0000-4000-8000-000000000003'),
  ('nobody', '00000000-0000-4000-8000-000000000009');
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

/** The job titles in display order, so a swap is read the way the screen reads it. */
create function pg_temp.titles() returns text[] language sql stable as $$
  select array_agg(name order by position)
  from public.list_items
  where list_key = 'job_title' and archived_at is null;
$$;

create function pg_temp.title(n text) returns uuid language sql stable as $$
  select id from public.list_items where list_key = 'job_title' and name = n;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org', 'nobody');
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner@example.com', 'owner', 'active', now()),
  (pg_temp.fx('admin'), pg_temp.fx('org'), 'Test Admin', 'admin@example.com', 'admin', 'active', now()),
  (pg_temp.fx('staff'), pg_temp.fx('org'), 'Test Staff', 'staff@example.com', 'staff', 'active', now());
delete from public.activity_log;

-- Structure and grants -------------------------------------------------------------------------
select has_function('public', 'list_item_move', array['text', 'uuid', 'text'], 'list_item_move exists');
select ok(not has_function_privilege('anon', 'public.list_item_move(text, uuid, text)', 'execute'),
  'anon may not call list_item_move');
select ok(
  has_function_privilege('authenticated', 'public.list_item_move(text, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.list_item_move(text, uuid, text)', 'execute'),
  'authenticated and service_role may call it (the function decides)');

-- The order it starts from -----------------------------------------------------------------------
select is(pg_temp.titles(), array['Video Editor', 'Graphic Designer'],
  'the seeded job titles are in their seeded order');

select pg_temp.as_member('owner');
insert into public.list_items (list_key, name, position) values ('job_title', 'Colorist', 'a2');
select is(pg_temp.titles(), array['Video Editor', 'Graphic Designer', 'Colorist'],
  'a new entry is appended');

-- Moving --------------------------------------------------------------------------------------
select isnt(public.list_item_move('job_title', pg_temp.title('Colorist'), 'up'), null,
  'the Owner moves an entry up and gets the neighbour it passed');
select is(pg_temp.titles(), array['Video Editor', 'Colorist', 'Graphic Designer'],
  'the two entries traded places');
select is(public.list_item_move('job_title', pg_temp.title('Colorist'), 'down'), pg_temp.title('Graphic Designer'),
  'moving back down names the same neighbour');
select is(pg_temp.titles(), array['Video Editor', 'Graphic Designer', 'Colorist'],
  'the order is back where it started');
select is(public.list_item_move('job_title', pg_temp.title('Video Editor'), 'up'), null,
  'the first entry has nowhere to go up, and that is not an error');
select is(public.list_item_move('job_title', pg_temp.title('Colorist'), 'down'), null,
  'nor the last one down');
select is(pg_temp.titles(), array['Video Editor', 'Graphic Designer', 'Colorist'],
  'neither no-op changed the order');

-- A move touches `position` and nothing else: the reason this is one statement in SQL and not
-- two whole rows written back from TS (a concurrent rename used to be reverted).
select pg_temp.as_system();
update public.list_items set description = 'Grades the footage' where name = 'Colorist';
delete from public.activity_log; -- that fixture edit is audited too; the move's rows are the subject
select pg_temp.as_member('owner');
select lives_ok($$ select public.list_item_move('job_title', pg_temp.title('Colorist'), 'up') $$,
  'the entry moves again');
select pg_temp.as_system();
select is((select description from public.list_items where name = 'Colorist'), 'Grades the footage',
  'a move leaves every other column alone');
select results_eq(
  $$ select array_agg(distinct k order by k)
     from public.activity_log, lateral jsonb_object_keys(diff -> 'new') k
     where entity = 'list_items' and action = 'update' $$,
  $$ values (array['position']) $$,
  'the audit rows for a move say only the position changed');

-- Archived entries are not neighbours ------------------------------------------------------------
-- Colorist now sits between Video Editor and Graphic Designer, so archiving it must not leave it
-- as the neighbour a move swaps with.
select pg_temp.as_member('owner');
update public.list_items set archived_at = now() where name = 'Colorist';
select is(pg_temp.titles(), array['Video Editor', 'Graphic Designer'],
  'the archived entry leaves the visible list');
select is(
  public.list_item_move('job_title', pg_temp.title('Graphic Designer'), 'up'),
  pg_temp.title('Video Editor'),
  'the move skips the archived entry and swaps with the one actually above');
select is(pg_temp.titles(), array['Graphic Designer', 'Video Editor'],
  'the visible order is the swapped one');
select throws_ok($$ select public.list_item_move('job_title', pg_temp.title('Colorist'), 'up') $$,
  'P0001', 'NOT_FOUND', 'an archived entry cannot be moved at all');
update public.list_items set archived_at = null where name = 'Colorist';

-- Who may move ------------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok($$ select public.list_item_move('job_title', pg_temp.title('Colorist'), 'down') $$,
  'an Admin may reorder a list (lists.manage, PERMISSIONS §1)');
select pg_temp.as_member('staff');
select throws_ok($$ select public.list_item_move('job_title', pg_temp.title('Colorist'), 'up') $$,
  'P0001', 'FORBIDDEN', 'Staff may not reorder a list');
select pg_temp.as_member('owner');
select throws_ok($$ select public.list_item_move('job_title', pg_temp.fx('nobody'), 'up') $$,
  'P0001', 'NOT_FOUND', 'an unknown entry is not found');
select throws_ok($$ select public.list_item_move('job_title', pg_temp.title('Colorist'), 'sideways') $$,
  'P0001', 'VALIDATION', 'only up and down are directions');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select public.list_item_move('job_title', '00000000-0000-4000-8000-000000000009', 'up') $$,
  '42501', null, 'anon cannot call list_item_move');
select pg_temp.as_system();

-- app.is_working_day() with no single organization in scope ---------------------------------------
-- No savepoint: pgTAP records its results in the transaction, so rolling one back un-counts the
-- test inside it (finish() then reports one fewer than it printed). The file's own rollback at
-- the end undoes this insert, and nothing follows it.
insert into public.organizations (id, name) values ('00000000-0000-4000-8000-0000000000aa', 'Another Org');
select is(app.is_working_day('2026-09-21'), null,
  'with more than one organization there is no scope, so the answer is null, never a working day');

select * from finish();
rollback;
