-- v5.0 "Has hand-in" (owner 25 Nov 2026, option b; migration v50_task_type_has_handin; DATA-MODEL
-- §4 task_types, WORKFLOWS §5C, PERMISSIONS §1): the per-type setting, on by default and for every
-- existing type; only the Owner changes it (Admins and Crew refused); a task of a type with it off
-- takes no file (handin_file_start INVALID_STATE, handin_versions can_add false) and still marks Done
-- without one; turned back on, files are taken again. Neutral names and example.com addresses only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003');
insert into fx select 'org', id from public.organizations order by created_at limit 1;
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
create function pg_temp.raised(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role, anon;

-- The studio Drive is connected; a new normal type made by the Owner, and a Crew task of that type.
delete from public.drive_account where org_id = pg_temp.fx('org');
insert into public.drive_account (org_id, google_email, google_sub, refresh_token_encrypted, state, connected_by,
                                  connected_at, quota_total_bytes, quota_used_bytes)
values (pg_temp.fx('org'), 'studio@example.com', 'sub-a', 'sealed', 'connected', pg_temp.fx('owner'), now(),
        2199023255552, 1099511627776);
select pg_temp.as_member('owner');
insert into public.task_types (name, kind) values ('Call 152', 'normal');
insert into fx select 'type', id from public.task_types where name = 'Call 152';
insert into fx select 'task', public.task_create(
  title => 'Has hand-in 152', description => null, task_type_id => pg_temp.fx('type'), client_id => null,
  priority => 'medium', due_at => now() + interval '3 days',
  assignee_ids => array[pg_temp.fx('staff')], primary_owner_id => pg_temp.fx('staff'));
select pg_temp.as_system();

-- 1. The column: on by default, and on for every type that already existed.
select col_not_null('public', 'task_types', 'has_handin', 'has_handin is not null');
select col_default_is('public', 'task_types', 'has_handin', 'true', 'and defaults to on');
select is((select count(*) from public.task_types where not has_handin and name <> 'Call 152'), 0::bigint,
  'every existing type starts on');
select ok((select has_handin from public.task_types where id = pg_temp.fx('type')), 'a new type is on');

-- 2. Who changes it: the Owner only.
select pg_temp.as_member('admin');
update public.task_types set has_handin = false where id = pg_temp.fx('type');
select pg_temp.as_system();
select ok((select has_handin from public.task_types where id = pg_temp.fx('type')), 'an Admin cannot turn it off (RLS: no row changes)');
select pg_temp.as_member('staff');
update public.task_types set has_handin = false where id = pg_temp.fx('type');
select pg_temp.as_system();
select ok((select has_handin from public.task_types where id = pg_temp.fx('type')), 'nor can Crew');
select pg_temp.as_member('owner');
select lives_ok(format('update public.task_types set has_handin = false where id = %L', pg_temp.fx('type')),
  'the Owner turns it off');
select pg_temp.as_system();
select ok(exists (select 1 from public.activity_log where entity = 'task_types' and entity_id = pg_temp.fx('type')
                  and action = 'update'), 'the change is in the history (audit trigger)');

-- 3. Off: no file is taken, Done still works without one.
select pg_temp.as_member('staff');
select is(pg_temp.raised(format('select public.handin_file_start(%L, ''a.mp4'', '''', 10)', pg_temp.fx('task'))),
  'INVALID_STATE', 'a task of a type with no hand-in takes no file');
select is((public.handin_versions(pg_temp.fx('task')) ->> 'can_add')::boolean, false,
  'and its read says nobody can add one');
select pg_temp.as_system();
select is(app.task_type_has_handin(pg_temp.fx('task')), false, 'task_type_has_handin: off');
select is(app.task_type_has_handin(gen_random_uuid()), false, 'and false for a task that does not exist');

-- 4. Back on: files are taken again.
select pg_temp.as_member('owner');
update public.task_types set has_handin = true where id = pg_temp.fx('type');
select pg_temp.as_member('staff');
select is((public.handin_versions(pg_temp.fx('task')) ->> 'can_add')::boolean, true, 'on again: the Crew primary can add');
insert into fx select 'file', (public.handin_file_start(pg_temp.fx('task'), 'a.mp4', '', 10) ->> 'file_id')::uuid;
select isnt(pg_temp.fx('file'), null, 'and does');

-- 5. Off again, Mark done with no file at all.
select pg_temp.as_member('owner');
update public.task_types set has_handin = false where id = pg_temp.fx('type');
select pg_temp.as_member('staff');
select public.handin_file_failed(pg_temp.fx('file'), 'gave_up');
select is(public.task_submit_done(pg_temp.fx('task')), 'admin_approved'::public.task_state,
  'Mark done needs no file (no approving Admin: straight to the Owner)');

-- 6. anon: no EXECUTE on the helper.
select pg_temp.as_system();
select ok(not has_function_privilege('anon', 'app.task_type_has_handin(uuid)', 'execute'), 'anon: no EXECUTE on the helper');

select * from finish();
rollback;
