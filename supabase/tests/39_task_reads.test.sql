-- The task page rework (Kickoff 4 decision 28, migration task_reads): per-member read tracking of
-- a task's comments. task_reads is each member's own (RLS; no API writes at all; not audited);
-- task_mark_read() moves the caller's read forward, never back, never past now(), on a task they
-- see; task_unread_counts() counts, per task the caller sees, the comments by someone else after
-- the caller's last read (their own, written for a freelancer included, never count; a
-- coordinator's reads are their own). Each role, allowed and denied.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- Fixtures as 38. Rolled back at the end.
delete from public.task_reads;
-- 7A: client work rows reference clients and members, and the presets the organization (a
-- Playwright run leaves some behind).
delete from public.item_reviews;
delete from public.project_item_stages;
delete from public.project_items;
delete from public.project_cycles;
delete from public.project_item_blueprints;
delete from public.project_stages;
delete from public.projects;
delete from public.project_templates;
delete from public.stage_presets;
delete from public.task_requests;
delete from public.task_warnings;
delete from public.task_reviews;
delete from public.task_submissions;
delete from public.task_comments;
delete from public.task_stages;
delete from public.task_assignees;
delete from public.tasks;
delete from public.task_templates;
delete from public.member_coordinators;
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
delete from public.client_close_reasons;
delete from public.clients;
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000000c01'),
  ('admin1', '00000000-0000-4000-8000-000000000c02'),
  ('admin2', '00000000-0000-4000-8000-000000000c03'),
  ('staff1', '00000000-0000-4000-8000-000000000c04'),
  ('staff2', '00000000-0000-4000-8000-000000000c05'),
  ('coord',  '00000000-0000-4000-8000-000000000c06'),
  ('gone',   '00000000-0000-4000-8000-000000000c07');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;

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

-- Signed in, with no member row (a removed account).
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c99', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000c99', 'role', 'authenticated')::text, true);
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

create function pg_temp.type_id(n text) returns uuid language sql stable as $$
  select tt.id from public.task_types tt where tt.org_id = pg_temp.fx('org') and tt.name = n;
$$;

create function pg_temp.due() returns timestamptz language sql stable as $$
  select app.ist_day_start(app.today_ist() + 1) + interval '18 hours';
$$;

-- The caller's unread count on one task (0 when the function gives no row).
create function pg_temp.unread(k text) returns integer language sql stable as $$
  select coalesce((select u.unread from public.task_unread_counts(array[pg_temp.fx(k)]) u where u.task_id = pg_temp.fx(k)), 0);
$$;

-- A comment written at a given time (the tests run in one transaction, so now() never moves).
create function pg_temp.comment(k text, author text, at timestamptz, for_whom text default null)
returns void language plpgsql as $$
begin
  insert into public.task_comments (task_id, author_id, on_behalf_of, body, created_at)
  values (pg_temp.fx(k), pg_temp.fx(author), pg_temp.fx(for_whom), 'Note from ' || author, at);
end;
$$;

-- How many rows a statement touched, as the caller (RLS decides).
create function pg_temp.rows(q text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'),
             ('staff2', 'staff'), ('coord', 'staff'), ('gone', 'staff')) as v(k, r);

-- T1: the Owner routes it through admin1, to staff1 (primary), gone and the freelancer Asha
-- (coordinated by coord). T2 is staff2's alone.
select pg_temp.as_member('owner');
insert into fx values ('asha', public.member_add_freelancer('Asha', null, '9811111111', pg_temp.fx('coord')));
insert into fx values ('t1', public.task_create('Reel edit', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1'), pg_temp.fx('gone'), pg_temp.fx('asha')],
  pg_temp.fx('staff1'), pg_temp.fx('admin1')));
insert into fx values ('t2', public.task_create('Poster', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff2')], pg_temp.fx('staff2')));

-- Comments an hour apart, oldest first: staff1, admin1, coord for Asha on T1; staff2 on T2.
select pg_temp.as_system();
select pg_temp.comment('t1', 'staff1', now() - interval '4 hours');
select pg_temp.comment('t1', 'admin1', now() - interval '3 hours');
select pg_temp.comment('t1', 'coord', now() - interval '2 hours', 'asha');
select pg_temp.comment('t2', 'staff2', now() - interval '2 hours');

-- 1. The table ----------------------------------------------------------------------------------------
select has_table('public', 'task_reads', 'task_reads exists');
select col_is_pk('public', 'task_reads', array['task_id', 'member_id'], 'one read per member per task');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.task_reads'::regclass),
  'RLS is on');
select is((select count(*)::int from pg_constraint
           where conrelid = 'public.task_reads'::regclass and contype = 'f' and confdeltype = 'c'), 2,
  'both foreign keys cascade: a read marker is never history');
select is((select count(*)::int from pg_trigger
           where tgrelid = 'public.task_reads'::regclass and not tgisinternal), 0,
  'not audited (no audit trigger): a read is the member''s own view state');
select ok(not has_function_privilege('anon', 'public.task_mark_read(uuid, timestamptz)', 'execute'),
  'anon may not mark a read');
select ok(not has_function_privilege('anon', 'public.task_unread_counts(uuid[])', 'execute'),
  'nor count unread comments');

-- 2. No API writes, whoever asks ------------------------------------------------------------------------
select pg_temp.as_member('staff1');
select throws_ok(format($$ insert into public.task_reads (task_id, member_id) values (%L, %L) $$,
    pg_temp.fx('t1'), pg_temp.fx('staff1')),
  '42501', null, 'Staff cannot insert a read, even their own');
select pg_temp.as_member('owner');
select throws_ok(format($$ insert into public.task_reads (task_id, member_id) values (%L, %L) $$,
    pg_temp.fx('t1'), pg_temp.fx('owner')),
  '42501', null, 'nor can the Owner');
select throws_ok($$ update public.task_reads set last_read_at = now() $$,
  '42501', null, 'no API update');
select throws_ok($$ delete from public.task_reads $$, '42501', null, 'no API delete');

-- 3. Unread before anyone reads: comments by someone else only -----------------------------------------------
select pg_temp.as_member('staff1');
select is(pg_temp.unread('t1'), 2, 'Staff: the two comments by others, never their own');
select is(pg_temp.unread('t2'), 0, 'Staff: nothing from a task they do not see');
select pg_temp.as_member('coord');
select is(pg_temp.unread('t1'), 2,
  'a coordinator: staff1''s and admin1''s; the one they wrote for Asha is their own');
select pg_temp.as_member('admin1');
select is(pg_temp.unread('t1'), 2, 'the approving Admin: the other two');
select pg_temp.as_member('admin2');
select is((select count(*)::int from public.task_unread_counts(array[pg_temp.fx('t1'), pg_temp.fx('t2')])), 0,
  'an Admin with nothing to do with either task counts nothing');
select pg_temp.as_member('owner');
select is(pg_temp.unread('t1'), 3, 'the Owner: every comment on T1 (none is theirs)');
select is(pg_temp.unread('t2'), 1, 'and on T2');
select results_eq(format($$ select u.task_id from public.task_unread_counts(array[%L]::uuid[]) u $$, pg_temp.fx('t2')),
  format($$ values (%L::uuid) $$, pg_temp.fx('t2')),
  'task_ids narrows the answer to the tasks asked for');
select pg_temp.as_member('staff2');
select is(pg_temp.unread('t2'), 0, 'a task whose only comment is the caller''s own has none');

-- 4. Marking a read -----------------------------------------------------------------------------------------
select pg_temp.as_member('staff1');
select is(public.task_mark_read(pg_temp.fx('t1'), now() - interval '2 hours'), now() - interval '2 hours',
  'Staff mark T1 read up to the newest comment they were shown');
select is(pg_temp.unread('t1'), 0, 'nothing unread for them now');
select is((select count(*)::int from public.task_reads), 1, 'they read their own row');
select pg_temp.as_member('coord');
select is(pg_temp.unread('t1'), 2, 'the coordinator''s count is untouched: reads are per member');
select is((select count(*)::int from public.task_reads), 0, 'and they read no one else''s row');
select pg_temp.as_member('owner');
select is((select count(*)::int from public.task_reads), 0, 'nor does the Owner');
select is(pg_temp.unread('t1'), 3, 'whose count is their own');

-- A newer comment by someone else is unread again; an older mark never moves the read back.
select pg_temp.as_system();
select pg_temp.comment('t1', 'admin1', now() - interval '1 hour');
select pg_temp.as_member('staff1');
select is(pg_temp.unread('t1'), 1, 'a comment after their read is new to them');
select is(public.task_mark_read(pg_temp.fx('t1'), now() - interval '3 hours'), now() - interval '2 hours',
  'a mark older than the read keeps the read where it was');
select is(pg_temp.unread('t1'), 1, 'so the newer comment stays unread');
select is(public.task_mark_read(pg_temp.fx('t1'), now() + interval '1 day'), now(),
  'a mark in the future stops at now()');
select is(pg_temp.unread('t1'), 0, 'and covers the newer comment');
select is(public.task_mark_read(pg_temp.fx('t1')), now(), 'with no time given, now()');

-- A comment the caller writes after their read never counts for them.
select pg_temp.as_system();
select pg_temp.comment('t1', 'staff1', now());
select pg_temp.as_member('staff1');
select is(pg_temp.unread('t1'), 0, 'their own later comment is not unread for them');

-- The coordinator reads for themselves.
select pg_temp.as_member('coord');
select lives_ok(format($$ select public.task_mark_read(%L) $$, pg_temp.fx('t1')),
  'a coordinator marks their freelancer''s task read');
select is(pg_temp.unread('t1'), 0, 'and has nothing unread');

-- The Owner and an Admin mark their reads.
select pg_temp.as_member('owner');
select lives_ok(format($$ select public.task_mark_read(%L) $$, pg_temp.fx('t2')), 'the Owner marks T2 read');
select is(pg_temp.unread('t2'), 0, 'T2 has nothing unread for the Owner');
select pg_temp.as_member('admin1');
select lives_ok(format($$ select public.task_mark_read(%L) $$, pg_temp.fx('t1')), 'the approving Admin marks T1 read');

-- 5. Refused -------------------------------------------------------------------------------------------
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_mark_read(%L) $$, pg_temp.fx('t2')),
  'P0001', 'NOT_FOUND', 'Staff cannot mark a task they do not see');
select throws_ok($$ select public.task_mark_read(null) $$, 'P0001', 'NOT_FOUND', 'nor no task');
select pg_temp.as_member('admin2');
select throws_ok(format($$ select public.task_mark_read(%L) $$, pg_temp.fx('t1')),
  'P0001', 'NOT_FOUND', 'an Admin outside the task cannot either');
select pg_temp.as_nobody();
select throws_ok(format($$ select public.task_mark_read(%L) $$, pg_temp.fx('t1')),
  'P0001', 'UNAUTHENTICATED', 'someone who is no longer a member cannot');
select is((select count(*)::int from public.task_unread_counts(array[pg_temp.fx('t1'), pg_temp.fx('t2')])), 0, 'and counts nothing');

-- Taken off the task: it is gone from their counts and their reads.
select pg_temp.as_member('owner');
select public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object('assignee_ids',
  jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('asha'))));
select pg_temp.as_member('gone');
select is(pg_temp.unread('t1'), 0, 'a removed assignee counts nothing on the task');
select throws_ok(format($$ select public.task_mark_read(%L) $$, pg_temp.fx('t1')),
  'P0001', 'NOT_FOUND', 'and cannot mark it read');

-- 6. Not audited ---------------------------------------------------------------------------------------
select pg_temp.as_system();
select is((select count(*)::int from public.activity_log where entity = 'task_reads'), 0,
  'no history entry for a read');

select * from finish();
rollback;
