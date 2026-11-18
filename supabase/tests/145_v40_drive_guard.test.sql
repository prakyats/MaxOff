-- v4.0 review (migration drive_connection_guard): the Worker's writes are tied to the connection
-- they read (the sealed refresh token); a write from an older connection changes nothing and tells
-- nobody. drive_folder_replace re-points a cached key. The two notification texts no longer
-- promise archiving. Service role only. Neutral names and example.com addresses only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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


-- Fixtures: a connected account (as the system), a client, a cached client folder, org B.
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Drive client 145', 'active', pg_temp.fx('admin'), now());
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Drive other org 145');
insert into public.drive_account (org_id, google_email, google_sub, refresh_token_encrypted, state,
  connected_by, connected_at)
values (pg_temp.fx('org'), 'drive-145@example.com', 'sub-145', 'enc-refresh-now', 'connected',
  pg_temp.fx('owner'), now());
insert into public.drive_folders (org_id, account_sub, kind, client_id, drive_folder_id, name)
values (pg_temp.fx('org'), 'sub-145', 'client', pg_temp.fx('client'), 'folder-old', 'Drive client 145');
insert into fx select 'folder', id from public.drive_folders where drive_folder_id = 'folder-old';

-- 1. Privileges -----------------------------------------------------------------------------------------
select is((select count(*) from unnest(array[
    'public.drive_store_access_token(uuid, text, text, timestamptz)', 'public.drive_mark_needs_reconnect(uuid, text, text)',
    'public.drive_record_quota(uuid, text, bigint, bigint)', 'public.drive_folder_replace(uuid, uuid, text)']) f,
    unnest(array['anon', 'authenticated']) r
  where has_function_privilege(r, f, 'execute')), 0::bigint, 'the four new functions: not anon, not authenticated');
select is((select count(*) from unnest(array[
    'public.drive_store_access_token(uuid, text, text, timestamptz)', 'public.drive_mark_needs_reconnect(uuid, text, text)',
    'public.drive_record_quota(uuid, text, bigint, bigint)', 'public.drive_folder_replace(uuid, uuid, text)']) f
  where has_function_privilege('service_role', f, 'execute')), 4::bigint, 'the four new functions: service_role');

-- 2. Quota, tied to the connection ---------------------------------------------------------------------
select pg_temp.as_service();
select is(public.drive_record_quota(pg_temp.fx('org'), 'enc-refresh-old', 2000::bigint, 1900::bigint), 0::smallint,
  'quota from an older connection: nothing');
select pg_temp.as_system();
select is((select quota_used_bytes from public.drive_account), null::bigint, 'older connection: no quota stored');
select is(pg_temp.notes('owner', 'drive_space_low'), 0::bigint, 'older connection: nobody told');
select pg_temp.as_service();
select is(public.drive_record_quota(pg_temp.fx('org'), 'enc-refresh-now', 2000::bigint, 1700::bigint), 80::smallint,
  'quota from this connection: the 80 % alert');
select pg_temp.as_system();
select is((select quota_used_bytes from public.drive_account), 1700::bigint, 'this connection: stored');
select is((select body from public.notifications where kind = 'drive_space_low' and recipient_id = pg_temp.fx('owner')),
  'Make space in that Google account or add more storage to it.', 'the space alert promises no archiving');

-- 3. Access token, tied to the connection --------------------------------------------------------------
select pg_temp.as_service();
select is(public.drive_store_access_token(pg_temp.fx('org'), 'enc-refresh-old', 'enc-access-old', now() + interval '1 hour'),
  false, 'access token from an older connection: not stored');
select pg_temp.as_system();
select is((select access_token_encrypted from public.drive_account), null, 'older connection: no access token');
select pg_temp.as_service();
select is(public.drive_store_access_token(pg_temp.fx('org'), 'enc-refresh-now', 'enc-access-now', now() + interval '1 hour'),
  true, 'access token from this connection: stored');
select pg_temp.as_system();
select is((select access_token_encrypted from public.drive_account), 'enc-access-now', 'this connection: the access token');

-- 4. Needs reconnect, tied to the connection -----------------------------------------------------------
select pg_temp.as_service();
select is(public.drive_mark_needs_reconnect(pg_temp.fx('org'), 'enc-refresh-old', 'invalid_grant'), false,
  'a refusal of an older connection''s grant: nothing');
select pg_temp.as_system();
select is((select state from public.drive_account), 'connected', 'older connection: still connected');
select is(pg_temp.notes('owner', 'drive_needs_reconnect'), 0::bigint, 'older connection: nobody told');
select pg_temp.as_service();
select is(public.drive_mark_needs_reconnect(pg_temp.fx('org'), 'enc-refresh-now', 'invalid_grant'), true,
  'a refusal of this connection''s grant: needs reconnect');
select pg_temp.as_system();
select is(pg_temp.notes('owner', 'drive_needs_reconnect'), 1::bigint, 'the Owner is told once');
select is((select body from public.notifications where kind = 'drive_needs_reconnect' and recipient_id = pg_temp.fx('owner')),
  'MaxOff can no longer reach drive-145@example.com. Open Settings, Google Drive and tap Reconnect.',
  'the reconnect notice promises no archiving');
select pg_temp.as_service();
select is(public.drive_store_access_token(pg_temp.fx('org'), 'enc-refresh-now', 'enc-access-2', now() + interval '1 hour'),
  false, 'needs reconnect: no access token stored');

-- 5. Folder replace ------------------------------------------------------------------------------------
select is((public.drive_folder_replace(pg_temp.fx('org'), pg_temp.fx('folder'), ' folder-new ')).drive_folder_id, 'folder-new',
  'replace: the key points at the new Drive folder');
select is((public.drive_folder_find(pg_temp.fx('org'), 'sub-145', 'client', pg_temp.fx('client'), null, null)).id,
  pg_temp.fx('folder'), 'replace: the same cached row');
select is(pg_temp.raised(format('select public.drive_folder_replace(%L, %L, ''x'')', pg_temp.fx('org_b'), pg_temp.fx('folder'))),
  'NOT_FOUND', 'replace: another organisation''s folder is NOT_FOUND');
select is(pg_temp.raised(format('select public.drive_folder_replace(%L, %L, '' '')', pg_temp.fx('org'), pg_temp.fx('folder'))),
  'VALIDATION', 'replace: an empty id is VALIDATION');
select pg_temp.as_member('owner');
select is(pg_temp.raised(format('select public.drive_folder_replace(%L, %L, ''x'')', pg_temp.fx('org'), pg_temp.fx('folder'))),
  'permission denied for function drive_folder_replace', 'replace: the Owner''s session cannot call it');

select * from finish();
rollback;
