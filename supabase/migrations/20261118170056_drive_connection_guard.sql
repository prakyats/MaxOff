-- v4.0 review (18 Nov 2026), expand-only beside drive_connect (already on staging, never edited):
-- 1. The Worker's writes name the connection they read. Each guarded overload takes the sealed
--    refresh token the Worker read (p_read_refresh_enc) and does nothing when the row holds another
--    one: an account switch or a reconnect happened in between, so a token, an error or a reading
--    from the old connection never lands on the new one. The unguarded signatures stay (expand-only)
--    but the app no longer calls them.
-- 2. drive_folder_replace: the cache can point a key at a new Drive folder when the cached one is
--    gone (trashed or deleted by hand in Drive); the key and the row stay.
-- 3. The two notification texts no longer promise archiving: v4.0 connects Drive, D2 archives.

create or replace function public.drive_mark_needs_reconnect(p_org uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.drive_account;
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 500);
begin
  select a.* into v_old from public.drive_account a where a.org_id = p_org for update;
  if v_old.org_id is null then
    perform app.fail('NOT_FOUND', 'Google Drive was never connected here.');
  end if;
  if v_old.state = 'disconnected' then
    -- The Owner disconnected it: nothing to reconnect.
    return false;
  end if;
  if v_old.state = 'needs_reconnect' then
    -- Already waiting for the Owner: the latest error only, no second notice.
    update public.drive_account set last_error = coalesce(v_error, last_error) where org_id = p_org;
    return false;
  end if;
  update public.drive_account
  set state = 'needs_reconnect', last_error = v_error, access_token_encrypted = null, token_expires_at = null
  where org_id = p_org;
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (p_org, null, 'drive_account', p_org, 'needs_reconnect',
    jsonb_build_object('state', jsonb_build_object('from', v_old.state, 'to', 'needs_reconnect')),
    jsonb_build_object('email', v_old.google_email, 'error', v_error));
  perform app.notify(array[app.org_owner_id(p_org)], 'drive_needs_reconnect',
    'Google Drive needs reconnecting',
    format('MaxOff can no longer reach %s. Open Settings, Google Drive and tap Reconnect.',
      v_old.google_email),
    '/settings/drive', 'drive_account', p_org, '{}'::jsonb, null);
  return true;
end;
$$;

create or replace function public.drive_record_quota(p_org uuid, p_total bigint, p_used bigint)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.drive_account;
  v_level smallint;
  v_free_gb text;
begin
  if p_total is null or p_total <= 0 or p_used is null or p_used < 0 then
    perform app.fail('VALIDATION', 'Google Drive''s space needs a total above 0 and a used amount of 0 or more.');
  end if;
  select a.* into v_old from public.drive_account a where a.org_id = p_org for update;
  if v_old.org_id is null then
    perform app.fail('NOT_FOUND', 'Google Drive was never connected here.');
  end if;
  if v_old.state <> 'connected' then
    perform app.fail('INVALID_STATE', 'Google Drive is not connected.');
  end if;

  v_level := case when p_used::numeric * 100 >= p_total::numeric * 90 then 90
                  when p_used::numeric * 100 >= p_total::numeric * 80 then 80
                  else 0 end;

  update public.drive_account
  set quota_total_bytes = p_total, quota_used_bytes = p_used, quota_checked_at = now(),
      -- Below 80 % the alerts re-arm; above, the level only rises (each one is sent once).
      quota_alert_level = case when v_level = 0 then 0 else greatest(v_old.quota_alert_level, v_level) end
  where org_id = p_org;

  if v_level = 0 or v_level <= v_old.quota_alert_level then
    return 0;
  end if;

  v_free_gb := to_char(greatest(p_total - p_used, 0)::numeric / 1000000000, 'FM999G999G990D0');
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (p_org, null, 'drive_account', p_org, 'space_low',
    jsonb_build_object('quota_alert_level', jsonb_build_object('from', v_old.quota_alert_level, 'to', v_level)),
    jsonb_build_object('level', v_level, 'total_bytes', p_total, 'used_bytes', p_used));
  perform app.notify(array[app.org_owner_id(p_org)], 'drive_space_low',
    format('Google Drive is %s%% full: %s GB free', v_level, v_free_gb),
    'Make space in that Google account or add more storage to it.',
    '/settings/drive', 'drive_account', p_org, jsonb_build_object('level', v_level), null);
  return v_level;
end;
$$;

create function public.drive_store_access_token(
  p_org uuid, p_read_refresh_enc text, p_access_enc text, p_expires_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.drive_account a
  where a.org_id = p_org and a.state = 'connected' and a.refresh_token_encrypted = p_read_refresh_enc
  for update;
  if not found then
    return false;
  end if;
  perform public.drive_store_access_token(p_org, p_access_enc, p_expires_at);
  return true;
end;
$$;
comment on function public.drive_store_access_token(uuid, text, text, timestamptz) is
  'v4.0 review, service_role only: drive_store_access_token for the connection the Worker read '
  '(p_read_refresh_enc); false and nothing written when the connection changed or is not connected.';
revoke all on function public.drive_store_access_token(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.drive_store_access_token(uuid, text, text, timestamptz) to service_role;

create function public.drive_mark_needs_reconnect(p_org uuid, p_read_refresh_enc text, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.drive_account a
  where a.org_id = p_org and a.refresh_token_encrypted = p_read_refresh_enc
  for update;
  if not found then
    return false;
  end if;
  return public.drive_mark_needs_reconnect(p_org, p_error);
end;
$$;
comment on function public.drive_mark_needs_reconnect(uuid, text, text) is
  'v4.0 review, service_role only: drive_mark_needs_reconnect for the connection the Worker read '
  '(p_read_refresh_enc); false and nobody told when the Owner has reconnected or switched since.';
revoke all on function public.drive_mark_needs_reconnect(uuid, text, text) from public, anon, authenticated;
grant execute on function public.drive_mark_needs_reconnect(uuid, text, text) to service_role;

create function public.drive_record_quota(p_org uuid, p_read_refresh_enc text, p_total bigint, p_used bigint)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.drive_account a
  where a.org_id = p_org and a.state = 'connected' and a.refresh_token_encrypted = p_read_refresh_enc
  for update;
  if not found then
    return 0;
  end if;
  return public.drive_record_quota(p_org, p_total, p_used);
end;
$$;
comment on function public.drive_record_quota(uuid, text, bigint, bigint) is
  'v4.0 review, service_role only: drive_record_quota for the connection the Worker read '
  '(p_read_refresh_enc); 0 and nothing stored when the connection changed or is not connected.';
revoke all on function public.drive_record_quota(uuid, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.drive_record_quota(uuid, text, bigint, bigint) to service_role;

create function public.drive_folder_replace(p_org uuid, p_id uuid, p_drive_folder_id text)
returns public.drive_folders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.drive_folders;
begin
  if length(btrim(coalesce(p_drive_folder_id, ''))) not between 1 and 255 then
    perform app.fail('VALIDATION', 'A Drive folder id needs 1 to 255 characters.');
  end if;
  update public.drive_folders f set drive_folder_id = btrim(p_drive_folder_id)
  where f.id = p_id and f.org_id = p_org
  returning * into v_row;
  if v_row.id is null then
    perform app.fail('NOT_FOUND', 'That folder is not cached here.');
  end if;
  return v_row;
end;
$$;
comment on function public.drive_folder_replace(uuid, uuid, text) is
  'v4.0 review, service_role only: points a cached folder''s key at a new Drive folder after the '
  'cached one was found gone (trashed or deleted in Drive). The key, the row and its children stay.';
revoke all on function public.drive_folder_replace(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.drive_folder_replace(uuid, uuid, text) to service_role;
