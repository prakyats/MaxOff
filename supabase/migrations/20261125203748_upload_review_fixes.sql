-- v4.5 security review pass 2 (advisor, 25 Nov 2026): fixes in the upload link's public functions.
-- Expand-only: 20261125122607, 20261125122610 and 20261125191730 stay as applied; this re-creates
-- functions with the same signatures and adds one nullable column and two service_role functions.
--
-- 1. C8: upload_file_start_v2 also counts what Google took since the quota was read (files received
--    since, and what files opened since hold), so parallel starts cannot overshoot; and
--    upload_quota_stale tells the Worker when a link's organisation's reading is older than 5
--    minutes, so it reads Google's quota again first (WORKFLOWS §5B.6).
-- 2. done's Google check at most once per file per 5 s: upload_files.google_checked_at and
--    upload_done_check_claim (a loop of `done` on an uploading file cannot burn the studio's Drive
--    API quota).
-- 3. Every public call is counted per network in a new `call` bucket (1,200 a minute: a real bulk
--    upload of small photos makes a few hundred calls; the `open` bucket's 60 would stop it).
-- 4. G1: housekeeping's "failed for good" files each get a history row.

alter table public.upload_files add column google_checked_at timestamptz null;
comment on column public.upload_files.google_checked_at is
  'v4.5 (review pass 2): when the Worker last asked Google about this file for `done`; at most once per 5 s.';

alter table public.upload_rate_hits drop constraint upload_rate_hits_bucket_check;
alter table public.upload_rate_hits add constraint upload_rate_hits_bucket_check
  check (bucket in ('bad_link', 'open', 'call'));

create or replace function public.upload_file_start_v2(
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
      -- C8 (security review pass 2, advisor 25 Nov 2026): the quota is a reading (refreshed by the
      -- Worker when older than 5 minutes), so what Google took since it was read counts too, or
      -- parallel starts within those minutes could overshoot: files received since the reading,
      -- and what files opened since already hold (their rest is in v_to_come above).
      select v_to_come + coalesce(sum(case when f.state in ('done', 'missing_in_drive') then f.size_bytes
                                           else f.bytes_at_google end), 0)
        into v_to_come
      from public.upload_files f
      where f.org_id = v_link.org_id and f.id is distinct from v_file.id
        and ((f.state in ('done', 'missing_in_drive')
              and f.done_at > coalesce(v_drive.quota_checked_at, '-infinity'::timestamptz))
          or (f.state = 'uploading'
              and f.session_opened_at > coalesce(v_drive.quota_checked_at, '-infinity'::timestamptz)));
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


create or replace function public.upload_rate_hit(p_bucket text, p_key_hash bytea, p_at timestamptz)
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
  if p_bucket is null or p_bucket not in ('bad_link', 'open', 'call') or p_key_hash is null
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
  if v_hits > (case p_bucket when 'bad_link' then 10 when 'call' then 1200 else 60 end) then
    v_blocked := case p_bucket when 'bad_link' then p_at + interval '15 minutes' else v_window + interval '1 minute' end;
    update public.upload_rate_hits h set blocked_until = v_blocked
    where h.bucket = p_bucket and h.key_hash = p_key_hash and h.window_start = v_window;
    return v_blocked;
  end if;
  return null;
end;
$$;


create or replace function app.upload_housekeeping(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- A row made on an IST day 90 or more days before today: made before the start of (today - 89) IST.
  -- Compared as instants, so the indexes on created_at are used.
  v_before timestamptz := ((app.to_ist_date(p_now) - 90) + 1)::timestamp at time zone 'Asia/Kolkata';
  v_org uuid;
  n_uploaders integer;
  n_keys integer;
  n_files integer;
  n_gave_up integer;
  n_sessions integer;
  v_uploaders integer := 0;
  v_keys integer := 0;
  v_files integer := 0;
  v_gave_up integer := 0;
  v_sessions integer := 0;
  v_hits integer;
begin
  -- One organisation at a time, so each gets its own summary row (counts only).
  for v_org in select distinct l.org_id from public.upload_links l loop
    -- Q12, plan I3: network details of rows made 90 or more IST days ago. Names, files and every
    -- history row stay (no IP is ever in activity_log).
    update public.upload_uploaders u
    set ip = null, user_agent = null, device_label = null, network_erased_at = coalesce(u.network_erased_at, p_now)
    where u.org_id = v_org and u.created_at < v_before
      and (u.ip is not null or u.user_agent is not null or u.device_label is not null or u.network_erased_at is null);
    get diagnostics n_uploaders = row_count;
    update public.upload_uploaders u
    set device_key_hash = null, network_erased_at = coalesce(u.network_erased_at, p_now)
    where u.org_id = v_org and u.device_key_hash is not null and u.last_activity_at < v_before
      and u.created_at < v_before;
    get diagnostics n_keys = row_count;
    update public.upload_files f set ip = null, user_agent = null
    where f.org_id = v_org and f.created_at < v_before and (f.ip is not null or f.user_agent is not null);
    get diagnostics n_files = row_count;
    -- S5b (advisor 25 Nov): Google's sessions last about a week. A file still uploading on a session
    -- older than 8 days, or that never got a session in 8 days, will not finish: failed, gave_up, as
    -- when the browser gives up (nobody told). A later start reuses the row.
    -- G1 (review pass 2): each file failed for good here gets its own history row, like any other
    -- failure (reason gave_up; no name, no IP, nobody told).
    with gone as (
      update public.upload_files f set state = 'failed', failed_reason = 'gave_up'
      where f.org_id = v_org and f.state = 'uploading'
        and ((f.session_uri_encrypted is not null and f.session_opened_at < p_now - interval '8 days')
             or (f.session_uri_encrypted is null and f.updated_at < p_now - interval '8 days'))
      returning f.id, f.org_id, f.uploader_id, f.task_id
    )
    insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
    select g.org_id, null, 'upload_files', g.id, 'failed', '{}'::jsonb,
      jsonb_build_object('reason', 'gave_up', 'by', 'housekeeping', 'uploader_id', g.uploader_id, 'task_id', g.task_id)
    from gone g;
    get diagnostics n_gave_up = row_count;
    -- An address older than 8 days is of no use.
    update public.upload_files f set session_uri_encrypted = null
    where f.org_id = v_org and f.session_uri_encrypted is not null and f.session_opened_at < p_now - interval '8 days';
    get diagnostics n_sessions = row_count;
    if n_uploaders + n_keys + n_files + n_gave_up + n_sessions > 0 then
      insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
      values (v_org, null, 'upload_housekeeping', v_org, 'ran', '{}'::jsonb,
        jsonb_build_object('uploaders', n_uploaders, 'device_keys', n_keys, 'files', n_files,
                           'gave_up', n_gave_up, 'sessions', n_sessions));
    end if;
    v_uploaders := v_uploaders + n_uploaders;
    v_keys := v_keys + n_keys;
    v_files := v_files + n_files;
    v_gave_up := v_gave_up + n_gave_up;
    v_sessions := v_sessions + n_sessions;
  end loop;
  -- Bookkeeping, not history (as cron_history_trim).
  delete from public.upload_rate_hits h where h.window_start < p_now - interval '1 day';
  get diagnostics v_hits = row_count;
  return jsonb_build_object('uploaders', v_uploaders, 'device_keys', v_keys, 'files', v_files,
    'gave_up', v_gave_up, 'sessions', v_sessions, 'rate_hits', v_hits);
end;
$$;


create function public.upload_quota_stale(p_token_hash bytea, p_max_age interval)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.org_id from public.upload_links l
  join public.drive_account a on a.org_id = l.org_id and a.state = 'connected'
  where l.token_hash = p_token_hash and l.stopped_at is null
    and (a.quota_checked_at is null or a.quota_checked_at < now() - greatest(coalesce(p_max_age, interval '5 minutes'), interval '1 minute'))
  limit 1;
$$;
comment on function public.upload_quota_stale(bytea, interval) is
  'v4.5 (C8, review pass 2), service_role only: the organisation of an alive link whose connected Drive''s '
  'quota reading is older than p_max_age (at least 1 minute), else null. The Worker then reads Google''s '
  'quota again (drive_record_quota) before upload_file_start_v2.';
revoke all on function public.upload_quota_stale(bytea, interval) from public, anon, authenticated;
grant execute on function public.upload_quota_stale(bytea, interval) to service_role;

create function public.upload_done_check_claim(p_file_id uuid, p_now timestamptz)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with claimed as (
    update public.upload_files f set google_checked_at = p_now
    where f.id = p_file_id and (f.google_checked_at is null or f.google_checked_at <= p_now - interval '5 seconds')
    returning f.id
  )
  select exists (select 1 from claimed);
$$;
comment on function public.upload_done_check_claim(uuid, timestamptz) is
  'v4.5 (review pass 2), service_role only: true, and stamps the file, when the Worker may ask Google about '
  'it for `done` (at most once per 5 s); false otherwise (the page asks again later).';
revoke all on function public.upload_done_check_claim(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.upload_done_check_claim(uuid, timestamptz) to service_role;
