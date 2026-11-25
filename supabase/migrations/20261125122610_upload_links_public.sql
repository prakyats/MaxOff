-- v4.5 "The upload link", the database, part 2 of 2 (DATA-MODEL §8a "The public API's functions",
-- WORKFLOWS §5B and §8, plan A4-A7, B, C, E, F, I3). Every function here is service_role only:
-- anon and authenticated have no EXECUTE. The Worker calls them after its own checks of the token,
-- the body size and the rate limits (plan H2).
--
-- * The uploader's calls find the link by token_hash and the uploader by device_key_hash, never by an
--   id the browser sends (plan A4, M7). "Alive" = not stopped and the task todo, in_progress or
--   changes_requested and not archived (plan A5), checked inside each function. Any link that is not
--   alive answers the same way: null from upload_resolve, NOT_FOUND from the others (plan A6).
--   A file already on its way may finish after a stop (Q8): progress, a failure and the Worker's
--   upload_file_done still work for a stopped link's uploading files.
-- * The server's seal (upload_link_seal), the folder cache (upload_folder_put), the session
--   (upload_session_set), Google's answer (upload_file_done), the watch (upload_watch_due,
--   upload_record_offset, upload_signals), Google's daily limit (upload_daily_limit_hit), the network
--   counters (upload_rate_hit), the Drive check (upload_drive_check_claim, _daily, upload_drive_seen).
-- * app.upload_housekeeping (pg_cron, 03:20 IST): the 90-day erasure, old session addresses, old counters.
-- Nothing is deleted but the bookkeeping counters (upload_rate_hits, as cron_history_trim). No IP, user
-- agent, device key, token or session address is ever written to activity_log (plan G2).
-- Expand-only: new functions and one pg_cron job.

-- 1. Internal: the link a token names -----------------------------------------------------------------
create function app.upload_public_link(p_token_hash bytea, p_alive boolean)
returns public.upload_links
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.upload_links;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    return null;
  end if;
  select l.* into v_link from public.upload_links l where l.token_hash = p_token_hash;
  if v_link.id is null then
    return null;
  end if;
  if p_alive and (v_link.stopped_at is not null or not exists (
      select 1 from public.tasks t
      where t.id = v_link.task_id and t.state in ('todo', 'in_progress', 'changes_requested')
        and t.archived_at is null)) then
    return null;
  end if;
  return v_link;
end;
$$;
comment on function app.upload_public_link(bytea, boolean) is
  'Internal (v4.5, plan A4-A6): the link whose token_hash this is, or null. With p_alive, null too when '
  'the link is stopped or its task is not todo / in_progress / changes_requested or is archived.';
revoke all on function app.upload_public_link(bytea, boolean) from public, anon, authenticated;
grant execute on function app.upload_public_link(bytea, boolean) to service_role;

-- 2. The server seals a new link ---------------------------------------------------------------------
create function public.upload_link_seal(p_link_id uuid, p_token_hash bytea)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    perform app.fail('VALIDATION', 'A token hash is 32 bytes (sha256).');
  end if;
  update public.upload_links l set token_hash = p_token_hash
  where l.id = p_link_id and l.token_hash is null and l.stopped_at is null;
  if found then
    return true;
  end if;
  -- A repeat with the same hash (a retried request) is a harmless no-op.
  return exists (select 1 from public.upload_links l
                 where l.id = p_link_id and l.token_hash = p_token_hash and l.stopped_at is null);
end;
$$;
comment on function public.upload_link_seal(uuid, bytea) is
  'v4.5 (plan A2-A3), service_role only: stores sha256(token) on a link just made by upload_link_create '
  'or upload_link_renew (the server derived the token with UPLOAD_LINK_KEY). Write-once: the same hash '
  'again is a no-op (true); false and nothing written when the link has another hash, is stopped or '
  'does not exist.';
revoke all on function public.upload_link_seal(uuid, bytea) from public, anon, authenticated;
grant execute on function public.upload_link_seal(uuid, bytea) to service_role;

-- 3. The uploader's calls ---------------------------------------------------------------------------
create function public.upload_resolve(p_token_hash bytea, p_device_key_hash bytea)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.upload_links;
  v_drive text;
  v_up public.upload_uploaders;
  v_can text;
  v_wait integer := 0;
begin
  v_link := app.upload_public_link(p_token_hash, true);
  if v_link.id is null then
    return null;
  end if;
  select a.state into v_drive from public.drive_account a where a.org_id = v_link.org_id;
  if v_drive is distinct from 'connected' then
    v_can := 'drive_unavailable';
    v_wait := 300;
  elsif v_link.paused_until > now() then
    v_can := 'paused';
    v_wait := ceil(extract(epoch from v_link.paused_until - now()))::integer;
  else
    v_can := 'yes';
  end if;
  if p_device_key_hash is not null then
    select u.* into v_up from public.upload_uploaders u
    where u.link_id = v_link.id and u.device_key_hash = p_device_key_hash;
  end if;
  return jsonb_build_object(
    'studio_name', (select o.name from public.organizations o where o.id = v_link.org_id),
    'task_title', (select t.title from public.tasks t where t.id = v_link.task_id),
    'can_start', v_can,
    'wait_seconds', v_wait,
    'uploader', case when v_up.id is null then null else jsonb_build_object(
      'name', v_up.name,
      'files', (select coalesce(jsonb_agg(jsonb_build_object(
                  'name', f.name, 'relative_path', f.relative_path, 'size_bytes', f.size_bytes,
                  -- "Removed in Drive" is for the studio only: the uploader sees their file as sent.
                  'state', case when f.state = 'missing_in_drive' then 'done' else f.state end)
                  order by f.created_at, f.id), '[]'::jsonb)
                from public.upload_files f where f.uploader_id = v_up.id)) end);
end;
$$;
comment on function public.upload_resolve(bytea, bytea) is
  'v4.5 (plan A6-A7, Q4-Q5), service_role only: for an alive link exactly {studio_name, task_title, '
  'can_start (yes / drive_unavailable / paused), wait_seconds, uploader} and, when the device key is '
  'an uploader''s, uploader = {name, files: [{name, relative_path, size_bytes, state}]} (that device''s '
  'own files only; a file removed in Drive shows as done). Anything else (unknown, stopped, Done, cancelled, archived, malformed): null.';
revoke all on function public.upload_resolve(bytea, bytea) from public, anon, authenticated;
grant execute on function public.upload_resolve(bytea, bytea) to service_role;

create function public.upload_register(
  p_token_hash bytea, p_device_key_hash bytea, p_name text, p_ip inet, p_user_agent text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.upload_links;
  v_task public.tasks;
  v_name text := app.upload_clean(p_name);
  v_key text;
  v_up public.upload_uploaders;
  v_match uuid;
  v_folder text;
  v_n integer := 1;
  v_today date := app.today_ist();
  v_alert uuid;
  v_sent integer;
begin
  v_link := app.upload_public_link(p_token_hash, true);
  if v_link.id is null then
    perform app.fail('NOT_FOUND', 'This upload link doesn''t work any more.');
  end if;
  if p_device_key_hash is null or octet_length(p_device_key_hash) <> 32 then
    perform app.fail('VALIDATION', 'A device key is 32 bytes (its sha256).');
  end if;
  if length(v_name) not between 1 and 60 then
    perform app.fail('VALIDATION', 'Type your name (1 to 60 characters).');
  end if;
  v_key := app.upload_fold(v_name);
  if coalesce(v_key, '') = '' then
    -- Only combining marks (or the like): nothing left to match or name a folder by.
    perform app.fail('VALIDATION', 'Type your name (1 to 60 characters).');
  end if;
  -- One link at a time: the cap and the folder names are counted under this lock. Alive again under
  -- the lock (S1): a stop, Done or Cancel that committed while this call waited answers NOT_FOUND.
  perform 1 from public.upload_links l where l.id = v_link.id for update;
  v_link := app.upload_public_link(p_token_hash, true);
  if v_link.id is null then
    perform app.fail('NOT_FOUND', 'This upload link doesn''t work any more.');
  end if;
  select t.* into v_task from public.tasks t where t.id = v_link.task_id;

  -- The same device again: its own row (the browser makes a new device key for "Use another name").
  select u.* into v_up from public.upload_uploaders u
  where u.link_id = v_link.id and u.device_key_hash = p_device_key_hash;
  if v_up.id is not null then
    if v_up.name_key <> v_key then
      perform app.fail('CONFLICT', 'This device already sends under another name.');
    end if;
    update public.upload_uploaders set last_activity_at = now() where id = v_up.id;
    return jsonb_build_object('uploader_id', v_up.id);
  end if;

  -- Plan C3: 20 new names per link in an IST day; the 21st is refused and the task's Admins are told
  -- once. A refusal is an answer, not an error, so the notice commits.
  if (select count(*) from public.upload_uploaders u
      where u.link_id = v_link.id and app.to_ist_date(u.created_at) = v_today) >= 20 then
    insert into public.upload_alerts (org_id, link_id, kind, answers)
    values (v_link.org_id, v_link.id, 'names_capped', v_today::text)
    on conflict do nothing returning id into v_alert;
    if v_alert is not null then
      perform app.notify(app.upload_recipients(v_task.id), 'upload_names_capped',
        format('Too many new names on the %s link', v_task.title),
        'New names are refused until tomorrow. Stop the link if it has spread.',
        '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), null);
    end if;
    return jsonb_build_object('refused', 'rate_limited');
  end if;

  -- A name is a claim (plan B1): it only decides the "not on this task" flag and the folder. The rule
  -- (advisor 19 Nov): a case- and accent-insensitive match of the full or first name of an active
  -- assignee, freelancers included.
  select a.member_id into v_match
  from public.task_assignees a
  join public.members m on m.id = a.member_id and m.status = 'active'
  where a.task_id = v_task.id and a.removed_at is null
    and (app.upload_fold(m.full_name) = v_key or app.upload_fold(split_part(btrim(m.full_name), ' ', 1)) = v_key)
  order by a.is_primary desc, a.assigned_at
  limit 1;

  -- The uploader's Drive folder: the name, or "Sam (2)" when another uploader on this task has it.
  -- A name shaped like a hand-in version folder ("v2", any case; v5.0) is never used as it is, so
  -- an uploader's folder never sits beside a version's: "v2" becomes "v2 (2)".
  v_folder := v_name;
  while v_folder ~* '^v[0-9]+$' or exists (select 1 from public.upload_uploaders u
                where u.task_id = v_task.id and lower(u.folder_name) = lower(v_folder)) loop
    v_n := v_n + 1;
    v_folder := v_name || ' (' || v_n || ')';
  end loop;

  insert into public.upload_uploaders (org_id, link_id, task_id, name, name_key, on_task, matched_member_id,
    folder_name, device_key_hash, ip, user_agent, device_label, last_activity_at)
  values (v_link.org_id, v_link.id, v_task.id, v_name, v_key, v_match is not null, v_match, v_folder,
    p_device_key_hash, p_ip, left(nullif(btrim(coalesce(p_user_agent, '')), ''), 300),
    app.upload_device_label(p_user_agent), now())
  returning * into v_up;

  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (v_link.org_id, null, 'upload_uploaders', v_up.id, 'started', '{}'::jsonb,
    jsonb_build_object('task_id', v_task.id, 'uploader_id', v_up.id, 'name', v_up.name, 'on_task', v_up.on_task));

  -- Plan C10: someone not on the task tells the task's Admins once per name per link, at most 5 a day
  -- per link, then one summary that day.
  if not v_up.on_task and not exists (select 1 from public.upload_alerts x
                                      where x.link_id = v_link.id and x.kind = 'not_on_task' and x.answers = v_key) then
    select count(*) into v_sent from public.upload_alerts x
    where x.link_id = v_link.id and x.kind = 'not_on_task' and app.to_ist_date(x.sent_at) = v_today;
    if v_sent < 5 then
      insert into public.upload_alerts (org_id, link_id, uploader_id, kind, answers)
      values (v_link.org_id, v_link.id, null, 'not_on_task', v_key);
      perform app.notify(app.upload_recipients(v_task.id), 'upload_not_on_task',
        format('%s is uploading to %s (not on the task)', v_up.name, v_task.title),
        'The name was typed by the uploader, not checked.',
        '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), null);
    else
      v_alert := null;
      insert into public.upload_alerts (org_id, link_id, kind, answers)
      values (v_link.org_id, v_link.id, 'not_on_task_summary', v_today::text)
      on conflict do nothing returning id into v_alert;
      if v_alert is not null then
        perform app.notify(app.upload_recipients(v_task.id), 'upload_not_on_task',
          format('More new names are uploading to %s', v_task.title),
          'More people not on the task are uploading today. Stop the link if it has spread.',
          '/tasks/' || v_task.id, 'tasks', v_task.id,
          jsonb_build_object('task_id', v_task.id, 'summary', true), null);
      end if;
    end if;
  end if;
  -- Only the id: whether the name matched someone on the task is the studio's, never the uploader's.
  return jsonb_build_object('uploader_id', v_up.id);
end;
$$;
comment on function public.upload_register(bytea, bytea, text, inet, text) is
  'v4.5 (plan B1-B3, C3, C10), service_role only: the uploader gives a name on an alive link (NOT_FOUND '
  'otherwise). The name is cleaned (1-60, VALIDATION) and matched to the task''s active assignees (full '
  'or first name, case and accents ignored: on_task, matched_member_id; a name with nothing left once '
  'folded is VALIDATION); the folder is the name or '
  '"Name (2)". The same device again returns its row (CONFLICT under another name). The 21st new name on '
  'the link in an IST day answers {refused: rate_limited} and tells the task''s Admins once '
  '(upload_names_capped). A name not on the task tells them once per name, at most 5 a day per link, '
  'then one summary (upload_not_on_task). History ''started'' (name, on_task; no IP). Returns '
  '{uploader_id}. The link is checked alive again under its lock.';
revoke all on function public.upload_register(bytea, bytea, text, inet, text) from public, anon, authenticated;
grant execute on function public.upload_register(bytea, bytea, text, inet, text) to service_role;

create function public.upload_file_start(
  p_token_hash bytea, p_device_key_hash bytea, p_name text, p_relative_path text, p_size_bytes bigint,
  p_mime_hint text, p_ip inet, p_user_agent text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.upload_links;
  v_task public.tasks;
  v_up public.upload_uploaders;
  v_file public.upload_files;
  v_drive public.drive_account;
  v_name text := app.upload_clean(replace(replace(coalesce(p_name, ''), '/', ''), '\', ''));
  v_path text;
  v_mime text := nullif(left(app.upload_clean(p_mime_hint), 100), '');
  v_ua text := left(nullif(btrim(coalesce(p_user_agent, '')), ''), 300);
  v_to_come bigint;
  v_alert uuid;
  v_folders jsonb := '[]'::jsonb;
  v_parts text[];
  v_prefix text := '';
  i integer;
begin
  v_link := app.upload_public_link(p_token_hash, true);
  if v_link.id is null then
    perform app.fail('NOT_FOUND', 'This upload link doesn''t work any more.');
  end if;
  select u.* into v_up from public.upload_uploaders u
  where u.link_id = v_link.id and u.device_key_hash = p_device_key_hash and p_device_key_hash is not null;
  if v_up.id is null then
    perform app.fail('NOT_FOUND', 'Give your name first.');
  end if;
  if length(v_name) not between 1 and 255 then
    perform app.fail('VALIDATION', 'A file name needs 1 to 255 characters.');
  end if;
  v_path := app.upload_clean_path(p_relative_path);
  if p_size_bytes is null or p_size_bytes < 0 then
    perform app.fail('VALIDATION', 'A file''s size is 0 bytes or more.');
  end if;
  -- The per-link limits are counted under the link's lock, and the link is alive again under it (S1):
  -- a stop, Done or Cancel that committed while this call waited answers NOT_FOUND.
  perform 1 from public.upload_links l where l.id = v_link.id for update;
  v_link := app.upload_public_link(p_token_hash, true);
  if v_link.id is null then
    perform app.fail('NOT_FOUND', 'This upload link doesn''t work any more.');
  end if;
  select t.* into v_task from public.tasks t where t.id = v_link.task_id;

  -- "Already sent" (plan B4): this uploader's own received file with the same folder, name and size.
  if exists (select 1 from public.upload_files f
             where f.uploader_id = v_up.id and f.state = 'done' and f.relative_path = v_path
               and f.name = v_name and f.size_bytes = p_size_bytes) then
    return jsonb_build_object('result', 'already_sent');
  end if;
  -- The same file asked for again: a held, uploading or failed row of this uploader.
  select f.* into v_file from public.upload_files f
  where f.uploader_id = v_up.id and f.state in ('held', 'uploading', 'failed') and f.relative_path = v_path
    and f.name = v_name and f.size_bytes = p_size_bytes
  order by f.created_at desc limit 1
  for update;

  select a.* into v_drive from public.drive_account a where a.org_id = v_link.org_id;
  if v_drive.state is distinct from 'connected' then
    return jsonb_build_object('result', 'wait', 'seconds', 300, 'reason', 'drive_unavailable');
  end if;
  if v_link.paused_until > now() then
    return jsonb_build_object('result', 'wait', 'reason', 'daily_limit',
      'seconds', greatest(ceil(extract(epoch from v_link.paused_until - now()))::integer, 1));
  end if;

  if v_file.id is not null and v_file.session_uri_encrypted is not null
     and (v_file.state = 'uploading' or v_file.state = 'failed') then
    -- A retry on the same session while it lasts: back to uploading, nothing else counted again.
    if v_file.state = 'failed' then
      update public.upload_files set state = 'uploading', failed_reason = null where id = v_file.id
      returning * into v_file;
    end if;
  else
    -- Plan C4: at most 6 files uploading per uploader (a start the Worker never finished stops
    -- counting after 10 minutes).
    if (select count(*) from public.upload_files f
        where f.uploader_id = v_up.id and f.state = 'uploading' and f.id is distinct from v_file.id
          and (f.session_uri_encrypted is not null or f.updated_at > now() - interval '10 minutes')) >= 6 then
      return jsonb_build_object('result', 'wait', 'seconds', 30, 'reason', 'busy');
    end if;
    -- Plan C5: 600 new files an hour and 5,000 an IST day per link.
    if v_file.id is null and (
         (select count(*) from public.upload_files f
          where f.link_id = v_link.id and f.created_at > now() - interval '1 hour') >= 600
      or (select count(*) from public.upload_files f
          where f.link_id = v_link.id and app.to_ist_date(f.created_at) = app.today_ist()) >= 5000) then
      return jsonb_build_object('result', 'wait', 'seconds', 60, 'reason', 'too_many');
    end if;
    -- The space guard (Q11, plan C8): free space (rounded down to 10 GB) less a 10 GB reserve and the
    -- bytes still to come on open sessions. With no quota reading yet, nothing is held.
    if v_drive.quota_total_bytes is not null and v_drive.quota_used_bytes is not null then
      select coalesce(sum(greatest(f.size_bytes - f.bytes_at_google, 0)), 0) into v_to_come
      from public.upload_files f
      where f.org_id = v_link.org_id and f.state = 'uploading' and f.id is distinct from v_file.id
        and (f.session_uri_encrypted is not null or f.updated_at > now() - interval '10 minutes');
      -- S7: the free space counts in whole 10 GB steps, so a held answer tells the uploader at most,
      -- coarsely, whether there is room (an accepted leftover risk, plan §8).
      if p_size_bytes > floor((v_drive.quota_total_bytes - v_drive.quota_used_bytes)::numeric / 10000000000) * 10000000000
                        - 10000000000 - v_to_come then
        if v_file.id is null then
          insert into public.upload_files (org_id, uploader_id, link_id, task_id, name, relative_path, size_bytes,
            mime_hint, state, account_sub, ip, user_agent)
          values (v_link.org_id, v_up.id, v_link.id, v_task.id, v_name, v_path, p_size_bytes, v_mime, 'held',
            v_drive.google_sub, p_ip, v_ua)
          returning * into v_file;
        else
          update public.upload_files
          set state = 'held', failed_reason = null, session_uri_encrypted = null, session_opened_at = null,
              account_sub = v_drive.google_sub
          where id = v_file.id returning * into v_file;
        end if;
        insert into public.upload_alerts (org_id, link_id, file_id, kind, answers)
        values (v_link.org_id, v_link.id, v_file.id, 'space_held', app.today_ist()::text)
        on conflict do nothing returning id into v_alert;
        -- upload_alerts' key leaves file_id out: once per link per IST day.
        if v_alert is not null then
          perform app.notify(array[app.org_owner_id(v_link.org_id)], 'upload_space_held',
            'Studio Drive too full for an upload',
            format('A %s file for %s is waiting for space', app.upload_size_text(p_size_bytes), v_task.title),
            '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), null);
        end if;
        update public.upload_uploaders set last_activity_at = now() where id = v_up.id;
        return jsonb_build_object('result', 'held', 'file_id', v_file.id);
      end if;
    end if;
    if v_file.id is null then
      insert into public.upload_files (org_id, uploader_id, link_id, task_id, name, relative_path, size_bytes,
        mime_hint, state, account_sub, ip, user_agent)
      values (v_link.org_id, v_up.id, v_link.id, v_task.id, v_name, v_path, p_size_bytes, v_mime, 'uploading',
        v_drive.google_sub, p_ip, v_ua)
      returning * into v_file;
    else
      update public.upload_files
      set state = 'uploading', failed_reason = null, account_sub = v_drive.google_sub, mime_hint = v_mime,
          ip = p_ip, user_agent = v_ua
      where id = v_file.id returning * into v_file;
    end if;
  end if;
  update public.upload_uploaders set last_activity_at = now() where id = v_up.id;

  -- The folder steps under the task folder: the uploader's own folder, then each level of the path,
  -- with the Drive id already cached for this account (null: the Worker makes it, upload_folder_put).
  v_parts := case when v_path = '' then '{}'::text[] else string_to_array(v_path, '/') end;
  v_folders := jsonb_build_array(jsonb_build_object('relative_path', '', 'name', v_up.folder_name,
    'drive_folder_id', (select d.drive_folder_id from public.upload_folders d
                        where d.uploader_id = v_up.id and d.account_sub = v_drive.google_sub and d.relative_path = '')));
  for i in 1 .. coalesce(cardinality(v_parts), 0) loop
    v_prefix := case when i = 1 then v_parts[1] else v_prefix || '/' || v_parts[i] end;
    v_folders := v_folders || jsonb_build_object('relative_path', v_prefix, 'name', v_parts[i],
      'drive_folder_id', (select d.drive_folder_id from public.upload_folders d
                          where d.uploader_id = v_up.id and d.account_sub = v_drive.google_sub
                            and d.relative_path = v_prefix));
  end loop;

  -- Worker only: never sent to the browser. task_id, client_id, task_title, the folder ids,
  -- folder names, account_sub and uploader_id are for the Worker to open the session; the browser
  -- gets only the session address (plan E1-E2).
  return jsonb_build_object(
    'result', 'start',
    'file_id', v_file.id,
    'name', v_file.name,
    'size_bytes', v_file.size_bytes,
    'mime_hint', v_file.mime_hint,
    'session_uri_encrypted', v_file.session_uri_encrypted,
    'account_sub', v_drive.google_sub,
    'task_id', v_task.id,
    'task_title', v_task.title,
    'client_id', v_task.client_id,
    'task_folder_id', (select d.drive_folder_id from public.drive_folders d
                       where d.org_id = v_link.org_id and d.account_sub = v_drive.google_sub
                         and d.kind = 'task' and d.task_id = v_task.id),
    'uploader_id', v_up.id,
    'folders', v_folders);
end;
$$;
comment on function public.upload_file_start(bytea, bytea, text, text, bigint, text, inet, text) is
  'v4.5 (plan B4, C4-C5, C8, C11, E2-E3, Q11), service_role only: an uploader asks to start a file on an '
  'alive link (NOT_FOUND otherwise, or before a name). The name (no / or \, 1-255) and the path are '
  'cleaned (VALIDATION). Answers {result: already_sent} (this uploader''s own done file, same path, name '
  'and size); {result: wait, seconds, reason: drive_unavailable | daily_limit | busy (6 uploading) | '
  'too_many (600 an hour, 5,000 a day per link)}; {result: held, file_id} when it would not fit in the '
  'free space (rounded down to 10 GB) less 10 GB and the bytes still to come (the Owner told once per link per IST day, '
  'upload_space_held); or {result: start, file_id, name, size_bytes, mime_hint, session_uri_encrypted '
  '(the existing session on a retry, else null), account_sub, task_id, task_title, client_id, '
  'task_folder_id, uploader_id, folders: [{relative_path, name, drive_folder_id}]}. A held or failed '
  'file asked for again reuses its row.';
revoke all on function public.upload_file_start(bytea, bytea, text, text, bigint, text, inet, text)
  from public, anon, authenticated;
grant execute on function public.upload_file_start(bytea, bytea, text, text, bigint, text, inet, text) to service_role;

create function public.upload_folder_put(
  p_uploader_id uuid, p_account_sub text, p_relative_path text, p_drive_folder_id text)
returns public.upload_folders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_up public.upload_uploaders;
  v_path text := app.upload_clean_path(p_relative_path);
  v_row public.upload_folders;
begin
  select u.* into v_up from public.upload_uploaders u where u.id = p_uploader_id;
  if v_up.id is null then
    perform app.fail('NOT_FOUND', 'This uploader does not exist.');
  end if;
  if length(btrim(coalesce(p_account_sub, ''))) not between 1 and 255
     or length(btrim(coalesce(p_drive_folder_id, ''))) not between 1 and 255 then
    perform app.fail('VALIDATION', 'A folder needs its Google account and its Drive id.');
  end if;
  select d.* into v_row from public.upload_folders d
  where d.uploader_id = v_up.id and d.account_sub = btrim(p_account_sub) and d.relative_path = v_path;
  if v_row.id is not null then
    return v_row;
  end if;
  if (select count(*) from public.upload_folders d where d.uploader_id = v_up.id) >= 2000 then
    perform app.fail('RATE_LIMITED', 'An uploader can have at most 2,000 folders.');
  end if;
  insert into public.upload_folders (org_id, uploader_id, account_sub, relative_path, drive_folder_id)
  values (v_up.org_id, v_up.id, btrim(p_account_sub), v_path, btrim(p_drive_folder_id))
  on conflict (uploader_id, account_sub, relative_path) do nothing
  returning * into v_row;
  if v_row.id is null then
    select d.* into v_row from public.upload_folders d
    where d.uploader_id = v_up.id and d.account_sub = btrim(p_account_sub) and d.relative_path = v_path;
  end if;
  return v_row;
end;
$$;
comment on function public.upload_folder_put(uuid, text, text, text) is
  'v4.5 (plan C11), service_role only: caches a Drive folder the Worker made for an uploader, or returns '
  'the one already cached for (uploader, account, path), unchanged (as drive_folder_put). At most 2,000 '
  'per uploader (RATE_LIMITED); the path is cleaned as upload_file_start''s.';
revoke all on function public.upload_folder_put(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.upload_folder_put(uuid, text, text, text) to service_role;

create function public.upload_session_set(
  p_file_id uuid, p_account_sub text, p_drive_parent_id text, p_session_uri_encrypted text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.upload_files;
begin
  if length(btrim(coalesce(p_account_sub, ''))) not between 1 and 255
     or length(btrim(coalesce(p_drive_parent_id, ''))) not between 1 and 255
     or nullif(btrim(coalesce(p_session_uri_encrypted, '')), '') is null then
    perform app.fail('VALIDATION', 'A session needs its account, its folder and its sealed address.');
  end if;
  select f.* into v_file from public.upload_files f where f.id = p_file_id for update;
  if v_file.id is null then
    perform app.fail('NOT_FOUND', 'This file does not exist.');
  end if;
  if v_file.state <> 'uploading' then
    perform app.fail('INVALID_STATE', 'Only a file that is starting gets a session.');
  end if;
  update public.upload_files
  set account_sub = btrim(p_account_sub), drive_parent_id = btrim(p_drive_parent_id),
      session_uri_encrypted = p_session_uri_encrypted, session_opened_at = now(), last_moved_at = now(),
      bytes_at_google = case when session_uri_encrypted is distinct from p_session_uri_encrypted then 0
                             else bytes_at_google end,
      bytes_reported = case when session_uri_encrypted is distinct from p_session_uri_encrypted then 0
                            else bytes_reported end
  where id = v_file.id;
  -- WORKFLOWS §5B.6: the first file Google accepts ends a daily-limit pause.
  update public.upload_links
  set paused_until = null, pause_step = 0, paused_day = null
  where id = v_file.link_id and (paused_until is not null or pause_step <> 0);
  return 'uploading';
end;
$$;
comment on function public.upload_session_set(uuid, text, text, text) is
  'v4.5 (plan E2-E4), service_role only: the Worker opened the Google resumable session (fixed name, '
  'parent, declared size, a description linking to the task) and stores its sealed address, the '
  'account and the parent folder on the file (uploading only, INVALID_STATE otherwise). A new address '
  'starts the byte counts again. Ends the link''s daily-limit pause.';
revoke all on function public.upload_session_set(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.upload_session_set(uuid, text, text, text) to service_role;

-- The uploader's own file on a link that exists (stopped or not: a file on its way may finish, Q8).
create function app.upload_own_file(p_token_hash bytea, p_device_key_hash bytea, p_file_id uuid)
returns public.upload_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.upload_links;
  v_file public.upload_files;
begin
  v_link := app.upload_public_link(p_token_hash, false);
  if v_link.id is not null and p_device_key_hash is not null then
    select f.* into v_file from public.upload_files f
    join public.upload_uploaders u on u.id = f.uploader_id
    where f.id = p_file_id and f.link_id = v_link.id and u.link_id = v_link.id
      and u.device_key_hash = p_device_key_hash
    for update of f;
  end if;
  if v_file.id is null then
    perform app.fail('NOT_FOUND', 'This file does not exist.');
  end if;
  return v_file;
end;
$$;
comment on function app.upload_own_file(bytea, bytea, uuid) is
  'Internal (v4.5, plan A4, M7): the file, locked, when it is this device''s uploader''s on the link this '
  'token names (stopped or not); NOT_FOUND otherwise.';
revoke all on function app.upload_own_file(bytea, bytea, uuid) from public, anon, authenticated;
grant execute on function app.upload_own_file(bytea, bytea, uuid) to service_role;

create function public.upload_progress(p_token_hash bytea, p_device_key_hash bytea, p_file_id uuid, p_bytes bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.upload_files;
begin
  v_file := app.upload_own_file(p_token_hash, p_device_key_hash, p_file_id);
  if v_file.state <> 'uploading' then
    return false;
  end if;
  if p_bytes is null or p_bytes < 0 or p_bytes > v_file.size_bytes then
    perform app.fail('VALIDATION', 'Progress is between 0 and the file''s size.');
  end if;
  -- Plan C6: at most one report per file per 5 seconds; the extra ones are dropped.
  if v_file.updated_at > now() - interval '5 seconds' then
    return false;
  end if;
  update public.upload_files
  set bytes_reported = p_bytes,
      last_moved_at = case when p_bytes > bytes_reported then now() else last_moved_at end
  where id = v_file.id;
  update public.upload_uploaders set last_activity_at = now() where id = v_file.uploader_id;
  return true;
end;
$$;
comment on function public.upload_progress(bytea, bytea, uuid, bigint) is
  'v4.5 (plan C6), service_role only: the browser''s progress on its own uploading file (NOT_FOUND for '
  'another device''s or another link''s). New bytes move last_moved_at. At most one per file per 5 s: '
  'false when dropped or the file is not uploading. Not history.';
revoke all on function public.upload_progress(bytea, bytea, uuid, bigint) from public, anon, authenticated;
grant execute on function public.upload_progress(bytea, bytea, uuid, bigint) to service_role;

create function public.upload_file_failed(p_token_hash bytea, p_device_key_hash bytea, p_file_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.upload_files;
begin
  if p_reason is null or p_reason not in ('gave_up', 'unreadable') then
    perform app.fail('VALIDATION', 'A browser reports a file as gave_up or unreadable.');
  end if;
  v_file := app.upload_own_file(p_token_hash, p_device_key_hash, p_file_id);
  if v_file.state <> 'uploading' then
    perform app.fail('INVALID_STATE', 'Only a file that is uploading can fail.');
  end if;
  update public.upload_files set state = 'failed', failed_reason = p_reason where id = v_file.id;
  update public.upload_uploaders set last_activity_at = now() where id = v_file.uploader_id;
  return 'failed';
end;
$$;
comment on function public.upload_file_failed(bytea, bytea, uuid, text) is
  'v4.5, service_role only: the browser gave up on its own uploading file after its retries (gave_up) '
  'or cannot read it (unreadable). The session is kept: upload_file_start with the same file goes back '
  'to uploading on it while it lasts. Not history (a retry may follow); the Worker''s checks write '
  'the ''failed'' rows.';
revoke all on function public.upload_file_failed(bytea, bytea, uuid, text) from public, anon, authenticated;
grant execute on function public.upload_file_failed(bytea, bytea, uuid, text) to service_role;

create function public.upload_file_done(
  p_file_id uuid, p_drive_file_id text, p_size bigint, p_md5_drive text, p_parent_id text, p_md5_page text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.upload_files;
  v_link public.upload_links;
  v_md5_drive text := lower(nullif(btrim(coalesce(p_md5_drive, '')), ''));
  v_md5_page text := lower(nullif(btrim(coalesce(p_md5_page, '')), ''));
  v_reason text;
  v_kind text;
  v_after boolean;
begin
  select f.* into v_file from public.upload_files f where f.id = p_file_id for update;
  if v_file.id is null then
    perform app.fail('NOT_FOUND', 'This file does not exist.');
  end if;
  if nullif(btrim(coalesce(p_drive_file_id, '')), '') is null or p_size is null or p_size < 0 then
    perform app.fail('VALIDATION', 'Google''s answer needs the file id and its size.');
  end if;
  if (v_md5_drive is not null and v_md5_drive !~ '^[0-9a-f]{32}$')
     or (v_md5_page is not null and v_md5_page !~ '^[0-9a-f]{32}$') then
    perform app.fail('VALIDATION', 'An MD5 is 32 hex characters.');
  end if;
  -- Idempotent on a retry: the same answer again changes nothing.
  if v_file.state in ('done', 'missing_in_drive') then
    if v_file.drive_file_id = btrim(p_drive_file_id) then
      return v_file.state;
    end if;
    perform app.fail('INVALID_STATE', 'This file was already received.');
  end if;
  select l.* into v_link from public.upload_links l where l.id = v_file.link_id;
  -- An uploading file may finish after a stop (Q8); a failed one only while it still has its session
  -- and the link is not stopped; a held one never started.
  if not (v_file.state = 'uploading'
          or (v_file.state = 'failed' and v_file.session_uri_encrypted is not null and v_link.stopped_at is null)) then
    perform app.fail('INVALID_STATE', 'This file is not on its way to Google.');
  end if;
  if exists (select 1 from public.upload_files f where f.drive_file_id = btrim(p_drive_file_id) and f.id <> v_file.id) then
    perform app.fail('VALIDATION', 'That Drive file belongs to another upload.');
  end if;

  -- Plan F1-F2: Google's own answer decides.
  v_reason := case when p_size <> v_file.size_bytes then 'size_mismatch'
                   when p_parent_id is distinct from v_file.drive_parent_id then 'wrong_folder'
                   when v_md5_page is not null and v_md5_drive is not null and v_md5_page <> v_md5_drive then 'damaged'
              end;
  if v_reason is not null then
    update public.upload_files
    set state = 'failed', failed_reason = v_reason, session_uri_encrypted = null, md5_drive = v_md5_drive,
        md5_page = v_md5_page
    where id = v_file.id;
    insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
    values (v_file.org_id, null, 'upload_files', v_file.id, 'failed', '{}'::jsonb,
      jsonb_build_object('task_id', v_file.task_id, 'uploader_id', v_file.uploader_id, 'name', v_file.name,
                         'relative_path', v_file.relative_path, 'size_bytes', v_file.size_bytes, 'reason', v_reason));
    return 'failed';
  end if;

  v_kind := case when v_md5_page is not null and v_md5_drive is not null then 'md5' else 'size_only' end;
  v_after := v_link.stopped_at is not null and v_link.stopped_at <= now();
  update public.upload_files
  set state = 'done', failed_reason = null, drive_file_id = btrim(p_drive_file_id), md5_drive = v_md5_drive,
      md5_page = v_md5_page, check_kind = v_kind, done_at = now(), session_uri_encrypted = null,
      bytes_at_google = p_size, bytes_reported = p_size, last_moved_at = now(), after_stop = v_after
  where id = v_file.id;
  update public.upload_uploaders
  set first_file_at = coalesce(first_file_at, now()), last_activity_at = now()
  where id = v_file.uploader_id;
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (v_file.org_id, null, 'upload_files', v_file.id, 'received', '{}'::jsonb,
    jsonb_build_object('task_id', v_file.task_id, 'uploader_id', v_file.uploader_id, 'name', v_file.name,
                       'relative_path', v_file.relative_path, 'size_bytes', v_file.size_bytes,
                       'check_kind', v_kind, 'drive_file_id', btrim(p_drive_file_id), 'after_stop', v_after));
  return 'done';
end;
$$;
comment on function public.upload_file_done(uuid, text, bigint, text, text, text) is
  'v4.5 (plan F1-F2, Q8), service_role only: the Worker asked Google itself. A size other than the '
  'declared one fails it (size_mismatch), another parent (wrong_folder), a page MD5 unlike Drive''s '
  '(damaged): the session is cleared and the history row ''failed'' written. Otherwise done, check_kind '
  'md5 or size_only (no page MD5), the session cleared, after_stop = the link stopped before now; '
  'history ''received'' (name, path, size, check, Drive id, after_stop). Idempotent for the same Drive '
  'id. A stopped link''s file only while uploading. Returns the new state.';
revoke all on function public.upload_file_done(uuid, text, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.upload_file_done(uuid, text, bigint, text, text, text) to service_role;

create function public.upload_said_done(p_token_hash bytea, p_device_key_hash bytea)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.upload_links;
  v_task public.tasks;
  v_up public.upload_uploaders;
  v_files bigint;
  v_bytes bigint;
begin
  v_link := app.upload_public_link(p_token_hash, true);
  if v_link.id is not null and p_device_key_hash is not null then
    select u.* into v_up from public.upload_uploaders u
    where u.link_id = v_link.id and u.device_key_hash = p_device_key_hash for update;
  end if;
  if v_up.id is null then
    perform app.fail('NOT_FOUND', 'This upload link doesn''t work any more.');
  end if;
  -- Alive again under the link's lock (S1).
  perform 1 from public.upload_links l where l.id = v_link.id for update;
  if (app.upload_public_link(p_token_hash, true)).id is null then
    perform app.fail('NOT_FOUND', 'This upload link doesn''t work any more.');
  end if;
  select t.* into v_task from public.tasks t where t.id = v_link.task_id;
  update public.upload_uploaders set said_done_at = now(), last_activity_at = now() where id = v_up.id;
  select count(*), coalesce(sum(f.size_bytes), 0) into v_files, v_bytes
  from public.upload_files f where f.uploader_id = v_up.id and f.state in ('done', 'missing_in_drive');
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (v_link.org_id, null, 'upload_uploaders', v_up.id, 'said_done', '{}'::jsonb,
    jsonb_build_object('task_id', v_task.id, 'uploader_id', v_up.id, 'files', v_files, 'bytes', v_bytes));
  perform app.notify(app.upload_recipients(v_task.id), 'upload_said_done',
    format('%s finished: %s %s, %s', v_up.name, v_files, case when v_files = 1 then 'file' else 'files' end,
           app.upload_size_text(v_bytes)),
    format('%s · open the folder', v_task.title),
    '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), null);
end;
$$;
comment on function public.upload_said_done(bytea, bytea) is
  'v4.5, service_role only: the uploader tapped "I''m done" on an alive link (NOT_FOUND otherwise): '
  'said_done_at = now, history ''said_done'', the task''s Admins told (upload_said_done). Allowed again '
  'later (Send more files, then I''m done again).';
revoke all on function public.upload_said_done(bytea, bytea) from public, anon, authenticated;
grant execute on function public.upload_said_done(bytea, bytea) to service_role;

-- 4. The watch (WORKFLOWS §8 upload_watch, every minute) ---------------------------------------------
create function public.upload_watch_due(p_now timestamptz)
returns table (file_id uuid, org_id uuid, account_sub text, session_uri_encrypted text, size_bytes bigint,
               bytes_at_google bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.org_id, f.account_sub, f.session_uri_encrypted, f.size_bytes, f.bytes_at_google
  from public.upload_files f
  join public.drive_account a on a.org_id = f.org_id and a.state = 'connected'
  where f.state = 'uploading' and f.session_uri_encrypted is not null
    and f.updated_at <= p_now - interval '2 minutes'
  order by f.updated_at, f.id
  limit 500;
$$;
comment on function public.upload_watch_due(timestamptz) is
  'v4.5 (WORKFLOWS §8 upload_watch, plan F3), service_role only: uploading files with a session whose '
  'row has been quiet for 2 minutes or more (no browser report, no offset), 500 at a time, while the '
  'Drive is connected. The Worker asks Google each session''s offset.';
revoke all on function public.upload_watch_due(timestamptz) from public, anon, authenticated;
grant execute on function public.upload_watch_due(timestamptz) to service_role;

create function public.upload_record_offset(p_file_id uuid, p_bytes bigint, p_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.upload_files;
begin
  select f.* into v_file from public.upload_files f where f.id = p_file_id for update;
  if v_file.id is null then
    perform app.fail('NOT_FOUND', 'This file does not exist.');
  end if;
  if v_file.state <> 'uploading' then
    return false;
  end if;
  if p_bytes is null or p_bytes < 0 or p_bytes > v_file.size_bytes or p_at is null then
    perform app.fail('VALIDATION', 'An offset is between 0 and the file''s size, with its time.');
  end if;
  update public.upload_files
  set bytes_at_google = greatest(bytes_at_google, p_bytes),
      last_moved_at = case when p_bytes > bytes_at_google then p_at else last_moved_at end
  where id = v_file.id;
  return p_bytes > v_file.bytes_at_google;
end;
$$;
comment on function public.upload_record_offset(uuid, bigint, timestamptz) is
  'v4.5 (plan F3), service_role only: the offset Google reported for an uploading file''s session. New '
  'bytes move last_moved_at to p_at (true); the same offset only marks the row as checked (false). Not '
  'history.';
revoke all on function public.upload_record_offset(uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.upload_record_offset(uuid, bigint, timestamptz) to service_role;

-- Stuck and looks finished (WORKFLOWS §5B.4), each once (upload_alerts). Called by the Worker after the
-- watch, so it lives in public (the API exposes public only) and is service_role only.
create function public.upload_signals(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_alert uuid;
  v_stuck integer := 0;
  v_finished integer := 0;
begin
  -- Stuck: an uploading file with no new bytes at Google for 15 minutes, on an active link, while the
  -- Drive is connected. Once per stall per uploader: the stall is the earliest stalled file's last move.
  for r in
    select u.id as uploader_id, u.name, u.link_id, u.org_id, t.id as task_id, t.title,
           min(coalesce(f.last_moved_at, f.session_opened_at)) as since,
           (select count(*) from public.upload_files x where x.uploader_id = u.id and x.state in ('done', 'missing_in_drive')) as done_n,
           (select count(*) from public.upload_files x where x.uploader_id = u.id) as total_n
    from public.upload_uploaders u
    join public.upload_links l on l.id = u.link_id and l.stopped_at is null
    join public.tasks t on t.id = u.task_id
    join public.drive_account a on a.org_id = u.org_id and a.state = 'connected'
    join public.upload_files f on f.uploader_id = u.id and f.state = 'uploading' and f.session_uri_encrypted is not null
    where coalesce(f.last_moved_at, f.session_opened_at) <= p_now - interval '15 minutes'
    group by u.id, t.id
  loop
    v_alert := null;
    insert into public.upload_alerts (org_id, link_id, uploader_id, kind, answers, sent_at)
    values (r.org_id, r.link_id, r.uploader_id, 'stuck',
      to_char(r.since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), p_now)
    on conflict do nothing returning id into v_alert;
    continue when v_alert is null;
    v_stuck := v_stuck + 1;
    insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
    values (r.org_id, null, 'upload_uploaders', r.uploader_id, 'stuck_signalled', '{}'::jsonb,
      jsonb_build_object('task_id', r.task_id, 'uploader_id', r.uploader_id, 'since', r.since));
    perform app.notify(app.upload_recipients(r.task_id), 'upload_stuck',
      format('Upload stuck: %s, %s', r.name, r.title),
      format('No progress for 15 min · %s of %s files', r.done_n, r.total_n),
      '/tasks/' || r.task_id, 'tasks', r.task_id, jsonb_build_object('task_id', r.task_id), null);
  end loop;

  -- Looks finished: every file the uploader started is received (removed in Drive counts), nothing
  -- uploading, held or failed, nothing moved for 10 minutes, on an active link. Once per quiet period.
  -- Not sent when the uploader said "I'm done" after their last file (they already told).
  for r in
    select u.id as uploader_id, u.name, u.link_id, u.org_id, t.id as task_id, t.title,
           greatest(max(greatest(coalesce(f.last_moved_at, f.created_at), coalesce(f.done_at, f.created_at))),
                    u.last_activity_at) as since,
           max(f.done_at) as last_done,
           count(*) as n, coalesce(sum(f.size_bytes), 0)::bigint as bytes
    from public.upload_uploaders u
    join public.upload_links l on l.id = u.link_id and l.stopped_at is null
    join public.tasks t on t.id = u.task_id
    join public.upload_files f on f.uploader_id = u.id
    -- Bounded: only uploaders active in the last day (an older quiet period was signalled already).
    where u.last_activity_at > p_now - interval '1 day'
    group by u.id, t.id
    having bool_and(f.state in ('done', 'missing_in_drive'))
       and greatest(max(greatest(coalesce(f.last_moved_at, f.created_at), coalesce(f.done_at, f.created_at))),
                    u.last_activity_at) <= p_now - interval '10 minutes'
       and not (u.said_done_at is not null and u.said_done_at >= max(f.done_at))
  loop
    v_alert := null;
    insert into public.upload_alerts (org_id, link_id, uploader_id, kind, answers, sent_at)
    values (r.org_id, r.link_id, r.uploader_id, 'looks_finished',
      to_char(r.since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), p_now)
    on conflict do nothing returning id into v_alert;
    continue when v_alert is null;
    v_finished := v_finished + 1;
    insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
    values (r.org_id, null, 'upload_uploaders', r.uploader_id, 'looks_finished_signalled', '{}'::jsonb,
      jsonb_build_object('task_id', r.task_id, 'uploader_id', r.uploader_id, 'files', r.n, 'bytes', r.bytes));
    perform app.notify(app.upload_recipients(r.task_id), 'upload_looks_finished',
      format('Uploads look finished: %s, %s %s, %s', r.name, r.n, case when r.n = 1 then 'file' else 'files' end,
             app.upload_size_text(r.bytes)),
      format('%s · last file %s min ago', r.title,
             greatest(floor(extract(epoch from p_now - r.last_done) / 60), 0)::integer),
      '/tasks/' || r.task_id, 'tasks', r.task_id, jsonb_build_object('task_id', r.task_id), null);
  end loop;
  return jsonb_build_object('stuck', v_stuck, 'looks_finished', v_finished);
end;
$$;
comment on function public.upload_signals(timestamptz) is
  'v4.5 (WORKFLOWS §5B.4, plan C10, F3-F4), service_role only, after the every-minute watch: stuck (an '
  'uploading file with no new bytes for 15 min, active link, Drive connected; once per stall per '
  'uploader, upload_stuck) and looks finished (all received, nothing moved for 10 min, active link; '
  'once per quiet period, none after an "I''m done" that followed the last file, upload_looks_finished). '
  'History ''stuck_signalled'' / ''looks_finished_signalled''. Returns the counts sent.';
revoke all on function public.upload_signals(timestamptz) from public, anon, authenticated;
grant execute on function public.upload_signals(timestamptz) to service_role;

-- Google's daily limit (WORKFLOWS §5B.6, Q10): 15 minutes, then an hour at a time the same IST day.
create function public.upload_daily_limit_hit(p_link_id uuid, p_at timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.upload_links;
  v_task public.tasks;
  v_day date := app.to_ist_date(p_at);
  v_step smallint;
  v_until timestamptz;
  v_alert uuid;
begin
  select l.* into v_link from public.upload_links l where l.id = p_link_id for update;
  if v_link.id is null or p_at is null then
    perform app.fail('NOT_FOUND', 'This upload link does not exist.');
  end if;
  v_step := case when v_link.paused_day is distinct from v_day then 0 else v_link.pause_step end;
  -- The next IST day starts it again.
  v_until := least(p_at + case when v_step = 0 then interval '15 minutes' else interval '1 hour' end,
                   ((v_day + 1)::timestamp at time zone 'Asia/Kolkata'));
  update public.upload_links
  set paused_until = v_until, pause_step = least(v_step + 1, 2), paused_day = v_day
  where id = v_link.id;
  insert into public.upload_alerts (org_id, link_id, kind, answers, sent_at)
  values (v_link.org_id, v_link.id, 'daily_limit', v_day::text, p_at)
  on conflict do nothing returning id into v_alert;
  if v_alert is not null then
    select t.* into v_task from public.tasks t where t.id = v_link.task_id;
    perform app.notify(array[app.org_owner_id(v_link.org_id)] || app.upload_recipients(v_task.id),
      'upload_daily_limit', 'Google''s daily upload limit reached',
      format('Uploads to %s carry on by themselves when Google allows it.', v_task.title),
      '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), null);
  end if;
  return v_until;
end;
$$;
comment on function public.upload_daily_limit_hit(uuid, timestamptz) is
  'v4.5 (WORKFLOWS §5B.6, Q10), service_role only: Google refused a new session for its daily limit. '
  'The link pauses new files for 15 minutes, then an hour at a time on each further refusal the same '
  'IST day (pause_step, paused_day), never past the IST midnight; the Owner and the task''s Admins are '
  'told once per link per IST day (upload_daily_limit). Nothing resumes by a job. Returns paused_until.';
revoke all on function public.upload_daily_limit_hit(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.upload_daily_limit_hit(uuid, timestamptz) to service_role;

-- The per-network counters (plan C1-C2) beside the Cloudflare binding: bad links 10 a minute, then 15
-- minutes refused; opens 60 a minute.
create function public.upload_rate_hit(p_bucket text, p_key_hash bytea, p_at timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocked timestamptz;
  v_window timestamptz := date_trunc('minute', p_at);
  v_hits integer;
begin
  if p_bucket is null or p_bucket not in ('bad_link', 'open') or p_key_hash is null
     or octet_length(p_key_hash) <> 32 or p_at is null then
    perform app.fail('VALIDATION', 'A rate hit needs its bucket, a 32-byte key hash and its time.');
  end if;
  select max(h.blocked_until) into v_blocked from public.upload_rate_hits h
  where h.bucket = p_bucket and h.key_hash = p_key_hash and h.blocked_until > p_at;
  if v_blocked is not null then
    return v_blocked;
  end if;
  insert into public.upload_rate_hits as h (bucket, key_hash, window_start, hits)
  values (p_bucket, p_key_hash, v_window, 1)
  on conflict (bucket, key_hash, window_start) do update set hits = h.hits + 1
  returning h.hits into v_hits;
  if v_hits > (case p_bucket when 'bad_link' then 10 else 60 end) then
    v_blocked := case p_bucket when 'bad_link' then p_at + interval '15 minutes' else v_window + interval '1 minute' end;
    update public.upload_rate_hits h set blocked_until = v_blocked
    where h.bucket = p_bucket and h.key_hash = p_key_hash and h.window_start = v_window;
    return v_blocked;
  end if;
  return null;
end;
$$;
comment on function public.upload_rate_hit(text, bytea, timestamptz) is
  'v4.5 (plan C1-C2), service_role only: counts one hit for a network (key_hash = HMAC of the IP, never '
  'the IP) in its minute. bad_link: the 11th in a minute blocks for 15 minutes; open: the 61st blocks to '
  'the end of the minute. Returns blocked_until while blocked, else null.';
revoke all on function public.upload_rate_hit(text, bytea, timestamptz) from public, anon, authenticated;
grant execute on function public.upload_rate_hit(text, bytea, timestamptz) to service_role;

-- 5. "Removed in Drive" (Q7; DATA-MODEL §8a): a metadata read, never a delete -------------------------
create function public.upload_drive_check_claim(p_file_ids uuid[], p_now timestamptz)
returns table (file_id uuid, drive_file_id text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  update public.upload_files f set drive_checked_at = p_now
  from public.drive_account a
  where f.id = any (p_file_ids) and f.state = 'done'
    and a.org_id = f.org_id and a.state = 'connected' and f.account_sub = a.google_sub
    and (f.drive_checked_at is null or f.drive_checked_at <= p_now - interval '10 minutes')
  returning f.id, f.drive_file_id;
end;
$$;
comment on function public.upload_drive_check_claim(uuid[], timestamptz) is
  'v4.5 (Q7, plan F6), service_role only: of the files on the sheet an Admin has open (after the server '
  'action passed upload_uploader_files'' check), the received ones on the connected account not checked '
  'in the last 10 minutes; stamps drive_checked_at = p_now in the same statement, so two Admins opening '
  'one sheet read Drive once.';
revoke all on function public.upload_drive_check_claim(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.upload_drive_check_claim(uuid[], timestamptz) to service_role;

create function public.upload_drive_check_daily(p_now timestamptz, p_limit integer default 200)
returns table (file_id uuid, drive_file_id text, state text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select f.id
    from public.upload_files f
    join public.upload_links l on l.id = f.link_id
    join public.drive_account a on a.org_id = f.org_id and a.state = 'connected' and f.account_sub = a.google_sub
    where ((f.state = 'done' and (l.stopped_at is null or l.stopped_at >= p_now - interval '30 days'))
           or (f.state = 'missing_in_drive' and f.missing_seen_at >= p_now - interval '30 days'))
      and (f.drive_checked_at is null or f.drive_checked_at <= p_now - interval '10 minutes')
    order by f.drive_checked_at nulls first, f.id
    limit greatest(coalesce(p_limit, 200), 1)
    for update of f skip locked
  )
  update public.upload_files f set drive_checked_at = p_now
  from due where f.id = due.id
  returning f.id, f.drive_file_id, f.state;
end;
$$;
comment on function public.upload_drive_check_daily(timestamptz, integer) is
  'v4.5 (WORKFLOWS §8 drive_space_check, Q7), service_role only: the daily pass, p_limit at a time: the '
  'received files of links active in the last 30 days (not stopped, or stopped within 30 days) and the '
  'files marked missing_in_drive in the last 30 days (to find a restored one), on the connected '
  'account, skipping any checked in the last 10 minutes; stamps drive_checked_at.';
revoke all on function public.upload_drive_check_daily(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.upload_drive_check_daily(timestamptz, integer) to service_role;

create function public.upload_drive_seen(p_file_id uuid, p_outcome text, p_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.upload_files;
begin
  if p_outcome is null or p_outcome not in ('not_found', 'trashed', 'present') or p_at is null then
    perform app.fail('VALIDATION', 'Drive''s answer is not_found, trashed or present, with its time.');
  end if;
  select f.* into v_file from public.upload_files f where f.id = p_file_id for update;
  if v_file.id is null then
    perform app.fail('NOT_FOUND', 'This file does not exist.');
  end if;
  if v_file.state = 'done' and p_outcome in ('not_found', 'trashed') then
    update public.upload_files
    set state = 'missing_in_drive', missing_seen_at = p_at, drive_checked_at = p_at
    where id = v_file.id;
    insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
    values (v_file.org_id, null, 'upload_files', v_file.id, 'missing_in_drive',
      jsonb_build_object('state', jsonb_build_object('from', 'done', 'to', 'missing_in_drive')),
      jsonb_build_object('task_id', v_file.task_id, 'uploader_id', v_file.uploader_id, 'name', v_file.name,
                         'drive_file_id', v_file.drive_file_id, 'seen', p_outcome));
    return 'missing_in_drive';
  end if;
  if v_file.state = 'missing_in_drive' and p_outcome = 'present' then
    -- Restored from the Drive bin (advisor 19 Nov): received again; missing_seen_at stays for the record.
    update public.upload_files set state = 'done', drive_checked_at = p_at where id = v_file.id;
    insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
    values (v_file.org_id, null, 'upload_files', v_file.id, 'back_in_drive',
      jsonb_build_object('state', jsonb_build_object('from', 'missing_in_drive', 'to', 'done')),
      jsonb_build_object('task_id', v_file.task_id, 'uploader_id', v_file.uploader_id, 'name', v_file.name,
                         'drive_file_id', v_file.drive_file_id));
    return 'done';
  end if;
  return v_file.state;
end;
$$;
comment on function public.upload_drive_seen(uuid, text, timestamptz) is
  'v4.5 (Q7, plan F6), service_role only: what Drive answered for a recorded file. A done file Google '
  'no longer has (not_found) or holds in its bin (trashed) becomes missing_in_drive with '
  'missing_seen_at, history ''missing_in_drive'' (no actor; meta: name, Drive id, seen); a '
  'missing_in_drive file that is present again goes back to done, history ''back_in_drive''. Anything '
  'else changes nothing (idempotent). Nobody is notified. Returns the state.';
revoke all on function public.upload_drive_seen(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.upload_drive_seen(uuid, text, timestamptz) to service_role;

-- 6. The daily housekeeping (WORKFLOWS §8 upload_housekeeping, pg_cron 03:20 IST) ----------------------
create function app.upload_housekeeping(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- A row made on an IST day 90 or more days before today: made before the start of (today - 89) IST.
  -- Compared as instants, so the indexes on created_at are used.
  v_before timestamptz := ((app.to_ist_date(p_now) - 90) + 1)::timestamp at time zone 'Asia/Kolkata';
  v_uploaders integer;
  v_keys integer;
  v_files integer;
  v_gave_up integer;
  v_sessions integer;
  v_hits integer;
begin
  -- Q12, plan I3: network details of rows made 90 or more IST days ago. Names, files and every history
  -- row stay (no IP is ever in activity_log).
  update public.upload_uploaders u
  set ip = null, user_agent = null, device_label = null, network_erased_at = coalesce(u.network_erased_at, p_now)
  where u.created_at < v_before
    and (u.ip is not null or u.user_agent is not null or u.device_label is not null or u.network_erased_at is null);
  get diagnostics v_uploaders = row_count;
  update public.upload_uploaders u
  set device_key_hash = null, network_erased_at = coalesce(u.network_erased_at, p_now)
  where u.device_key_hash is not null and u.last_activity_at < v_before and u.created_at < v_before;
  get diagnostics v_keys = row_count;
  update public.upload_files f set ip = null, user_agent = null
  where f.created_at < v_before and (f.ip is not null or f.user_agent is not null);
  get diagnostics v_files = row_count;
  -- S5b (advisor 25 Nov): Google's sessions last about a week. A file still uploading on a session older
  -- than 8 days, or that never got a session in 8 days, will not finish: failed, gave_up, as when the
  -- browser gives up (no history row, nobody told). A later start of the same file reuses the row.
  update public.upload_files f set state = 'failed', failed_reason = 'gave_up'
  where f.state = 'uploading'
    and ((f.session_uri_encrypted is not null and f.session_opened_at < p_now - interval '8 days')
         or (f.session_uri_encrypted is null and f.updated_at < p_now - interval '8 days'));
  get diagnostics v_gave_up = row_count;
  -- An address older than 8 days is of no use.
  update public.upload_files f set session_uri_encrypted = null
  where f.session_uri_encrypted is not null and f.session_opened_at < p_now - interval '8 days';
  get diagnostics v_sessions = row_count;
  -- Bookkeeping, not history (as cron_history_trim).
  delete from public.upload_rate_hits h where h.window_start < p_now - interval '1 day';
  get diagnostics v_hits = row_count;
  return jsonb_build_object('uploaders', v_uploaders, 'device_keys', v_keys, 'files', v_files,
    'gave_up', v_gave_up, 'sessions', v_sessions, 'rate_hits', v_hits);
end;
$$;
comment on function app.upload_housekeeping(timestamptz) is
  'v4.5 (WORKFLOWS §8 upload_housekeeping, Q12, plan I3), pg_cron daily at 03:20 IST: nulls ip, '
  'user_agent and device_label of uploaders and files made 90 or more IST days before p_now, and the '
  'device_key_hash of uploaders whose last activity is that old too, setting network_erased_at; marks a '
  'file still uploading on a session older than 8 days (or with no session for 8 days) failed, gave_up, '
  'with no history row or notice (S5b); clears session addresses older than 8 days; removes '
  'upload_rate_hits rows older than a day. Idempotent. Names, files and history stay. Returns the counts.';
revoke all on function app.upload_housekeeping(timestamptz) from public, anon, authenticated;
grant execute on function app.upload_housekeeping(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'upload_housekeeping') then
    perform cron.unschedule('upload_housekeeping');
  end if;
  perform cron.schedule('upload_housekeeping', '50 21 * * *', 'select app.upload_housekeeping(now())');
end;
$$;
