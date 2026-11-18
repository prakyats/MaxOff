-- v4.0 D1 "Drive connected" (database half; kickoff phase 8 sheet D1, ADR-0010, DATA-MODEL §8):
-- the company Google account MaxOff archives into, and the folder cache.
--
-- * public.drive_account: one row per organisation. The OAuth tokens are encrypted by the Worker
--   (AES-GCM, a server-side key) before they reach the database and are never returned to the
--   browser. **No API role reads it** (RLS on, no policy, privileges revoked): the Owner reads the
--   safe columns through drive_status(); the Worker (service_role) reads the tokens.
--   **No audit trigger**: the token columns must never land in activity_log. Each function below
--   writes its own activity_log row with no secret in diff or meta.
-- * public.drive_folders: the folder cache, keyed by what a folder is for (kind, client id, month,
--   task id), never by a name, and by the Google account it lives in (account_sub), so switching
--   the account never reuses the other account's folders and nothing is deleted. Service role only.
-- * Functions: drive_status / drive_connect_complete / drive_disconnect for drive.manage (the
--   Owner); drive_mark_needs_reconnect, drive_store_access_token, drive_record_quota,
--   drive_folder_put and drive_folder_find for the Worker (service_role only).
-- * Two notification kinds to the Owner (WORKFLOWS §9 "Google Drive needs reconnecting, or is low
--   on space"): drive_needs_reconnect and drive_space_low.
--
-- Expand-only: two new tables, new functions, two new kinds. Nothing existing changes.

-- 1. drive_account ---------------------------------------------------------------------------------
create table public.drive_account (
  org_id uuid primary key references public.organizations (id),
  google_email text not null check (length(btrim(google_email)) between 3 and 320),
  google_sub text not null check (length(btrim(google_sub)) between 1 and 255),
  refresh_token_encrypted text null,
  access_token_encrypted text null,
  token_expires_at timestamptz null,
  scopes text[] not null default '{}',
  root_folder_id text null,
  state text not null check (state in ('connected', 'needs_reconnect', 'disconnected')),
  last_error text null check (last_error is null or length(last_error) <= 500),
  connected_by uuid not null references public.members (id),
  connected_at timestamptz not null,
  quota_total_bytes bigint null check (quota_total_bytes is null or quota_total_bytes >= 0),
  quota_used_bytes bigint null check (quota_used_bytes is null or quota_used_bytes >= 0),
  quota_checked_at timestamptz null,
  quota_alert_level smallint not null default 0 check (quota_alert_level in (0, 80, 90)),
  updated_at timestamptz not null default now(),
  -- A connected account always has its refresh token; a disconnected one never keeps a token.
  constraint drive_account_tokens_by_state check (
    (state <> 'connected' or refresh_token_encrypted is not null)
    and (state <> 'disconnected' or (refresh_token_encrypted is null and access_token_encrypted is null)))
);
comment on table public.drive_account is
  'v4.0 D1 (ADR-0010, DATA-MODEL §8): the company Google account MaxOff archives into, one row per '
  'organisation. Tokens are AES-GCM encrypted by the Worker and never reach the browser. No API '
  'access (RLS on, no policy, privileges revoked): drive_status() is the Owner''s safe read; '
  'service_role (the Worker) reads the tokens. No audit trigger (tokens must never land in '
  'activity_log): the drive_* functions write their own history rows without secrets. '
  'quota_alert_level = the highest space alert already sent (0, 80 or 90).';
comment on column public.drive_account.google_sub is
  'The Google account''s stable id (Drive about.user.permissionId; drive.file asks for no OpenID '
  'scope): an account switch is a different id.';
comment on column public.drive_account.root_folder_id is
  'MaxOff''s top folder in that Drive (a Drive folder id).';
create trigger set_updated_at before update on public.drive_account
  for each row execute function app.set_updated_at();
alter table public.drive_account enable row level security;
revoke all on public.drive_account from public, anon, authenticated;

-- 2. drive_folders ----------------------------------------------------------------------------------
create table public.drive_folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  account_sub text not null check (length(btrim(account_sub)) between 1 and 255),
  kind text not null check (kind in ('root', 'clients', 'internal', 'client', 'month', 'task')),
  client_id uuid null references public.clients (id),
  task_id uuid null references public.tasks (id),
  month text null check (month is null or month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  parent_id uuid null references public.drive_folders (id),
  drive_folder_id text not null check (length(btrim(drive_folder_id)) between 1 and 255),
  name text not null check (length(btrim(name)) between 1 and 255),
  created_at timestamptz not null default now(),
  -- What each kind is keyed by: the top folders by nothing; a client by its id; a month by its
  -- YYYY-MM (under a client, or under Internal); a task by its id.
  constraint drive_folders_key_by_kind check (
    case kind
      when 'root' then client_id is null and month is null and task_id is null
      when 'clients' then client_id is null and month is null and task_id is null
      when 'internal' then client_id is null and month is null and task_id is null
      when 'client' then client_id is not null and month is null and task_id is null
      when 'month' then month is not null and task_id is null
      when 'task' then task_id is not null
    end)
);
comment on table public.drive_folders is
  'v4.0 D1: the Google Drive folder cache, so each folder is made once. Keyed by what it is for '
  '(kind + client id + month + task id; never by a name, so a renamed client keeps its folder) and '
  'by the Google account it lives in (account_sub), so an account switch never reuses the other '
  'account''s folders and nothing is deleted. Service role only (RLS on, no policy).';
create unique index drive_folders_key on public.drive_folders
  (org_id, account_sub, kind, client_id, month, task_id) nulls not distinct;
create index drive_folders_parent_idx on public.drive_folders (parent_id);
create index drive_folders_client_idx on public.drive_folders (client_id) where client_id is not null;
create index drive_folders_task_idx on public.drive_folders (task_id) where task_id is not null;
alter table public.drive_folders enable row level security;
revoke all on public.drive_folders from public, anon, authenticated;

-- 3. The kinds (WORKFLOWS §9: the Owner only) -------------------------------------------------------
-- Actionable: the Owner must act, so the email is the fallback when they have no working push.
insert into public.notification_kinds (kind, actionable, always_email, description) values
  ('drive_needs_reconnect', true, false,
   'MaxOff lost access to the company Google Drive; archiving waits until the Owner reconnects (v4.0)'),
  ('drive_space_low', true, false,
   'The company Google Drive is 80 % or 90 % full (to the Owner, once per level; v4.0)');

-- 4. The Owner's functions (drive.manage) -----------------------------------------------------------
create function public.drive_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_row public.drive_account;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('drive.manage') then
    perform app.fail('FORBIDDEN', 'Only the Owner can see the Google Drive connection.');
  end if;
  select a.* into v_row from public.drive_account a where a.org_id = v_caller.org_id;
  return jsonb_build_object(
    'state', coalesce(v_row.state, 'disconnected'),
    'google_email', v_row.google_email,
    'connected_at', v_row.connected_at,
    'root_folder_id', v_row.root_folder_id,
    'quota_total_bytes', v_row.quota_total_bytes,
    'quota_used_bytes', v_row.quota_used_bytes,
    'quota_checked_at', v_row.quota_checked_at,
    'last_error', v_row.last_error);
end;
$$;
comment on function public.drive_status() is
  'v4.0 D1: the caller''s organisation''s Google Drive connection for drive.manage (the Owner): '
  'state (''disconnected'' when never connected), google_email, connected_at, root_folder_id, quota '
  'and last_error. Never a token. UNAUTHENTICATED with no active member, FORBIDDEN for anyone else.';
revoke all on function public.drive_status() from public, anon, authenticated, service_role;
grant execute on function public.drive_status() to authenticated;

create function public.drive_connect_complete(
  p_email text,
  p_sub text,
  p_refresh_enc text,
  p_access_enc text,
  p_expires_at timestamptz,
  p_scopes text[],
  p_root_folder_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_old public.drive_account;
  v_action text;
  v_switched boolean;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('drive.manage') then
    perform app.fail('FORBIDDEN', 'Only the Owner can connect Google Drive.');
  end if;
  if nullif(btrim(coalesce(p_email, '')), '') is null or nullif(btrim(coalesce(p_sub, '')), '') is null then
    perform app.fail('VALIDATION', 'Google did not say which account was connected.');
  end if;
  if nullif(btrim(coalesce(p_refresh_enc, '')), '') is null then
    perform app.fail('VALIDATION', 'Google did not give MaxOff lasting access. Connect again.');
  end if;

  select a.* into v_old from public.drive_account a where a.org_id = v_caller.org_id for update;
  v_switched := v_old.org_id is not null and v_old.google_sub <> btrim(p_sub);
  v_action := case when v_old.org_id is null then 'connected'
                   when v_switched then 'account_switched'
                   else 'reconnected' end;

  insert into public.drive_account as a (
    org_id, google_email, google_sub, refresh_token_encrypted, access_token_encrypted, token_expires_at,
    scopes, root_folder_id, state, last_error, connected_by, connected_at)
  values (
    v_caller.org_id, btrim(p_email), btrim(p_sub), p_refresh_enc, nullif(p_access_enc, ''),
    p_expires_at, coalesce(p_scopes, '{}'), nullif(btrim(coalesce(p_root_folder_id, '')), ''),
    'connected', null, v_caller.id, now())
  on conflict (org_id) do update set
    google_email = excluded.google_email,
    google_sub = excluded.google_sub,
    refresh_token_encrypted = excluded.refresh_token_encrypted,
    access_token_encrypted = excluded.access_token_encrypted,
    token_expires_at = excluded.token_expires_at,
    scopes = excluded.scopes,
    root_folder_id = coalesce(excluded.root_folder_id, case when v_switched then null else a.root_folder_id end),
    state = 'connected',
    last_error = null,
    connected_by = excluded.connected_by,
    connected_at = excluded.connected_at,
    -- Another account's space and alerts are not this one's.
    quota_total_bytes = case when v_switched then null else a.quota_total_bytes end,
    quota_used_bytes = case when v_switched then null else a.quota_used_bytes end,
    quota_checked_at = case when v_switched then null else a.quota_checked_at end,
    quota_alert_level = case when v_switched then 0 else a.quota_alert_level end;

  -- History with no secret: the account's address only.
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (v_caller.org_id, v_caller.id, 'drive_account', v_caller.org_id, v_action,
    case when v_old.org_id is null then '{}'::jsonb
         else jsonb_build_object('state', jsonb_build_object('from', v_old.state, 'to', 'connected')) end,
    jsonb_build_object('email', btrim(p_email)));
  return v_action;
end;
$$;
comment on function public.drive_connect_complete(text, text, text, text, timestamptz, text[], text) is
  'v4.0 D1: the end of the Owner''s Google sign-in (drive.manage): stores the account and its encrypted '
  'tokens as connected, clears last_error. A different Google account (sub) is an account switch: its '
  'quota and quota_alert_level start again and the old root folder is not reused. Audited by hand as '
  '''connected'', ''reconnected'' or ''account_switched'' (meta: the email only, never a token). Returns '
  'that action.';
revoke all on function public.drive_connect_complete(text, text, text, text, timestamptz, text[], text)
  from public, anon, authenticated, service_role;
grant execute on function public.drive_connect_complete(text, text, text, text, timestamptz, text[], text)
  to authenticated;

create function public.drive_disconnect()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_old public.drive_account;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('drive.manage') then
    perform app.fail('FORBIDDEN', 'Only the Owner can disconnect Google Drive.');
  end if;
  select a.* into v_old from public.drive_account a where a.org_id = v_caller.org_id for update;
  if v_old.org_id is null or v_old.state = 'disconnected' then
    perform app.fail('INVALID_STATE', 'Google Drive is not connected.');
  end if;
  update public.drive_account
  set state = 'disconnected', refresh_token_encrypted = null, access_token_encrypted = null,
      token_expires_at = null
  where org_id = v_caller.org_id;
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (v_caller.org_id, v_caller.id, 'drive_account', v_caller.org_id, 'disconnected',
    jsonb_build_object('state', jsonb_build_object('from', v_old.state, 'to', 'disconnected')),
    jsonb_build_object('email', v_old.google_email));
end;
$$;
comment on function public.drive_disconnect() is
  'v4.0 D1: the Owner (drive.manage) disconnects Google Drive: the tokens are cleared, the account''s '
  'address, quota and folder cache stay. INVALID_STATE when not connected. Audited ''disconnected''.';
revoke all on function public.drive_disconnect() from public, anon, authenticated, service_role;
grant execute on function public.drive_disconnect() to authenticated;

-- 5. The Worker's functions (service_role only) -----------------------------------------------------
create function public.drive_mark_needs_reconnect(p_org uuid, p_error text)
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
    format('MaxOff can no longer reach %s, so new work is not being archived. Open Settings, Google Drive and tap Reconnect.',
      v_old.google_email),
    '/settings/drive', 'drive_account', p_org, '{}'::jsonb, null);
  return true;
end;
$$;
comment on function public.drive_mark_needs_reconnect(uuid, text) is
  'v4.0 D1, service_role only (the Worker, on invalid_grant or a revoked token): connected → '
  'needs_reconnect with last_error (≤ 500 characters, no secret), the access token dropped, audited '
  '''needs_reconnect'' and the Owner told once (drive_needs_reconnect). Already needs_reconnect: the '
  'error is updated, nobody told again. Disconnected: nothing. Returns true when it moved. NOT_FOUND '
  'when never connected.';
revoke all on function public.drive_mark_needs_reconnect(uuid, text) from public, anon, authenticated;
grant execute on function public.drive_mark_needs_reconnect(uuid, text) to service_role;

create function public.drive_store_access_token(p_org uuid, p_access_enc text, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if nullif(btrim(coalesce(p_access_enc, '')), '') is null or p_expires_at is null then
    perform app.fail('VALIDATION', 'An access token needs its value and expiry.');
  end if;
  select a.state into v_state from public.drive_account a where a.org_id = p_org for update;
  if v_state is null then
    perform app.fail('NOT_FOUND', 'Google Drive was never connected here.');
  end if;
  if v_state <> 'connected' then
    perform app.fail('INVALID_STATE', 'Google Drive is not connected.');
  end if;
  update public.drive_account
  set access_token_encrypted = p_access_enc, token_expires_at = p_expires_at
  where org_id = p_org;
end;
$$;
comment on function public.drive_store_access_token(uuid, text, timestamptz) is
  'v4.0 D1, service_role only: keeps the Worker''s refreshed (encrypted) access token and its expiry. '
  'Only while connected (INVALID_STATE otherwise; NOT_FOUND when never connected). Not written to '
  'activity_log on purpose: an hourly cache refresh of a secret, no business change.';
revoke all on function public.drive_store_access_token(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.drive_store_access_token(uuid, text, timestamptz) to service_role;

create function public.drive_record_quota(p_org uuid, p_total bigint, p_used bigint)
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
    'Make space in that Google account or add storage, or new work cannot be archived.',
    '/settings/drive', 'drive_account', p_org, jsonb_build_object('level', v_level), null);
  return v_level;
end;
$$;
comment on function public.drive_record_quota(uuid, bigint, bigint) is
  'v4.0 D1, service_role only (the daily quota check): stores Google Drive''s total and used bytes. '
  'Crossing 80 % and then 90 % tells the Owner once each (drive_space_low, "Google Drive is 80% full: '
  'X GB free", audited ''space_low''); back below 80 % re-arms both. Returns the alert sent: 0, 80 or 90. '
  'Only while connected (INVALID_STATE; NOT_FOUND when never connected). The plain quota refresh is '
  'not written to activity_log (a daily reading, no business change).';
revoke all on function public.drive_record_quota(uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.drive_record_quota(uuid, bigint, bigint) to service_role;

create function public.drive_folder_find(
  p_org uuid, p_account_sub text, p_kind text, p_client uuid, p_month text, p_task uuid)
returns public.drive_folders
language sql
stable
security definer
set search_path = ''
as $$
  select f.* from public.drive_folders f
  where f.org_id = p_org and f.account_sub = p_account_sub and f.kind = p_kind
    and f.client_id is not distinct from p_client
    and f.month is not distinct from p_month
    and f.task_id is not distinct from p_task;
$$;
comment on function public.drive_folder_find(uuid, text, text, uuid, text, uuid) is
  'v4.0 D1, service_role only: the cached folder for that key in that Google account, or null.';
revoke all on function public.drive_folder_find(uuid, text, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.drive_folder_find(uuid, text, text, uuid, text, uuid) to service_role;

create function public.drive_folder_put(
  p_org uuid, p_account_sub text, p_kind text, p_client uuid, p_month text, p_task uuid,
  p_parent uuid, p_drive_folder_id text, p_name text)
returns public.drive_folders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.drive_folders;
begin
  if p_client is not null and not exists (select 1 from public.clients c where c.id = p_client and c.org_id = p_org) then
    perform app.fail('VALIDATION', 'That client is not in this organisation.');
  end if;
  if p_task is not null and not exists (select 1 from public.tasks t where t.id = p_task and t.org_id = p_org) then
    perform app.fail('VALIDATION', 'That task is not in this organisation.');
  end if;
  if p_parent is not null and not exists (
    select 1 from public.drive_folders f where f.id = p_parent and f.org_id = p_org and f.account_sub = p_account_sub) then
    perform app.fail('VALIDATION', 'The parent folder is not in this Google account.');
  end if;
  insert into public.drive_folders (org_id, account_sub, kind, client_id, month, task_id, parent_id, drive_folder_id, name)
  values (p_org, p_account_sub, p_kind, p_client, p_month, p_task, p_parent, p_drive_folder_id, p_name)
  on conflict (org_id, account_sub, kind, client_id, month, task_id) do nothing
  returning * into v_row;
  if v_row.id is null then
    v_row := public.drive_folder_find(p_org, p_account_sub, p_kind, p_client, p_month, p_task);
  end if;
  return v_row;
end;
$$;
comment on function public.drive_folder_put(uuid, text, text, uuid, text, uuid, uuid, text, text) is
  'v4.0 D1, service_role only: caches a folder the Worker made, or returns the one already cached for '
  'that key (org, account, kind, client, month, task), unchanged. The client, task and parent must be '
  'the organisation''s (and the parent the same account''s): VALIDATION otherwise.';
revoke all on function public.drive_folder_put(uuid, text, text, uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.drive_folder_put(uuid, text, text, uuid, text, uuid, uuid, text, text) to service_role;

create function public.drive_folder_rename(p_org uuid, p_id uuid, p_name text)
returns public.drive_folders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.drive_folders;
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 255 then
    perform app.fail('VALIDATION', 'A folder name needs 1 to 255 characters.');
  end if;
  update public.drive_folders f set name = btrim(p_name)
  where f.id = p_id and f.org_id = p_org
  returning * into v_row;
  if v_row.id is null then
    perform app.fail('NOT_FOUND', 'That folder is not cached here.');
  end if;
  return v_row;
end;
$$;
comment on function public.drive_folder_rename(uuid, uuid, text) is
  'v4.0 (owner Q3, 18 Nov: a renamed client renames its Drive folder), service_role only: records '
  'the new name of a cached folder the Worker has just renamed in Drive. The key (kind, ids, month) '
  'never changes, so the folder stays the same one. NOT_FOUND outside the organisation; VALIDATION '
  'for an empty or over-long name.';
revoke all on function public.drive_folder_rename(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.drive_folder_rename(uuid, uuid, text) to service_role;
