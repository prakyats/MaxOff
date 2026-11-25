-- v5.0 "Hand in work" (owner decisions 25 Nov 2026, #89 7161998756; plan
-- docs/handoff/v50-hand-in-plan.md; DATA-MODEL §8b, WORKFLOWS §5C, PERMISSIONS §1, ADR-0010
-- amendment 2026-11-25). PROPOSED: unreleased until the sample and the plan are approved, and
-- released after v4.5. Expand-only: two new tables, new functions, one new notification kind,
-- task_submit_done re-created with its signature and grants. Nothing renamed or dropped.
--
-- The people on a task add files to the version the next Mark done hands in (the "open version":
-- one after the last task_submissions.version). Each file goes from the browser straight into
-- ‹task folder›/v‹n›/… in the studio Drive through a Google resumable session the Worker opened
-- (no MaxOff copy). Mark done ties the version's files to the task_submissions row it writes.
--
-- REBASE NOTE: v4.5 (released first) re-creates task_submit_done to stop the task's upload link
-- and defines app.upload_manager. When v4.5's migration lands on phase-v45, this migration is
-- re-timestamped after it, keeps v4.5's stop-link lines in task_submit_done, and drops its own
-- app.upload_manager if v4.5's is the same.
--
-- No audit trigger on either table: session addresses must never reach activity_log. The
-- functions write their own history rows (entity 'tasks', entity_id = the task, so the task's
-- existing history policy decides who reads them), with no Drive id and no session address.

-- 1. Tables ---------------------------------------------------------------------------------------
create table public.handin_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  task_id uuid not null references public.tasks (id),
  version integer not null check (version >= 1),
  submission_id uuid null references public.task_submissions (id),
  added_by uuid not null references public.members (id),
  on_behalf_of uuid null references public.members (id),
  name text not null check (length(name) between 1 and 255 and name !~ '[/\\]'),
  relative_path text not null default '' check (length(relative_path) <= 2000),
  size_bytes bigint not null check (size_bytes >= 0),
  mime_hint text null check (mime_hint is null or length(mime_hint) <= 100),
  state text not null default 'uploading'
    check (state in ('uploading', 'done', 'failed', 'left_out', 'missing_in_drive')),
  failed_reason text null
    check (failed_reason is null or failed_reason in ('damaged', 'size_mismatch', 'wrong_folder', 'gave_up', 'unreadable')),
  account_sub text not null check (length(btrim(account_sub)) between 1 and 255),
  drive_parent_id text null,
  drive_file_id text null unique,
  session_uri_encrypted text null,
  session_opened_at timestamptz null,
  bytes_at_google bigint not null default 0 check (bytes_at_google >= 0),
  bytes_reported bigint not null default 0 check (bytes_reported >= 0),
  last_moved_at timestamptz null,
  md5_page text null check (md5_page is null or md5_page ~ '^[0-9a-f]{32}$'),
  md5_drive text null check (md5_drive is null or md5_drive ~ '^[0-9a-f]{32}$'),
  check_kind text null check (check_kind is null or check_kind in ('md5', 'size_only')),
  done_at timestamptz null,
  left_out_at timestamptz null,
  left_out_by uuid null references public.members (id),
  drive_checked_at timestamptz null,
  missing_seen_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handin_files_done_has_drive check (
    state not in ('done', 'missing_in_drive') or (drive_file_id is not null and done_at is not null and check_kind is not null)),
  constraint handin_files_missing_seen check (state <> 'missing_in_drive' or missing_seen_at is not null),
  constraint handin_files_failed_reason check ((state = 'failed') = (failed_reason is not null)),
  constraint handin_files_left_out_who check ((state = 'left_out') = (left_out_at is not null and left_out_by is not null)),
  constraint handin_files_handed_in check (submission_id is null or state in ('done', 'missing_in_drive')),
  constraint handin_files_no_session_after check (
    session_uri_encrypted is null or state in ('uploading', 'failed'))
);
create index handin_files_task_version_idx on public.handin_files (task_id, version);
create index handin_files_uploading_idx on public.handin_files (state, last_moved_at) where state = 'uploading';
create index handin_files_submission_idx on public.handin_files (submission_id) where submission_id is not null;
create index handin_files_added_by_idx on public.handin_files (added_by);
create index handin_files_on_behalf_of_idx on public.handin_files (on_behalf_of) where on_behalf_of is not null;
create index handin_files_left_out_by_idx on public.handin_files (left_out_by) where left_out_by is not null;
create index handin_files_org_idx on public.handin_files (org_id);
alter table public.handin_files enable row level security;
revoke all on public.handin_files from public, anon, authenticated;
comment on table public.handin_files is
  'v5.0: one file of a task''s hand-in version (WORKFLOWS §5C). The bytes are in the studio Drive only '
  '(ADR-0010 amendment 2026-11-25). RLS on, no policy, no API grant: members read through handin_versions(), '
  'the Worker writes through the service-role functions. submission_id is set by task_submit_done when the '
  'version is handed in. No audit trigger (session addresses); the functions write their own history.';

create table public.handin_folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  task_id uuid not null references public.tasks (id),
  version integer not null check (version >= 1),
  account_sub text not null check (length(btrim(account_sub)) between 1 and 255),
  relative_path text not null default '' check (length(relative_path) <= 2000),
  drive_folder_id text not null check (length(btrim(drive_folder_id)) between 1 and 255),
  created_at timestamptz not null default now(),
  unique (task_id, account_sub, version, relative_path)
);
create index handin_folders_org_idx on public.handin_folders (org_id);
alter table public.handin_folders enable row level security;
revoke all on public.handin_folders from public, anon, authenticated;
comment on table public.handin_folders is
  'v5.0: the Drive folders of a hand-in version (relative_path '''' = the v‹n› folder under the task''s '
  'drive_folders row), keyed by what they are for and by the Google account, like drive_folders. '
  'RLS on, no policy, no API grant.';

-- 2. The kind (WORKFLOWS §9) -------------------------------------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, description) values
  ('handin_space_held', true, false,
   'The studio''s Google Drive is too full for a file someone is handing in (to the Owner, once a day; v5.0)');

-- 3. Helpers -----------------------------------------------------------------------------------------
-- The task's Admins (v4.5 Q1, owner 19 Nov: three people) and the Owner: who opens hand-in files in
-- Drive (v5.0 Q6, proposed). Scope is live: each condition holds only while its key or role does.
create or replace function app.upload_manager(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me public.members;
  v_task public.tasks;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    return false;
  end if;
  select t.* into v_task from public.tasks t where t.id = p_task_id and t.org_id = v_me.org_id;
  if v_task.id is null then
    return false;
  end if;
  if v_me.role = 'owner' then
    return true;
  end if;
  if v_task.created_by = v_me.id and app.has_permission('tasks.create') then
    return true;
  end if;
  if v_task.approving_admin_id = v_me.id and app.has_permission('tasks.approve_admin') then
    return true;
  end if;
  return v_me.role = 'admin' and exists (
    select 1 from public.members f
    where f.id = v_task.primary_owner_id and f.engagement = 'freelance' and f.status = 'active'
      and app.coordinator_of(f.id) = v_me.id);
end;
$$;
revoke all on function app.upload_manager(uuid) from public, anon;
grant execute on function app.upload_manager(uuid) to authenticated, service_role;
comment on function app.upload_manager(uuid) is
  'The Owner, or one of the task''s Admins: its creator holding tasks.create, its approving Admin holding '
  'tasks.approve_admin, or the active Admin who coordinates the active freelancer who is its primary owner '
  '(v4.5 Q1; v5.0 reads it for the Open-in-Drive links).';

-- The v4.5 B2 cleaning, repeated by the server (modules/handin/domain/files.ts is the screen's copy).
create or replace function app.handin_clean_part(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(normalize(coalesce(p, ''), NFC),
        '[\x01-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]', '', 'g'),
      '[/\\]', '', 'g'),
    '\s+', ' ', 'g'));
$$;

create or replace function app.handin_clean_name(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := app.handin_clean_part(p);
  v_ext text;
begin
  if v in ('', '.', '..') then
    return null;
  end if;
  if char_length(v) > 255 then
    v_ext := substring(v from '(\.[^.]{1,15})$');
    v := left(v, 255 - coalesce(char_length(v_ext), 0)) || coalesce(v_ext, '');
  end if;
  return v;
end;
$$;

create or replace function app.handin_clean_path(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[];
begin
  select coalesce(array_agg(left(c, 120) order by n), '{}') into v_parts
  from (select app.handin_clean_part(x) c, n
        from unnest(regexp_split_to_array(coalesce(p, ''), '[/\\]')) with ordinality as u(x, n)) s
  where c not in ('', '.', '..');
  if cardinality(v_parts) > 12 then
    perform app.fail('VALIDATION', 'That folder is nested too deep: at most 12 folders inside each other.');
  end if;
  return array_to_string(v_parts, '/');
end;
$$;
revoke all on function app.handin_clean_part(text) from public, anon;
revoke all on function app.handin_clean_name(text) from public, anon;
revoke all on function app.handin_clean_path(text) from public, anon;
grant execute on function app.handin_clean_part(text) to authenticated, service_role;
grant execute on function app.handin_clean_name(text) to authenticated, service_role;
grant execute on function app.handin_clean_path(text) to authenticated, service_role;

create or replace function app.handin_open_version(p_task_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(s.version), 0) + 1 from public.task_submissions s where s.task_id = p_task_id;
$$;
revoke all on function app.handin_open_version(uuid) from public, anon;
grant execute on function app.handin_open_version(uuid) to authenticated, service_role;

-- The caller may add files to this task: an active assignee with tasks.work, or the current
-- coordinator of an active freelancer assignee. Never raises (for the read's can_add).
create or replace function app.handin_can_add(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null or v_me.engagement <> 'permanent' or not app.has_permission('tasks.work') then
    return false;
  end if;
  return app.is_task_assignee(p_task_id, v_me.id) or exists (
    select 1 from public.task_assignees a join public.members f on f.id = a.member_id
    where a.task_id = p_task_id and a.removed_at is null and f.engagement = 'freelance'
      and f.status = 'active' and app.coordinator_of(f.id) = v_me.id);
end;
$$;
revoke all on function app.handin_can_add(uuid) from public, anon;
grant execute on function app.handin_can_add(uuid) to authenticated, service_role;

-- 4. The read ------------------------------------------------------------------------------------------
create or replace function public.handin_versions(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members;
  v_task public.tasks;
  v_reviewer boolean;
  v_open integer;
  v_sub text;
  v_drive text;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.task_visible(p_task_id) then
    perform app.fail('NOT_FOUND', 'This task does not exist.');
  end if;
  select t.* into v_task from public.tasks t where t.id = p_task_id;
  v_reviewer := app.upload_manager(p_task_id);
  v_open := app.handin_open_version(p_task_id);
  select a.state, a.google_sub into v_drive, v_sub from public.drive_account a where a.org_id = v_task.org_id;

  return jsonb_build_object(
    'open_version', v_open,
    'task_open', v_task.state in ('todo', 'in_progress', 'changes_requested') and v_task.archived_at is null,
    'can_add', app.handin_can_add(p_task_id),
    'drive', coalesce(v_drive, 'never'),
    'reviewer', v_reviewer,
    'versions', coalesce((
      select jsonb_agg(v order by (v ->> 'version')::int desc)
      from (
        select jsonb_build_object(
          'version', vn.version,
          'handed_in', s.id is not null,
          'submission_id', s.id,
          'submitted_at', s.at,
          'submitted_by', s.submitted_by,
          'on_behalf_of', s.on_behalf_of,
          'folder_id', case when v_reviewer then (
             select f.drive_folder_id from public.handin_folders f
             where f.task_id = p_task_id and f.version = vn.version and f.relative_path = ''
               and f.account_sub = v_sub) end,
          'files', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', h.id,
              'name', h.name,
              'relative_path', h.relative_path,
              'size', h.size_bytes,
              'state', h.state,
              'failed_reason', h.failed_reason,
              'bytes', greatest(h.bytes_at_google, h.bytes_reported),
              'added_by', h.added_by,
              'on_behalf_of', h.on_behalf_of,
              'mine', h.added_by = v_me.id,
              'done_at', h.done_at,
              'left_out_at', h.left_out_at,
              'left_out_by', h.left_out_by,
              'check_kind', h.check_kind,
              'after_handin', s.id is not null and h.submission_id is null and h.state = 'done',
              'drive_file_id', case when v_reviewer then h.drive_file_id end)
              order by h.relative_path, h.name, h.created_at)
            from public.handin_files h where h.task_id = p_task_id and h.version = vn.version), '[]'::jsonb)) v
        from (select s2.version from public.task_submissions s2 where s2.task_id = p_task_id
              union
              select h2.version from public.handin_files h2 where h2.task_id = p_task_id) vn
        left join public.task_submissions s on s.task_id = p_task_id and s.version = vn.version
      ) x), '[]'::jsonb));
end;
$$;
revoke all on function public.handin_versions(uuid) from public, anon;
grant execute on function public.handin_versions(uuid) to authenticated, service_role;
comment on function public.handin_versions(uuid) is
  'v5.0: a task''s hand-in versions and their files, newest first, for anyone who sees the task '
  '(NOT_FOUND otherwise). drive_file_id and the version folder''s folder_id only for app.upload_manager '
  '(the Owner and the task''s Admins, Q6); never a session address. Also: the open version, whether the '
  'caller may add files now, and the Drive state.';

-- The count the Approvals rows show ("v2 · 14 files"): per handed-in version, its files in Drive.
create or replace function public.handin_counts(p_submission_ids uuid[])
returns table (submission_id uuid, files integer, bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from app.current_member()) then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if p_submission_ids is null or cardinality(p_submission_ids) > 500 then
    perform app.fail('VALIDATION', 'Ask for at most 500 hand-ins at a time.');
  end if;
  return query
  select h.submission_id, count(*)::integer, coalesce(sum(h.size_bytes), 0)::bigint
  from public.handin_files h
  where h.submission_id = any (p_submission_ids)
    and h.state in ('done', 'missing_in_drive')
    and app.task_visible(h.task_id)
  group by h.submission_id;
end;
$$;
revoke all on function public.handin_counts(uuid[]) from public, anon;
grant execute on function public.handin_counts(uuid[]) to authenticated, service_role;
comment on function public.handin_counts(uuid[]) is
  'v5.0: per handed-in version (task_submissions id, at most 500), the files it holds in Drive and their '
  'bytes, for the tasks the caller sees (others are left out). What the Approvals rows show.';

-- 5. Member transitions ---------------------------------------------------------------------------------
create or replace function public.handin_file_start(
  p_task_id uuid, p_name text, p_relative_path text, p_size_bytes bigint,
  p_mime_hint text default null, p_on_behalf_of uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_subject uuid;
  v_org uuid;
  v_task public.tasks;
  v_drive public.drive_account;
  v_name text := app.handin_clean_name(p_name);
  v_path text := app.handin_clean_path(p_relative_path);
  v_mime text := nullif(left(btrim(coalesce(p_mime_hint, '')), 100), '');
  v_version integer;
  v_row public.handin_files;
  v_free bigint;
  v_owner uuid;
begin
  select a.actor_id, a.subject_id, a.org_id into v_actor, v_subject, v_org
  from app.task_actor(p_task_id, p_on_behalf_of) a;
  v_task := app.task_lock(p_task_id, v_org);
  if v_task.state not in ('todo', 'in_progress', 'changes_requested') or v_task.archived_at is not null then
    perform app.fail('INVALID_STATE', 'Files can be added only while the task is open.');
  end if;
  select d.* into v_drive from public.drive_account d where d.org_id = v_org;
  if v_drive.org_id is null or v_drive.state <> 'connected' then
    perform app.fail('INVALID_STATE', 'Handing in files is off until the Owner reconnects Google Drive.');
  end if;
  if v_name is null then
    perform app.fail('VALIDATION', 'This file has no usable name.');
  end if;
  if p_size_bytes is null or p_size_bytes < 0 then
    perform app.fail('VALIDATION', 'This file''s size is unknown.');
  end if;
  v_version := app.handin_open_version(v_task.id);

  -- Already added (any adder): the same folder, name and size in this version.
  select h.* into v_row from public.handin_files h
  where h.task_id = v_task.id and h.version = v_version and h.state = 'done'
    and h.relative_path = v_path and h.name = v_name and h.size_bytes = p_size_bytes
  limit 1;
  if v_row.id is not null then
    return jsonb_build_object('outcome', 'already_added', 'file_id', v_row.id, 'version', v_version);
  end if;

  -- The same person's earlier try of this file, still on its way or failed: carry on with it.
  select h.* into v_row from public.handin_files h
  where h.task_id = v_task.id and h.version = v_version and h.added_by = v_actor
    and h.on_behalf_of is not distinct from p_on_behalf_of and h.state in ('uploading', 'failed')
    and h.relative_path = v_path and h.name = v_name and h.size_bytes = p_size_bytes
    and h.account_sub = v_drive.google_sub
  order by h.created_at desc limit 1
  for update;
  if v_row.id is not null then
    update public.handin_files
    set state = 'uploading', failed_reason = null, updated_at = now()
    where id = v_row.id;
    return jsonb_build_object('outcome', 'resume', 'file_id', v_row.id, 'version', v_version,
      'has_session', v_row.session_uri_encrypted is not null, 'name', v_name, 'relative_path', v_path,
      'size', p_size_bytes);
  end if;

  if (select count(*) from public.handin_files h
      where h.task_id = v_task.id and h.added_by = v_actor and h.state = 'uploading') >= 6 then
    return jsonb_build_object('outcome', 'wait', 'seconds', 5, 'version', v_version);
  end if;
  if (select count(*) from public.handin_files h
      where h.task_id = v_task.id and h.version = v_version and h.state <> 'left_out') >= 2000 then
    perform app.fail('VALIDATION', 'A hand-in holds at most 2,000 files.');
  end if;

  -- The space guard (v4.5 Q11): 10 GB kept free, and what is still on its way counts.
  if v_drive.quota_total_bytes is not null and v_drive.quota_used_bytes is not null then
    v_free := v_drive.quota_total_bytes - v_drive.quota_used_bytes - 10::bigint * 1024 * 1024 * 1024
      - coalesce((select sum(greatest(h.size_bytes - h.bytes_at_google, 0)) from public.handin_files h
                  where h.org_id = v_org and h.state = 'uploading'), 0);
    if p_size_bytes > v_free then
      v_owner := app.org_owner_id(v_org);
      if not exists (select 1 from public.notifications n
                     where n.recipient_id = v_owner and n.kind = 'handin_space_held'
                       and n.created_at >= (app.today_ist()::timestamp at time zone 'Asia/Kolkata')) then
        perform app.notify(array[v_owner], 'handin_space_held', 'Studio Drive too full for a hand-in',
          format('%s couldn''t add a file to %s. Free up space in the studio''s Google Drive.',
                 app.member_name(v_subject), v_task.title),
          '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), v_actor);
      end if;
      return jsonb_build_object('outcome', 'space_full', 'version', v_version);
    end if;
  end if;

  insert into public.handin_files (org_id, task_id, version, added_by, on_behalf_of, name, relative_path,
                                   size_bytes, mime_hint, state, account_sub)
  values (v_org, v_task.id, v_version, v_actor, p_on_behalf_of, v_name, v_path, p_size_bytes, v_mime,
          'uploading', v_drive.google_sub)
  returning * into v_row;
  return jsonb_build_object('outcome', 'start', 'file_id', v_row.id, 'version', v_version, 'has_session', false,
    'name', v_name, 'relative_path', v_path, 'size', p_size_bytes);
end;
$$;
revoke all on function public.handin_file_start(uuid, text, text, bigint, text, uuid) from public, anon;
grant execute on function public.handin_file_start(uuid, text, text, bigint, text, uuid) to authenticated, service_role;
comment on function public.handin_file_start(uuid, text, text, bigint, text, uuid) is
  'v5.0: the caller (app.task_actor: an assignee, or a freelancer assignee''s coordinator) adds one file '
  'to the task''s open version while the task is open and Drive is connected. Outcomes: already_added '
  '(the same path, name and size is in Drive for this version, whoever added it), resume (the caller''s '
  'own earlier try), wait (6 already uploading), space_full (the Owner told once a IST day), start. The '
  'Worker then makes the folders and opens the Google session (service role).';

-- A file's own adder only; the reads go through the file, so the caller's scope is the file's task.
create or replace function app.handin_own_file(p_file_id uuid)
returns public.handin_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.members;
  v_row public.handin_files;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  select h.* into v_row from public.handin_files h where h.id = p_file_id and h.org_id = v_me.org_id for update;
  if v_row.id is null or not app.task_visible(v_row.task_id) then
    perform app.fail('NOT_FOUND', 'This file does not exist.');
  end if;
  if v_row.added_by <> v_me.id then
    perform app.fail('FORBIDDEN', 'Only the person who added this file can do that.');
  end if;
  return v_row;
end;
$$;
revoke all on function app.handin_own_file(uuid) from public, anon;
grant execute on function app.handin_own_file(uuid) to authenticated, service_role;

create or replace function public.handin_progress(p_file_id uuid, p_bytes bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.handin_files := app.handin_own_file(p_file_id);
begin
  if v_row.state <> 'uploading' or p_bytes is null or p_bytes <= v_row.bytes_reported then
    return;
  end if;
  -- At most one write per file every 5 seconds (v4.5 C6); the last report always moves the clock.
  if v_row.last_moved_at is not null and v_row.last_moved_at > now() - interval '5 seconds'
     and p_bytes < v_row.size_bytes then
    return;
  end if;
  update public.handin_files
  set bytes_reported = least(p_bytes, size_bytes), last_moved_at = now(), updated_at = now()
  where id = v_row.id;
end;
$$;
revoke all on function public.handin_progress(uuid, bigint) from public, anon;
grant execute on function public.handin_progress(uuid, bigint) to authenticated, service_role;
comment on function public.handin_progress(uuid, bigint) is
  'v5.0: the adder''s browser reports bytes sent for its own uploading file (at most one write per 5 s). '
  'Not history.';

create or replace function public.handin_file_failed(p_file_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.handin_files := app.handin_own_file(p_file_id);
begin
  if p_reason is null or p_reason not in ('damaged', 'gave_up', 'unreadable') then
    perform app.fail('VALIDATION', 'Unknown reason.');
  end if;
  if v_row.state <> 'uploading' then
    return;
  end if;
  update public.handin_files set state = 'failed', failed_reason = p_reason, updated_at = now()
  where id = v_row.id;
end;
$$;
revoke all on function public.handin_file_failed(uuid, text) from public, anon;
grant execute on function public.handin_file_failed(uuid, text) to authenticated, service_role;
comment on function public.handin_file_failed(uuid, text) is
  'v5.0: the adder''s browser gives up on its own uploading file (damaged | gave_up | unreadable). A retry '
  'goes through handin_file_start, which finds the row and carries on. Not history: a failed file never '
  'reaches Drive.';

create or replace function public.handin_file_left_out(p_file_id uuid, p_on_behalf_of uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.members;
  v_row public.handin_files;
  v_actor uuid;
  v_subject uuid;
  v_org uuid;
  v_task public.tasks;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  select h.task_id into v_row.task_id from public.handin_files h where h.id = p_file_id and h.org_id = v_me.org_id;
  if v_row.task_id is null or not app.task_visible(v_row.task_id) then
    perform app.fail('NOT_FOUND', 'This file does not exist.');
  end if;
  select a.actor_id, a.subject_id, a.org_id into v_actor, v_subject, v_org
  from app.task_actor(v_row.task_id, p_on_behalf_of) a;
  v_task := app.task_lock(v_row.task_id, v_org);
  select h.* into v_row from public.handin_files h where h.id = p_file_id for update;
  if v_row.added_by <> v_actor and v_subject <> v_task.primary_owner_id then
    perform app.fail('FORBIDDEN', 'Only the person who added this file, or the primary owner, can leave it out.');
  end if;
  if v_task.state not in ('todo', 'in_progress', 'changes_requested') or v_task.archived_at is not null
     or v_row.version <> app.handin_open_version(v_task.id) then
    perform app.fail('INVALID_STATE', 'This version was already handed in.');
  end if;
  if v_row.state in ('left_out', 'missing_in_drive') then
    perform app.fail('INVALID_STATE', 'This file is already left out.');
  end if;
  update public.handin_files
  set state = 'left_out', failed_reason = null, left_out_at = now(), left_out_by = v_actor,
      session_uri_encrypted = null, updated_at = now()
  where id = v_row.id;
  insert into public.activity_log (org_id, actor_id, on_behalf_of_id, entity, entity_id, action, meta)
  values (v_org, v_actor, p_on_behalf_of, 'tasks', v_task.id, 'handin_file_left_out',
          jsonb_build_object('file_id', v_row.id, 'name', v_row.name, 'relative_path', v_row.relative_path,
                             'version', v_row.version, 'was', v_row.state));
end;
$$;
revoke all on function public.handin_file_left_out(uuid, uuid) from public, anon;
grant execute on function public.handin_file_left_out(uuid, uuid) to authenticated, service_role;
comment on function public.handin_file_left_out(uuid, uuid) is
  'v5.0 Q3 (proposed): before the version is handed in, the person who added a file (or the primary owner, '
  'or a freelancer primary''s coordinator) leaves it out. Nothing is deleted: the file stays in Drive and '
  'in the list as left out. History: tasks / handin_file_left_out.';

-- 6. The Worker (service role only) ----------------------------------------------------------------------
create or replace function public.handin_folder_find(
  p_task_id uuid, p_version integer, p_account_sub text, p_relative_path text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select f.drive_folder_id from public.handin_folders f
  where f.task_id = p_task_id and f.version = p_version and f.account_sub = p_account_sub
    and f.relative_path = p_relative_path;
$$;

create or replace function public.handin_folder_put(
  p_task_id uuid, p_version integer, p_account_sub text, p_relative_path text, p_drive_folder_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id text;
begin
  select t.org_id into v_org from public.tasks t where t.id = p_task_id;
  if v_org is null then
    perform app.fail('NOT_FOUND', 'This task does not exist.');
  end if;
  insert into public.handin_folders (org_id, task_id, version, account_sub, relative_path, drive_folder_id)
  values (v_org, p_task_id, p_version, p_account_sub, p_relative_path, p_drive_folder_id)
  on conflict (task_id, account_sub, version, relative_path) do nothing;
  select f.drive_folder_id into v_id from public.handin_folders f
  where f.task_id = p_task_id and f.version = p_version and f.account_sub = p_account_sub
    and f.relative_path = p_relative_path;
  return v_id;
end;
$$;

create or replace function public.handin_session_set(
  p_file_id uuid, p_account_sub text, p_drive_parent_id text, p_session_uri_encrypted text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.handin_files
  set drive_parent_id = p_drive_parent_id, session_uri_encrypted = p_session_uri_encrypted,
      session_opened_at = now(), last_moved_at = now(), updated_at = now()
  where id = p_file_id and state = 'uploading' and account_sub = p_account_sub;
  if not found then
    perform app.fail('INVALID_STATE', 'This file is no longer uploading.');
  end if;
end;
$$;

-- What the Worker needs to hand the browser its session again, or to ask Google about the file.
create or replace function public.handin_session_get(p_file_id uuid)
returns table (task_id uuid, version integer, name text, relative_path text, size_bytes bigint,
               state text, account_sub text, drive_parent_id text, session_uri_encrypted text)
language sql
stable
security definer
set search_path = ''
as $$
  select h.task_id, h.version, h.name, h.relative_path, h.size_bytes, h.state, h.account_sub,
         h.drive_parent_id, h.session_uri_encrypted
  from public.handin_files h where h.id = p_file_id;
$$;

create or replace function public.handin_file_done(
  p_file_id uuid, p_drive_file_id text, p_size bigint, p_md5_drive text, p_parent_id text,
  p_md5_page text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.handin_files;
  v_fail text;
  v_md5_drive text := lower(nullif(btrim(coalesce(p_md5_drive, '')), ''));
  v_md5_page text := lower(nullif(btrim(coalesce(p_md5_page, '')), ''));
begin
  select h.* into v_row from public.handin_files h where h.id = p_file_id for update;
  if v_row.id is null then
    perform app.fail('NOT_FOUND', 'This file does not exist.');
  end if;
  if v_row.state = 'done' then
    if v_row.drive_file_id = p_drive_file_id then
      return 'done';
    end if;
    perform app.fail('INVALID_STATE', 'This file is already in Drive.');
  end if;
  if v_row.state not in ('uploading', 'failed') then
    return v_row.state;
  end if;
  if p_size is distinct from v_row.size_bytes then
    v_fail := 'size_mismatch';
  elsif p_parent_id is distinct from v_row.drive_parent_id then
    v_fail := 'wrong_folder';
  elsif v_md5_page is not null and v_md5_drive is not null and v_md5_page <> v_md5_drive then
    v_fail := 'damaged';
  end if;
  if v_fail is not null then
    update public.handin_files set state = 'failed', failed_reason = v_fail, updated_at = now()
    where id = v_row.id;
    return 'failed';
  end if;
  update public.handin_files
  set state = 'done', failed_reason = null, drive_file_id = p_drive_file_id, md5_drive = v_md5_drive,
      md5_page = v_md5_page, check_kind = case when v_md5_page is not null and v_md5_drive is not null
                                               then 'md5' else 'size_only' end,
      bytes_at_google = v_row.size_bytes, bytes_reported = v_row.size_bytes, done_at = now(),
      last_moved_at = now(), session_uri_encrypted = null, updated_at = now()
  where id = v_row.id;
  insert into public.activity_log (org_id, actor_id, on_behalf_of_id, entity, entity_id, action, meta)
  values (v_row.org_id, v_row.added_by, v_row.on_behalf_of, 'tasks', v_row.task_id, 'handin_file_added',
          jsonb_build_object('file_id', v_row.id, 'name', v_row.name, 'relative_path', v_row.relative_path,
                             'size', v_row.size_bytes, 'version', v_row.version,
                             'check_kind', case when v_md5_page is not null and v_md5_drive is not null
                                                then 'md5' else 'size_only' end));
  return 'done';
end;
$$;

-- The "Removed in Drive" check (§8a's shape): claim the files due (not checked in 10 minutes), then
-- record what Google said. Only 404 or trashed counts as gone; anything else is not recorded.
create or replace function public.handin_drive_check_claim(p_file_ids uuid[])
returns table (file_id uuid, drive_file_id text, account_sub text)
language sql
security definer
set search_path = ''
as $$
  update public.handin_files h
  set drive_checked_at = now()
  where h.id = any (p_file_ids) and h.state in ('done', 'missing_in_drive')
    and (h.drive_checked_at is null or h.drive_checked_at < now() - interval '10 minutes')
  returning h.id, h.drive_file_id, h.account_sub;
$$;

create or replace function public.handin_drive_seen(p_file_id uuid, p_seen text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.handin_files;
begin
  if p_seen not in ('present', 'not_found', 'trashed') then
    perform app.fail('VALIDATION', 'Unknown answer.');
  end if;
  select h.* into v_row from public.handin_files h where h.id = p_file_id for update;
  if v_row.id is null then
    perform app.fail('NOT_FOUND', 'This file does not exist.');
  end if;
  if p_seen = 'present' and v_row.state = 'missing_in_drive' then
    update public.handin_files set state = 'done', updated_at = now() where id = v_row.id;
    insert into public.activity_log (org_id, actor_id, entity, entity_id, action, meta)
    values (v_row.org_id, null, 'tasks', v_row.task_id, 'handin_file_back_in_drive',
            jsonb_build_object('file_id', v_row.id, 'name', v_row.name, 'version', v_row.version));
    return 'done';
  elsif p_seen in ('not_found', 'trashed') and v_row.state = 'done' then
    update public.handin_files set state = 'missing_in_drive', missing_seen_at = now(), updated_at = now()
    where id = v_row.id;
    insert into public.activity_log (org_id, actor_id, entity, entity_id, action, meta)
    values (v_row.org_id, null, 'tasks', v_row.task_id, 'handin_file_missing_in_drive',
            jsonb_build_object('file_id', v_row.id, 'name', v_row.name, 'version', v_row.version, 'seen', p_seen));
    return 'missing_in_drive';
  end if;
  return v_row.state;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.handin_folder_find(uuid, integer, text, text)',
    'public.handin_folder_put(uuid, integer, text, text, text)',
    'public.handin_session_set(uuid, text, text, text)',
    'public.handin_session_get(uuid)',
    'public.handin_file_done(uuid, text, bigint, text, text, text)',
    'public.handin_drive_check_claim(uuid[])',
    'public.handin_drive_seen(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
comment on function public.handin_file_done(uuid, text, bigint, text, text, text) is
  'v5.0 (service role): the Worker asked Google itself (v4.5 F1). A size or parent that differs fails the '
  'file (size_mismatch / wrong_folder); an MD5 from the page that differs from Drive''s fails it (damaged); '
  'otherwise done (check_kind md5 or size_only), the session address cleared, history tasks / '
  'handin_file_added (no Drive id). Idempotent for the same Drive id.';

-- 7. Mark done hands the open version in (re-created: same signature, grants and every path) ----------------
create or replace function public.task_submit_done(
  task_id uuid, note text default null, late_reason text default null, on_behalf_of uuid default null)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_subject uuid;
  v_org uuid;
  v_task public.tasks;
  v_row public.task_assignees;
  v_note text := nullif(btrim(coalesce(task_submit_done.note, '')), '');
  v_late boolean;
  v_late_reason text := app.clean_reason(task_submit_done.late_reason);
  v_version integer;
  v_submission uuid;
  v_state public.task_state;
  v_step public.admin_step;
  v_meta jsonb;
  v_uploading integer;
  v_files integer;
  v_bytes bigint;
  v_tag text;
begin
  select a.actor_id, a.subject_id, a.org_id into v_actor, v_subject, v_org
  from app.task_actor(task_submit_done.task_id, task_submit_done.on_behalf_of) a;
  v_task := app.task_lock(task_submit_done.task_id, v_org);
  if v_subject <> v_task.primary_owner_id then
    perform app.fail('FORBIDDEN', 'Only the primary owner marks a task Done.');
  end if;
  if v_task.state in ('submitted', 'admin_approved') then
    perform app.fail('INVALID_STATE', 'Already submitted: the task is waiting for its review.');
  end if;
  if v_task.state = 'completed' then
    perform app.fail('INVALID_STATE', 'This task is complete.');
  end if;
  if v_task.state = 'cancelled' then
    perform app.fail('INVALID_STATE', 'This task was cancelled.');
  end if;
  if v_note is not null and length(v_note) > 5000 then
    perform app.fail('VALIDATION', 'Keep the note under 5000 characters.');
  end if;

  -- v5.0 (plan §3): the version waits for files still on their way; failed ones never block it.
  select coalesce(max(s.version), 0) + 1 into v_version from public.task_submissions s where s.task_id = v_task.id;
  select count(*) into v_uploading from public.handin_files h
  where h.task_id = v_task.id and h.version = v_version and h.state = 'uploading';
  if v_uploading > 0 then
    perform app.fail('INVALID_STATE', case when v_uploading = 1
      then '1 file is still uploading. Wait for it, or leave it out.'
      else format('%s files are still uploading. Wait for them, or leave them out.', v_uploading) end);
  end if;

  v_late := now() > v_task.due_at;
  if v_late and v_late_reason is null then
    perform app.fail('REASON_REQUIRED', 'The deadline has passed: say why the task is late.');
  end if;

  -- Done does not wait for acknowledgements: the primary owner's is recorded now if missing.
  select ta.* into v_row from public.task_assignees ta
  where ta.task_id = v_task.id and ta.member_id = v_subject for update;
  if v_row.acknowledged_at is null then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'acknowledged',
      'on_behalf_of', task_submit_done.on_behalf_of,
      'meta', jsonb_build_object('member_id', v_subject, 'implied', true))::text, true);
    update public.task_assignees set acknowledged_at = now(), acknowledged_by = v_actor
    where task_assignees.task_id = v_task.id and member_id = v_subject;
  end if;

  -- The hand-in: one version per Done or resubmit (WORKFLOWS §3.3).
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submission_added',
    'on_behalf_of', task_submit_done.on_behalf_of,
    'meta', jsonb_build_object('version', v_version))::text, true);
  insert into public.task_submissions (task_id, version, note, submitted_by, on_behalf_of)
  values (v_task.id, v_version, v_note, v_actor, task_submit_done.on_behalf_of)
  returning id into v_submission;

  -- v5.0: the version's files in Drive are handed in with it (left-out and failed ones are not).
  with tied as (
    update public.handin_files h set submission_id = v_submission, updated_at = now()
    where h.task_id = v_task.id and h.version = v_version and h.state = 'done'
    returning h.size_bytes)
  select count(*), coalesce(sum(size_bytes), 0) into v_files, v_bytes from tied;
  v_tag := case when v_files = 0 then ''
                else format(' · v%s · %s', v_version, case when v_files = 1 then '1 file' else v_files || ' files' end) end;

  -- 6b.2 (owner 2026-10-07): a task whose primary owner is the Owner completes on Done.
  if v_task.primary_owner_id = app.org_owner_id(v_org) then
    v_step := case when v_task.approving_admin_id is null then 'none' else 'skipped' end;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'completed',
      'meta', jsonb_build_object('step', 'owner_done', 'version', v_version, 'late', v_late,
                                 'submission_id', v_submission, 'files', v_files, 'bytes', v_bytes))::text, true);
    update public.tasks
    set state = 'completed', admin_step = v_step, submitted_at = now(), submitted_by = v_actor,
        submitted_on_behalf_of = null,
        late_reason = case when v_late then v_late_reason else tasks.late_reason end,
        admin_approved_at = null, completed_at = now()
    where id = v_task.id;
    perform app.notify(app.task_people(v_task.id, true), 'task_completed',
      'Completed: ' || v_task.title,
      format('%s marked it done%s%s', app.member_name(v_subject), case when v_late then ' (late)' else '' end, v_tag),
      '/tasks/' || v_task.id, 'tasks', v_task.id,
      jsonb_build_object('task_id', v_task.id, 'version', v_version, 'files', v_files), v_actor);
    return 'completed'::public.task_state;
  end if;

  if v_task.approving_admin_id is null then
    v_state := 'admin_approved'; v_step := 'none';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'none');
  elsif app.task_approver_on_task(v_task.id, v_task.approving_admin_id) then
    v_state := 'admin_approved'; v_step := 'skipped';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'skipped',
      'reason', case when app.is_task_assignee(v_task.id, v_task.approving_admin_id)
                     then 'approver_is_assignee' else 'approver_is_coordinator' end);
  else
    v_state := 'submitted'; v_step := 'required';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'required');
  end if;
  v_meta := v_meta || jsonb_build_object('files', v_files, 'bytes', v_bytes);

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'on_behalf_of', task_submit_done.on_behalf_of, 'meta', v_meta)::text, true);
  update public.tasks
  set state = v_state, admin_step = v_step, submitted_at = now(), submitted_by = v_actor,
      submitted_on_behalf_of = task_submit_done.on_behalf_of,
      late_reason = case when v_late then v_late_reason else tasks.late_reason end,
      admin_approved_at = null
  where id = v_task.id;

  perform app.notify(
    array[case when v_state = 'submitted' then v_task.approving_admin_id else app.org_owner_id(v_org) end],
    'task_submitted', 'Done: ' || v_task.title,
    format('%s marked it Done%s%s', app.member_name(v_subject), case when v_late then ' (late)' else '' end, v_tag),
    '/tasks/' || v_task.id, 'tasks', v_task.id,
    jsonb_build_object('task_id', v_task.id, 'version', v_version, 'files', v_files), v_actor);
  return v_state;
end;
$$;
revoke all on function public.task_submit_done(uuid, text, text, uuid) from public, anon;
grant execute on function public.task_submit_done(uuid, text, text, uuid) to authenticated, service_role;
comment on function public.task_submit_done(uuid, text, text, uuid) is
  'Done (WORKFLOWS §3.1, §3.3): the primary owner (or a freelancer primary''s coordinator) hands the open '
  'version in. v5.0: refused (INVALID_STATE) while a file of that version is still uploading; the version''s '
  'files in Drive get its submission_id; the history row and the notification carry the file count. The '
  'route is unchanged: to submitted, to admin_approved (no Admin step, or the approver is on the task), or '
  'completed for the Owner''s own task.';
