-- v4.0 D1 (DATA-MODEL §8, ADR-0010, PERMISSIONS drive.manage, WORKFLOWS §9): drive_account and
-- drive_folders (no API role reads either), drive_status / drive_connect_complete /
-- drive_disconnect for each role, the Worker's service-role functions on every path (needs
-- reconnect once, quota alerts at 80 % and 90 % once each and re-armed below 80 %, the access
-- token), tokens never in activity_log, an account switch, the folder cache per account, and a
-- second organisation. Neutral names and example.com addresses only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(123);

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner',    '10000000-0000-4000-8000-000000000001'),
  ('admin',    '10000000-0000-4000-8000-000000000002'),
  ('staff',    '10000000-0000-4000-8000-000000000003'),
  ('gone',     '10000000-0000-4000-8000-000000000004'),
  ('nobody',   null),
  ('client',   '00000000-0000-4000-8000-000000014401'),
  ('org_b',    '00000000-0000-4000-8000-000000014410'),
  ('b_owner',  '00000000-0000-4000-8000-000000014411'),
  ('b_admin',  '00000000-0000-4000-8000-000000014412'),
  ('b_client', '00000000-0000-4000-8000-000000014414');
insert into fx select 'org', id from public.organizations order by created_at limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') and kind = 'normal' order by position limit 1;
grant select, insert on fx to authenticated, service_role;
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
create function pg_temp.notes(k text, p_kind text) returns bigint language sql stable as $$
  select count(*) from public.notifications n where n.recipient_id = pg_temp.fx(k) and n.kind = p_kind;
$$;
create function pg_temp.connect_sql(email text, sub text, refresh text, access text) returns text language sql immutable as $$
  select format('select public.drive_connect_complete(%L, %L, %L, %L, now() + interval ''1 hour'', '
                'array[''https://www.googleapis.com/auth/drive''], ''root-folder-a'')', email, sub, refresh, access);
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role, anon;
-- Notifications written by the jobs are read back as the system.

-- Fixtures: org A's client and task; org B with an Owner, an Admin and a client.
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Drive client 144', 'active', pg_temp.fx('admin'), now());
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id) values
  (pg_temp.fx('org'), 'Drive task 144', pg_temp.fx('type'), 'medium', now() + interval '2 days', 'todo',
   pg_temp.fx('owner'), pg_temp.fx('staff'));
insert into fx select 'task', id from public.tasks where title = 'Drive task 144';
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Drive other org 144');
insert into auth.users (id, email)
select pg_temp.fx(k), 'drive-' || k || '-144@example.com' from unnest(array['b_owner', 'b_admin']) k;
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at)
select pg_temp.fx(k), pg_temp.fx('org_b'), 'Drive ' || k || ' 144', 'drive-' || k || '-144@example.com',
       r::public.member_role, 'active', 'permanent', now() - interval '20 days'
from (values ('b_owner', 'owner'), ('b_admin', 'admin')) v(k, r);
select pg_temp.as_member('b_owner');
reset role;
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('b_client'), pg_temp.fx('org_b'), 'Drive B client 144', 'active', pg_temp.fx('b_admin'), now());
select pg_temp.as_system();

-- 1. Tables: RLS on, no API privilege, no audit trigger ---------------------------------------------
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.drive_account'::regclass), 'drive_account: RLS on');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.drive_folders'::regclass), 'drive_folders: RLS on');
select is((select count(*) from pg_policy p where p.polrelid in ('public.drive_account'::regclass, 'public.drive_folders'::regclass)),
  0::bigint, 'no policy on either table (service role only)');
select is((select count(*) from unnest(array['anon', 'authenticated']) r, unnest(array['public.drive_account', 'public.drive_folders']) t
           where has_table_privilege(r, t, 'select, insert, update, delete')),
  0::bigint, 'anon and authenticated hold no privilege on drive_account or drive_folders');
select is((select count(*) from pg_trigger g where g.tgrelid = 'public.drive_account'::regclass and not g.tgisinternal
           and g.tgname <> 'set_updated_at'),
  0::bigint, 'drive_account has no audit trigger (tokens never reach activity_log)');

-- 2. Function privileges ---------------------------------------------------------------------------------
select is((select count(*) from unnest(array[
    'public.drive_mark_needs_reconnect(uuid, text)', 'public.drive_store_access_token(uuid, text, timestamptz)',
    'public.drive_record_quota(uuid, bigint, bigint)', 'public.drive_folder_find(uuid, text, text, uuid, text, uuid)',
    'public.drive_folder_put(uuid, text, text, uuid, text, uuid, uuid, text, text)']) f,
    unnest(array['anon', 'authenticated']) r
  where has_function_privilege(r, f, 'execute')), 0::bigint, 'the Worker''s five functions: not anon, not authenticated');
select is((select count(*) from unnest(array[
    'public.drive_mark_needs_reconnect(uuid, text)', 'public.drive_store_access_token(uuid, text, timestamptz)',
    'public.drive_record_quota(uuid, bigint, bigint)', 'public.drive_folder_find(uuid, text, text, uuid, text, uuid)',
    'public.drive_folder_put(uuid, text, text, uuid, text, uuid, uuid, text, text)']) f
  where has_function_privilege('service_role', f, 'execute')), 5::bigint, 'the Worker''s five functions: service_role');
select is((select count(*) from unnest(array['public.drive_status()', 'public.drive_disconnect()',
    'public.drive_connect_complete(text, text, text, text, timestamptz, text[], text)']) f
  where has_function_privilege('anon', f, 'execute')), 0::bigint, 'the Owner''s three functions: not anon');
select is((select count(*) from unnest(array['public.drive_status()', 'public.drive_disconnect()',
    'public.drive_connect_complete(text, text, text, text, timestamptz, text[], text)']) f
  where has_function_privilege('authenticated', f, 'execute')), 3::bigint, 'the Owner''s three functions: authenticated');

-- 3. drive_status before any connection, per role ---------------------------------------------------
select pg_temp.as_member('owner');
select is(public.drive_status()->>'state', 'disconnected', 'Owner: never connected reads disconnected');
select ok(public.drive_status()->'google_email' = 'null'::jsonb, 'Owner: no address yet');
select is(pg_temp.raised('select public.drive_status()'), null, 'Owner: allowed');
select pg_temp.as_member('admin');
select is(pg_temp.raised('select public.drive_status()'), 'FORBIDDEN', 'Admin: drive_status FORBIDDEN');
select pg_temp.as_member('staff');
select is(pg_temp.raised('select public.drive_status()'), 'FORBIDDEN', 'Crew: drive_status FORBIDDEN');
select pg_temp.as_member('gone');
select is(pg_temp.raised('select public.drive_status()'), 'UNAUTHENTICATED', 'deactivated: drive_status UNAUTHENTICATED');
select pg_temp.as_member('nobody');
select is(pg_temp.raised('select public.drive_status()'), 'UNAUTHENTICATED', 'no session: drive_status UNAUTHENTICATED');
select pg_temp.as_anon();
select is(pg_temp.raised('select public.drive_status()'), 'permission denied for function drive_status', 'anon: drive_status denied');

-- 4. drive_connect_complete, refused ------------------------------------------------------------------
select pg_temp.as_member('admin');
select is(pg_temp.raised(pg_temp.connect_sql('drive-a@example.com', 'sub-a', 'enc-refresh-a1', 'enc-access-a1')), 'FORBIDDEN', 'Admin: connect FORBIDDEN');
select pg_temp.as_member('staff');
select is(pg_temp.raised(pg_temp.connect_sql('drive-a@example.com', 'sub-a', 'enc-refresh-a1', 'enc-access-a1')), 'FORBIDDEN', 'Crew: connect FORBIDDEN');
select pg_temp.as_member('gone');
select is(pg_temp.raised(pg_temp.connect_sql('drive-a@example.com', 'sub-a', 'enc-refresh-a1', 'enc-access-a1')), 'UNAUTHENTICATED', 'deactivated: connect UNAUTHENTICATED');
select pg_temp.as_member('nobody');
select is(pg_temp.raised(pg_temp.connect_sql('drive-a@example.com', 'sub-a', 'enc-refresh-a1', 'enc-access-a1')), 'UNAUTHENTICATED', 'no session: connect UNAUTHENTICATED');
select pg_temp.as_anon();
select is(pg_temp.raised(pg_temp.connect_sql('drive-a@example.com', 'sub-a', 'enc-refresh-a1', 'enc-access-a1')),
  'permission denied for function drive_connect_complete', 'anon: connect denied');
select pg_temp.as_member('owner');
select is(pg_temp.raised(pg_temp.connect_sql(' ', 'sub-a', 'enc-refresh-a1', 'enc-access-a1')), 'VALIDATION', 'Owner: no address is VALIDATION');
select is(pg_temp.raised(pg_temp.connect_sql('drive-a@example.com', '', 'enc-refresh-a1', 'enc-access-a1')), 'VALIDATION', 'Owner: no account id is VALIDATION');
select is(pg_temp.raised(pg_temp.connect_sql('drive-a@example.com', 'sub-a', '', 'enc-access-a1')), 'VALIDATION', 'Owner: no refresh token is VALIDATION');
select pg_temp.as_system();
select is((select count(*) from public.drive_account), 0::bigint, 'nothing refused wrote a row');

-- 5. Connect as the Owner -----------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.drive_connect_complete('drive-a@example.com', 'sub-a', 'enc-refresh-a1', 'enc-access-a1',
  now() + interval '1 hour', array['https://www.googleapis.com/auth/drive'], 'root-folder-a'), 'connected', 'Owner: first connect is connected');
select is(public.drive_status()->>'state', 'connected', 'status: connected');
select is(public.drive_status()->>'google_email', 'drive-a@example.com', 'status: the address');
select is(public.drive_status()->>'root_folder_id', 'root-folder-a', 'status: the root folder');
select ok(public.drive_status()->'connected_at' <> 'null'::jsonb, 'status: connected_at');
select ok(public.drive_status()::text not like '%enc-%', 'status never carries a token');
select is((select count(*) from jsonb_object_keys(public.drive_status()) k where k like '%token%'), 0::bigint, 'status has no token key');
-- No API role reads the tables, even the Owner.
select is(pg_temp.raised('select count(*) from public.drive_account'), 'permission denied for table drive_account', 'Owner: select drive_account denied');
select is(pg_temp.raised('select count(*) from public.drive_folders'), 'permission denied for table drive_folders', 'Owner: select drive_folders denied');
select is(pg_temp.raised('update public.drive_account set state = ''connected'''), 'permission denied for table drive_account', 'Owner: update drive_account denied');
select pg_temp.as_member('staff');
select is(pg_temp.raised('select count(*) from public.drive_account'), 'permission denied for table drive_account', 'Crew: select drive_account denied');
select pg_temp.as_anon();
select is(pg_temp.raised('select count(*) from public.drive_account'), 'permission denied for table drive_account', 'anon: select drive_account denied');
select is(pg_temp.raised('select count(*) from public.drive_folders'), 'permission denied for table drive_folders', 'anon: select drive_folders denied');
select pg_temp.as_system();
select is((select count(*) from public.activity_log a where a.entity = 'drive_account' and a.action = 'connected'
           and a.actor_id = pg_temp.fx('owner') and a.meta = jsonb_build_object('email', 'drive-a@example.com')),
  1::bigint, 'connect is in the history with the address only');
select is((select a.refresh_token_encrypted || '/' || a.access_token_encrypted from public.drive_account a),
  'enc-refresh-a1/enc-access-a1', 'the Worker''s tokens are stored');

-- 6. Reconnect the same account --------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.drive_connect_complete('drive-a@example.com', 'sub-a', 'enc-refresh-a2', 'enc-access-a2',
  now() + interval '1 hour', array['https://www.googleapis.com/auth/drive'], null), 'reconnected', 'same account again: reconnected');
select is(public.drive_status()->>'root_folder_id', 'root-folder-a', 'reconnect without a root keeps the root folder');

-- 7. Quota alerts (the Worker) ----------------------------------------------------------------------------
select pg_temp.as_service();
select is(public.drive_record_quota(pg_temp.fx('org'), 1000000000000, 790000000000), 0::smallint, '79 %: no alert');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'drive_space_low'), 0::bigint, '79 %: the Owner is not told');
select pg_temp.as_service();
select is(public.drive_record_quota(pg_temp.fx('org'), 1000000000000, 810000000000), 80::smallint, '81 %: the 80 % alert');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'drive_space_low'), 1::bigint, '81 %: the Owner is told once');
select is((select n.title from public.notifications n where n.recipient_id = pg_temp.fx('owner') and n.kind = 'drive_space_low'),
  'Google Drive is 80% full: 190.0 GB free', '81 %: the wording, in GB free');
select is((select n.link from public.notifications n where n.recipient_id = pg_temp.fx('owner') and n.kind = 'drive_space_low'),
  '/settings/drive', 'the alert opens Settings, Google Drive');
select pg_temp.as_service();
select is(public.drive_record_quota(pg_temp.fx('org'), 1000000000000, 850000000000), 0::smallint, '85 %: no second alert');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'drive_space_low'), 1::bigint, '85 %: still one notice');
select pg_temp.as_service();
select is(public.drive_record_quota(pg_temp.fx('org'), 1000000000000, 910000000000), 90::smallint, '91 %: the 90 % alert');
select is(public.drive_record_quota(pg_temp.fx('org'), 1000000000000, 950000000000), 0::smallint, '95 %: nothing more');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'drive_space_low'), 2::bigint, '91 %: a second notice, once');
select pg_temp.as_service();
select is(public.drive_record_quota(pg_temp.fx('org'), 1000000000000, 500000000000), 0::smallint, '50 %: nothing');
select pg_temp.as_system();
select is((select a.quota_alert_level from public.drive_account a), 0::smallint, '50 %: the alerts re-arm');
select pg_temp.as_service();
select is(public.drive_record_quota(pg_temp.fx('org'), 1000000000000, 810000000000), 80::smallint, '81 % again: the 80 % alert again');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'drive_space_low'), 3::bigint, '81 % again: told again');
select is((select count(*) from public.activity_log a where a.entity = 'drive_account' and a.action = 'space_low'), 3::bigint,
  'each alert is in the history');
select pg_temp.as_member('owner');
select is((public.drive_status()->>'quota_used_bytes')::bigint, 810000000000::bigint, 'status: the used bytes');
select pg_temp.as_service();
select is(pg_temp.raised('select public.drive_record_quota(pg_temp.fx(''org''), 0, 0)'), 'VALIDATION', 'quota: a total of 0 is VALIDATION');
select is(pg_temp.raised('select public.drive_record_quota(pg_temp.fx(''org''), 10, -1)'), 'VALIDATION', 'quota: a negative used is VALIDATION');

-- 8. Switching to another Google account ------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.drive_connect_complete('drive-c@example.com', 'sub-c', 'enc-refresh-c1', null,
  null, array['https://www.googleapis.com/auth/drive'], null), 'account_switched', 'another account: account_switched');
select pg_temp.as_system();
select is((select a.quota_alert_level from public.drive_account a), 0::smallint, 'switch: the alert level starts again');
select ok((select a.quota_total_bytes is null and a.quota_used_bytes is null and a.quota_checked_at is null
                  and a.root_folder_id is null and a.access_token_encrypted is null from public.drive_account a),
  'switch: the old account''s quota and root folder are not reused');
select is((select count(*) from public.activity_log a where a.action = 'account_switched'
           and a.meta = jsonb_build_object('email', 'drive-c@example.com')), 1::bigint, 'switch: in the history, the address only');
select pg_temp.as_service();
select is(public.drive_record_quota(pg_temp.fx('org'), 1000000000000, 810000000000), 80::smallint, 'switch: the new account is alerted at 80 %');

-- 9. Access token (the Worker) -------------------------------------------------------------------------
select is(pg_temp.raised('select public.drive_store_access_token(pg_temp.fx(''org''), ''enc-access-c2'', now() + interval ''1 hour'')'),
  null, 'store access token while connected');
select is(pg_temp.raised('select public.drive_store_access_token(pg_temp.fx(''org''), '''', now())'), 'VALIDATION', 'an empty access token is VALIDATION');
select is(pg_temp.raised('select public.drive_store_access_token(pg_temp.fx(''org''), ''enc-x'', null)'), 'VALIDATION', 'no expiry is VALIDATION');
select pg_temp.as_system();
select is((select a.access_token_encrypted from public.drive_account a), 'enc-access-c2', 'the access token is kept');

-- 10. Needs reconnect (the Worker) -----------------------------------------------------------------------
select pg_temp.as_service();
select is(public.drive_mark_needs_reconnect(pg_temp.fx('org'), 'invalid_grant'), true, 'connected → needs_reconnect');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'drive_needs_reconnect'), 1::bigint, 'the Owner is told');
select is((select n.title || ' | ' || n.body from public.notifications n where n.recipient_id = pg_temp.fx('owner') and n.kind = 'drive_needs_reconnect'),
  'Google Drive needs reconnecting | MaxOff can no longer reach drive-c@example.com, so new work is not being archived. Open Settings, Google Drive and tap Reconnect.',
  'the wording');
select is((select count(*) from public.notifications n where n.kind in ('drive_needs_reconnect', 'drive_space_low')
           and n.recipient_id <> pg_temp.fx('owner')), 0::bigint, 'nobody but the Owner gets a Drive notice');
select ok((select a.access_token_encrypted is null and a.refresh_token_encrypted is not null from public.drive_account a),
  'needs_reconnect drops the access token, keeps the rest');
select pg_temp.as_service();
select is(public.drive_mark_needs_reconnect(pg_temp.fx('org'), 'invalid_grant again'), false, 'already needs_reconnect: no move');
select is(pg_temp.raised('select public.drive_store_access_token(pg_temp.fx(''org''), ''enc-x'', now())'), 'INVALID_STATE', 'no access token while needs_reconnect');
select is(pg_temp.raised('select public.drive_record_quota(pg_temp.fx(''org''), 10, 1)'), 'INVALID_STATE', 'no quota while needs_reconnect');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'drive_needs_reconnect'), 1::bigint, 'told once per transition');
select pg_temp.as_member('owner');
select is(public.drive_status()->>'state', 'needs_reconnect', 'status: needs_reconnect');
select is(public.drive_status()->>'last_error', 'invalid_grant again', 'status: the latest error');
select is(public.drive_connect_complete('drive-c@example.com', 'sub-c', 'enc-refresh-c3', 'enc-access-c3',
  now() + interval '1 hour', array['https://www.googleapis.com/auth/drive'], null), 'reconnected', 'Owner reconnects');
select ok(public.drive_status()->'last_error' = 'null'::jsonb and public.drive_status()->>'state' = 'connected', 'reconnect clears the error');
select pg_temp.as_service();
select is(public.drive_mark_needs_reconnect(pg_temp.fx('org'), 'token revoked'), true, 'a new transition after the reconnect');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'drive_needs_reconnect'), 2::bigint, 'and the Owner is told again');
select pg_temp.as_member('owner');
select is(public.drive_connect_complete('drive-c@example.com', 'sub-c', 'enc-refresh-c4', 'enc-access-c4',
  now() + interval '1 hour', array['https://www.googleapis.com/auth/drive'], null), 'reconnected', 'Owner reconnects again');

-- 11. Second organisation ---------------------------------------------------------------------------------
select pg_temp.as_member('b_owner');
select is(public.drive_status()->>'state', 'disconnected', 'org B''s Owner: their own (never connected) status');
select ok(public.drive_status()->'google_email' = 'null'::jsonb, 'org B''s Owner never sees org A''s address');
select is(pg_temp.raised('select public.drive_disconnect()'), 'INVALID_STATE', 'org B''s Owner cannot disconnect org A');
select pg_temp.as_service();
select is(pg_temp.raised(format('select public.drive_mark_needs_reconnect(%L, ''x'')', pg_temp.fx('org_b'))), 'NOT_FOUND', 'org B never connected: needs_reconnect NOT_FOUND');
select is(pg_temp.raised(format('select public.drive_store_access_token(%L, ''enc-x'', now())', pg_temp.fx('org_b'))), 'NOT_FOUND', 'org B: store token NOT_FOUND');
select is(pg_temp.raised(format('select public.drive_record_quota(%L, 10, 1)', pg_temp.fx('org_b'))), 'NOT_FOUND', 'org B: quota NOT_FOUND');
select pg_temp.as_system();
select is((select a.state from public.drive_account a where a.org_id = pg_temp.fx('org')), 'connected', 'org A untouched by org B');

-- 12. Folder cache (the Worker) ---------------------------------------------------------------------------
select pg_temp.as_service();
insert into fx select 'root_c', (public.drive_folder_put(pg_temp.fx('org'), 'sub-c', 'root', null, null, null, null, 'folder-root-c', 'MaxOff')).id;
select is((public.drive_folder_put(pg_temp.fx('org'), 'sub-c', 'root', null, null, null, null, 'folder-root-other', 'MaxOff')).id,
  pg_temp.fx('root_c'), 'the same key returns the cached folder');
select is((public.drive_folder_find(pg_temp.fx('org'), 'sub-c', 'root', null, null, null)).drive_folder_id, 'folder-root-c',
  'the cached folder is unchanged');
select isnt((public.drive_folder_put(pg_temp.fx('org'), 'sub-a', 'root', null, null, null, null, 'folder-root-a', 'MaxOff')).id,
  pg_temp.fx('root_c'), 'another account gets its own folder');
insert into fx select 'client_c', (public.drive_folder_put(pg_temp.fx('org'), 'sub-c', 'client', pg_temp.fx('client'), null, null,
  pg_temp.fx('root_c'), 'folder-client-c', 'Drive client 144')).id;
select ok(pg_temp.fx('client_c') is not null, 'a client folder under the root');
select isnt((public.drive_folder_put(pg_temp.fx('org'), 'sub-c', 'month', pg_temp.fx('client'), '2026-11', null,
  pg_temp.fx('client_c'), 'folder-month-c', '2026-11')).id, null, 'a month folder under the client');
select is((public.drive_folder_find(pg_temp.fx('org'), 'sub-c', 'month', pg_temp.fx('client'), '2026-12', null)).id, null,
  'find: another month is not cached');
select isnt((public.drive_folder_put(pg_temp.fx('org'), 'sub-c', 'task', null, null, pg_temp.fx('task'),
  null, 'folder-task-c', 'Drive task 144')).id, null, 'a task folder');
select is(pg_temp.raised(format('select public.drive_folder_put(%L, ''sub-c'', ''client'', %L, null, null, null, ''f'', ''n'')',
  pg_temp.fx('org'), pg_temp.fx('b_client'))), 'VALIDATION', 'another organisation''s client is VALIDATION');
select is(pg_temp.raised(format('select public.drive_folder_put(%L, ''sub-c'', ''task'', null, null, %L, null, ''f'', ''n'')',
  pg_temp.fx('org_b'), pg_temp.fx('task'))), 'VALIDATION', 'another organisation''s task is VALIDATION');
select is(pg_temp.raised(format('select public.drive_folder_put(%L, ''sub-a'', ''clients'', null, null, null, %L, ''f'', ''n'')',
  pg_temp.fx('org'), pg_temp.fx('root_c'))), 'VALIDATION', 'a parent in another account is VALIDATION');
select is(pg_temp.raised(format('select public.drive_folder_put(%L, ''sub-c'', ''month'', null, ''2026-13'', null, null, ''f'', ''n'')',
  pg_temp.fx('org'))), 'new row for relation "drive_folders" violates check constraint "drive_folders_month_check"', 'a month that is not YYYY-MM is refused');
select is(pg_temp.raised(format('select public.drive_folder_put(%L, ''sub-c'', ''client'', null, null, null, null, ''f'', ''n'')',
  pg_temp.fx('org'))), 'new row for relation "drive_folders" violates check constraint "drive_folders_key_by_kind"', 'a client folder needs its client');
select pg_temp.as_system();
select is(pg_temp.raised(format('insert into public.drive_folders (org_id, account_sub, kind, drive_folder_id, name) values (%L, ''sub-c'', ''root'', ''dup'', ''dup'')',
  pg_temp.fx('org'))), 'duplicate key value violates unique constraint "drive_folders_key"', 'the key is unique per account, nulls included');

-- 13. Disconnect, per role ------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select is(pg_temp.raised('select public.drive_disconnect()'), 'FORBIDDEN', 'Admin: disconnect FORBIDDEN');
select pg_temp.as_member('staff');
select is(pg_temp.raised('select public.drive_disconnect()'), 'FORBIDDEN', 'Crew: disconnect FORBIDDEN');
select pg_temp.as_member('gone');
select is(pg_temp.raised('select public.drive_disconnect()'), 'UNAUTHENTICATED', 'deactivated: disconnect UNAUTHENTICATED');
select pg_temp.as_member('nobody');
select is(pg_temp.raised('select public.drive_disconnect()'), 'UNAUTHENTICATED', 'no session: disconnect UNAUTHENTICATED');
select pg_temp.as_anon();
select is(pg_temp.raised('select public.drive_disconnect()'), 'permission denied for function drive_disconnect', 'anon: disconnect denied');
select pg_temp.as_member('owner');
select is(pg_temp.raised('select public.drive_disconnect()'), null, 'Owner: disconnect');
select is(public.drive_status()->>'state', 'disconnected', 'status: disconnected');
select is(pg_temp.raised('select public.drive_disconnect()'), 'INVALID_STATE', 'disconnect twice is INVALID_STATE');
select pg_temp.as_system();
select ok((select a.refresh_token_encrypted is null and a.access_token_encrypted is null and a.token_expires_at is null
                  and a.google_email = 'drive-c@example.com' from public.drive_account a),
  'disconnect clears the tokens and keeps the address');
select is((select count(*) from public.drive_folders where org_id = pg_temp.fx('org')), 5::bigint, 'the folder cache stays');
select is((select count(*) from public.activity_log a where a.action = 'disconnected' and a.entity = 'drive_account'
           and a.actor_id = pg_temp.fx('owner')), 1::bigint, 'disconnect is in the history');
select pg_temp.as_service();
select is(public.drive_mark_needs_reconnect(pg_temp.fx('org'), 'invalid_grant'), false, 'disconnected: needs_reconnect does nothing');
select is(pg_temp.raised('select public.drive_store_access_token(pg_temp.fx(''org''), ''enc-x'', now())'), 'INVALID_STATE', 'disconnected: no access token');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'drive_needs_reconnect'), 2::bigint, 'disconnected: nobody told');

-- 14. No token ever reached the history ------------------------------------------------------------------
select is((select count(*) from public.activity_log a where a.entity = 'drive_account'
           and (a.diff::text like '%enc-%' or a.meta::text like '%enc-%')), 0::bigint,
  'no token in any drive_account history row');
select is((select count(*) from public.activity_log a where a.diff::text like '%enc-refresh%' or a.meta::text like '%enc-refresh%'
           or a.diff::text like '%enc-access%' or a.meta::text like '%enc-access%'), 0::bigint,
  'no token anywhere in activity_log');

select * from finish();
rollback;
