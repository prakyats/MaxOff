-- v5.0 "Hand in work" (plan docs/handoff/v50-hand-in-plan.md; DATA-MODEL §8b, WORKFLOWS §5C,
-- PERMISSIONS §1): handin_files and handin_folders (no API role reads either), handin_versions,
-- handin_file_start, handin_progress, handin_file_failed and handin_file_left_out for each role (the
-- Owner, the creator and approving Admin, another Admin, the Admin who coordinates a freelancer primary,
-- Crew primary, a second Crew assignee, Crew not on the task, a deactivated member, anon), the Worker's
-- service-role functions on every path (folders, session, done with each check, idempotent, the Drive
-- check), and task_submit_done handing the open version in (waits for uploads, ties the files, the
-- file count in history and the notification, the next version after a send-back, the Owner's own task).
-- Neutral names and example.com addresses only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(117);

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner',  '10000000-0000-4000-8000-000000000001'),
  ('admin',  '10000000-0000-4000-8000-000000000002'),
  ('staff',  '10000000-0000-4000-8000-000000000003'),
  ('gone',   '10000000-0000-4000-8000-000000000004'),
  ('admin2', '00000000-0000-4000-8000-000000015001'),
  ('admin3', '00000000-0000-4000-8000-000000015002'),
  ('staff2', '00000000-0000-4000-8000-000000015003'),
  ('staff3', '00000000-0000-4000-8000-000000015004'),
  ('free1',  '00000000-0000-4000-8000-000000015005');
insert into fx select 'org', id from public.organizations order by created_at limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') and kind = 'normal' order by position limit 1;
grant select, insert on fx to authenticated, service_role, anon;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.fx(k)::text, ''), true);
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
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform pg_temp.as_system();
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform pg_temp.as_system();
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;
create function pg_temp.raised(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
-- handin_file_start as a member, its outcome as jsonb.
create function pg_temp.start(who text, task text, name text, size bigint, path text default '',
                              behalf text default null) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.as_member(who);
  v := public.handin_file_start(pg_temp.fx(task), name, path, size, 'video/mp4',
                                case when behalf is null then null else pg_temp.fx(behalf) end);
  perform pg_temp.as_system();
  return v;
end;
$$;
-- The Worker finishes a file: the v‹n› folder, the session, Google's answer.
create function pg_temp.finish(file uuid, drive_id text, size bigint) returns text language plpgsql as $$
declare
  v text;
  v_task uuid;
  v_version int;
begin
  perform pg_temp.as_service();
  select task_id, version into v_task, v_version from public.handin_session_get(file);
  perform public.handin_folder_put(v_task, v_version, 'sub-a', '', 'folder-v' || v_version);
  perform public.handin_session_set(file, 'sub-a', 'folder-v' || v_version, 'sealed-session');
  v := public.handin_file_done(file, drive_id, size, null, 'folder-v' || v_version, null);
  perform pg_temp.as_system();
  return v;
end;
$$;
create function pg_temp.file_of(o jsonb) returns uuid language sql immutable as $$ select (o ->> 'file_id')::uuid; $$;
create function pg_temp.versions(who text, task text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.as_member(who);
  v := public.handin_versions(pg_temp.fx(task));
  perform pg_temp.as_system();
  return v;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role, anon;

-- Fixtures: three more Admins and Crew, a freelancer coordinated by admin3, the connected Drive.
insert into auth.users (id, email) select id, key || '@example.com' from fx
where key in ('admin2', 'admin3', 'staff2', 'staff3');
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('admin2', 'admin'), ('admin3', 'admin'), ('staff2', 'staff'), ('staff3', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, joined_at, engagement)
values (pg_temp.fx('free1'), pg_temp.fx('org'), 'Free1', null, 'staff', 'active', now() - interval '60 days', 'freelance');
insert into public.member_coordinators (member_id, coordinator_id) values (pg_temp.fx('free1'), pg_temp.fx('admin3'));
delete from public.drive_account where org_id = pg_temp.fx('org');
insert into public.drive_account (org_id, google_email, google_sub, refresh_token_encrypted, state, connected_by,
                                  connected_at, quota_total_bytes, quota_used_bytes)
values (pg_temp.fx('org'), 'studio@example.com', 'sub-a', 'sealed', 'connected', pg_temp.fx('owner'), now(),
        2199023255552, 1099511627776);

-- The main task: made by admin (its creator and approving Admin), Crew primary, a second Crew assignee.
select pg_temp.as_member('admin');
insert into fx select 'task', public.task_create(
  title => 'Hand-in task 150', description => null, task_type_id => pg_temp.fx('type'), client_id => null,
  priority => 'medium', due_at => now() + interval '3 days',
  assignee_ids => array[pg_temp.fx('staff'), pg_temp.fx('staff2')], primary_owner_id => pg_temp.fx('staff'),
  approving_admin_id => pg_temp.fx('admin'));
-- A freelancer primary's task, made by the Owner with no approver; admin3 coordinates the freelancer.
select pg_temp.as_member('owner');
insert into fx select 'ftask', public.task_create(
  title => 'Freelance task 150', description => null, task_type_id => pg_temp.fx('type'), client_id => null,
  priority => 'medium', due_at => now() + interval '3 days',
  assignee_ids => array[pg_temp.fx('free1')], primary_owner_id => pg_temp.fx('free1'));
-- The Owner's own task.
insert into fx select 'otask', public.task_create(
  title => 'Owner task 150', description => null, task_type_id => pg_temp.fx('type'), client_id => null,
  priority => 'medium', due_at => now() + interval '3 days',
  assignee_ids => array[pg_temp.fx('owner')], primary_owner_id => pg_temp.fx('owner'));
select pg_temp.as_system();

-- ===========================================================================================================
-- 0. The tables: RLS on, no API role reads or writes them
-- ===========================================================================================================
select ok((select relrowsecurity from pg_class where oid = 'public.handin_files'::regclass), 'handin_files: RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.handin_folders'::regclass), 'handin_folders: RLS on');
select is((select count(*) from pg_policy where polrelid in ('public.handin_files'::regclass, 'public.handin_folders'::regclass)),
  0::bigint, 'no policy on either table');
select pg_temp.as_member('owner');
select is(pg_temp.raised('select count(*) from public.handin_files'), 'permission denied for table handin_files',
  'the Owner reads no row directly');
select pg_temp.as_member('staff');
select is(pg_temp.raised('select count(*) from public.handin_folders'), 'permission denied for table handin_folders',
  'Crew read no folder row directly');
select is(pg_temp.raised($$insert into public.handin_files (org_id, task_id, version, added_by, name, size_bytes, account_sub)
  values (pg_temp.fx('org'), pg_temp.fx('task'), 1, pg_temp.fx('staff'), 'x', 1, 'sub-a')$$),
  'permission denied for table handin_files', 'nor writes one');
select pg_temp.as_anon();
select is(pg_temp.raised('select count(*) from public.handin_files'), 'permission denied for table handin_files', 'anon neither');
select pg_temp.as_system();
select ok(exists (select 1 from public.notification_kinds where kind = 'handin_space_held' and actionable and not always_email),
  'the new kind: handin_space_held, actionable, email only as the fallback');
select ok(not exists (select 1 from pg_trigger where tgrelid = 'public.handin_files'::regclass and not tgisinternal),
  'no audit trigger on handin_files (session addresses never reach activity_log)');

-- ===========================================================================================================
-- 1. Adding files: who may
-- ===========================================================================================================
create temporary table out (key text primary key, v jsonb);
grant select, insert on out to authenticated, service_role;
insert into out values ('a1', pg_temp.start('staff', 'task', 'C0041.MP4', 1000));
select is((select v ->> 'outcome' from out where key = 'a1'), 'start', 'the Crew primary adds a file');
select is((select (v ->> 'version')::int from out where key = 'a1'), 1, 'into the open version, v1');
insert into out values ('a2', pg_temp.start('staff2', 'task', 'C0042.MP4', 2000, 'Day 1/Cam B'));
select is((select v ->> 'outcome' from out where key = 'a2'), 'start', 'a second Crew assignee adds one too (Q1)');
select is((select v ->> 'relative_path' from out where key = 'a2'), 'Day 1/Cam B', 'a laptop''s folders are kept');
select is((select row(added_by, on_behalf_of, state, account_sub)::text from public.handin_files
           where id = pg_temp.file_of((select v from out where key = 'a2'))),
  row(pg_temp.fx('staff2'), null::uuid, 'uploading', 'sub-a')::text, 'recorded as uploading, by its adder, on the connected account');
select is(pg_temp.raised($$select pg_temp.start('staff3', 'task', 'x.mp4', 1)$$), 'FORBIDDEN',
  'Crew not on the task: FORBIDDEN');
select is(pg_temp.raised($$select pg_temp.start('admin', 'task', 'x.mp4', 1)$$), 'FORBIDDEN',
  'the creator Admin is not on the task: adds nothing');
select is(pg_temp.raised($$select pg_temp.start('owner', 'task', 'x.mp4', 1)$$), 'FORBIDDEN',
  'nor does the Owner on a task they are not on');
select is(pg_temp.raised($$select pg_temp.start('gone', 'task', 'x.mp4', 1)$$), 'UNAUTHENTICATED',
  'a deactivated member: UNAUTHENTICATED');
select pg_temp.as_anon();
select is(pg_temp.raised(format('select public.handin_file_start(%L, ''x'', '''', 1)', pg_temp.fx('task'))),
  'permission denied for function handin_file_start', 'anon: no EXECUTE');
select pg_temp.as_system();
insert into out values ('f1', pg_temp.start('admin3', 'ftask', 'free.mov', 500, '', 'free1'));
select is((select v ->> 'outcome' from out where key = 'f1'), 'start', 'a freelancer''s coordinator adds for them');
select is((select on_behalf_of from public.handin_files where id = pg_temp.file_of((select v from out where key = 'f1'))),
  pg_temp.fx('free1'), 'recorded on behalf of the freelancer');
select is(pg_temp.raised($$select pg_temp.start('admin2', 'ftask', 'x.mp4', 1, '', 'free1')$$), 'FORBIDDEN',
  'another Admin cannot act for that freelancer');

-- Cleaning and limits
select is(pg_temp.raised($$select pg_temp.start('staff', 'task', E'\u200b ', 1)$$), 'VALIDATION', 'a name with nothing left: VALIDATION');
select is(pg_temp.raised($$select pg_temp.start('staff', 'task', 'x.mp4', -1)$$), 'VALIDATION', 'a negative size: VALIDATION');
select is(pg_temp.raised($$select pg_temp.start('staff', 'task', 'x.mp4', 1, 'a/b/c/d/e/f/g/h/i/j/k/l/m')$$), 'VALIDATION',
  'a path deeper than 12: VALIDATION');
insert into out values ('clean', pg_temp.start('staff', 'task', E'a/b\\c\u202e.jpg', 7, '../Day 2/./'));
select is((select v ->> 'name' || '|' || (v ->> 'relative_path') from out where key = 'clean'), 'abc.jpg|Day 2',
  'the server cleans the name and the path itself');

-- Resume, wait
insert into out values ('again', pg_temp.start('staff', 'task', 'C0041.MP4', 1000));
select is((select v ->> 'outcome' from out where key = 'again'), 'resume', 'the same person choosing the same file again carries on');
select is(pg_temp.file_of((select v from out where key = 'again')), pg_temp.file_of((select v from out where key = 'a1')),
  'with the same row');
insert into out values ('w1', pg_temp.start('staff', 'task', 'w1.mp4', 1));
insert into out values ('w2', pg_temp.start('staff', 'task', 'w2.mp4', 1));
insert into out values ('w3', pg_temp.start('staff', 'task', 'w3.mp4', 1));
insert into out values ('w4', pg_temp.start('staff', 'task', 'w4.mp4', 1));
select is((select v ->> 'outcome' from out where key = 'w4'), 'start', 'up to six of one person''s files upload at once');
insert into out values ('w5', pg_temp.start('staff', 'task', 'w5.mp4', 1));
select is((select v ->> 'outcome' from out where key = 'w5'), 'wait', 'the seventh waits');

-- ===========================================================================================================
-- 2. Progress and failure: the adder's own file only
-- ===========================================================================================================
select pg_temp.as_member('staff');
select lives_ok(format('select public.handin_progress(%L, 400)', pg_temp.file_of((select v from out where key = 'a1'))),
  'the adder reports progress');
select pg_temp.as_system();
select is((select bytes_reported from public.handin_files where id = pg_temp.file_of((select v from out where key = 'a1'))),
  400::bigint, 'recorded');
select pg_temp.as_member('staff2');
select is(pg_temp.raised(format('select public.handin_progress(%L, 900)', pg_temp.file_of((select v from out where key = 'a1')))),
  'FORBIDDEN', 'another assignee cannot report on it');
select pg_temp.as_member('staff3');
select is(pg_temp.raised(format('select public.handin_progress(%L, 900)', pg_temp.file_of((select v from out where key = 'a1')))),
  'NOT_FOUND', 'Crew not on the task: NOT_FOUND');
select pg_temp.as_member('staff');
select lives_ok(format('select public.handin_file_failed(%L, ''gave_up'')', pg_temp.file_of((select v from out where key = 'w1'))),
  'the adder gives up on a file');
select is(pg_temp.raised(format('select public.handin_file_failed(%L, ''nonsense'')', pg_temp.file_of((select v from out where key = 'w1')))),
  'VALIDATION', 'an unknown reason: VALIDATION');
select pg_temp.as_system();
select is((select state || '/' || failed_reason from public.handin_files where id = pg_temp.file_of((select v from out where key = 'w1'))),
  'failed/gave_up', 'failed, with its reason');
insert into out values ('w1b', pg_temp.start('staff', 'task', 'w1.mp4', 1));
select is((select v ->> 'outcome' from out where key = 'w1b'), 'resume', 'Retry carries on with the failed row');
select is((select state from public.handin_files where id = pg_temp.file_of((select v from out where key = 'w1'))),
  'uploading', 'uploading again');

-- ===========================================================================================================
-- 3. The Worker: folders, session, done
-- ===========================================================================================================
select pg_temp.as_member('staff');
select is(pg_temp.raised(format('select public.handin_file_done(%L, ''d'', 1, null, ''p'')', pg_temp.file_of((select v from out where key = 'a1')))),
  'permission denied for function handin_file_done', 'a member cannot say a file arrived');
select is(pg_temp.raised(format('select * from public.handin_session_get(%L)', pg_temp.file_of((select v from out where key = 'a1')))),
  'permission denied for function handin_session_get', 'nor read a session address');
select pg_temp.as_system();
select is(pg_temp.finish(pg_temp.file_of((select v from out where key = 'a1')), 'drive-a1', 1000), 'done',
  'the Worker confirms a file Google holds whole');
select is((select row(state, check_kind, session_uri_encrypted, bytes_at_google)::text from public.handin_files
           where id = pg_temp.file_of((select v from out where key = 'a1'))),
  row('done', 'size_only', null::text, 1000::bigint)::text, 'done, size checked, the session address cleared');
select pg_temp.as_service();
select is(public.handin_file_done(pg_temp.file_of((select v from out where key = 'a1')), 'drive-a1', 1000, null, 'folder-v1'), 'done',
  'done again with the same Drive id: idempotent');
select pg_temp.as_system();
select is((select count(*) from public.activity_log where entity = 'tasks' and entity_id = pg_temp.fx('task')
           and action = 'handin_file_added'), 1::bigint, 'one history row for it');
select ok((select not (meta ? 'drive_file_id') and meta ->> 'name' = 'C0041.MP4' and actor_id = pg_temp.fx('staff')
           from public.activity_log where entity = 'tasks' and entity_id = pg_temp.fx('task') and action = 'handin_file_added'),
  'the history names the file and its adder, never a Drive id');
select is(pg_temp.finish(pg_temp.file_of((select v from out where key = 'a2')), 'drive-a2', 1999), 'failed',
  'a size that differs from the declared one fails the file');
select is((select failed_reason from public.handin_files where id = pg_temp.file_of((select v from out where key = 'a2'))),
  'size_mismatch', 'as size_mismatch');
select pg_temp.as_service();
select is(public.handin_file_done(pg_temp.file_of((select v from out where key = 'w2')), 'drive-w2', 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  null, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), 'failed', 'a page MD5 that differs from Drive''s fails it');
select pg_temp.as_system();
select is((select failed_reason from public.handin_files where id = pg_temp.file_of((select v from out where key = 'w2'))),
  'damaged', 'as damaged');
select is(pg_temp.finish(pg_temp.file_of((select v from out where key = 'w3')), 'drive-w3', 1), 'done', 'another file arrives');
select pg_temp.as_service();
select is(public.handin_folder_put(pg_temp.fx('task'), 1, 'sub-a', '', 'other-folder'), 'folder-v1',
  'a folder put twice keeps the first (insert or return)');
select pg_temp.as_system();

-- Already added: the same folder, name and size in this version, whoever added it.
insert into out values ('dup', pg_temp.start('staff2', 'task', 'C0041.MP4', 1000));
select is((select v ->> 'outcome' from out where key = 'dup'), 'already_added', 'a file already in Drive is skipped, whoever added it');
insert into out values ('dup2', pg_temp.start('staff2', 'task', 'C0041.MP4', 1001));
select is((select v ->> 'outcome' from out where key = 'dup2'), 'start', 'a different size is a different file');

-- ===========================================================================================================
-- 4. Reading the versions: who sees what
-- ===========================================================================================================
select is((pg_temp.versions('staff', 'task') -> 'versions' -> 0 ->> 'version')::int, 1, 'the primary sees v1');
select is((pg_temp.versions('staff', 'task') ->> 'can_add')::boolean, true, 'and may add');
select ok((select bool_and(f ->> 'drive_file_id' is null) from jsonb_array_elements(pg_temp.versions('staff', 'task') -> 'versions' -> 0 -> 'files') f),
  'Crew never get a Drive id (Q6)');
select is(pg_temp.versions('staff', 'task') -> 'versions' -> 0 ->> 'folder_id', null, 'nor the folder');
select ok((select bool_or(f ->> 'drive_file_id' = 'drive-a1') from jsonb_array_elements(pg_temp.versions('admin', 'task') -> 'versions' -> 0 -> 'files') f),
  'the creator and approving Admin gets the Drive ids');
select is(pg_temp.versions('admin', 'task') -> 'versions' -> 0 ->> 'folder_id', 'folder-v1', 'and the version''s folder');
select is((pg_temp.versions('admin', 'task') ->> 'can_add')::boolean, false, 'but may not add (not on the task)');
select ok((select bool_or(f ->> 'drive_file_id' = 'drive-a1') from jsonb_array_elements(pg_temp.versions('owner', 'task') -> 'versions' -> 0 -> 'files') f),
  'the Owner gets them');
select is(pg_temp.raised($$select pg_temp.versions('staff3', 'task')$$), 'NOT_FOUND', 'Crew not on the task: NOT_FOUND');
select is(pg_temp.raised($$select pg_temp.versions('admin2', 'task')$$), 'NOT_FOUND', 'an Admin who cannot see the task: NOT_FOUND');
select is(pg_temp.raised($$select pg_temp.versions('gone', 'task')$$), 'UNAUTHENTICATED', 'a deactivated member: UNAUTHENTICATED');
select is((pg_temp.versions('admin3', 'ftask') ->> 'reviewer')::boolean, true,
  'the Admin who coordinates a freelancer primary is one of the task''s Admins');
select is((pg_temp.versions('staff', 'task') ->> 'drive'), 'connected', 'the read says the Drive state');
select pg_temp.as_anon();
select is(pg_temp.raised(format('select public.handin_versions(%L)', pg_temp.fx('task'))),
  'permission denied for function handin_versions', 'anon: no EXECUTE');
select pg_temp.as_system();

-- ===========================================================================================================
-- 5. Leave out
-- ===========================================================================================================
select pg_temp.as_member('staff2');
select is(pg_temp.raised(format('select public.handin_file_left_out(%L)', pg_temp.file_of((select v from out where key = 'a1')))),
  'FORBIDDEN', 'a second assignee cannot leave out the primary''s file');
select lives_ok(format('select public.handin_file_left_out(%L)', pg_temp.file_of((select v from out where key = 'dup2'))),
  'but leaves out their own (still uploading)');
select pg_temp.as_member('staff');
select lives_ok(format('select public.handin_file_left_out(%L)', pg_temp.file_of((select v from out where key = 'a2'))),
  'the primary owner leaves out anyone''s file (a failed one here)');
select is(pg_temp.raised(format('select public.handin_file_left_out(%L)', pg_temp.file_of((select v from out where key = 'a2')))),
  'INVALID_STATE', 'twice: INVALID_STATE');
select pg_temp.as_member('staff3');
select is(pg_temp.raised(format('select public.handin_file_left_out(%L)', pg_temp.file_of((select v from out where key = 'a1')))),
  'NOT_FOUND', 'Crew not on the task: NOT_FOUND');
select pg_temp.as_system();
select is((select row(state, left_out_by, session_uri_encrypted)::text from public.handin_files
           where id = pg_temp.file_of((select v from out where key = 'dup2'))),
  row('left_out', pg_temp.fx('staff2'), null::text)::text, 'left out, by whom, the session dropped');
select is((select count(*) from public.activity_log where entity = 'tasks' and entity_id = pg_temp.fx('task')
           and action = 'handin_file_left_out'), 2::bigint, 'each one in the history');

-- ===========================================================================================================
-- 6. Mark done hands the version in
-- ===========================================================================================================
select pg_temp.as_member('staff');
select is(pg_temp.raised(format('select public.task_submit_done(%L)', pg_temp.fx('task'))),
  'INVALID_STATE', 'Mark done waits while files are still uploading');
select pg_temp.as_system();
-- Finish or leave out what is still uploading (w1 resumed, w4, clean): w4 and clean arrive, w1 is left out.
select is(pg_temp.finish(pg_temp.file_of((select v from out where key = 'w4')), 'drive-w4', 1), 'done', 'w4 arrives');
select is(pg_temp.finish(pg_temp.file_of((select v from out where key = 'clean')), 'drive-clean', 7), 'done', 'the cleaned file arrives');
select pg_temp.as_member('staff');
select lives_ok(format('select public.handin_file_left_out(%L)', pg_temp.file_of((select v from out where key = 'w1'))),
  'the last uploading file is left out');
select is(public.task_submit_done(pg_temp.fx('task'), 'Final cut is C0041'), 'submitted'::public.task_state,
  'now Mark done hands v1 in, to the approving Admin');
select pg_temp.as_system();
select is((select count(*) from public.handin_files where task_id = pg_temp.fx('task') and version = 1
           and submission_id = (select id from public.task_submissions where task_id = pg_temp.fx('task') and version = 1)),
  4::bigint, 'the four files in Drive are tied to the version');
select is((select count(*) from public.handin_files where task_id = pg_temp.fx('task') and state in ('left_out', 'failed')
           and submission_id is not null), 0::bigint, 'left-out and failed files are not');
select is((select (meta ->> 'files')::int from public.activity_log where entity = 'tasks' and entity_id = pg_temp.fx('task')
           and action = 'submitted'), 4, 'the history counts the files');
select ok((select body like '% · v1 · 4 files' from public.notifications where recipient_id = pg_temp.fx('admin')
           and kind = 'task_submitted' and entity_id = pg_temp.fx('task')), 'the approving Admin''s notification says v1 · 4 files');
select is(pg_temp.raised($$select pg_temp.start('staff', 'task', 'late.mp4', 1)$$), 'INVALID_STATE',
  'no file can be added once handed in');
select pg_temp.as_member('staff');
select is(pg_temp.raised(format('select public.handin_file_left_out(%L)', pg_temp.file_of((select v from out where key = 'w3')))),
  'INVALID_STATE', 'nor left out');
select pg_temp.as_system();
select is((pg_temp.versions('staff', 'task') -> 'versions' -> 0 ->> 'handed_in')::boolean, true, 'the read shows v1 handed in');
select is((pg_temp.versions('staff', 'task') ->> 'can_add')::boolean, true, 'can_add is about the person; task_open says the rest');
select is((pg_temp.versions('staff', 'task') ->> 'task_open')::boolean, false, 'the task is not open');

-- Request changes → v2
select pg_temp.as_member('admin');
select is(public.task_review(pg_temp.fx('task'), 'rejected', 'C0041: the logo is cut off'),
  'changes_requested'::public.task_state, 'the Admin requests changes (unchanged)');
select pg_temp.as_system();
select is((pg_temp.versions('staff', 'task') ->> 'open_version')::int, 2, 'the open version is now v2');
insert into out values ('v2', pg_temp.start('staff', 'task', 'C0041.MP4', 1000));
select is((select (v ->> 'version') || (v ->> 'outcome') from out where key = 'v2'), '2start',
  'the same file name goes into v2 as a new file (v1 is never touched)');
select is((select count(*) from public.handin_files where task_id = pg_temp.fx('task') and version = 1 and state = 'done'),
  4::bigint, 'v1 is unchanged');
select is(pg_temp.finish(pg_temp.file_of((select v from out where key = 'v2')), 'drive-v2', 1000), 'done', 'it arrives');
select pg_temp.as_member('staff');
select is(public.task_submit_done(pg_temp.fx('task')), 'submitted'::public.task_state, 'v2 is handed in');
select pg_temp.as_system();
select is((select count(*) from public.handin_files h join public.task_submissions s on s.id = h.submission_id
           where h.task_id = pg_temp.fx('task') and s.version = 2), 1::bigint, 'with its one file');
select is(jsonb_array_length(pg_temp.versions('admin', 'task') -> 'versions'), 2, 'the reviewer sees both versions');
select pg_temp.as_member('admin');
select is((select files from public.handin_counts(array(select id from public.task_submissions where task_id = pg_temp.fx('task') and version = 1)))::int,
  4, 'handin_counts: v1 holds four files in Drive (what Approvals shows)');
select pg_temp.as_member('staff3');
select is((select count(*) from public.handin_counts(array(select id from public.task_submissions where task_id = pg_temp.fx('task')))),
  0::bigint, 'handin_counts leaves out a task the caller cannot see');
select pg_temp.as_anon();
select is(pg_temp.raised('select * from public.handin_counts(array[]::uuid[])'),
  'permission denied for function handin_counts', 'anon: no EXECUTE');
select pg_temp.as_system();
select is((pg_temp.versions('admin', 'task') -> 'versions' -> 0 ->> 'version')::int, 2, 'newest first');

-- A Mark done with no files is unchanged (Q2); the Owner's own task completes with its files.
insert into out values ('o1', pg_temp.start('owner', 'otask', 'owner.jpg', 10));
select is(pg_temp.finish(pg_temp.file_of((select v from out where key = 'o1')), 'drive-o1', 10), 'done', 'the Owner adds a file to their own task');
select pg_temp.as_member('owner');
select is(public.task_submit_done(pg_temp.fx('otask')), 'completed'::public.task_state, 'and completes it');
select pg_temp.as_system();
select is((select (meta ->> 'files')::int from public.activity_log where entity = 'tasks' and entity_id = pg_temp.fx('otask')
           and action = 'completed'), 1, 'its history counts the file');
select pg_temp.as_member('admin3');
select is(pg_temp.raised(format('select public.task_submit_done(%L, null, null, %L)', pg_temp.fx('ftask'), pg_temp.fx('free1'))),
  'INVALID_STATE', 'the coordinator''s Mark done for the freelancer waits for the file too');
select pg_temp.as_system();
select is(pg_temp.finish(pg_temp.file_of((select v from out where key = 'f1')), 'drive-f1', 500), 'done', 'the freelancer''s file arrives');
select pg_temp.as_member('admin3');
select is(public.task_submit_done(pg_temp.fx('ftask'), null, null, pg_temp.fx('free1')), 'admin_approved'::public.task_state,
  'then the coordinator hands it in for the freelancer (no approver: to the Owner)');
select pg_temp.as_system();

-- ===========================================================================================================
-- 7. Drive off, space full, the Drive check
-- ===========================================================================================================
select pg_temp.as_member('admin');
select public.task_review(pg_temp.fx('task'), 'rejected', 'One more change');
select pg_temp.as_system();
update public.drive_account set state = 'needs_reconnect' where org_id = pg_temp.fx('org');
select is(pg_temp.raised($$select pg_temp.start('staff', 'task', 'x.mp4', 1)$$), 'INVALID_STATE',
  'Drive needing a reconnect: no file can be added');
select is((pg_temp.versions('staff', 'task') ->> 'drive'), 'needs_reconnect', 'and the read says why');
update public.drive_account set state = 'connected', quota_used_bytes = quota_total_bytes - 5::bigint * 1024 * 1024 * 1024
where org_id = pg_temp.fx('org');
insert into out values ('big', pg_temp.start('staff', 'task', 'big.mp4', 1));
select is((select v ->> 'outcome' from out where key = 'big'), 'space_full', 'under 10 GB free: space_full');
insert into out values ('big2', pg_temp.start('staff2', 'task', 'big2.mp4', 1));
select is((select count(*) from public.notifications where recipient_id = pg_temp.fx('owner') and kind = 'handin_space_held'),
  1::bigint, 'the Owner is told once a day');
update public.drive_account set quota_used_bytes = 0 where org_id = pg_temp.fx('org');

select pg_temp.as_service();
select is((select count(*) from public.handin_drive_check_claim(array[pg_temp.file_of((select v from out where key = 'a1'))])),
  1::bigint, 'the Drive check claims a received file');
select is((select count(*) from public.handin_drive_check_claim(array[pg_temp.file_of((select v from out where key = 'a1'))])),
  0::bigint, 'not again within 10 minutes');
select is(public.handin_drive_seen(pg_temp.file_of((select v from out where key = 'a1')), 'trashed'), 'missing_in_drive',
  'a file in the Drive bin is Removed in Drive');
select is(public.handin_drive_seen(pg_temp.file_of((select v from out where key = 'a1')), 'present'), 'done',
  'and comes back when restored');
select pg_temp.as_member('owner');
select is(pg_temp.raised(format('select public.handin_drive_seen(%L, ''trashed'')', pg_temp.file_of((select v from out where key = 'a1')))),
  'permission denied for function handin_drive_seen', 'no member can mark a file removed');
select pg_temp.as_system();
select is((select count(*) from public.activity_log where entity = 'tasks' and entity_id = pg_temp.fx('task')
           and action in ('handin_file_missing_in_drive', 'handin_file_back_in_drive')), 2::bigint, 'both in the history');

select * from finish();
rollback;
