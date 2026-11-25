-- v4.5 the upload link (DATA-MODEL §8a, WORKFLOWS §5B, §8, §9, PERMISSIONS v4.5, ADR-0010 amendment,
-- plan docs/handoff/v45-security-review-plan.md §7.1; migrations upload_links and upload_links_public):
-- the six tables (RLS on, no policy, no API privilege, no audit trigger) for every role; the keys and
-- the kinds; every member function for the Owner, each of the task's three Admins, another Admin who
-- sees the task (client label, coordinator of a freelancer who is only an assignee), an Admin who does
-- not, a Crew assignee and primary owner, Crew not on the task, a Crew coordinator, a freelancer's id, a
-- deactivated member, no member, anon, service_role and another organisation; the public functions are
-- service_role only; one active link per task; create, seal, copy, stop, renew; the token-hash lookup and
-- its exact key set; register (cleaning, matching, folders, the device, the 20-name cap, the not-on-task
-- notices); file start (cleaning, already sent, the 6 / 600 / 5,000 limits, the space guard, the daily
-- pause, the Drive state, a retry on the same session); progress, failure and Google's answer (size,
-- folder, checksum, idempotent, after a stop); I'm done; stuck and looks finished once each; All files
-- received on every path; Done and Cancel stop the link; the Drive check ("Removed in Drive" and back);
-- the erasure (by the Owner and after 90 days); the network counters; and nothing secret in history.
-- Neutral names and documentation addresses only (example.com, 198.51.100.0/24).
begin;
create extension if not exists pgtap with schema extensions;
select plan(369);

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner',    '10000000-0000-4000-8000-000000000001'),
  ('gone',     '10000000-0000-4000-8000-000000000004'),
  ('nobody',   null),
  ('adm_c',    '00000000-0000-4000-8000-000000146001'),
  ('adm_a',    '00000000-0000-4000-8000-000000146002'),
  ('adm_k',    '00000000-0000-4000-8000-000000146003'),
  ('adm_o',    '00000000-0000-4000-8000-000000146004'),
  ('adm_x',    '00000000-0000-4000-8000-000000146005'),
  ('crew',     '00000000-0000-4000-8000-000000146006'),
  ('crew_out', '00000000-0000-4000-8000-000000146007'),
  ('crew_k',   '00000000-0000-4000-8000-000000146008'),
  ('free',     '00000000-0000-4000-8000-000000146009'),
  ('free2',    '00000000-0000-4000-8000-000000146010'),
  ('adm_s',    '00000000-0000-4000-8000-000000146011'),
  ('adm_p',    '00000000-0000-4000-8000-000000146012'),
  ('client',   '00000000-0000-4000-8000-000000146020'),
  ('org_b',    '00000000-0000-4000-8000-000000146030'),
  ('b_owner',  '00000000-0000-4000-8000-000000146031'),
  ('b_type',   '00000000-0000-4000-8000-000000146032');
insert into fx select 'org', id from public.organizations order by created_at limit 1;
insert into fx select 'type', id from public.task_types
  where org_id = (select id from fx where key = 'org') and kind = 'normal' order by position limit 1;
grant select, insert, update on fx to authenticated, service_role, anon;
create temporary table r (key text primary key, v jsonb);
grant select, insert on r to service_role;

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
-- 'ok', or the error message (the code for app.fail, the privilege message otherwise).
create function pg_temp.code(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception when others then
  return sqlerrm;
end;
$$;
create function pg_temp.h(t text) returns bytea language sql immutable as $$ select sha256(convert_to(t, 'UTF8')); $$;
create function pg_temp.notes(k text, p_kind text) returns bigint language sql stable security definer as $$
  select count(*) from public.notifications n where n.recipient_id = pg_temp.fx(k) and n.kind = p_kind;
$$;
create function pg_temp.kind_total(p_kind text) returns bigint language sql stable security definer as $$
  select count(*) from public.notifications n where n.kind = p_kind;
$$;
create function pg_temp.entries(p_entity text, p_action text, p_id uuid) returns bigint language sql stable security definer as $$
  select count(*) from public.activity_log a where a.entity = p_entity and a.action = p_action and a.entity_id = p_id;
$$;
create function pg_temp.link(k text) returns public.upload_links language sql stable security definer as $$
  select l from public.upload_links l where l.id = pg_temp.fx(k);
$$;
create function pg_temp.file(k text) returns public.upload_files language sql stable security definer as $$
  select f from public.upload_files f where f.id = pg_temp.fx(k);
$$;
create function pg_temp.uploader(k text) returns public.upload_uploaders language sql stable security definer as $$
  select u from public.upload_uploaders u where u.id = pg_temp.fx(k);
$$;
create function pg_temp.task(k text) returns public.tasks language sql stable security definer as $$
  select t from public.tasks t where t.id = pg_temp.fx(k);
$$;
-- A task written directly (the upload functions are under test, not task_create).
create function pg_temp.mk_task(k text, title text, by text, approver text, primary_k text, assignees text[],
  client text default null, due interval default interval '3 days') returns uuid language plpgsql as $$
declare
  v_id uuid;
  a text;
begin
  insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id,
    approving_admin_id, admin_step, client_id)
  values (pg_temp.fx('org'), title, pg_temp.fx('type'), 'medium', now() + due, 'todo', pg_temp.fx(by),
    pg_temp.fx(primary_k), pg_temp.fx(approver), case when approver is null then 'none' else 'required' end::public.admin_step,
    pg_temp.fx(client))
  returning id into v_id;
  foreach a in array assignees loop
    insert into public.task_assignees (task_id, member_id, is_primary) values (v_id, pg_temp.fx(a), a = primary_k);
  end loop;
  insert into fx values (k, v_id);
  return v_id;
end;
$$;
-- The eight member calls on a task, a link and an uploader: how many answered like `expect`.
create function pg_temp.matrix(t uuid, l uuid, u uuid, expect text) returns bigint language plpgsql as $$
declare
  q text;
  n bigint := 0;
begin
  foreach q in array array[
    format('select public.upload_card(%L)', t),
    format('select public.upload_uploader_files(%L)', u),
    format('select public.upload_link_secret(%L, false)', l),
    format('select public.upload_link_create(%L)', t),
    format('select public.upload_link_stop(%L)', l),
    format('select public.upload_link_renew(%L)', t),
    format('select public.upload_files_received(%L, false, null)', l),
    format('select public.upload_uploader_erase_network(%L)', u)] loop
    if pg_temp.code(q) like expect then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
-- Select, insert, update and delete on the six tables: how many were refused for lack of privilege.
create function pg_temp.tables_denied() returns bigint language plpgsql as $$
declare
  t text;
  c text;
  q text;
  n bigint := 0;
begin
  foreach t in array array['upload_links', 'upload_uploaders', 'upload_files', 'upload_folders', 'upload_alerts',
                           'upload_rate_hits'] loop
    c := case when t = 'upload_rate_hits' then 'hits' else 'id' end;
    foreach q in array array[format('select count(*) from public.%I', t), format('insert into public.%I default values', t),
                             format('update public.%I set %I = %I', t, c, c), format('delete from public.%I', t)] loop
      if pg_temp.code(q) like 'permission denied for table%' then
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end;
$$;
-- A file the Worker is uploading (start + session), as the service role; returns its id.
create function pg_temp.start(tok text, dev text, name text, path text, size bigint, sealed text) returns uuid
language plpgsql as $$
declare
  v jsonb;
  v_id uuid;
begin
  v := public.upload_file_start(pg_temp.h(tok), pg_temp.h(dev), name, path, size, 'video/mp4', '198.51.100.7', 'Mozilla/5.0 (iPhone)');
  if v ->> 'result' <> 'start' then
    raise exception 'start answered %', v;
  end if;
  v_id := (v ->> 'file_id')::uuid;
  perform public.upload_session_set(v_id, 'sub-146', 'parent-146', sealed);
  return v_id;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role, anon;

-- Fixtures: org A's people, a client, the tasks; org B with its Owner, a task and a link. ---------------
insert into auth.users (id, email)
select pg_temp.fx(k), k || '-146@example.com'
from unnest(array['adm_c', 'adm_a', 'adm_k', 'adm_o', 'adm_x', 'crew', 'crew_out', 'crew_k', 'adm_s', 'adm_p']) k;
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), n, k || '-146@example.com', r::public.member_role, 'active', 'permanent',
       now() - interval '60 days'
from (values ('adm_c', 'Cora Admin', 'admin'), ('adm_a', 'Abe Approver', 'admin'), ('adm_k', 'Kit Coordinator', 'admin'),
             ('adm_o', 'Ola Clientadmin', 'admin'), ('adm_x', 'Xan Outside', 'admin'), ('crew', 'Jo Rao', 'staff'),
             ('crew_out', 'Pat Away', 'staff'), ('crew_k', 'Kay Crewcoord', 'staff'),
             ('adm_s', 'Sid Assignee', 'admin'), ('adm_p', 'Pia Primary', 'admin')) v(k, n, r);
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at)
values (pg_temp.fx('free'), pg_temp.fx('org'), 'Fen Free', null, 'staff', 'active', 'freelance', now() - interval '60 days'),
       (pg_temp.fx('free2'), pg_temp.fx('org'), 'Fay Free', null, 'staff', 'active', 'freelance', now() - interval '60 days');
insert into public.member_coordinators (member_id, coordinator_id) values
  (pg_temp.fx('free'), pg_temp.fx('adm_k')), (pg_temp.fx('free2'), pg_temp.fx('crew_k'));
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Upload client 146', 'active', pg_temp.fx('adm_o'), now());

select pg_temp.mk_task('t1', 'Brand reel 146', 'adm_c', 'adm_a', 'crew', array['crew', 'free', 'free2', 'adm_s'], 'client');
select pg_temp.mk_task('t2', 'Freelance cut 146', 'owner', null, 'free', array['free'], null, interval '-1 day');
select pg_temp.mk_task('t3', 'Crew coordinated 146', 'adm_c', null, 'free2', array['free2']);
select pg_temp.mk_task('t4', 'Own task 146', 'adm_a', null, 'adm_a', array['adm_a']);
select pg_temp.mk_task('t5', 'Cancelled 146', 'adm_c', null, 'crew', array['crew']);
select pg_temp.mk_task('t6', 'Done by crew 146', 'adm_c', 'adm_a', 'crew', array['crew']);
select pg_temp.mk_task('t7', 'Owner work 146', 'owner', null, 'owner', array['owner']);
select pg_temp.mk_task('t9', 'Caps 146', 'adm_c', null, 'crew', array['crew']);
select pg_temp.mk_task('t10', 'Signals 146', 'adm_c', 'adm_a', 'crew', array['crew']);
select pg_temp.mk_task('t11', 'Admin primary 146', 'owner', null, 'adm_p', array['adm_p']);
select pg_temp.mk_task('t12', 'Archived 146', 'adm_c', null, 'crew', array['crew']);
select pg_temp.mk_task('t13', 'Approver cancels 146', 'adm_c', 'adm_a', 'crew', array['crew']);
select pg_temp.mk_task('t14', 'Owner cancels 146', 'adm_c', null, 'crew', array['crew']);

insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Other studio 146');
insert into auth.users (id, email) values (pg_temp.fx('b_owner'), 'b-owner-146@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at)
values (pg_temp.fx('b_owner'), pg_temp.fx('org_b'), 'Bea Owner', 'b-owner-146@example.com', 'owner', 'active', 'permanent',
        now() - interval '20 days');
insert into public.task_types (id, org_id, name, kind, shows_on_calendar, has_location, position)
values (pg_temp.fx('b_type'), pg_temp.fx('org_b'), 'Type B 146', 'normal', false, false, 'z146');
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id)
values (pg_temp.fx('org_b'), 'Other task 146', pg_temp.fx('b_type'), 'medium', now() + interval '2 days', 'todo',
        pg_temp.fx('b_owner'), pg_temp.fx('b_owner'));
insert into fx select 'tb', id from public.tasks where title = 'Other task 146';
insert into public.upload_links (org_id, task_id, token_hash, token_salt, created_by)
values (pg_temp.fx('org_b'), pg_temp.fx('tb'), pg_temp.h('tok-b'), extensions.gen_random_bytes(16), pg_temp.fx('b_owner'));
insert into fx select 'lb', id from public.upload_links where task_id = pg_temp.fx('tb');

-- =====================================================================================================
-- 0. Structure: tables, privileges, keys, kinds
-- =====================================================================================================
select is((select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
           and c.relname in ('upload_links', 'upload_uploaders', 'upload_files', 'upload_folders', 'upload_alerts',
                             'upload_rate_hits')), 6::bigint, 'the six upload tables have RLS on');
select is((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname like 'upload\_%' and c.relnamespace = 'public'::regnamespace), 0::bigint,
  'no policy on any upload table (functions only)');
select is((select count(*) from unnest(array['anon', 'authenticated']) r,
           unnest(array['public.upload_links', 'public.upload_uploaders', 'public.upload_files', 'public.upload_folders',
                         'public.upload_alerts', 'public.upload_rate_hits']) t
           where has_table_privilege(r, t, 'select, insert, update, delete, truncate, references, trigger')),
  0::bigint, 'anon and authenticated hold no privilege on any upload table');
select is((select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
           where c.relname like 'upload\_%' and c.relnamespace = 'public'::regnamespace and not g.tgisinternal
             and g.tgname <> 'set_updated_at'), 0::bigint,
  'no upload table has the audit trigger (hashes, salts, sessions and IPs never reach activity_log)');
select is((select count(*) from unnest(array[
    'public.upload_card(uuid)', 'public.upload_uploader_files(uuid)', 'public.upload_link_secret(uuid, boolean)',
    'public.upload_link_create(uuid)', 'public.upload_link_stop(uuid)', 'public.upload_link_renew(uuid)',
    'public.upload_files_received(uuid, boolean, text)', 'public.upload_uploader_erase_network(uuid)']) f
  where has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
    and not has_function_privilege('service_role', f, 'execute')
    and (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure)),
  8::bigint, 'the eight member functions: authenticated only, SECURITY DEFINER with an empty search_path');
select is((select count(*) from unnest(array[
    'public.upload_link_seal(uuid, bytea)', 'public.upload_resolve(bytea, bytea)',
    'public.upload_register(bytea, bytea, text, inet, text)',
    'public.upload_file_start(bytea, bytea, text, text, bigint, text, inet, text)',
    'public.upload_folder_put(uuid, text, text, text)', 'public.upload_session_set(uuid, text, text, text)',
    'public.upload_progress(bytea, bytea, uuid, bigint)', 'public.upload_file_failed(bytea, bytea, uuid, text)',
    'public.upload_file_done(uuid, text, bigint, text, text, text)', 'public.upload_said_done(bytea, bytea)',
    'public.upload_watch_due(timestamptz)', 'public.upload_record_offset(uuid, bigint, timestamptz)',
    'public.upload_signals(timestamptz)', 'public.upload_daily_limit_hit(uuid, timestamptz)',
    'public.upload_rate_hit(text, bytea, timestamptz)', 'public.upload_drive_check_claim(uuid, uuid[], timestamptz)',
    'public.upload_drive_check_daily(timestamptz, integer)', 'public.upload_drive_seen(uuid, text, timestamptz)']) f
  where has_function_privilege('service_role', f, 'execute') and not has_function_privilege('anon', f, 'execute')
    and not has_function_privilege('authenticated', f, 'execute')),
  18::bigint, 'the eighteen public API and job functions: service_role only, never anon or authenticated');
select ok(has_function_privilege('authenticated', 'app.upload_manager(uuid)', 'execute')
          and not has_function_privilege('anon', 'app.upload_manager(uuid)', 'execute'),
  'app.upload_manager keeps the API grant (the activity_log policy reads it), never anon');
select ok(has_function_privilege('authenticated', 'public.task_submit_done(uuid, text, text, uuid)', 'execute')
          and has_function_privilege('service_role', 'public.task_submit_done(uuid, text, text, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.task_submit_done(uuid, text, text, uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.task_cancel(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.task_cancel(uuid, text)', 'execute'),
  'task_submit_done and task_cancel keep their grants');
select is((select array_agg(role::text || ':' || permission order by role, permission) from public.role_permissions
           where permission like 'uploads.%'),
  array['owner:uploads.manage', 'owner:uploads.network', 'admin:uploads.manage'],
  'uploads.manage for the Owner and Admins, uploads.network for the Owner only, nothing for Crew');
select is((select array_agg(kind || ':' || actionable || ':' || always_email || ':' || in_app order by kind)
           from public.notification_kinds where kind like 'upload\_%'),
  array['upload_daily_limit:true:false:true', 'upload_files_received:true:false:true',
        'upload_looks_finished:false:false:true', 'upload_names_capped:false:false:true',
        'upload_not_on_task:false:false:true', 'upload_said_done:false:false:true',
        'upload_space_held:true:false:true', 'upload_stuck:false:false:true'],
  'the eight kinds: info ones never emailed; files received, space held and the daily limit fall back to email');
select is((select count(*) from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
           and p.proname like 'upload%' and p.proname ~ '(remove|delete|trash|move)'), 0::bigint,
  'no function removes, deletes, moves or trashes an uploaded file (Q7)');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name like 'upload\_%'
           and column_name ~ '(amount|price|paise|rupee|revenue|cost|fee)'), 0::bigint,
  'no money in any upload table (invariant 2)');
select is((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'upload\_%'),
  0::bigint, 'no upload table joins the Realtime publication');
select is((select count(*) from pg_attribute a where a.attrelid = 'public.upload_links'::regclass
           and a.attname in ('token', 'token_plain', 'url', 'link')), 0::bigint, 'no column holds a token (plan A2)');

-- =====================================================================================================
-- 1. Direct table access, every role: refused
-- =====================================================================================================
select pg_temp.as_member('owner');
select is(pg_temp.tables_denied(), 24::bigint, 'the Owner: select / insert / update / delete refused on all six');
select pg_temp.as_member('adm_c');
select is(pg_temp.tables_denied(), 24::bigint, 'the task''s Admin: refused on all six');
select pg_temp.as_member('adm_k');
select is(pg_temp.tables_denied(), 24::bigint, 'a coordinator Admin: refused on all six');
select pg_temp.as_member('adm_o');
select is(pg_temp.tables_denied(), 24::bigint, 'another Admin: refused on all six');
select pg_temp.as_member('crew');
select is(pg_temp.tables_denied(), 24::bigint, 'a Crew assignee: refused on all six');
select pg_temp.as_member('crew_out');
select is(pg_temp.tables_denied(), 24::bigint, 'Crew not on the task: refused on all six');
select pg_temp.as_member('free');
select is(pg_temp.tables_denied(), 24::bigint, 'a freelancer''s id: refused on all six');
select pg_temp.as_member('b_owner');
select is(pg_temp.tables_denied(), 24::bigint, 'another organisation''s Owner: refused on all six');
select pg_temp.as_anon();
select is(pg_temp.tables_denied(), 24::bigint, 'anon: refused on all six');

-- =====================================================================================================
-- 2. Who "the task's Admin" is
-- =====================================================================================================
select pg_temp.as_system();
select is(app.upload_recipients(pg_temp.fx('t1')), array[pg_temp.fx('adm_c'), pg_temp.fx('adm_a')],
  'recipients, a task with an approver: its creator and its approving Admin (not the Owner)');
select is(app.upload_recipients(pg_temp.fx('t2')), array[pg_temp.fx('owner'), pg_temp.fx('adm_k')],
  'recipients, the Owner''s task for a freelancer: the Owner (creator, no approver) and the coordinating Admin');
select is(app.upload_recipients(pg_temp.fx('t3')), array[pg_temp.fx('adm_c'), pg_temp.fx('owner')],
  'recipients, a Crew-coordinated freelancer: the creator and the Owner (no approver); never the Crew coordinator');
select pg_temp.as_member('owner');
select ok(app.upload_manager(pg_temp.fx('t1')), 'manager: the Owner');
select pg_temp.as_member('adm_c');
select ok(app.upload_manager(pg_temp.fx('t1')), 'manager: the creator Admin');
select pg_temp.as_member('adm_a');
select ok(app.upload_manager(pg_temp.fx('t1')), 'manager: the approving Admin');
select pg_temp.as_member('adm_k');
select ok(app.upload_manager(pg_temp.fx('t2')) and not app.upload_manager(pg_temp.fx('t1')),
  'manager: the coordinator of the freelancer primary owner, not of a freelancer who is only an assignee');
select pg_temp.as_member('adm_o');
select ok(not app.upload_manager(pg_temp.fx('t1')), 'manager: not the client''s Admin through the label');
select pg_temp.as_member('crew_k');
select ok(not app.upload_manager(pg_temp.fx('t3')), 'manager: not a Crew coordinator of the primary owner');
select pg_temp.as_member('crew');
select ok(not app.upload_manager(pg_temp.fx('t1')), 'manager: not the Crew primary owner');

-- =====================================================================================================
-- 3. Get upload link: the Drive, the task's state, one active link per task
-- =====================================================================================================
select pg_temp.as_member('adm_c');
select is(pg_temp.code($$ select public.upload_link_create(pg_temp.fx('t1')) $$), 'INVALID_STATE',
  'no Drive connected yet: INVALID_STATE');
select pg_temp.as_system();
insert into public.drive_account (org_id, google_email, google_sub, refresh_token_encrypted, state, connected_by, connected_at,
  quota_total_bytes, quota_used_bytes, quota_checked_at)
values (pg_temp.fx('org'), 'studio-146@example.com', 'sub-146', null, 'needs_reconnect', pg_temp.fx('owner'), now(),
  2000000000000, 1000000000000, now());
select pg_temp.as_member('crew');
select is(pg_temp.code($$ select public.upload_link_create(pg_temp.fx('t1')) $$), 'FORBIDDEN', 'a Crew assignee: FORBIDDEN');
select pg_temp.as_member('adm_c');
select is(pg_temp.code($$ insert into fx select 'l1', public.upload_link_create(pg_temp.fx('t1')) $$), 'ok',
  'the creator Admin makes the link while the Drive waits to be reconnected');
select is(pg_temp.code($$ select public.upload_link_create(pg_temp.fx('t1')) $$), 'INVALID_STATE',
  'a second link on the same task: INVALID_STATE');
select pg_temp.as_system();
select throws_ok($$ insert into public.upload_links (org_id, task_id, token_salt, created_by)
                    values (pg_temp.fx('org'), pg_temp.fx('t1'), extensions.gen_random_bytes(16), pg_temp.fx('owner')) $$,
  '23505', null, 'the database holds one active link per task');
select is(pg_temp.entries('upload_links', 'created', pg_temp.fx('l1')), 1::bigint, 'history: created');
select is((select meta from public.activity_log where entity = 'upload_links' and entity_id = pg_temp.fx('l1') and action = 'created'),
  jsonb_build_object('task_id', pg_temp.fx('t1')), 'created: the task id only');
select is((select actor_id from public.activity_log where entity = 'upload_links' and entity_id = pg_temp.fx('l1') and action = 'created'),
  pg_temp.fx('adm_c'), 'created: by the creator Admin');
select ok((select octet_length(token_salt) = 16 and token_hash is null and key_version = 1 from public.upload_links where id = pg_temp.fx('l1')),
  'a 16-byte salt, key version 1, no hash until sealed');
update public.tasks set state = 'submitted', submitted_at = now(), submitted_by = pg_temp.fx('crew')
  where id = pg_temp.fx('t9');
select pg_temp.as_member('adm_c');
select is(pg_temp.code($$ select public.upload_link_create(pg_temp.fx('t9')) $$), 'INVALID_STATE', 'a submitted task: INVALID_STATE');
select pg_temp.as_system();
update public.tasks set state = 'todo', submitted_at = null, submitted_by = null where id = pg_temp.fx('t9');
update public.tasks set archived_at = now() where id = pg_temp.fx('t9');
select pg_temp.as_member('adm_c');
select is(pg_temp.code($$ select public.upload_link_create(pg_temp.fx('t9')) $$), 'INVALID_STATE', 'an archived task: INVALID_STATE');
select pg_temp.as_system();
update public.tasks set archived_at = null where id = pg_temp.fx('t9');

-- The seal and the token-hash lookup (plan A2, A6-A7) --------------------------------------------------
select pg_temp.as_service();
select is(public.upload_resolve(pg_temp.h('tok-1'), null), null, 'before the seal the token answers nothing');
select is(public.upload_link_seal(pg_temp.fx('l1'), pg_temp.h('tok-1')), true, 'the server seals the link with sha256(token)');
select is(public.upload_link_seal(pg_temp.fx('l1'), pg_temp.h('tok-other')), false, 'the seal is write-once');
select is(public.upload_link_seal(pg_temp.fx('l1'), pg_temp.h('tok-1')), true, 'the same hash again is a harmless no-op');
select is((pg_temp.link('l1')).token_hash, pg_temp.h('tok-1'), 'and the hash is unchanged');
select is(pg_temp.code($$ select public.upload_link_seal(pg_temp.fx('l1'), '\x00'::bytea) $$), 'VALIDATION', 'a short hash: VALIDATION');
select is(public.upload_resolve(pg_temp.h('tok-1'), null) ->> 'can_start', 'drive_unavailable',
  'the Drive needs reconnecting: the page waits (screen R)');
select pg_temp.as_system();
update public.drive_account set state = 'connected', refresh_token_encrypted = 'enc-refresh-146' where org_id = pg_temp.fx('org');
select pg_temp.as_service();
select is((select array_agg(k order by k) from jsonb_object_keys(public.upload_resolve(pg_temp.h('tok-1'), null)) k),
  array['can_start', 'studio_name', 'task_title', 'uploader', 'wait_seconds'], 'resolve: exactly five keys (plan A7)');
select is(public.upload_resolve(pg_temp.h('tok-1'), null) ->> 'task_title', 'Brand reel 146', 'resolve: the task''s title');
select is(public.upload_resolve(pg_temp.h('tok-1'), null) ->> 'studio_name',
  (select name from public.organizations where id = pg_temp.fx('org')), 'resolve: the studio''s name');
select is(public.upload_resolve(pg_temp.h('tok-1'), null) ->> 'can_start', 'yes', 'resolve: files may start');
select ok(public.upload_resolve(pg_temp.h('tok-1'), pg_temp.h('dev-new')) -> 'uploader' = 'null'::jsonb,
  'resolve: an unknown device is nobody yet');
select is(public.upload_resolve(pg_temp.h('tok-unknown'), null), null, 'resolve: an unknown token is null');
select is(public.upload_resolve('\x0102'::bytea, null), null, 'resolve: a malformed hash is null');
select is(public.upload_resolve(null, null), null, 'resolve: no hash is null');
select is(public.upload_resolve(pg_temp.h('tok-b'), null) ->> 'task_title', 'Other task 146',
  'resolve: another organisation''s link answers for its own task only');

-- The secret and Copy link (plan A3) -------------------------------------------------------------------
select pg_temp.as_member('adm_a');
select ok((select octet_length(s.token_salt) = 16 and s.key_version = 1 and s.link_id = pg_temp.fx('l1')
           from public.upload_link_secret(pg_temp.fx('l1'), false) s), 'the approving Admin gets the salt and key version');
select pg_temp.as_system();
select is(pg_temp.entries('upload_links', 'copied', pg_temp.fx('l1')), 0::bigint, 'showing the masked link writes nothing');
select pg_temp.as_member('owner');
select is(pg_temp.code($$ select public.upload_link_secret(pg_temp.fx('l1'), true) $$), 'ok', 'the Owner copies the link');
select pg_temp.as_system();
select is((select actor_id from public.activity_log where entity = 'upload_links' and entity_id = pg_temp.fx('l1') and action = 'copied'),
  pg_temp.fx('owner'), 'Copy link is a history row naming who copied it');

-- =====================================================================================================
-- 4. Register (plan B1-B3, C3, C10)
-- =====================================================================================================
select pg_temp.as_service();
select is(pg_temp.code($$ select public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-x'), E'\u202e\u200b  ', null, null) $$),
  'VALIDATION', 'a name of only bidi and zero-width characters: VALIDATION');
select is(pg_temp.code($$ select public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-x'), repeat('a', 61), null, null) $$),
  'VALIDATION', 'a 61-character name: VALIDATION');
select is(pg_temp.code($$ select public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-x'), U&'\0301\0301', null, null) $$),
  'VALIDATION', 'a name of only combining marks (nothing left once folded): VALIDATION, not a constraint error');
select is(pg_temp.code($$ select public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-x'), U&'\00AD\2028\2029\180E\034F\FE0F', null, null) $$),
  'VALIDATION', 'a name of only soft hyphens, separators, U+180E, U+034F and variation selectors: VALIDATION');
select is(app.upload_clean(U&'S\00ADa\2028m\2029\180E\034F\FE0F'), 'Sam', 'those characters are stripped from a name');
select is(pg_temp.code($$ select public.upload_register(pg_temp.h('tok-1'), '\x01'::bytea, 'Sam', null, null) $$),
  'VALIDATION', 'a malformed device key: VALIDATION');
select is(pg_temp.code($$ select public.upload_register(pg_temp.h('tok-unknown'), pg_temp.h('dev-x'), 'Sam', null, null) $$),
  'NOT_FOUND', 'an unknown link: NOT_FOUND');
insert into fx select 'u_sam', (public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), E'S\u202eam\u200b ',
  '198.51.100.7', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile') ->> 'uploader_id')::uuid;
select is((pg_temp.uploader('u_sam')).name, 'Sam', 'the name is cleaned (bidi and zero-width removed, trimmed)');
select is((pg_temp.uploader('u_sam')).folder_name, 'Sam', 'the folder is the name');
select is((pg_temp.uploader('u_sam')).device_label, 'phone · iOS', 'the device label comes from the user agent');
select ok(not (pg_temp.uploader('u_sam')).on_task, 'Sam is not on the task');
select is(public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'sam', null, null),
  jsonb_build_object('uploader_id', pg_temp.fx('u_sam')), 'the same device and name again: the same uploader, and only its id (S4)');
select is(pg_temp.code($$ select public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'Alex', null, null) $$),
  'CONFLICT', 'the same device under another name: CONFLICT');
insert into fx select 'u_jo', (public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-jo'), 'JÖ', '198.51.100.8', 'Mozilla/5.0 (Android 14; Mobile)')
  ->> 'uploader_id')::uuid;
select ok((pg_temp.uploader('u_jo')).on_task and (pg_temp.uploader('u_jo')).matched_member_id = pg_temp.fx('crew'),
  'a case- and accent-insensitive first name matches the active assignee');
insert into fx select 'u_fen', (public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-fen'), 'fen  free', null, null)
  ->> 'uploader_id')::uuid;
select ok((pg_temp.uploader('u_fen')).on_task and (pg_temp.uploader('u_fen')).matched_member_id = pg_temp.fx('free'),
  'a freelancer assignee''s full name matches too');
insert into fx select 'u_sam2', (public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-sam2'), 'Sam', null, null)
  ->> 'uploader_id')::uuid;
select is((pg_temp.uploader('u_sam2')).folder_name, 'Sam (2)', 'a second Sam on the task gets the folder "Sam (2)"');
-- In a savepoint, so the extra uploader and its notices leave the later counts alone.
savepoint folder_v2;
insert into fx select 'u_v2', (public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-v2'), 'V2', null, null)
  ->> 'uploader_id')::uuid;
select is((pg_temp.uploader('u_v2')).folder_name, 'V2 (2)',
  'a name shaped like a hand-in version folder never sits beside one: "V2 (2)" (v5.0)');
rollback to savepoint folder_v2;
select pg_temp.as_system();
select is((select count(*) from public.activity_log where entity = 'upload_uploaders' and action = 'started'
           and meta ->> 'task_id' = pg_temp.fx('t1')::text), 4::bigint, 'each new uploader is a history row (started)');
select is((select array_agg(k order by k) from public.activity_log a, jsonb_object_keys(a.meta) k
           where a.entity = 'upload_uploaders' and a.entity_id = pg_temp.fx('u_sam') and a.action = 'started'),
  array['name', 'on_task', 'task_id', 'uploader_id'], 'started: name and on_task, never an IP or device');
select is((select actor_id from public.activity_log where entity = 'upload_uploaders' and entity_id = pg_temp.fx('u_sam')),
  null, 'an uploader''s action has no member actor');
select is(pg_temp.notes('adm_c', 'upload_not_on_task'), 1::bigint, 'a new name not on the task tells the creator once');
select is(pg_temp.notes('adm_a', 'upload_not_on_task'), 1::bigint, 'and the approving Admin');
select is(pg_temp.notes('owner', 'upload_not_on_task') + pg_temp.notes('crew', 'upload_not_on_task')
          + pg_temp.notes('adm_o', 'upload_not_on_task'), 0::bigint, 'nobody else (the Owner: the task has an approver)');
select is((select title from public.notifications where recipient_id = pg_temp.fx('adm_c') and kind = 'upload_not_on_task'),
  'Sam is uploading to Brand reel 146 (not on the task)', 'the wording names the uploader and the task');
select ok((select link = '/tasks/' || pg_temp.fx('t1') and body not like '%http%' from public.notifications
           where recipient_id = pg_temp.fx('adm_c') and kind = 'upload_not_on_task'),
  'it opens the task and carries no link to the upload page or Drive');

-- The 20-name cap and the not-on-task limit, on a link of its own ------------------------------------
select pg_temp.as_member('adm_c');
insert into fx select 'l9', public.upload_link_create(pg_temp.fx('t9'));
select pg_temp.as_service();
select public.upload_link_seal(pg_temp.fx('l9'), pg_temp.h('tok-9'));
select is((select count(*) from generate_series(1, 20) i
           where public.upload_register(pg_temp.h('tok-9'), pg_temp.h('dev-n' || i), 'Name ' || chr(64 + i), null, null) ? 'uploader_id'),
  20::bigint, 'twenty new names in a day are taken');
select is(public.upload_register(pg_temp.h('tok-9'), pg_temp.h('dev-n21'), 'Name U', null, null),
  jsonb_build_object('refused', 'rate_limited'), 'the 21st is refused (plan C3)');
select is(public.upload_register(pg_temp.h('tok-9'), pg_temp.h('dev-n22'), 'Name V', null, null),
  jsonb_build_object('refused', 'rate_limited'), 'and the 22nd');
select is(public.upload_register(pg_temp.h('tok-9'), pg_temp.h('dev-n1'), 'Name A', null, null) ->> 'uploader_id',
  (select id::text from public.upload_uploaders where link_id = pg_temp.fx('l9') and name = 'Name A'),
  'a device already on the link still comes back after the cap');
select pg_temp.as_system();
select is(pg_temp.notes('adm_c', 'upload_names_capped'), 1::bigint, 'the task''s Admin is told of the cap once');
select is(pg_temp.notes('owner', 'upload_names_capped'), 1::bigint, 'and the Owner (no approving Admin), once');
select is((select count(*) from public.notifications where recipient_id = pg_temp.fx('adm_c') and kind = 'upload_not_on_task'
           and entity_id = pg_temp.fx('t9')), 6::bigint, 'twenty names not on the task: five notices, then one summary');
select is((select count(*) from public.notifications where recipient_id = pg_temp.fx('adm_c') and kind = 'upload_not_on_task'
           and entity_id = pg_temp.fx('t9') and payload ->> 'summary' = 'true'), 1::bigint, 'one of them the summary');
select is((select count(*) from public.upload_uploaders where link_id = pg_temp.fx('l9')), 20::bigint, 'the refused names were not kept');

-- =====================================================================================================
-- 5. Who may call the member functions (PERMISSIONS v4.5), on t1
-- =====================================================================================================
select pg_temp.as_member('adm_o');
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'FORBIDDEN'), 8::bigint,
  'the client''s Admin (sees the task through its label): FORBIDDEN on all eight');
select pg_temp.as_member('adm_k');
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'FORBIDDEN'), 8::bigint,
  'the coordinator of a freelancer who is only an assignee: FORBIDDEN on all eight');
select pg_temp.as_member('crew');
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'FORBIDDEN'), 8::bigint,
  'a Crew assignee and primary owner: FORBIDDEN on all eight');
select pg_temp.as_member('crew_k');
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'FORBIDDEN'), 8::bigint,
  'a Crew coordinator of a freelancer on the task: FORBIDDEN on all eight');
select pg_temp.as_member('adm_s');
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'FORBIDDEN'), 8::bigint,
  'an Admin assignee who is not the primary owner, the creator or the approver: FORBIDDEN on all eight');
select pg_temp.as_member('owner');
insert into fx select 'l11', public.upload_link_create(pg_temp.fx('t11'));
select pg_temp.as_service();
select public.upload_link_seal(pg_temp.fx('l11'), pg_temp.h('tok-11'));
insert into fx select 'u_11', (public.upload_register(pg_temp.h('tok-11'), pg_temp.h('dev-11'), 'Ana', null, null) ->> 'uploader_id')::uuid;
select pg_temp.as_member('adm_p');
select is(pg_temp.matrix(pg_temp.fx('t11'), pg_temp.fx('l11'), pg_temp.fx('u_11'), 'FORBIDDEN'), 8::bigint,
  'an Admin primary owner who is neither the creator nor the approver: FORBIDDEN on all eight');
select pg_temp.as_member('adm_x');
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'NOT_FOUND'), 8::bigint,
  'an Admin who does not see the task: NOT_FOUND on all eight');
select pg_temp.as_member('crew_out');
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'NOT_FOUND'), 8::bigint,
  'Crew not on the task: NOT_FOUND on all eight');
select pg_temp.as_member('b_owner');
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'NOT_FOUND'), 8::bigint,
  'another organisation''s Owner: NOT_FOUND on all eight');
select pg_temp.as_member('owner');
select is(pg_temp.code($$ select public.upload_card(pg_temp.fx('tb')) $$), 'NOT_FOUND', 'the Owner: another organisation''s task is NOT_FOUND');
select is(pg_temp.code($$ select public.upload_link_stop(pg_temp.fx('lb')) $$), 'NOT_FOUND', 'and its link');
select pg_temp.as_member('free');
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'UNAUTHENTICATED'), 8::bigint,
  'a freelancer''s id (no login): UNAUTHENTICATED on all eight');
select pg_temp.as_member('gone');
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'UNAUTHENTICATED'), 8::bigint,
  'a deactivated member: UNAUTHENTICATED on all eight');
select pg_temp.as_member('nobody');
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'UNAUTHENTICATED'), 8::bigint,
  'authenticated with no member: UNAUTHENTICATED on all eight');
select pg_temp.as_anon();
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'permission denied for function%'), 8::bigint,
  'anon: no EXECUTE on any of the eight');
select pg_temp.as_service();
select is(pg_temp.matrix(pg_temp.fx('t1'), pg_temp.fx('l1'), pg_temp.fx('u_sam'), 'permission denied for function%'), 8::bigint,
  'service_role: no EXECUTE on the member functions');
-- The public functions refuse every API role.
select pg_temp.as_member('owner');
select is(pg_temp.code($$ select public.upload_resolve(pg_temp.h('tok-1'), null) $$), 'permission denied for function upload_resolve',
  'the Owner cannot call the public API');
select is(pg_temp.code($$ select public.upload_drive_seen(pg_temp.fx('u_sam'), 'trashed', now()) $$),
  'permission denied for function upload_drive_seen', 'nor mark a file removed in Drive');
select pg_temp.as_member('adm_c');
select is(pg_temp.code($$ select public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-z'), 'Zed', null, null) $$),
  'permission denied for function upload_register', 'an Admin cannot call the public API');
select pg_temp.as_member('crew');
select is(pg_temp.code($$ select public.upload_signals(now()) $$), 'permission denied for function upload_signals',
  'Crew cannot run the jobs');
select pg_temp.as_anon();
select is(pg_temp.code($$ select public.upload_resolve(pg_temp.h('tok-1'), null) $$), 'permission denied for function upload_resolve',
  'anon cannot resolve a link (only the Worker, as service_role)');
select is(pg_temp.code($$ select public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'a', '', 1, null, null, null) $$),
  'permission denied for function upload_file_start', 'nor start a file');

-- The allowed reads -----------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.upload_card(pg_temp.fx('t1')) ->> 'state', 'active', 'the Owner reads the card');
select pg_temp.as_member('adm_c');
select is(public.upload_card(pg_temp.fx('t1')) ->> 'state', 'active', 'the creator Admin reads the card');
select is((public.upload_card(pg_temp.fx('t1')) -> 'link' ->> 'sealed')::boolean, true, 'the card reports the link sealed (S6)');
select is(jsonb_array_length(public.upload_card(pg_temp.fx('t1')) -> 'uploaders'), 4, 'one row per uploader');
select is((public.upload_card(pg_temp.fx('t1')) -> 'link' ->> 'age_days')::integer, 0, 'the link''s age in days');
select ok(public.upload_card(pg_temp.fx('t1'))::text !~ '(198\.51\.100|sealed-|enc-refresh|token_hash|token_salt)',
  'the card carries no IP, session, token or salt');
select is(jsonb_array_length(public.upload_uploader_files(pg_temp.fx('u_sam')) -> 'files'), 0, 'the creator Admin opens a sheet');
select ok(not (public.upload_uploader_files(pg_temp.fx('u_sam')) -> 'uploader' ? 'ip'), 'an Admin''s sheet has no IP');
select pg_temp.as_member('adm_a');
select is(public.upload_card(pg_temp.fx('t1')) ->> 'state', 'active', 'the approving Admin reads the card');
select pg_temp.as_member('adm_k');
select is(public.upload_card(pg_temp.fx('t2')) ->> 'state', 'none', 'the coordinator of the freelancer primary owner reads its card');
select pg_temp.as_member('owner');
select is(public.upload_uploader_files(pg_temp.fx('u_sam')) -> 'uploader' ->> 'ip', '198.51.100.7',
  'the Owner''s sheet shows the IP (uploads.network, Q12)');
select pg_temp.as_member('adm_c');
select is(pg_temp.code($$ select public.upload_uploader_erase_network(pg_temp.fx('u_sam')) $$), 'FORBIDDEN',
  'the task''s Admin cannot erase network details (uploads.network)');

-- =====================================================================================================
-- 6. File start, session, progress, failure, Google's answer
-- =====================================================================================================
select pg_temp.as_service();
select is(pg_temp.code($$ select public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-nobody'), 'a.mp4', '', 1, null, null, null) $$),
  'NOT_FOUND', 'a device with no name yet: NOT_FOUND');
select is(pg_temp.code($$ select public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), '/\', '', 1, null, null, null) $$),
  'VALIDATION', 'a file name of only slashes: VALIDATION');
select is(pg_temp.code($$ select public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'a.mp4', 'Day 1/../x', 1, null, null, null) $$),
  'VALIDATION', 'a ".." folder: VALIDATION');
select is(pg_temp.code($$ select public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'a.mp4',
  array_to_string(array_fill('d'::text, array[13]), '/'), 1, null, null, null) $$), 'VALIDATION', 'folders 13 deep: VALIDATION');
select is(pg_temp.code($$ select public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'a.mp4', repeat('d', 121), 1, null, null, null) $$),
  'VALIDATION', 'a folder name of 121 characters: VALIDATION');
select is(pg_temp.code($$ select public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'a.mp4', '', -1, null, null, null) $$),
  'VALIDATION', 'a negative size: VALIDATION');
select is(pg_temp.code($$ select public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'a.mp4', '', 5000000000001, null, null, null) $$),
  'VALIDATION', 'a declared size over 5 TB: VALIDATION');
insert into r select 'f1', public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), E'clip\u202e1/.mp4',
  '/Day 1//Cam A/', 1000000000, 'video/mp4', '198.51.100.7', 'Mozilla/5.0 (iPhone)');
insert into fx select 'f1', (v ->> 'file_id')::uuid from r where key = 'f1';
select is((select v ->> 'result' from r where key = 'f1'), 'start', 'a file starts');
select is((pg_temp.file('f1')).name, 'clip1.mp4', 'the file name is cleaned (no slash, no bidi)');
select is((pg_temp.file('f1')).relative_path, 'Day 1/Cam A', 'the path is cleaned');
select is((select jsonb_path_query_array(v -> 'folders', '$[*].name') from r where key = 'f1'),
  '["Sam", "Day 1", "Cam A"]'::jsonb, 'the folder steps: the uploader''s folder, then each level');
select ok((select v ->> 'session_uri_encrypted' is null and v ->> 'account_sub' = 'sub-146' and v ->> 'task_id' = pg_temp.fx('t1')::text
           from r where key = 'f1'), 'a new file has no session yet; the account and the task come from the link');
select is((public.upload_folder_put(pg_temp.fx('u_sam'), 'sub-146', 'Day 1', 'folder-day1')).drive_folder_id, 'folder-day1',
  'the Worker caches the folder it made');
select is((public.upload_folder_put(pg_temp.fx('u_sam'), 'sub-146', '/Day 1/', 'folder-other')).drive_folder_id, 'folder-day1',
  'folder_put: the cached folder is returned unchanged');
select is(public.upload_session_set(pg_temp.fx('f1'), 'sub-146', 'parent-146', 'sealed-1'), 'uploading', 'the Worker sets the session');
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'clip1.mp4', 'Day 1/Cam A', 1000000000, null, null, null)
  -> 'folders' -> 1 ->> 'drive_folder_id', 'folder-day1', 'a cached folder is in the steps');
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'clip1.mp4', 'Day 1/Cam A', 1000000000, null, null, null)
  ->> 'session_uri_encrypted', 'sealed-1', 'the same file again resumes on its session (to the device that asked)');
select is((select count(*) from public.upload_files where uploader_id = pg_temp.fx('u_sam')), 1::bigint, 'and makes no second row');
select is(public.upload_progress(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), pg_temp.fx('f1'), 1000), false,
  'a second report within 5 seconds is dropped (plan C6)');
select pg_temp.as_system();
set local session_replication_role = replica; -- keep the backdated updated_at (no set_updated_at)
update public.upload_files set updated_at = now() - interval '10 seconds', last_moved_at = now() - interval '10 seconds'
  where id = pg_temp.fx('f1');
set local session_replication_role = origin;
select pg_temp.as_service();
select is(public.upload_progress(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), pg_temp.fx('f1'), 5000), true, 'progress is recorded');
select ok((pg_temp.file('f1')).bytes_reported = 5000 and (pg_temp.file('f1')).last_moved_at = now(), 'new bytes move last_moved_at');
select is(pg_temp.code($$ select public.upload_progress(pg_temp.h('tok-1'), pg_temp.h('dev-jo'), pg_temp.fx('f1'), 6000) $$),
  'NOT_FOUND', 'another uploader''s device cannot report on the file (plan M7)');
select is(pg_temp.code($$ select public.upload_progress(pg_temp.h('tok-9'), pg_temp.h('dev-sam'), pg_temp.fx('f1'), 6000) $$),
  'NOT_FOUND', 'nor through another link');
select pg_temp.as_system();
set local session_replication_role = replica; -- keep the backdated updated_at (no set_updated_at)
update public.upload_files set updated_at = now() - interval '10 seconds' where id = pg_temp.fx('f1');
set local session_replication_role = origin;
select pg_temp.as_service();
select is(pg_temp.code($$ select public.upload_progress(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), pg_temp.fx('f1'), 2000000000) $$),
  'VALIDATION', 'progress past the size: VALIDATION');
select is(pg_temp.code($$ select public.upload_file_failed(pg_temp.h('tok-1'), pg_temp.h('dev-jo'), pg_temp.fx('f1'), 'gave_up') $$),
  'NOT_FOUND', 'another uploader''s device on the same link cannot fail the file');
select is(pg_temp.code($$ select public.upload_file_failed(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), pg_temp.fx('f1'), 'damaged') $$),
  'VALIDATION', 'the browser reports only gave_up or unreadable');
select is(public.upload_file_failed(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), pg_temp.fx('f1'), 'gave_up'), 'failed', 'the browser gave up');
select is((pg_temp.file('f1')).session_uri_encrypted, 'sealed-1', 'a browser failure keeps the session for the retry');
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'clip1.mp4', 'Day 1/Cam A', 1000000000, null, null, null)
  ->> 'session_uri_encrypted', 'sealed-1', 'Retry carries on on the same session');
select is((pg_temp.file('f1')).state, 'uploading', 'and the file is uploading again');
-- Google's answer decides (plan F1-F2).
select is(public.upload_file_done(pg_temp.fx('f1'), 'drive-f1', 999999999, null, 'parent-146', null), 'failed', 'a size other than declared: failed');
select ok((pg_temp.file('f1')).failed_reason = 'size_mismatch' and (pg_temp.file('f1')).session_uri_encrypted is null,
  'size_mismatch, and the session is cleared');
select pg_temp.as_system();
select is((select meta ->> 'reason' from public.activity_log where entity = 'upload_files' and entity_id = pg_temp.fx('f1') and action = 'failed'),
  'size_mismatch', 'history: failed, with the reason');
select pg_temp.as_service();
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'clip1.mp4', 'Day 1/Cam A', 1000000000, null, null, null)
  ->> 'file_id', pg_temp.fx('f1')::text, 'a file failed for good starts again on its own row');
select is(public.upload_session_set(pg_temp.fx('f1'), 'sub-146', 'parent-146', 'sealed-2'), 'uploading', 'with a new session');
select is(public.upload_file_done(pg_temp.fx('f1'), 'drive-f1', 1000000000, null, 'parent-elsewhere', null), 'failed', 'another folder: failed');
select is((pg_temp.file('f1')).failed_reason, 'wrong_folder', 'wrong_folder');
select public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'clip1.mp4', 'Day 1/Cam A', 1000000000, null, null, null);
select public.upload_session_set(pg_temp.fx('f1'), 'sub-146', 'parent-146', 'sealed-3');
select is(public.upload_file_done(pg_temp.fx('f1'), 'drive-f1', 1000000000, repeat('a', 32), 'parent-146', repeat('b', 32)), 'failed',
  'a page MD5 unlike Drive''s: failed');
select is((pg_temp.file('f1')).failed_reason, 'damaged', 'damaged on the way');
select is(pg_temp.code($$ select public.upload_file_done(pg_temp.fx('f1'), 'drive-f1', 1000000000, null, 'parent-146', null) $$),
  'INVALID_STATE', 'a file failed for good without a session is not on its way');
select public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'clip1.mp4', 'Day 1/Cam A', 1000000000, null, null, null);
select public.upload_session_set(pg_temp.fx('f1'), 'sub-146', 'parent-146', 'sealed-4');
select is(pg_temp.code($$ select public.upload_file_done(pg_temp.fx('f1'), 'drive-f1', 1000000000, 'xyz', 'parent-146', null) $$),
  'VALIDATION', 'an MD5 that is not 32 hex characters: VALIDATION');
select is(public.upload_file_done(pg_temp.fx('f1'), 'drive-f1', 1000000000, repeat('A', 32), 'parent-146', repeat('a', 32)), 'done',
  'size, folder and checksum agree: done');
select ok((select state = 'done' and check_kind = 'md5' and not after_stop and session_uri_encrypted is null and done_at is not null
                  and drive_file_id = 'drive-f1' from public.upload_files where id = pg_temp.fx('f1')),
  'done: md5-checked, not after a stop, the session cleared');
select is(public.upload_file_done(pg_temp.fx('f1'), 'drive-f1', 1000000000, repeat('a', 32), 'parent-146', repeat('a', 32)), 'done',
  'the same answer again: done (idempotent)');
select is(pg_temp.code($$ select public.upload_file_done(pg_temp.fx('f1'), 'drive-other', 1000000000, null, 'parent-146', null) $$),
  'INVALID_STATE', 'another Drive id for a received file: INVALID_STATE');
select pg_temp.as_system();
select is(pg_temp.entries('upload_files', 'received', pg_temp.fx('f1')), 1::bigint, 'history: received once');
select is((select array_agg(k order by k) from public.activity_log a, jsonb_object_keys(a.meta) k
           where a.entity = 'upload_files' and a.entity_id = pg_temp.fx('f1') and a.action = 'received'),
  array['after_stop', 'check_kind', 'drive_file_id', 'name', 'relative_path', 'size_bytes', 'task_id', 'uploader_id'],
  'received: name, path, size, check, Drive id, after_stop (nothing else)');
select ok((pg_temp.uploader('u_sam')).first_file_at is not null, 'the uploader''s first file is recorded');
select pg_temp.as_service();
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-sam'), 'clip1.mp4', 'Day 1/Cam A', 1000000000, null, null, null),
  jsonb_build_object('result', 'already_sent'), 'the same file from the same uploader: already sent (plan B4)');
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-jo'), 'clip1.mp4', 'Day 1/Cam A', 1000000000, null, null, null) ->> 'result',
  'start', 'another uploader''s identical file is not "already sent" (no probing)');
select is(pg_temp.code(format('select public.upload_file_done(%L, %L, 1000000000, null, null, null)',
  (select id from public.upload_files where uploader_id = pg_temp.fx('u_jo') and name = 'clip1.mp4'), 'drive-jo-clip')),
  'INVALID_STATE', 'a file that never got a session (no parent) cannot be received');
select ok((public.upload_resolve(pg_temp.h('tok-1'), pg_temp.h('dev-sam')) -> 'uploader' -> 'files') @> '[{"name": "clip1.mp4", "state": "done"}]'::jsonb
          and jsonb_array_length(public.upload_resolve(pg_temp.h('tok-1'), pg_temp.h('dev-sam')) -> 'uploader' -> 'files') = 1,
  'welcome back: Sam''s device sees its own file only (Q4)');
select is((select array_agg(k order by k) from jsonb_object_keys(public.upload_resolve(pg_temp.h('tok-1'), pg_temp.h('dev-sam')) -> 'uploader' -> 'files' -> 0) k),
  array['name', 'relative_path', 'size_bytes', 'state'], 'each own file: name, path, size, state');
select is(public.upload_resolve(pg_temp.h('tok-1'), pg_temp.h('dev-sam')) -> 'uploader' ->> 'name', 'Sam', 'and the uploader''s name');
select ok(not (public.upload_resolve(pg_temp.h('tok-1'), pg_temp.h('dev-jo')) -> 'uploader' -> 'files') @> '[{"state": "done"}]'::jsonb
          and public.upload_resolve(pg_temp.h('tok-1'), pg_temp.h('dev-jo')) -> 'uploader' ->> 'name' = 'JÖ',
  'another device on the same link sees none of Sam''s files (Jo has no received file)');
-- No page MD5: checked by size only.
insert into fx select 'f2', pg_temp.start('tok-1', 'dev-sam', 'still.jpg', '', 2000000, 'sealed-f2');
select is(public.upload_file_done(pg_temp.fx('f2'), 'drive-f2', 2000000, repeat('c', 32), 'parent-146', null), 'done', 'no page hash: done');
select is((pg_temp.file('f2')).check_kind, 'size_only', 'checked by size only (plan F2)');
select is(pg_temp.code($$ select public.upload_file_done(pg_temp.fx('f2'), 'drive-f1', 2000000, null, 'parent-146', null) $$),
  'INVALID_STATE', 'a received file cannot take another file''s Drive id');

-- The limits that pause (plan C4-C5, C8, Q10-Q11) -------------------------------------------------------
-- Six at once per uploader.
select pg_temp.as_system();
insert into public.upload_files (org_id, uploader_id, link_id, task_id, name, size_bytes, state, account_sub, session_uri_encrypted, session_opened_at)
select pg_temp.fx('org'), pg_temp.fx('u_jo'), pg_temp.fx('l1'), pg_temp.fx('t1'), 'busy' || i || '.mp4', 10, 'uploading', 'sub-146', 'sealed-busy', now()
from generate_series(1, 5) i;
select pg_temp.as_service();
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-jo'), 'seventh.mp4', '', 10, null, null, null),
  jsonb_build_object('result', 'wait', 'seconds', 30, 'reason', 'busy'), 'a seventh file at once waits (6 per uploader)');
select pg_temp.as_system();
update public.upload_files set state = 'failed', failed_reason = 'gave_up' where uploader_id = pg_temp.fx('u_jo') and name like 'busy%';
-- 600 new files an hour per link.
select pg_temp.as_system();
insert into public.upload_files (org_id, uploader_id, link_id, task_id, name, size_bytes, state, failed_reason, account_sub)
select pg_temp.fx('org'), u.id, pg_temp.fx('l9'), pg_temp.fx('t9'), 'n' || i || '.jpg', 1, 'failed', 'gave_up', 'sub-146'
from generate_series(1, 600) i, (select id from public.upload_uploaders where link_id = pg_temp.fx('l9') and name = 'Name B') u;
select pg_temp.as_service();
select is(public.upload_file_start(pg_temp.h('tok-9'), pg_temp.h('dev-n1'), 'one-more.jpg', '', 1, null, null, null),
  jsonb_build_object('result', 'wait', 'seconds', 60, 'reason', 'too_many'), 'the 601st new file in an hour waits (plan C5)');
select pg_temp.as_system();
update public.upload_files set created_at = greatest(app.today_ist()::timestamp at time zone 'Asia/Kolkata', now() - interval '61 minutes')
  where link_id = pg_temp.fx('l9');
insert into public.upload_files (org_id, uploader_id, link_id, task_id, name, size_bytes, state, failed_reason, account_sub, created_at)
select pg_temp.fx('org'), u.id, pg_temp.fx('l9'), pg_temp.fx('t9'), 'm' || i || '.jpg', 1, 'failed', 'gave_up', 'sub-146',
       greatest(app.today_ist()::timestamp at time zone 'Asia/Kolkata', now() - interval '61 minutes')
from generate_series(1, 4400) i, (select id from public.upload_uploaders where link_id = pg_temp.fx('l9') and name = 'Name C') u;
select pg_temp.as_service();
select is(public.upload_file_start(pg_temp.h('tok-9'), pg_temp.h('dev-n1'), 'one-more.jpg', '', 1, null, null, null) ->> 'reason',
  'too_many', 'the 5,001st new file in an IST day waits');
-- The space guard: 15 GB free, a 10 GB reserve.
select pg_temp.as_system();
update public.drive_account set quota_used_bytes = quota_total_bytes - 15000000000 where org_id = pg_temp.fx('org');
select pg_temp.as_service();
insert into r select 'held', public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-fen'), 'big.mov', '', 6000000000, null, null, null);
insert into fx select 'f_held', (v ->> 'file_id')::uuid from r where key = 'held';
select is((select v ->> 'result' from r where key = 'held'), 'held', 'a file that would leave less than 10 GB free is held (Q11)');
select ok((select state = 'held' and session_uri_encrypted is null from public.upload_files where id = pg_temp.fx('f_held')),
  'held: no session');
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-fen'), 'bigger.mov', '', 7000000000, null, null, null) ->> 'result',
  'held', 'a second big file is held too');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'upload_space_held'), 1::bigint, 'the Owner is told once per link per IST day');
select is(pg_temp.kind_total('upload_space_held'), 1::bigint, 'and nobody else');
select is((select title || ' | ' || body from public.notifications where recipient_id = pg_temp.fx('owner') and kind = 'upload_space_held'),
  'Studio Drive too full for an upload | A 6.0 GB file for Brand reel 146 is waiting for space', 'the wording has no studio numbers but the file''s size');
select is(pg_temp.code($$ select public.upload_file_done(pg_temp.fx('f_held'), 'drive-held', 6000000000, null, 'parent-146', null) $$),
  'INVALID_STATE', 'a held file never started: no done');
-- Bytes still to come on open sessions count against the space.
update public.drive_account set quota_used_bytes = quota_total_bytes - 30000000000 where org_id = pg_temp.fx('org');
select pg_temp.as_service();
insert into fx select 'f_open', pg_temp.start('tok-1', 'dev-fen', 'open.mov', '', 12000000000, 'sealed-open');
select pg_temp.as_system();
update public.drive_account set quota_used_bytes = quota_total_bytes - 25000000000 where org_id = pg_temp.fx('org');
select pg_temp.as_service();
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-fen'), 'big.mov', '', 6000000000, null, null, null) ->> 'result',
  'held', '25 GB free less 10 GB and 12 GB still to come: a 6 GB file stays held');
select pg_temp.as_system();
update public.drive_account set quota_used_bytes = quota_total_bytes - 29900000000 where org_id = pg_temp.fx('org');
select pg_temp.as_service();
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-fen'), 'big.mov', '', 6000000000, null, null, null) ->> 'result',
  'held', 'S7: 29.9 GB free counts as 20 GB (10 GB steps), so the 6 GB file is still held (29.9 - 10 - 13 would fit)');
select pg_temp.as_system();
update public.drive_account set quota_used_bytes = 1000000000000 where org_id = pg_temp.fx('org');
select pg_temp.as_service();
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-fen'), 'big.mov', '', 6000000000, null, null, null) ->> 'file_id',
  pg_temp.fx('f_held')::text, 'space freed: the held file starts on its own row');
select is((pg_temp.file('f_held')).state, 'uploading', 'and is uploading');
-- Google's daily limit pauses the link (Q10).
select ok(public.upload_daily_limit_hit(pg_temp.fx('l1'), now()) <= now() + interval '15 minutes',
  'the first refusal pauses for 15 minutes (never past IST midnight)');
select is((pg_temp.link('l1')).pause_step, 1::smallint, 'pause step 1');
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-fen'), 'later.mov', '', 1, null, null, null) ->> 'reason',
  'daily_limit', 'a new file waits while paused');
select is(public.upload_resolve(pg_temp.h('tok-1'), null) ->> 'can_start', 'paused', 'the page shows the pause (screen O)');
select ok(public.upload_daily_limit_hit(pg_temp.fx('l1'), now()) <= now() + interval '1 hour',
  'a second refusal the same IST day: an hour');
select is((pg_temp.link('l1')).pause_step, 2::smallint, 'pause step 2');
select is(pg_temp.entries('upload_links', 'paused', pg_temp.fx('l1')), 2::bigint, 'each pause is a history row');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'upload_daily_limit') + pg_temp.notes('adm_c', 'upload_daily_limit') + pg_temp.notes('adm_a', 'upload_daily_limit'),
  3::bigint, 'the Owner and the task''s Admins are told once per link per IST day');
select pg_temp.as_service();
select public.upload_session_set(pg_temp.fx('f_held'), 'sub-146', 'parent-146', 'sealed-held');
select ok((pg_temp.link('l1')).paused_until is null and (pg_temp.link('l1')).pause_step = 0,
  'the first file Google accepts ends the pause');
-- The Drive needs reconnecting: nothing starts.
select pg_temp.as_system();
update public.drive_account set state = 'needs_reconnect' where org_id = pg_temp.fx('org');
select pg_temp.as_service();
select is(public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-fen'), 'later.mov', '', 1, null, null, null) ->> 'reason',
  'drive_unavailable', 'the Drive needs reconnecting: the file waits (screen R)');
select pg_temp.as_system();
update public.drive_account set state = 'connected' where org_id = pg_temp.fx('org');

-- =====================================================================================================
-- 7. I'm done, the watch, stuck and looks finished (WORKFLOWS §5B.4, §8)
-- =====================================================================================================
select pg_temp.as_service();
select public.upload_said_done(pg_temp.h('tok-1'), pg_temp.h('dev-sam'));
select pg_temp.as_system();
select ok((pg_temp.uploader('u_sam')).said_done_at is not null, 'I''m done is recorded');
select is((select title || ' | ' || body from public.notifications where recipient_id = pg_temp.fx('adm_c') and kind = 'upload_said_done'),
  'Sam finished: 2 files, 1.0 GB | Brand reel 146 · open the folder', 'the task''s Admins are told, with the count and size');
select pg_temp.as_service();
select public.upload_said_done(pg_temp.h('tok-1'), pg_temp.h('dev-sam'));
select pg_temp.as_system();
select is(pg_temp.notes('adm_a', 'upload_said_done'), 1::bigint, 'a second tap straight away tells nobody');
select is(pg_temp.entries('upload_uploaders', 'said_done', pg_temp.fx('u_sam')), 1::bigint, 'and writes no history');
-- No file received since the last "I'm done": refused even after 10 minutes.
update public.upload_files set done_at = now() - interval '12 minutes' where uploader_id = pg_temp.fx('u_sam');
update public.upload_uploaders set said_done_at = now() - interval '11 minutes' where id = pg_temp.fx('u_sam');
select pg_temp.as_service();
select public.upload_said_done(pg_temp.h('tok-1'), pg_temp.h('dev-sam'));
select pg_temp.as_system();
select ok(pg_temp.notes('adm_a', 'upload_said_done') = 1 and (pg_temp.uploader('u_sam')).said_done_at = now() - interval '11 minutes',
  'no file received since the last I''m done: nothing written, nobody told');
-- A new file, but within 10 minutes of the last one: refused.
update public.upload_uploaders set said_done_at = now() - interval '5 minutes' where id = pg_temp.fx('u_sam');
select pg_temp.as_service();
insert into fx select 'f_extra', pg_temp.start('tok-1', 'dev-sam', 'extra.jpg', '', 3000000, 'sealed-extra');
select public.upload_file_done(pg_temp.fx('f_extra'), 'drive-extra', 3000000, null, 'parent-146', null);
select public.upload_said_done(pg_temp.h('tok-1'), pg_temp.h('dev-sam'));
select pg_temp.as_system();
select is(pg_temp.notes('adm_a', 'upload_said_done'), 1::bigint, 'a new file but within 10 minutes of the last I''m done: nobody told');
-- A new file and more than 10 minutes: told again.
update public.upload_uploaders set said_done_at = now() - interval '11 minutes' where id = pg_temp.fx('u_sam');
select pg_temp.as_service();
select public.upload_said_done(pg_temp.h('tok-1'), pg_temp.h('dev-sam'));
select pg_temp.as_system();
select is(pg_temp.notes('adm_a', 'upload_said_done'), 2::bigint, 'a file received since, and 10 minutes on: told again');
select is(pg_temp.entries('upload_uploaders', 'said_done', pg_temp.fx('u_sam')), 2::bigint, 'each counted one is a history row');
create temporary table sam_done as select said_done_at from public.upload_uploaders where id = pg_temp.fx('u_sam');
select pg_temp.as_service();
select public.upload_said_done(pg_temp.h('tok-1'), pg_temp.h('dev-jo'));
select pg_temp.as_system();
select ok((pg_temp.uploader('u_jo')).said_done_at is null
          and (pg_temp.uploader('u_sam')).said_done_at = (select said_done_at from sam_done),
  'I''m done from another device on the link never touches Sam (and Jo, with nothing received yet, is not counted)');
select pg_temp.as_service();
select is(pg_temp.code($$ select public.upload_said_done(pg_temp.h('tok-1'), pg_temp.h('dev-unknown')) $$), 'NOT_FOUND',
  'an unknown device: NOT_FOUND');

-- The watch and the offsets.
select pg_temp.as_member('adm_c');
insert into fx select 'l10', public.upload_link_create(pg_temp.fx('t10'));
select pg_temp.as_service();
select public.upload_link_seal(pg_temp.fx('l10'), pg_temp.h('tok-10'));
insert into fx select 'u_rin', (public.upload_register(pg_temp.h('tok-10'), pg_temp.h('dev-rin'), 'Rin', null, null) ->> 'uploader_id')::uuid;
insert into fx select 'u_kai', (public.upload_register(pg_temp.h('tok-10'), pg_temp.h('dev-kai'), 'Kai', null, null) ->> 'uploader_id')::uuid;
insert into fx select 'u_lee', (public.upload_register(pg_temp.h('tok-10'), pg_temp.h('dev-lee'), 'Lee', null, null) ->> 'uploader_id')::uuid;
insert into fx select 'f_rin', pg_temp.start('tok-10', 'dev-rin', 'long.mov', '', 5000000000, 'sealed-rin');
insert into fx select 'f_kai', pg_temp.start('tok-10', 'dev-kai', 'kai.mov', '', 3000000000, 'sealed-kai');
select public.upload_file_done(pg_temp.fx('f_kai'), 'drive-kai', 3000000000, null, 'parent-146', null);
insert into fx select 'f_lee', pg_temp.start('tok-10', 'dev-lee', 'lee.mov', '', 1000000000, 'sealed-lee');
select public.upload_file_done(pg_temp.fx('f_lee'), 'drive-lee', 1000000000, null, 'parent-146', null);
select pg_temp.as_system();
set local session_replication_role = replica; -- keep the backdated updated_at (no set_updated_at)
update public.upload_files set updated_at = now() - interval '20 minutes', last_moved_at = now() - interval '20 minutes',
  session_opened_at = now() - interval '30 minutes' where id = pg_temp.fx('f_rin');
set local session_replication_role = origin;
update public.upload_files set done_at = now() - interval '11 minutes', last_moved_at = now() - interval '11 minutes',
  created_at = now() - interval '12 minutes' where id in (pg_temp.fx('f_kai'), pg_temp.fx('f_lee'));
update public.upload_uploaders set last_activity_at = now() - interval '11 minutes' where id in (pg_temp.fx('u_kai'), pg_temp.fx('u_lee'));
update public.upload_uploaders set said_done_at = now() - interval '10 minutes 30 seconds' where id = pg_temp.fx('u_lee');
select pg_temp.as_service();
select ok(exists (select 1 from public.upload_watch_due(now()) w where w.file_id = pg_temp.fx('f_rin') and w.session_uri_encrypted = 'sealed-rin'),
  'the watch lists an uploading file quiet for 2 minutes or more, with its sealed session');
select ok(not exists (select 1 from public.upload_watch_due(now()) w where w.file_id = pg_temp.fx('f1')),
  'not a received file');
select is(public.upload_signals(now()), jsonb_build_object('stuck', 1, 'looks_finished', 1),
  'one stuck uploader and one that looks finished (the other said I''m done after the last file)');
select is(public.upload_signals(now()), jsonb_build_object('stuck', 0, 'looks_finished', 0), 'each once');
select pg_temp.as_system();
select is(pg_temp.notes('adm_c', 'upload_stuck') + pg_temp.notes('adm_a', 'upload_stuck'), 2::bigint,
  'stuck tells the creator and the approving Admin');
select is((select title || ' | ' || body from public.notifications where recipient_id = pg_temp.fx('adm_c') and kind = 'upload_stuck'),
  'Upload stuck: Rin, Signals 146 | No progress for 15 min · 0 of 1 files', 'the stuck wording names the uploader only (no number, Q3)');
select is((select title from public.notifications where recipient_id = pg_temp.fx('adm_c') and kind = 'upload_looks_finished'),
  'Uploads look finished: Kai, 1 file, 3.0 GB', 'looks finished names the uploader, files and size');
select is(pg_temp.notes('adm_c', 'upload_looks_finished'), 1::bigint, 'Lee, who said I''m done after the last file, is not signalled');
select is(pg_temp.entries('upload_uploaders', 'stuck_signalled', pg_temp.fx('u_rin')), 1::bigint, 'history: stuck_signalled');
select is(pg_temp.entries('upload_uploaders', 'looks_finished_signalled', pg_temp.fx('u_kai')), 1::bigint, 'history: looks_finished_signalled');
select pg_temp.as_member('adm_c');
select ok((select (u ->> 'stuck_since') is not null from jsonb_array_elements(public.upload_card(pg_temp.fx('t10')) -> 'uploaders') u
           where u ->> 'name' = 'Rin'), 'the card shows Rin stuck');
select ok((select (u ->> 'looks_finished')::boolean from jsonb_array_elements(public.upload_card(pg_temp.fx('t10')) -> 'uploaders') u
           where u ->> 'name' = 'Kai'), 'and Kai looking finished');
select pg_temp.as_service();
select is(public.upload_record_offset(pg_temp.fx('f_rin'), 0, now()), false, 'the same offset: nothing moved');
select is(public.upload_record_offset(pg_temp.fx('f_rin'), 1000, now()), true, 'Google reports new bytes');
select is((pg_temp.file('f_rin')).last_moved_at, now(), 'last_moved_at follows Google');
select is(pg_temp.code($$ select public.upload_record_offset(pg_temp.fx('f_rin'), 6000000000, now()) $$), 'VALIDATION',
  'an offset past the size: VALIDATION');
select is(public.upload_record_offset(pg_temp.fx('f_kai'), 10, now()), false, 'a received file takes no offset');
select ok((public.upload_signals(now() + interval '20 minutes') ->> 'stuck')::integer >= 1, 'the watch runs again later');
select pg_temp.as_system();
select is((select count(*) from public.notifications where recipient_id = pg_temp.fx('adm_c') and kind = 'upload_stuck'
           and entity_id = pg_temp.fx('t10')), 2::bigint, 'a new stall after bytes moved tells again');

-- =====================================================================================================
-- 8. Stop, after_stop, renew (WORKFLOWS §5B.1, Q8, Q9)
-- =====================================================================================================
select pg_temp.as_service();
insert into fx select 'f3', pg_temp.start('tok-1', 'dev-jo', 'on-its-way.mov', '', 4000, 'sealed-f3');
select pg_temp.as_member('adm_a');
select is(pg_temp.code($$ select public.upload_link_stop(pg_temp.fx('l1')) $$), 'ok', 'the approving Admin stops the link');
select is(pg_temp.code($$ select public.upload_link_stop(pg_temp.fx('l1')) $$), 'INVALID_STATE', 'stopping it again: INVALID_STATE');
select is(pg_temp.code($$ select public.upload_link_secret(pg_temp.fx('l1'), true) $$), 'INVALID_STATE', 'a stopped link cannot be copied');
select pg_temp.as_system();
select ok((select stop_reason = 'stopped' and stopped_by = pg_temp.fx('adm_a') from public.upload_links where id = pg_temp.fx('l1')),
  'stop_reason stopped, by the approving Admin');
select is((select meta from public.activity_log where entity = 'upload_links' and entity_id = pg_temp.fx('l1') and action = 'stopped'),
  jsonb_build_object('task_id', pg_temp.fx('t1'), 'stop_reason', 'stopped'), 'history: stopped, with why');
select pg_temp.as_service();
select is(public.upload_resolve(pg_temp.h('tok-1'), pg_temp.h('dev-sam')), null, 'a stopped link resolves to nothing (one answer)');
select is(pg_temp.code($$ select public.upload_register(pg_temp.h('tok-1'), pg_temp.h('dev-new2'), 'New', null, null) $$), 'NOT_FOUND',
  'nobody new registers');
select is(pg_temp.code($$ select public.upload_file_start(pg_temp.h('tok-1'), pg_temp.h('dev-jo'), 'new.mov', '', 1, null, null, null) $$),
  'NOT_FOUND', 'no new file starts');
select is(pg_temp.code($$ select public.upload_said_done(pg_temp.h('tok-1'), pg_temp.h('dev-sam')) $$), 'NOT_FOUND', 'I''m done is refused');
-- The space guard counts only files really on their way, on live links (advisor review): Rin's 5 GB
-- moving on t10's link counts; the 6 GB and 12 GB still uploading on t1's stopped link do not.
select pg_temp.as_system();
update public.drive_account set quota_used_bytes = quota_total_bytes - 20000000000 where org_id = pg_temp.fx('org');
select pg_temp.as_service();
select is(public.upload_file_start(pg_temp.h('tok-11'), pg_temp.h('dev-11'), 'nine.mov', '', 9000000000, null, null, null) ->> 'result',
  'held', 'a file moving on a live link counts against the space (20 - 10 - 5 < 9)');
select is(public.upload_file_start(pg_temp.h('tok-11'), pg_temp.h('dev-11'), 'four.mov', '', 4000000000, null, null, null) ->> 'result',
  'start', 'files uploading on a stopped link do not count (20 - 10 - 5 >= 4; with them it would be held)');
select pg_temp.as_system();
update public.upload_files set last_moved_at = now() - interval '20 minutes' where id = pg_temp.fx('f_rin');
select pg_temp.as_service();
select is(public.upload_file_start(pg_temp.h('tok-11'), pg_temp.h('dev-11'), 'six.mov', '', 6000000000, null, null, null) ->> 'result',
  'start', 'a stalled file (no bytes for 15 minutes) no longer holds another link''s start (20 - 10 - 4 >= 6; with it, held)');
select pg_temp.as_system();
update public.upload_files set last_moved_at = now() where id = pg_temp.fx('f_rin');
update public.upload_files set state = 'failed', failed_reason = 'gave_up' where uploader_id = pg_temp.fx('u_11');
update public.drive_account set quota_used_bytes = 1000000000000 where org_id = pg_temp.fx('org');
select pg_temp.as_system();
set local session_replication_role = replica; -- keep the backdated updated_at (no set_updated_at)
update public.upload_files set updated_at = now() - interval '10 seconds' where id = pg_temp.fx('f3');
set local session_replication_role = origin;
select pg_temp.as_service();
select is(public.upload_progress(pg_temp.h('tok-1'), pg_temp.h('dev-jo'), pg_temp.fx('f3'), 2000), true,
  'a file already on its way still reports progress');
select is(public.upload_file_done(pg_temp.fx('f3'), 'drive-f3', 4000, null, 'parent-146', null), 'done', 'and finishes');
select ok((pg_temp.file('f3')).after_stop, 'marked "arrived after the link stopped" (Q8)');
select is(public.upload_file_done(pg_temp.fx('f_open'), 'drive-open', 12000000000, null, 'parent-146', null), 'done',
  'any file uploading at the stop may finish');
select is(public.upload_signals(now() + interval '1 hour') ->> 'stuck', '0', 'a stall after the link stopped tells nobody');
select pg_temp.as_member('adm_c');
select is(public.upload_card(pg_temp.fx('t1')) ->> 'state', 'stopped', 'the card is closed');
select is(public.upload_card(pg_temp.fx('t1')) -> 'link' ->> 'stopped_by_name', 'Abe Approver', 'closed by the approving Admin');
select is(pg_temp.code($$ insert into fx select 'l1b', public.upload_link_renew(pg_temp.fx('t1')) $$), 'ok', 'Make a new link from the closed card');
select pg_temp.as_system();
select is((pg_temp.link('l1b')).renewed_from_id, pg_temp.fx('l1'), 'the new link replaces the stopped one');
select pg_temp.as_member('owner');
insert into fx select 'l1c', public.upload_link_renew(pg_temp.fx('t1'));
select pg_temp.as_system();
select ok((pg_temp.link('l1b')).stop_reason = 'renewed' and (pg_temp.link('l1c')).renewed_from_id = pg_temp.fx('l1b')
          and (pg_temp.link('l1c')).stopped_at is null, 'Make a new link on an active one stops it (renewed) and replaces it');
select is((select count(*) from public.upload_links where task_id = pg_temp.fx('t1') and stopped_at is null), 1::bigint, 'still one active link');
select is((select meta from public.activity_log where entity = 'upload_links' and entity_id = pg_temp.fx('l1c') and action = 'renewed'),
  jsonb_build_object('task_id', pg_temp.fx('t1'), 'from', pg_temp.fx('l1b'), 'to', pg_temp.fx('l1c')), 'history: renewed, from and to');
select pg_temp.as_member('adm_c');
select is((select count(*) from jsonb_array_elements(public.upload_card(pg_temp.fx('t1')) -> 'uploaders') u where (u ->> 'current_link')::boolean),
  0::bigint, 'the new link''s card starts with nobody; earlier uploaders stay listed');

-- =====================================================================================================
-- 9. All files received (WORKFLOWS §5B.5): every path
-- =====================================================================================================
-- A Crew primary owner: the caller cannot mark Done, so the primary is told (even when asked to mark Done).
select is(public.upload_files_received(pg_temp.fx('l1c'), true, null), 'primary_told', 'the creator Admin, Crew primary: primary_told');
select pg_temp.as_system();
select ok((select stop_reason = 'files_received' and files_received_by = pg_temp.fx('adm_c') and files_received_at is not null
           from public.upload_links where id = pg_temp.fx('l1c')), 'the link stops, closed by the caller');
select is((pg_temp.task('t1')).state, 'todo', 'the task is not marked Done (invariant 6)');
select is(pg_temp.notes('crew', 'upload_files_received'), 1::bigint, 'the Crew primary owner is told "mark it done"');
select is((select title from public.notifications where recipient_id = pg_temp.fx('crew') and kind = 'upload_files_received'),
  'Files received for Brand reel 146: mark it done', 'the wording');
select is(pg_temp.notes('adm_c', 'upload_files_received'), 0::bigint, 'never the actor');
select is((select meta ->> 'path' from public.activity_log where entity = 'upload_links' and entity_id = pg_temp.fx('l1c') and action = 'files_received'),
  'primary_told', 'history: files_received, the path taken');
select pg_temp.as_member('adm_c');
select is(pg_temp.code($$ select public.upload_files_received(pg_temp.fx('l1c'), false, null) $$), 'INVALID_STATE', 'a stopped link: INVALID_STATE');
-- A freelancer primary owner with a Crew coordinator: the coordinator is told.
insert into fx select 'l3', public.upload_link_create(pg_temp.fx('t3'));
select is((public.upload_card(pg_temp.fx('t3')) -> 'link' ->> 'sealed')::boolean, false,
  'a link never sealed shows as not sealed (the card offers Make a new link)');
select is(public.upload_files_received(pg_temp.fx('l3'), false, null), 'primary_told', 'a Crew-coordinated freelancer: primary_told');
select pg_temp.as_system();
select is((select title from public.notifications where recipient_id = pg_temp.fx('crew_k') and kind = 'upload_files_received'),
  'Files received for Crew coordinated 146: mark it done · for Fay Free', 'the freelancer''s goes to their coordinator, worded for them');
-- The coordinator of a freelancer primary owner marks Done; past the due time the late reason is needed.
select pg_temp.as_member('adm_k');
insert into fx select 'l2', public.upload_link_create(pg_temp.fx('t2'));
select is(pg_temp.code($$ select public.upload_files_received(pg_temp.fx('l2'), true, null) $$), 'REASON_REQUIRED',
  'past the due time without a late reason: REASON_REQUIRED');
select pg_temp.as_system();
select ok((pg_temp.link('l2')).stopped_at is null, 'and nothing changed (one transaction)');
select pg_temp.as_member('adm_k');
select is(public.upload_files_received(pg_temp.fx('l2'), true, 'The shoot ran over'), 'marked_done', 'with the reason: marked_done');
select pg_temp.as_system();
select ok((select state = 'admin_approved' and submitted_on_behalf_of = pg_temp.fx('free') and late_reason = 'The shoot ran over'
           from public.tasks where id = pg_temp.fx('t2')), 'Done through task_submit_done on behalf of the freelancer, routed as usual');
select is((pg_temp.link('l2')).stop_reason, 'files_received', 'the link''s stop reason stays files_received');
select is(pg_temp.notes('owner', 'task_submitted'), 1::bigint, 'the Owner is told as any Done (no Admin step)');
select is((select meta ->> 'path' from public.activity_log where entity = 'upload_links' and entity_id = pg_temp.fx('l2') and action = 'files_received'),
  'marked_done', 'history: the path taken');
-- The primary owner themselves (an Admin's own task).
select pg_temp.as_member('adm_a');
insert into fx select 'l4', public.upload_link_create(pg_temp.fx('t4'));
select is(public.upload_files_received(pg_temp.fx('l4'), true, null), 'marked_done', 'the primary owner (an Admin) marks Done too');
select pg_temp.as_system();
select is((pg_temp.task('t4')).state, 'admin_approved'::public.task_state, 'routed to the Owner as usual');
-- Without mark_done the primary is "told", but never the actor.
select pg_temp.as_member('adm_c');
insert into fx select 'l9b', public.upload_link_renew(pg_temp.fx('t9'));
select is(public.upload_files_received(pg_temp.fx('l9b'), false, null), 'primary_told', 'mark_done false: primary_told');

-- =====================================================================================================
-- 10. Done and Cancel stop the link; a send-back never revives it (Q9)
-- =====================================================================================================
insert into fx select 'l5', public.upload_link_create(pg_temp.fx('t5'));
select is(public.task_cancel(pg_temp.fx('t5'), 'Not needed'), 'cancelled'::public.task_state, 'the creator cancels the task');
select pg_temp.as_system();
select ok((select stop_reason = 'task_cancelled' and stopped_by = pg_temp.fx('adm_c') from public.upload_links where id = pg_temp.fx('l5')),
  'Cancel stops the link in the same transaction');
select pg_temp.as_member('adm_c');
insert into fx select 'l6', public.upload_link_create(pg_temp.fx('t6'));
select pg_temp.as_service();
select public.upload_link_seal(pg_temp.fx('l6'), pg_temp.h('tok-6'));
select ok(public.upload_resolve(pg_temp.h('tok-6'), null) is not null, 'the link works before Done');
select pg_temp.as_member('crew');
select is(public.task_submit_done(pg_temp.fx('t6')), 'submitted'::public.task_state, 'the Crew primary marks Done');
select pg_temp.as_system();
select ok((select stop_reason = 'task_done' and stopped_by = pg_temp.fx('crew') from public.upload_links where id = pg_temp.fx('l6')),
  'Done stops the link (stopped_by the primary owner)');
select pg_temp.as_service();
select is(public.upload_resolve(pg_temp.h('tok-6'), null), null, 'and it answers nothing any more');
select pg_temp.as_member('adm_a');
select is(public.task_review(pg_temp.fx('t6'), 'rejected', 'Again please'), 'changes_requested'::public.task_state,
  'the approving Admin sends it back');
select pg_temp.as_system();
select is((select count(*) from public.upload_links where task_id = pg_temp.fx('t6') and stopped_at is null), 0::bigint,
  'the send-back does not revive the link (Q9)');
select pg_temp.as_service();
select is(public.upload_resolve(pg_temp.h('tok-6'), null), null, 'the old link stays dead');
select pg_temp.as_member('adm_c');
insert into fx select 'l13', public.upload_link_create(pg_temp.fx('t13'));
insert into fx select 'l14', public.upload_link_create(pg_temp.fx('t14'));
select pg_temp.as_member('adm_a');
select is(public.task_cancel(pg_temp.fx('t13'), 'Not needed'), 'cancelled'::public.task_state, 'the approving Admin cancels');
select pg_temp.as_member('owner');
select is(public.task_cancel(pg_temp.fx('t14'), 'Not needed'), 'cancelled'::public.task_state, 'the Owner cancels');
select pg_temp.as_system();
select ok((pg_temp.link('l13')).stop_reason = 'task_cancelled' and (pg_temp.link('l13')).stopped_by = pg_temp.fx('adm_a')
          and (pg_temp.link('l14')).stop_reason = 'task_cancelled' and (pg_temp.link('l14')).stopped_by = pg_temp.fx('owner'),
  'either Cancel stops the link, stopped_by the one who cancelled');
select pg_temp.as_service();
select is(public.upload_link_seal(pg_temp.fx('l14'), pg_temp.h('tok-14')), false, 'a stopped link cannot be sealed');
select pg_temp.as_member('owner');
insert into fx select 'l7', public.upload_link_create(pg_temp.fx('t7'));
select is(public.task_submit_done(pg_temp.fx('t7')), 'completed'::public.task_state, 'the Owner''s own task completes on Done');
select pg_temp.as_system();
select is((pg_temp.link('l7')).stop_reason, 'task_done', 'the Owner primary''s straight completion stops the link too');
select pg_temp.as_member('owner');
select is(public.task_reopen(pg_temp.fx('t7'), 'One more pass'), 'in_progress'::public.task_state, 'the Owner reopens it');
select pg_temp.as_system();
select is((select count(*) from public.upload_links where task_id = pg_temp.fx('t7') and stopped_at is null), 0::bigint,
  'a reopen does not revive the link (Q9)');
-- An archived task with a link still marked active: the link answers nothing.
select pg_temp.as_member('adm_c');
insert into fx select 'l12', public.upload_link_create(pg_temp.fx('t12'));
select pg_temp.as_service();
select public.upload_link_seal(pg_temp.fx('l12'), pg_temp.h('tok-12'));
select public.upload_register(pg_temp.h('tok-12'), pg_temp.h('dev-12'), 'Bo', null, null);
select pg_temp.as_system();
update public.tasks set archived_at = now() where id = pg_temp.fx('t12');
select pg_temp.as_service();
select is(public.upload_resolve(pg_temp.h('tok-12'), pg_temp.h('dev-12')), null, 'an archived task''s link resolves to nothing');
select is(pg_temp.code($$ select public.upload_register(pg_temp.h('tok-12'), pg_temp.h('dev-12b'), 'Cy', null, null) $$), 'NOT_FOUND',
  'register: NOT_FOUND');
select is(pg_temp.code($$ select public.upload_file_start(pg_temp.h('tok-12'), pg_temp.h('dev-12'), 'a.mov', '', 1, null, null, null) $$),
  'NOT_FOUND', 'file start: NOT_FOUND');

-- =====================================================================================================
-- 11. "Removed in Drive" (Q7): the claim, the daily pass, the answer
-- =====================================================================================================
select pg_temp.as_service();
select is((select array_agg(c.file_id order by c.file_id) from public.upload_drive_check_claim(pg_temp.fx('u_sam'), array[pg_temp.fx('f1'), pg_temp.fx('f_rin')], now()) c),
  array[pg_temp.fx('f1')], 'the sheet''s claim returns its received files only');
select is((select count(*) from public.upload_drive_check_claim(pg_temp.fx('u_sam'), array[pg_temp.fx('f1')], now() + interval '5 minutes')), 0::bigint,
  'a second claim within 10 minutes reads Drive no more');
select is((select count(*) from public.upload_drive_check_claim(pg_temp.fx('u_jo'), array[pg_temp.fx('f1')], now() + interval '11 minutes')), 0::bigint,
  'the claim is scoped to the uploader whose sheet is open: another uploader''s file is not taken');
select is((select count(*) from public.upload_drive_check_claim(pg_temp.fx('u_sam'), array[pg_temp.fx('f1')], now() + interval '11 minutes')), 1::bigint,
  'after 10 minutes it may');
select ok(exists (select 1 from public.upload_drive_check_daily(now() + interval '30 minutes', 500) d where d.file_id = pg_temp.fx('f2')),
  'the daily pass takes the received files of active links');
select is(public.upload_drive_seen(pg_temp.fx('f1'), 'trashed', now()), 'missing_in_drive', 'a file in the Drive bin is removed in Drive');
select ok((select state = 'missing_in_drive' and missing_seen_at = now() and drive_file_id = 'drive-f1' from public.upload_files where id = pg_temp.fx('f1')),
  'the row stays, with missing_seen_at');
select is(public.upload_drive_seen(pg_temp.fx('f1'), 'not_found', now()), 'missing_in_drive', 'seen again: unchanged');
select is(public.upload_drive_seen(pg_temp.fx('f2'), 'not_found', now()), 'missing_in_drive', 'a file Google no longer has too');
select is(pg_temp.code($$ select public.upload_drive_seen(pg_temp.fx('f2'), 'error', now()) $$), 'VALIDATION',
  'any other answer is not recorded');
select pg_temp.as_system();
select is(pg_temp.entries('upload_files', 'missing_in_drive', pg_temp.fx('f1')), 1::bigint, 'one history row');
select ok((select actor_id is null and meta ->> 'seen' = 'trashed' and meta ->> 'drive_file_id' = 'drive-f1'
           from public.activity_log where entity = 'upload_files' and entity_id = pg_temp.fx('f1') and action = 'missing_in_drive'),
  'no actor; meta: name, Drive id, seen');
select is((select count(*) from public.notifications where body like '%drive-f1%' or title ilike '%removed%'), 0::bigint,
  'nobody is told about a removal, and no notice carries a Drive id');
select pg_temp.as_member('adm_c');
select is((select f ->> 'state' from jsonb_array_elements(public.upload_uploader_files(pg_temp.fx('u_sam')) -> 'files') f
           where f ->> 'name' = 'clip1.mp4'), 'missing_in_drive', 'the sheet shows Removed in Drive');
select pg_temp.as_service();
select ok(exists (select 1 from public.upload_drive_check_daily(now() + interval '1 hour', 500) d
                  where d.file_id = pg_temp.fx('f1') and d.state = 'missing_in_drive'),
  'the daily pass re-checks a file marked removed in the last 30 days');
select is(public.upload_drive_seen(pg_temp.fx('f1'), 'present', now()), 'done', 'restored from the bin: received again');
select pg_temp.as_system();
select ok((pg_temp.file('f1')).missing_seen_at is not null, 'missing_seen_at kept for the record');
select is(pg_temp.entries('upload_files', 'back_in_drive', pg_temp.fx('f1')), 1::bigint, 'history: back_in_drive');
update public.drive_account set google_sub = 'sub-other' where org_id = pg_temp.fx('org');
select pg_temp.as_service();
select is((select count(*) from public.upload_drive_check_claim(pg_temp.fx('u_sam'), array[pg_temp.fx('f1'), pg_temp.fx('f3')], now() + interval '2 hours')), 0::bigint,
  'after an account switch the old account''s files are not checked');
select pg_temp.as_system();
update public.drive_account set google_sub = 'sub-146' where org_id = pg_temp.fx('org');
-- Removed in Drive is not "already sent": the uploader may send it again (on a live link).
select pg_temp.as_member('owner');
insert into fx select 'l10b', public.upload_link_renew(pg_temp.fx('t10'));
select pg_temp.as_service();
select public.upload_link_seal(pg_temp.fx('l10b'), pg_temp.h('tok-10b'));
insert into fx select 'u_kai2', (public.upload_register(pg_temp.h('tok-10b'), pg_temp.h('dev-kai'), 'Kai', null, null) ->> 'uploader_id')::uuid;
select is((pg_temp.uploader('u_kai2')).folder_name, 'Kai (2)', 'the same name on a new link of the task gets its own folder');
insert into fx select 'f_kai2', pg_temp.start('tok-10b', 'dev-kai', 'gone.mov', '', 1000, 'sealed-kai2');
select public.upload_file_done(pg_temp.fx('f_kai2'), 'drive-kai2', 1000, null, 'parent-146', null);
select public.upload_drive_seen(pg_temp.fx('f_kai2'), 'not_found', now());
select is(public.upload_resolve(pg_temp.h('tok-10b'), pg_temp.h('dev-kai')) -> 'uploader' -> 'files' -> 0 ->> 'state', 'done',
  'the uploader sees a file removed in Drive as sent (missing_in_drive is for the studio only)');
select is(public.upload_file_start(pg_temp.h('tok-10b'), pg_temp.h('dev-kai'), 'gone.mov', '', 1000, null, null, null) ->> 'result', 'start',
  'and may send it again (it is not "already sent")');

-- =====================================================================================================
-- 12. Erasure: by the Owner (plan I4) and after 90 days (I3); nothing secret in history (G2)
-- =====================================================================================================
select pg_temp.as_member('owner');
select is(public.upload_uploader_erase_network(pg_temp.fx('u_sam')), true, 'the Owner erases Sam''s network details');
select is(public.upload_uploader_erase_network(pg_temp.fx('u_sam')), false, 'again: nothing left to erase');
select pg_temp.as_system();
select ok((select ip is null and user_agent is null and device_label is null and device_key_hash is null and network_erased_at is not null
           from public.upload_uploaders where id = pg_temp.fx('u_sam')), 'the uploader''s IP, browser, device and key are gone');
select is((select count(*) from public.upload_files where uploader_id = pg_temp.fx('u_sam') and (ip is not null or user_agent is not null)),
  0::bigint, 'and their files''');
select ok((select name = 'Sam' from public.upload_uploaders where id = pg_temp.fx('u_sam'))
          and (select count(*) from public.upload_files where uploader_id = pg_temp.fx('u_sam')) = 3,
  'the name and the files stay (the studio''s record)');
select is((select meta from public.activity_log where entity = 'upload_uploaders' and entity_id = pg_temp.fx('u_sam') and action = 'network_erased'),
  jsonb_build_object('task_id', pg_temp.fx('t1'), 'uploader_id', pg_temp.fx('u_sam')), 'history: network_erased, no values');
-- The 90-day erasure.
update public.upload_uploaders set created_at = now() - interval '91 days', last_activity_at = now() - interval '91 days'
  where id = pg_temp.fx('u_jo');
update public.upload_files set created_at = now() - interval '91 days' where uploader_id = pg_temp.fx('u_jo');
update public.upload_files set session_opened_at = now() - interval '9 days' where id = pg_temp.fx('f_rin');
-- S5: a start the Worker never finished, quiet for 11 minutes, no longer counts as uploading on the card.
insert into public.upload_files (org_id, uploader_id, link_id, task_id, name, size_bytes, state, account_sub)
values (pg_temp.fx('org'), pg_temp.fx('u_kai2'), pg_temp.fx('l10b'), pg_temp.fx('t10'), 'stale.mov', 5, 'uploading', 'sub-146');
insert into fx select 'f_stale', id from public.upload_files where name = 'stale.mov';
insert into public.upload_files (org_id, uploader_id, link_id, task_id, name, size_bytes, state, account_sub)
values (pg_temp.fx('org'), pg_temp.fx('u_kai2'), pg_temp.fx('l10b'), pg_temp.fx('t10'), 'ancient.mov', 5, 'uploading', 'sub-146');
insert into fx select 'f_ancient', id from public.upload_files where name = 'ancient.mov';
-- The restarted gone.mov (a new row) never got a session: out of the way.
update public.upload_files set state = 'failed', failed_reason = 'gave_up'
  where uploader_id = pg_temp.fx('u_kai2') and name = 'gone.mov' and state = 'uploading';
set local session_replication_role = replica; -- keep the backdated updated_at (no set_updated_at)
update public.upload_files set updated_at = now() - interval '11 minutes' where id = pg_temp.fx('f_stale');
update public.upload_files set updated_at = now() - interval '9 days' where id = pg_temp.fx('f_ancient');
set local session_replication_role = origin;
select pg_temp.as_member('adm_c');
select is((public.upload_card(pg_temp.fx('t10')) ->> 'uploading')::integer, 0,
  'S5: a start with no session quiet for 10 minutes does not keep the card uploading');
select is((select (u ->> 'files_uploading')::integer from jsonb_array_elements(public.upload_card(pg_temp.fx('t10')) -> 'uploaders') u
           where u ->> 'id' = pg_temp.fx('u_kai2')::text), 0, 'nor the uploader''s row');
select pg_temp.as_system();
insert into public.upload_rate_hits (bucket, key_hash, window_start, hits) values ('open', pg_temp.h('net-old'), now() - interval '2 days', 3);
create temporary table notes_before as select count(*) as n from public.notifications;
select ok((app.upload_housekeeping(now()) ->> 'uploaders')::integer >= 1, 'the daily housekeeping runs');
select ok((select ip is null and user_agent is null and device_label is null and device_key_hash is null and network_erased_at is not null
           from public.upload_uploaders where id = pg_temp.fx('u_jo')), 'an uploader of 90 days ago: network details erased');
select is((select count(*) from public.upload_files where uploader_id = pg_temp.fx('u_jo') and ip is not null), 0::bigint, 'and their files''');
select ok((select device_key_hash is not null and network_erased_at is null from public.upload_uploaders where id = pg_temp.fx('u_fen')),
  'a recent uploader keeps their device key');
select is((pg_temp.file('f_rin')).session_uri_encrypted, null, 'a session address older than 8 days is cleared');
select ok((pg_temp.file('f_rin')).state = 'failed' and (pg_temp.file('f_rin')).failed_reason = 'gave_up',
  'S5b: a file still uploading on a session older than 8 days is failed, gave_up');
select ok((pg_temp.file('f_ancient')).state = 'failed' and (pg_temp.file('f_ancient')).failed_reason = 'gave_up',
  'and one that never got a session in 8 days');
select is((pg_temp.file('f_stale')).state, 'uploading', 'a recent start is left alone');
select is(pg_temp.entries('upload_files', 'failed', pg_temp.fx('f_rin')) + pg_temp.entries('upload_files', 'failed', pg_temp.fx('f_ancient')),
  0::bigint, 'no history row, as a browser''s gave_up');
select is((select count(*) from public.notifications), (select n from notes_before), 'nobody is told');
select is((app.upload_housekeeping(now()) ->> 'gave_up')::integer, 0, 'idempotent: a second run marks nothing more');
select is((select count(*) from public.activity_log where entity = 'upload_housekeeping' and action = 'ran'
           and entity_id = pg_temp.fx('org')), 1::bigint, 'the run that changed something wrote one summary row; the idle one none');
select ok((select meta ?& array['uploaders', 'device_keys', 'files', 'gave_up', 'sessions'] and (meta ->> 'gave_up')::integer = 2
           from public.activity_log where entity = 'upload_housekeeping' and action = 'ran'), 'counts only');
select is((select count(*) from public.upload_rate_hits where key_hash = pg_temp.h('net-old')), 0::bigint, 'counters older than a day are removed');
select ok((select count(*) from cron.job where jobname = 'upload_housekeeping' and schedule = '50 21 * * *') = 1,
  'scheduled daily at 03:20 IST');
-- Nothing secret ever reached activity_log.
select is((select count(*) from public.activity_log a
           where a.entity in ('upload_links', 'upload_uploaders', 'upload_files')
             and (a.meta ?| array['ip', 'user_agent', 'device_key_hash', 'device_label', 'token', 'token_hash', 'token_salt',
                                  'session_uri_encrypted']
                  or (a.meta::text || a.diff::text) ~ '(198\.51\.100|sealed-|Mozilla|\\x)')),
  0::bigint, 'no IP, user agent, device key, token, salt or session address in any upload history row (plan G2)');

-- =====================================================================================================
-- 13. Who reads the upload history rows (DATA-MODEL §8a policy)
-- =====================================================================================================
select pg_temp.as_member('adm_c');
select ok((select count(*) from public.activity_log where entity like 'upload\_%' and meta ->> 'task_id' = pg_temp.fx('t1')::text) > 0,
  'the task''s Admin reads its upload history');
select pg_temp.as_member('owner');
select ok((select count(*) from public.activity_log where entity like 'upload\_%' and meta ->> 'task_id' = pg_temp.fx('t1')::text) > 0,
  'the Owner reads it (activity.view_all)');
select pg_temp.as_member('adm_k');
select is((select count(*) from public.activity_log where entity like 'upload\_%' and meta ->> 'task_id' = pg_temp.fx('t1')::text), 0::bigint,
  'the coordinator of a freelancer who is only an assignee reads none of it');
select ok((select count(*) from public.activity_log where entity like 'upload\_%' and meta ->> 'task_id' = pg_temp.fx('t2')::text) > 0,
  'but reads the task where their freelancer is the primary owner');
select pg_temp.as_member('adm_o');
select is((select count(*) from public.activity_log where entity like 'upload\_%'), 0::bigint, 'the client''s Admin reads none');
select pg_temp.as_member('crew');
select is((select count(*) from public.activity_log where entity like 'upload\_%'), 0::bigint, 'Crew read none, even as the primary owner');
select pg_temp.as_member('crew_k');
select is((select count(*) from public.activity_log where entity like 'upload\_%'), 0::bigint, 'a Crew coordinator reads none');

-- =====================================================================================================
-- 14. The network counters (plan C1-C2)
-- =====================================================================================================
select pg_temp.as_service();
select is((select count(*) from generate_series(1, 10) i where public.upload_rate_hit('bad_link', pg_temp.h('net-1'), now()) is null),
  10::bigint, 'ten bad links in a minute pass');
select is(public.upload_rate_hit('bad_link', pg_temp.h('net-1'), now()), now() + interval '15 minutes', 'the 11th blocks for 15 minutes');
select is(public.upload_rate_hit('bad_link', pg_temp.h('net-1'), now() + interval '5 minutes'), now() + interval '15 minutes',
  'still blocked five minutes later');
select is(public.upload_rate_hit('bad_link', pg_temp.h('net-1'), now() + interval '16 minutes'), null, 'free again after 15 minutes');
select is((select count(*) from generate_series(1, 60) i where public.upload_rate_hit('open', pg_temp.h('net-2'), now()) is null),
  60::bigint, 'sixty opens in a minute pass');
select is(public.upload_rate_hit('open', pg_temp.h('net-2'), now()), date_trunc('minute', now()) + interval '1 minute',
  'the 61st waits for the next minute');
select is(pg_temp.code($$ select public.upload_rate_hit('other', pg_temp.h('net-2'), now()) $$), 'VALIDATION', 'an unknown bucket: VALIDATION');

select * from finish();
rollback;
