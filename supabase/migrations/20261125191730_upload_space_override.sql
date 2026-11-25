-- v4.5: a test-only override of the upload space guard's step and reserve (S7; advisor, 25 Nov 2026).
--
-- Why: a free 15 GB Gmail (the test account staging uses) can never take an upload under S7 (free
-- space rounded down to a 10 GB step, less a 10 GB reserve), so the staging round trip held every
-- file. Production's behaviour is unchanged: the decided 10 GB / 10 GB stays the rule.
--
-- How (expand-only; 20261125122610 stays as it was applied):
-- 1. public.upload_file_start_v2: upload_file_start's body, identical but for the guard's two
--    expressions, which read p_space_step and p_space_reserve (no defaults, so no ambiguous
--    overload; null means the decided value; a step is at least 1 GB, a reserve at least 0).
--    service_role only.
-- 2. public.upload_file_start (the same signature): re-created as a thin wrapper that calls _v2 with
--    10 GB / 10 GB, so any old caller and the decided rule are unchanged and no logic is duplicated.
-- The Worker calls _v2 with UPLOAD_SPACE_STEP_BYTES / UPLOAD_SPACE_RESERVE_BYTES when set (staging
-- only), else the decided values (modules/uploads, one constant).

create function public.upload_file_start_v2(
  p_token_hash bytea, p_device_key_hash bytea, p_name text, p_relative_path text, p_size_bytes bigint,
  p_mime_hint text, p_ip inet, p_user_agent text, p_space_step bigint, p_space_reserve bigint)
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
  -- The space guard's step and reserve (S7): the decided 10 GB / 10 GB unless the caller passes a
  -- test override (staging only; the Worker's env). A step is at least 1 GB, a reserve at least 0.
  v_step numeric := greatest(coalesce(p_space_step, 10000000000), 1000000000);
  v_reserve numeric := greatest(coalesce(p_space_reserve, 10000000000), 0);
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
  if p_size_bytes is null or p_size_bytes < 0 or p_size_bytes > 5000000000000 then
    perform app.fail('VALIDATION', 'A file''s size is 0 bytes to 5 TB.');
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
      -- Only files that are really on their way: moved (or started) in the last 15 minutes, on a live
      -- link. A stalled file, or one on a stopped link, never holds anyone else's start (one declared
      -- giant that stalls cannot freeze the organisation's uploads).
      select coalesce(sum(greatest(f.size_bytes - f.bytes_at_google, 0)), 0) into v_to_come
      from public.upload_files f
      join public.upload_links l on l.id = f.link_id and l.stopped_at is null
      join public.tasks t on t.id = l.task_id and t.state in ('todo', 'in_progress', 'changes_requested')
                         and t.archived_at is null
      where f.org_id = v_link.org_id and f.state = 'uploading' and f.id is distinct from v_file.id
        and coalesce(f.last_moved_at, f.session_opened_at, f.updated_at) > now() - interval '15 minutes';
      -- S7: the free space counts in whole 10 GB steps, so a held answer tells the uploader at most,
      -- coarsely, whether there is room (an accepted leftover risk, plan §8).
      if p_size_bytes > floor((v_drive.quota_total_bytes - v_drive.quota_used_bytes)::numeric / v_step) * v_step
                        - v_reserve - v_to_come then
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

comment on function public.upload_file_start_v2(bytea, bytea, text, text, bigint, text, inet, text, bigint, bigint) is
  'v4.5, service_role only: upload_file_start (see its comment) with the space guard''s step and reserve '
  'as parameters (S7): null is the decided 10 GB / 10 GB; a step is at least 1 GB, a reserve at least 0. '
  'Production''s Worker passes the decided values; staging may pass a test override (a free 15 GB test '
  'Drive can never take a file under 10 GB / 10 GB).';
revoke all on function public.upload_file_start_v2(bytea, bytea, text, text, bigint, text, inet, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.upload_file_start_v2(bytea, bytea, text, text, bigint, text, inet, text, bigint, bigint)
  to service_role;

create or replace function public.upload_file_start(
  p_token_hash bytea, p_device_key_hash bytea, p_name text, p_relative_path text, p_size_bytes bigint,
  p_mime_hint text, p_ip inet, p_user_agent text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  -- The decided space guard (S7): a 10 GB step and a 10 GB reserve.
  select public.upload_file_start_v2(p_token_hash, p_device_key_hash, p_name, p_relative_path, p_size_bytes,
    p_mime_hint, p_ip, p_user_agent, 10000000000, 10000000000);
$$;
comment on function public.upload_file_start(bytea, bytea, text, text, bigint, text, inet, text) is
  'v4.5 (plan B4, C4-C5, C8, C11, E2-E3, Q11), service_role only: upload_file_start_v2 with the decided '
  'space guard (free space rounded down to 10 GB, less 10 GB and the bytes still to come). Kept for its '
  'callers; the Worker calls _v2.';
revoke all on function public.upload_file_start(bytea, bytea, text, text, bigint, text, inet, text)
  from public, anon, authenticated;
grant execute on function public.upload_file_start(bytea, bytea, text, text, bigint, text, inet, text) to service_role;
