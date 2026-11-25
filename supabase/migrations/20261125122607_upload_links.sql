-- v4.5 "The upload link", the database, part 1 of 2 (DATA-MODEL §8a, WORKFLOWS §5B and §9,
-- PERMISSIONS §1 and the v4.5 block, ADR-0010 amendment of 2026-11-19 accepted 25 Nov 2026, security
-- review plan docs/handoff/v45-security-review-plan.md A-I).
--
-- A link lets anyone who holds it send files for one task straight into that task's Drive folder,
-- with no login. MaxOff stores only what it needs to know who sent what, to check it arrived whole
-- and to stop the link. This part holds:
--   1. Two permission keys: uploads.manage (the Owner and Admins, scoped to "the task's Admin") and
--      uploads.network (the Owner only).
--   2. Six tables: upload_links, upload_uploaders, upload_files, upload_folders, upload_alerts,
--      upload_rate_hits. RLS on, no policy, every API privilege revoked (hashes, salts, sealed
--      session addresses and IPs live in these rows). No audit trigger: app.audit_row_change() would
--      copy those into activity_log, which is append-only; the functions write their own history
--      rows with safe fields only (entity upload_links / upload_uploaders / upload_files, meta.task_id).
--   3. Eight notification kinds (WORKFLOWS §9).
--   4. The internal helpers: "the task's Admin" (app.upload_manager), who is told
--      (app.upload_recipients), the member guards, the text cleaning (NFC; control, zero-width and
--      bidi characters removed; plan B2, D4, C11) and the link stop shared with the task functions.
--   5. activity_log: a SELECT policy for the three upload entities, for app.upload_manager(meta.task_id)
--      (the Owner already reads every row through activity.view_all).
--   6. The member functions (uploads.manage / uploads.network): upload_card, upload_uploader_files,
--      upload_link_secret, upload_link_create, upload_link_stop, upload_link_renew,
--      upload_files_received, upload_uploader_erase_network.
--   7. task_submit_done and task_cancel re-created with their signatures and grants: every Done path
--      and Cancel stop the task's active link in the same transaction (stop_reason task_done /
--      task_cancelled). task_reopen and task_review's send-back are untouched: they never revive it (Q9).
-- Part 2 (upload_links_public) holds the Worker's service_role functions and the daily job.
--
-- Money is untouched (invariant 2): no amount anywhere. Realtime is unchanged: no table joins the
-- publication. Expand-only: new keys, tables, kinds, functions and one policy; two functions
-- re-created with the same signatures. Nothing is renamed, dropped or rewritten.

-- 1. The permission keys (PERMISSIONS §1) -----------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('owner', 'uploads.manage'),
  ('admin', 'uploads.manage'),
  ('owner', 'uploads.network');

-- 2. The tables ------------------------------------------------------------------------------------
create table public.upload_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  task_id uuid not null references public.tasks (id),
  -- sha256 of the token. Null only between upload_link_create / _renew and the server's
  -- upload_link_seal a moment later (the token is HMAC(UPLOAD_LINK_KEY, id ‖ token_salt), and only the
  -- Worker holds the key): a link with no hash answers nothing.
  token_hash bytea null check (token_hash is null or octet_length(token_hash) = 32),
  token_salt bytea not null check (octet_length(token_salt) = 16),
  key_version smallint not null default 1 check (key_version >= 1),
  created_by uuid not null references public.members (id),
  created_at timestamptz not null default now(),
  renewed_from_id uuid null references public.upload_links (id),
  stopped_at timestamptz null,
  stopped_by uuid null references public.members (id),
  stop_reason text null check (stop_reason in ('stopped', 'files_received', 'task_done', 'task_cancelled', 'renewed')),
  files_received_at timestamptz null,
  files_received_by uuid null references public.members (id),
  paused_until timestamptz null,
  pause_step smallint not null default 0 check (pause_step in (0, 1, 2)),
  paused_day date null,
  updated_at timestamptz not null default now(),
  constraint upload_links_stop_pair check ((stopped_at is null) = (stop_reason is null)),
  constraint upload_links_received_pair check (
    (stop_reason is not distinct from 'files_received') = (files_received_at is not null)
    and (stop_reason is not distinct from 'files_received') = (files_received_by is not null)),
  constraint upload_links_pause_pair check (paused_until is not null or pause_step = 0)
);
comment on table public.upload_links is
  'v4.5 (DATA-MODEL §8a): a task''s upload link. The token is never stored: token = '
  'base64url(HMAC-SHA256(UPLOAD_LINK_KEY, id ‖ token_salt)), worked out by the Worker for Copy link; '
  'token_hash = sha256(token) is the lookup (null until upload_link_seal). One active link per task. '
  'No API access (RLS on, no policy, privileges revoked); no audit trigger: the functions write their '
  'own history rows.';
create unique index upload_links_active_task on public.upload_links (task_id) where stopped_at is null;
create unique index upload_links_token_hash on public.upload_links (token_hash);
create unique index upload_links_renewed_from on public.upload_links (renewed_from_id);
create index upload_links_task_idx on public.upload_links (task_id, created_at desc);
create index upload_links_org_idx on public.upload_links (org_id);
create index upload_links_created_by_idx on public.upload_links (created_by);
create index upload_links_stopped_by_idx on public.upload_links (stopped_by) where stopped_by is not null;
create index upload_links_files_received_by_idx on public.upload_links (files_received_by)
  where files_received_by is not null;
create trigger set_updated_at before update on public.upload_links
  for each row execute function app.set_updated_at();
alter table public.upload_links enable row level security;
revoke all on public.upload_links from public, anon, authenticated;

create table public.upload_uploaders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  link_id uuid not null references public.upload_links (id),
  task_id uuid not null references public.tasks (id),
  name text not null check (length(name) between 1 and 60),
  name_key text not null check (length(name_key) between 1 and 240), -- NFD can lengthen some scripts
  on_task boolean not null default false,
  matched_member_id uuid null references public.members (id),
  folder_name text not null check (length(folder_name) between 1 and 80),
  device_key_hash bytea null check (device_key_hash is null or octet_length(device_key_hash) = 32),
  ip inet null,
  user_agent text null check (user_agent is null or length(user_agent) <= 300),
  device_label text null check (device_label is null or length(device_label) <= 60),
  said_done_at timestamptz null,
  first_file_at timestamptz null,
  last_activity_at timestamptz not null default now(),
  network_erased_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint upload_uploaders_match check (not on_task or matched_member_id is not null)
);
comment on table public.upload_uploaders is
  'v4.5 (DATA-MODEL §8a): someone who typed a name on an upload link (a claim, never an identity; '
  'plan B1). No phone, email or location, ever (Q3). ip, user_agent, device_label and device_key_hash '
  'are erased after 90 days (app.upload_housekeeping) or by the Owner (upload_uploader_erase_network); '
  'they are never in activity_log. No API access; no audit trigger.';
create unique index upload_uploaders_device on public.upload_uploaders (link_id, device_key_hash)
  where device_key_hash is not null;
create unique index upload_uploaders_folder on public.upload_uploaders (task_id, folder_name);
create index upload_uploaders_link_idx on public.upload_uploaders (link_id, created_at);
create index upload_uploaders_erase_idx on public.upload_uploaders (created_at) where network_erased_at is null;
create index upload_uploaders_org_idx on public.upload_uploaders (org_id);
create index upload_uploaders_matched_idx on public.upload_uploaders (matched_member_id)
  where matched_member_id is not null;
alter table public.upload_uploaders enable row level security;
revoke all on public.upload_uploaders from public, anon, authenticated;

create table public.upload_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  uploader_id uuid not null references public.upload_uploaders (id),
  link_id uuid not null references public.upload_links (id),
  task_id uuid not null references public.tasks (id),
  name text not null check (length(name) between 1 and 255 and name !~ '[/\\]'),
  relative_path text not null default ''
    check (length(relative_path) <= 1600 and relative_path !~ '(^/|/$|//|\\)'),
  size_bytes bigint not null check (size_bytes >= 0),
  mime_hint text null check (mime_hint is null or length(mime_hint) <= 100),
  state text not null check (state in ('held', 'uploading', 'done', 'failed', 'missing_in_drive')),
  failed_reason text null
    check (failed_reason in ('damaged', 'size_mismatch', 'wrong_folder', 'gave_up', 'unreadable')),
  account_sub text not null check (length(btrim(account_sub)) between 1 and 255),
  drive_parent_id text null check (drive_parent_id is null or length(drive_parent_id) between 1 and 255),
  drive_file_id text null check (drive_file_id is null or length(drive_file_id) between 1 and 255),
  session_uri_encrypted text null,
  session_opened_at timestamptz null,
  bytes_at_google bigint not null default 0 check (bytes_at_google >= 0),
  bytes_reported bigint not null default 0 check (bytes_reported >= 0),
  last_moved_at timestamptz null,
  md5_page text null check (md5_page is null or md5_page ~ '^[0-9a-f]{32}$'),
  md5_drive text null check (md5_drive is null or md5_drive ~ '^[0-9a-f]{32}$'),
  check_kind text null check (check_kind in ('md5', 'size_only')),
  done_at timestamptz null,
  after_stop boolean not null default false,
  drive_checked_at timestamptz null,
  missing_seen_at timestamptz null,
  ip inet null,
  user_agent text null check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upload_files_done_shape check (
    state <> 'done' or (drive_file_id is not null and done_at is not null and check_kind is not null)),
  constraint upload_files_missing_shape check (
    state <> 'missing_in_drive'
    or (drive_file_id is not null and done_at is not null and missing_seen_at is not null)),
  constraint upload_files_failed_reason check ((state = 'failed') = (failed_reason is not null)),
  constraint upload_files_held_no_session check (state <> 'held' or session_uri_encrypted is null),
  -- The sealed session address goes once the file is received, failed for good (the Worker's own
  -- check found it wrong) or missing in Drive. A failure the browser reports keeps it for the retry.
  constraint upload_files_session_cleared check (
    session_uri_encrypted is null
    or (state not in ('done', 'missing_in_drive')
        and coalesce(failed_reason, '') not in ('damaged', 'size_mismatch', 'wrong_folder')))
);
comment on table public.upload_files is
  'v4.5 (DATA-MODEL §8a): one file an uploader sent (or is sending) through a link. Done means '
  'Google''s own answer (size, folder, checksum; plan F1-F2). session_uri_encrypted is AES-GCM sealed '
  'by the Worker, like the Drive tokens, and never logged. missing_in_drive ("Removed in Drive") is set '
  'by the service role only: MaxOff has no Remove and never deletes a file (Q7). No API access; no '
  'audit trigger.';
create unique index upload_files_drive_file on public.upload_files (drive_file_id);
create index upload_files_uploader_state_idx on public.upload_files (uploader_id, state);
create index upload_files_moving_idx on public.upload_files (state, last_moved_at) where state = 'uploading';
create index upload_files_drive_check_idx on public.upload_files (link_id, drive_checked_at) where state = 'done';
create index upload_files_missing_idx on public.upload_files (missing_seen_at) where state = 'missing_in_drive';
create index upload_files_link_created_idx on public.upload_files (link_id, created_at);
create index upload_files_task_idx on public.upload_files (task_id);
create index upload_files_org_idx on public.upload_files (org_id);
create trigger set_updated_at before update on public.upload_files
  for each row execute function app.set_updated_at();
alter table public.upload_files enable row level security;
revoke all on public.upload_files from public, anon, authenticated;

create table public.upload_folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  uploader_id uuid not null references public.upload_uploaders (id),
  account_sub text not null check (length(btrim(account_sub)) between 1 and 255),
  relative_path text not null default ''
    check (length(relative_path) <= 1600 and relative_path !~ '(^/|/$|//|\\)'),
  drive_folder_id text not null check (length(btrim(drive_folder_id)) between 1 and 255),
  created_at timestamptz not null default now()
);
comment on table public.upload_folders is
  'v4.5 (DATA-MODEL §8a): the Drive folders made for an uploader (relative_path '''' = the uploader''s '
  'own folder under the task folder), keyed by what they are for and by the Google account, like '
  'drive_folders: an account switch never reuses another account''s rows. At most 2,000 per uploader '
  '(plan C11). Service role only.';
create unique index upload_folders_key on public.upload_folders (uploader_id, account_sub, relative_path);
create index upload_folders_org_idx on public.upload_folders (org_id);
alter table public.upload_folders enable row level security;
revoke all on public.upload_folders from public, anon, authenticated;

create table public.upload_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  link_id uuid not null references public.upload_links (id),
  uploader_id uuid null references public.upload_uploaders (id),
  file_id uuid null references public.upload_files (id),
  kind text not null check (kind in ('not_on_task', 'not_on_task_summary', 'names_capped', 'stuck',
                                     'looks_finished', 'space_held', 'daily_limit')),
  answers text not null check (length(answers) between 1 and 200),
  recipient_id uuid null references public.members (id),
  sent_at timestamptz not null default now()
);
comment on table public.upload_alerts is
  'v4.5 (DATA-MODEL §8a): each upload signal goes once (plan C10), as client_work_alerts. answers = '
  'what the send answers: the stall''s start instant, the quiet period''s start, the IST day, or the '
  'folded name for a new name not on the task. Service role only.';
create unique index upload_alerts_once on public.upload_alerts
  (link_id, kind, uploader_id, answers, recipient_id) nulls not distinct;
create index upload_alerts_link_sent_idx on public.upload_alerts (link_id, kind, sent_at);
create index upload_alerts_uploader_idx on public.upload_alerts (uploader_id) where uploader_id is not null;
create index upload_alerts_file_idx on public.upload_alerts (file_id) where file_id is not null;
create index upload_alerts_recipient_idx on public.upload_alerts (recipient_id) where recipient_id is not null;
create index upload_alerts_org_idx on public.upload_alerts (org_id);
alter table public.upload_alerts enable row level security;
revoke all on public.upload_alerts from public, anon, authenticated;

create table public.upload_rate_hits (
  bucket text not null check (bucket in ('bad_link', 'open')),
  key_hash bytea not null check (octet_length(key_hash) = 32),
  window_start timestamptz not null,
  hits integer not null default 1 check (hits >= 1),
  blocked_until timestamptz null,
  primary key (bucket, key_hash, window_start)
);
comment on table public.upload_rate_hits is
  'v4.5 (DATA-MODEL §8a; plan C1-C2): per-network counters beside the Cloudflare rate-limit binding. '
  'key_hash = an HMAC of the IP with a server key, never the IP. Bookkeeping, not history: rows older '
  'than a day are removed by app.upload_housekeeping. Service role only.';
create index upload_rate_hits_window_idx on public.upload_rate_hits (window_start);
alter table public.upload_rate_hits enable row level security;
revoke all on public.upload_rate_hits from public, anon, authenticated;

-- 3. The notification kinds (WORKFLOWS §9) ----------------------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, description) values
  ('upload_not_on_task', false, false,
   'Someone not on the task started uploading through its link; once per new name, at most 5 a day per link, then one summary (v4.5)'),
  ('upload_names_capped', false, false,
   'The 21st new name on an upload link in an IST day was refused (v4.5, plan C3)'),
  ('upload_stuck', false, false,
   'An upload has had no new bytes at Google for 15 minutes, once per stall per uploader (v4.5)'),
  ('upload_said_done', false, false,
   'An uploader tapped "I''m done" (v4.5)'),
  ('upload_looks_finished', false, false,
   'An uploader''s files are all received and nothing has moved for 10 minutes, once per quiet period (v4.5)'),
  ('upload_files_received', true, false,
   'All files received: the task''s primary owner (a freelancer''s coordinator) is asked to mark it done (v4.5)'),
  ('upload_space_held', true, false,
   'A file was held because the studio''s Drive is too full, to the Owner once per link per IST day (v4.5, Q11)'),
  ('upload_daily_limit', true, false,
   'Google''s daily upload limit paused a link, once per link per IST day (v4.5, Q10)');

-- 4. Internal helpers -------------------------------------------------------------------------------
-- "The task's Admin" (Q1, owner 19 Nov: three people), for the caller: the Owner; the creator while
-- holding tasks.create; the approving Admin while holding tasks.approve_admin; the active Admin who
-- currently coordinates the freelancer who is the task's primary owner. Scope is live. A Crew
-- coordinator, the coordinator of a freelancer who is only an assignee, a Crew assignee and an Admin
-- who only sees the task through a client label are not.
create function app.upload_manager(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return (select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and t.org_id = (select m.org_id from app.current_member() m)
      and ((select app.is_owner())
           or (t.created_by = auth.uid() and (select app.has_permission('tasks.create')))
           or (t.approving_admin_id = auth.uid() and (select app.has_permission('tasks.approve_admin')))
           or ((select m.role from app.current_member() m) = 'admin'
               and exists (select 1 from public.members f
                           where f.id = t.primary_owner_id and f.engagement = 'freelance' and f.status = 'active'
                             and app.coordinator_of(f.id) = auth.uid())))));
end;
$$;
comment on function app.upload_manager(uuid) is
  'v4.5 (DATA-MODEL §8a, Q1): true when the caller is "the task''s Admin" for its upload link: the '
  'Owner, the creator holding tasks.create, the approving Admin holding tasks.approve_admin, or the '
  'active Admin who currently coordinates the freelancer who is the primary owner (ADR-0013). Read by '
  'the upload functions and the activity_log policy for the upload entities.';
revoke all on function app.upload_manager(uuid) from public, anon;
grant execute on function app.upload_manager(uuid) to authenticated, service_role;

-- Who "the task's Admins" are for the upload notices (WORKFLOWS §9): the creator holding tasks.create,
-- the approving Admin holding tasks.approve_admin, the active Admin coordinating a freelancer primary
-- owner, and the Owner when the task has no approving Admin. app.notify drops the actor and repeats.
create function app.upload_recipients(p_task_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select x.id from (
      select t.created_by as id, 1 as ord
      from public.tasks t join public.members m on m.id = t.created_by and m.status = 'active'
      where t.id = p_task_id
        and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'tasks.create')
      union all
      select t.approving_admin_id, 2
      from public.tasks t join public.members m on m.id = t.approving_admin_id and m.status = 'active'
      where t.id = p_task_id
        and exists (select 1 from public.role_permissions rp
                    where rp.role = m.role and rp.permission = 'tasks.approve_admin')
      union all
      select c.id, 3
      from public.tasks t
      join public.members f on f.id = t.primary_owner_id and f.engagement = 'freelance' and f.status = 'active'
      join public.members c on c.id = app.coordinator_of(f.id) and c.status = 'active' and c.role = 'admin'
      where t.id = p_task_id
      union all
      select app.org_owner_id(t.org_id), 4
      from public.tasks t where t.id = p_task_id and t.approving_admin_id is null
    ) x
    where x.id is not null
    group by x.id
    order by min(x.ord));
$$;
comment on function app.upload_recipients(uuid) is
  'Internal (v4.5, WORKFLOWS §9 "who the task''s Admins are"): the creator (holding tasks.create), the '
  'approving Admin (holding tasks.approve_admin), the active Admin coordinating a freelancer primary '
  'owner, and the Owner when the task has no approving Admin; once each. Never an uploader.';
revoke all on function app.upload_recipients(uuid) from public, anon, authenticated;
grant execute on function app.upload_recipients(uuid) to service_role;

-- The member functions' check, in the PERMISSIONS order: UNAUTHENTICATED (no active member), NOT_FOUND
-- (the caller cannot see the task), FORBIDDEN (sees it, but is not the task's Admin with uploads.manage).
create function app.upload_guard(p_task_id uuid)
returns public.members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if p_task_id is null or not app.task_visible(p_task_id) then
    perform app.fail('NOT_FOUND', 'This task does not exist.');
  end if;
  if not app.has_permission('uploads.manage') or not app.upload_manager(p_task_id) then
    perform app.fail('FORBIDDEN', 'Only the Owner and the task''s Admin manage its upload link.');
  end if;
  return v_caller;
end;
$$;
comment on function app.upload_guard(uuid) is
  'Internal (v4.5): the upload member functions'' check. UNAUTHENTICATED with no active member, '
  'NOT_FOUND when the caller cannot see the task, FORBIDDEN unless uploads.manage and '
  'app.upload_manager. Returns the caller.';
revoke all on function app.upload_guard(uuid) from public, anon, authenticated;
grant execute on function app.upload_guard(uuid) to service_role;

-- A link the caller may manage, locked: NOT_FOUND outside the caller's organisation, then the guard.
create function app.upload_link_guard(p_link_id uuid)
returns public.upload_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_link public.upload_links;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  select l.* into v_link from public.upload_links l
  where l.id = p_link_id and l.org_id = v_caller.org_id for update;
  if v_link.id is null then
    perform app.fail('NOT_FOUND', 'This upload link does not exist.');
  end if;
  perform app.upload_guard(v_link.task_id);
  return v_link;
end;
$$;
comment on function app.upload_link_guard(uuid) is
  'Internal (v4.5): the caller''s organisation''s link, locked, after app.upload_guard on its task.';
revoke all on function app.upload_link_guard(uuid) from public, anon, authenticated;
grant execute on function app.upload_link_guard(uuid) to service_role;

-- Stops the task's active link, if there is one, with a history row (no secret). Returns its id.
create function app.upload_stop_link(p_task_id uuid, p_reason text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.upload_links;
begin
  update public.upload_links l
  set stopped_at = now(), stopped_by = p_actor, stop_reason = p_reason
  where l.task_id = p_task_id and l.stopped_at is null
  returning l.* into v_link;
  if v_link.id is null then
    return null;
  end if;
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (v_link.org_id, p_actor, 'upload_links', v_link.id, 'stopped',
    jsonb_build_object('stop_reason', jsonb_build_object('from', null, 'to', p_reason)),
    jsonb_build_object('task_id', v_link.task_id, 'stop_reason', p_reason));
  return v_link.id;
end;
$$;
comment on function app.upload_stop_link(uuid, text, uuid) is
  'Internal (v4.5): stops the task''s active upload link (stop_reason ''stopped'', ''task_done'', '
  '''task_cancelled'' or ''renewed''; stopped_by the actor) and writes the history row ''stopped'' '
  '(meta: task_id, stop_reason). Nothing when the task has no active link. Returns the link id.';
revoke all on function app.upload_stop_link(uuid, text, uuid) from public, anon, authenticated;
grant execute on function app.upload_stop_link(uuid, text, uuid) to service_role;

-- The task states a link may be made in, and the Drive (connected, or waiting to be reconnected).
create function app.upload_can_make_link(p_task public.tasks)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_drive text;
begin
  if p_task.state not in ('todo', 'in_progress', 'changes_requested') or p_task.archived_at is not null then
    perform app.fail('INVALID_STATE',
      'An upload link is made while the task is To do, In progress or Changes requested.');
  end if;
  select a.state into v_drive from public.drive_account a where a.org_id = p_task.org_id;
  if v_drive is null or v_drive = 'disconnected' then
    perform app.fail('INVALID_STATE', 'Connect the studio''s Google Drive first.');
  end if;
end;
$$;
comment on function app.upload_can_make_link(public.tasks) is
  'Internal (v4.5): INVALID_STATE unless the task is todo, in_progress or changes_requested and not '
  'archived, and the organisation''s Drive is connected or needs reconnecting.';
revoke all on function app.upload_can_make_link(public.tasks) from public, anon, authenticated;
grant execute on function app.upload_can_make_link(public.tasks) to service_role;

-- Names typed by strangers (plan B2, D4): Unicode NFC; control, zero-width and bidi characters, the soft
-- hyphen, the line and paragraph separators, U+180E, U+034F and the variation selectors removed;
-- trimmed. The caller checks the length. src/modules/uploads/domain/names.ts (HIDDEN) strips the same set.
create function app.upload_clean(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(normalize(coalesce(p_text, ''), NFC),
    '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufe00-\ufe0f\ufeff]', '', 'g'));
$$;
comment on function app.upload_clean(text) is
  'Internal (v4.5, plan B2): NFC; control, zero-width and bidi characters, U+00AD, U+2028-2029, U+180E, '
  'U+034F and the variation selectors U+FE00-FE0F removed; trimmed.';
revoke all on function app.upload_clean(text) from public, anon, authenticated;
grant execute on function app.upload_clean(text) to service_role;

-- The folded form of a name, for matching only: cleaned, lower case, accents (the combining mark blocks)
-- and repeated spaces removed.
create function app.upload_fold(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(regexp_replace(normalize(app.upload_clean(p_text), NFD), '[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]', '', 'g')),
    '\s+', ' ', 'g');
$$;
comment on function app.upload_fold(text) is
  'Internal (v4.5): a name''s folded form for matching (lower case, accents and repeated spaces removed).';
revoke all on function app.upload_fold(text) from public, anon, authenticated;
grant execute on function app.upload_fold(text) to service_role;

-- A laptop's folders under the uploader's folder (plan C11, M4): '/'-joined, each part cleaned with no
-- '\', empty parts dropped (so '/a//b/' is 'a/b'), '.' and '..' refused, depth ≤ 12, each part ≤ 120.
create function app.upload_clean_path(p_path text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
  v_part text;
begin
  if coalesce(p_path, '') = '' then
    return '';
  end if;
  foreach v_part in array string_to_array(p_path, '/') loop
    v_part := app.upload_clean(replace(v_part, '\', ''));
    continue when v_part = '';
    if v_part in ('.', '..') then
      perform app.fail('VALIDATION', 'A folder cannot be called "." or "..".');
    end if;
    if length(v_part) > 120 then
      perform app.fail('VALIDATION', 'A folder name can have at most 120 characters.');
    end if;
    v_parts := v_parts || v_part;
  end loop;
  if cardinality(v_parts) > 12 then
    perform app.fail('VALIDATION', 'Folders can be at most 12 deep.');
  end if;
  return array_to_string(v_parts, '/');
end;
$$;
comment on function app.upload_clean_path(text) is
  'Internal (v4.5, plan C11): a cleaned relative path; VALIDATION for ".", "..", a part over 120 '
  'characters or more than 12 levels.';
revoke all on function app.upload_clean_path(text) from public, anon, authenticated;
grant execute on function app.upload_clean_path(text) to service_role;

-- "5.4 GB", "820.0 MB": the notices' plain size words.
create function app.upload_size_text(p_bytes bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_bytes, 0) >= 1000000000
              then to_char(p_bytes::numeric / 1000000000, 'FM999G999G990D0') || ' GB'
              else to_char(coalesce(p_bytes, 0)::numeric / 1000000, 'FM999G990D0') || ' MB' end;
$$;
comment on function app.upload_size_text(bigint) is 'Internal (v4.5): a byte count as "5.4 GB" or "820.0 MB".';
revoke all on function app.upload_size_text(bigint) from public, anon, authenticated;
grant execute on function app.upload_size_text(bigint) to service_role;

-- "phone · Android" from a user agent (DATA-MODEL §8a device_label).
create function app.upload_device_label(p_user_agent text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when nullif(btrim(coalesce(p_user_agent, '')), '') is null then null else
    (case when p_user_agent ~* '(ipad|tablet)' or (p_user_agent ~* 'android' and p_user_agent !~* 'mobile') then 'tablet'
          when p_user_agent ~* '(iphone|ipod|mobile)' then 'phone'
          else 'computer' end)
    || coalesce(' · ' || (case when p_user_agent ~* '(iphone|ipod)' then 'iOS'
                               when p_user_agent ~* 'ipad' then 'iPadOS'
                               when p_user_agent ~* 'android' then 'Android'
                               when p_user_agent ~* 'windows' then 'Windows'
                               when p_user_agent ~* 'cros' then 'ChromeOS'
                               when p_user_agent ~* '(macintosh|mac os x)' then 'macOS'
                               when p_user_agent ~* 'linux' then 'Linux' end), '') end;
$$;
comment on function app.upload_device_label(text) is
  'Internal (v4.5): a short device label ("phone · Android", "computer · macOS") made from a user agent.';
revoke all on function app.upload_device_label(text) from public, anon, authenticated;
grant execute on function app.upload_device_label(text) to service_role;

-- 5. Who reads the upload history rows (DATA-MODEL §8a) ----------------------------------------------
-- The Owner already reads every activity_log row (activity.view_all, policy activity_log_select).
-- The task's Admin reads the three upload entities of the tasks they manage; Crew, other Admins, a Crew
-- coordinator and the coordinator of a freelancer who is only an assignee read none of them.
create policy activity_log_select_uploads on public.activity_log
  for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and case when entity in ('upload_links', 'upload_uploaders', 'upload_files')
                  then app.has_permission('uploads.manage') and app.upload_manager((meta ->> 'task_id')::uuid)
                  else false end);

-- 6. The member functions --------------------------------------------------------------------------
-- The Uploads card (WORKFLOWS §5B.3): the link shown (the active one, else the newest), the Drive
-- state, the task folder for "Open the folder in Drive", and one row per uploader. Never a token,
-- hash, salt, IP, user agent, device key or session address.
create function public.upload_card(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_link public.upload_links;
  v_drive public.drive_account;
  v_uploaders jsonb;
  v_files bigint;
  v_bytes bigint;
  v_people bigint;
  v_count bigint;
  v_all_finished boolean;
  v_uploading bigint;
  v_state text;
begin
  v_caller := app.upload_guard(p_task_id);
  select l.* into v_link from public.upload_links l
  where l.task_id = p_task_id
  order by (l.stopped_at is null) desc, l.created_at desc
  limit 1;
  select a.* into v_drive from public.drive_account a where a.org_id = v_caller.org_id;

  with per as (
    select u.id, u.link_id, u.name, u.on_task, u.said_done_at, u.last_activity_at, u.created_at,
           count(f.id) filter (where f.state = 'done') as files_done,
           -- Uploading = a session, or a start in the last 10 minutes (the rule of plan C4), so a start
           -- the Worker never finished does not keep the card "uploading" for ever.
           count(f.id) filter (where f.state = 'uploading'
                                 and (f.session_uri_encrypted is not null
                                      or f.updated_at > now() - interval '10 minutes')) as files_uploading,
           count(f.id) filter (where f.state = 'held') as files_held,
           count(f.id) filter (where f.state = 'failed') as files_failed,
           count(f.id) filter (where f.state = 'missing_in_drive') as files_removed,
           coalesce(sum(f.size_bytes) filter (where f.state in ('done', 'missing_in_drive')), 0) as bytes_done,
           coalesce(sum(f.size_bytes), 0) as bytes_total,
           min(coalesce(f.last_moved_at, f.session_opened_at)) filter (
             where f.state = 'uploading' and f.session_uri_encrypted is not null
               and coalesce(f.last_moved_at, f.session_opened_at) <= now() - interval '15 minutes') as stuck_since,
           (count(f.id) > 0
             and bool_and(f.state in ('done', 'missing_in_drive'))
             and greatest(max(greatest(coalesce(f.last_moved_at, f.created_at), coalesce(f.done_at, f.created_at))),
                          u.last_activity_at) <= now() - interval '10 minutes') as looks_finished
    from public.upload_uploaders u
    left join public.upload_files f on f.uploader_id = u.id
    where u.task_id = p_task_id
    group by u.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'link_id', p.link_id, 'current_link', p.link_id = v_link.id,
           'name', p.name, 'on_task', p.on_task,
           'files_done', p.files_done, 'files_uploading', p.files_uploading, 'files_held', p.files_held,
           'files_failed', p.files_failed, 'files_removed', p.files_removed,
           'bytes_done', p.bytes_done, 'bytes_total', p.bytes_total,
           'last_activity_at', p.last_activity_at, 'said_done_at', p.said_done_at,
           'stuck_since', p.stuck_since, 'looks_finished', coalesce(p.looks_finished, false))
           order by p.last_activity_at desc, p.created_at desc), '[]'::jsonb),
         coalesce(sum(p.files_done + p.files_removed) filter (where p.link_id = v_link.id), 0),
         coalesce(sum(p.bytes_done) filter (where p.link_id = v_link.id), 0),
         count(*) filter (where p.link_id = v_link.id and p.files_done + p.files_removed > 0),
         count(*) filter (where p.link_id = v_link.id),
         coalesce(bool_and(coalesce(p.looks_finished, false)) filter (where p.link_id = v_link.id), false),
         count(*) filter (where p.link_id = v_link.id and p.files_uploading > 0)
    into v_uploaders, v_files, v_bytes, v_people, v_count, v_all_finished, v_uploading
  from per p;

  v_state := case when v_link.id is null then 'none'
                  when v_link.stopped_at is not null then 'stopped'
                  when v_count > 0 and v_all_finished then 'looks_finished'
                  else 'active' end;

  return jsonb_build_object(
    'task_id', p_task_id,
    'state', v_state,
    'drive_state', coalesce(v_drive.state, 'disconnected'),
    'task_folder_id', (select f.drive_folder_id from public.drive_folders f
                       where f.org_id = v_caller.org_id and f.kind = 'task' and f.task_id = p_task_id
                         and f.account_sub = v_drive.google_sub),
    'link', case when v_link.id is null then null else jsonb_build_object(
      'id', v_link.id,
      -- The hash is stored (upload_link_seal): an active link that is not sealed works for nobody, so
      -- the card offers Make a new link.
      'sealed', v_link.token_hash is not null,
      'created_at', v_link.created_at,
      'created_by_name', app.member_name(v_link.created_by),
      'age_days', app.today_ist() - app.to_ist_date(v_link.created_at),
      'renewed_from_id', v_link.renewed_from_id,
      'stopped_at', v_link.stopped_at,
      'stopped_by_name', case when v_link.stopped_by is null then null else app.member_name(v_link.stopped_by) end,
      'stop_reason', v_link.stop_reason,
      'files_received_at', v_link.files_received_at,
      'files_received_by_name', case when v_link.files_received_by is null then null
                                     else app.member_name(v_link.files_received_by) end,
      'paused_until', case when v_link.paused_until > now() then v_link.paused_until end) end,
    'files', v_files,
    'bytes', v_bytes,
    'people', v_people,
    'uploading', v_uploading,
    'uploaders', v_uploaders);
end;
$$;
comment on function public.upload_card(uuid) is
  'v4.5 (WORKFLOWS §5B.3), uploads.manage and the task''s Admin (app.upload_manager): the Uploads card. '
  'state none / active / looks_finished / stopped; the shown link (the active one, else the newest: '
  'sealed, age_days, who made, stopped or closed it and why, a pause still running); drive_state; the task '
  'folder''s Drive id; files, bytes, people and uploading (a session, or a start in the '
  'last 10 minutes) on the shown link; one row per uploader of '
  'the task (current_link marks the shown link''s) with counts per state, bytes, last activity, '
  'said_done_at, stuck_since (15 min with no new bytes) and looks_finished (all received, 10 min '
  'quiet). Never a token, hash, salt, IP, user agent or session address. NOT_FOUND when the caller '
  'cannot see the task, FORBIDDEN when not its Admin, UNAUTHENTICATED with no active member.';
revoke all on function public.upload_card(uuid) from public, anon, authenticated, service_role;
grant execute on function public.upload_card(uuid) to authenticated;

-- An uploader's sheet (WORKFLOWS §5B.3). ip and user_agent only for uploads.network (the Owner, Q12).
create function public.upload_uploader_files(p_uploader_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_up public.upload_uploaders;
  v_network boolean;
  v_sub text;
  v_uploader jsonb;
  v_files jsonb;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  select u.* into v_up from public.upload_uploaders u where u.id = p_uploader_id and u.org_id = v_caller.org_id;
  if v_up.id is null then
    perform app.fail('NOT_FOUND', 'This uploader does not exist.');
  end if;
  perform app.upload_guard(v_up.task_id);
  v_network := app.has_permission('uploads.network');
  select a.google_sub into v_sub from public.drive_account a where a.org_id = v_caller.org_id;

  v_uploader := jsonb_build_object(
    'id', v_up.id, 'link_id', v_up.link_id, 'name', v_up.name, 'on_task', v_up.on_task,
    'folder_name', v_up.folder_name, 'device_label', v_up.device_label, 'first_file_at', v_up.first_file_at,
    'last_activity_at', v_up.last_activity_at, 'said_done_at', v_up.said_done_at,
    'network_erased_at', v_up.network_erased_at);
  if v_network then
    v_uploader := v_uploader || jsonb_build_object('ip', host(v_up.ip), 'user_agent', v_up.user_agent);
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', f.id, 'name', f.name, 'relative_path', f.relative_path, 'size_bytes', f.size_bytes,
             'state', f.state, 'failed_reason', f.failed_reason,
             'bytes_at_google', f.bytes_at_google, 'bytes_reported', f.bytes_reported,
             'done_at', f.done_at, 'check_kind', f.check_kind, 'after_stop', f.after_stop,
             'drive_file_id', f.drive_file_id, 'missing_seen_at', f.missing_seen_at,
             'in_current_account', f.account_sub is not distinct from v_sub, 'created_at', f.created_at)
           || case when v_network then jsonb_build_object('ip', host(f.ip), 'user_agent', f.user_agent)
                   else '{}'::jsonb end
           order by f.relative_path, f.name, f.created_at), '[]'::jsonb)
    into v_files
  from public.upload_files f where f.uploader_id = v_up.id;

  return jsonb_build_object('uploader', v_uploader, 'files', v_files);
end;
$$;
comment on function public.upload_uploader_files(uuid) is
  'v4.5 (WORKFLOWS §5B.3), uploads.manage and the task''s Admin: one uploader''s sheet: the uploader '
  '(name, on_task, folder, device_label, first_file_at, said_done_at, network_erased_at) and each file '
  '(name, relative_path, size, state, bytes, done_at, check_kind, after_stop, drive_file_id, '
  'missing_seen_at, in_current_account). ip and user_agent only for uploads.network (the Owner, Q12). '
  'Never waits on Google: the Drive check runs after the sheet is on screen (upload_drive_check_claim). '
  'NOT_FOUND / FORBIDDEN / UNAUTHENTICATED as upload_card.';
revoke all on function public.upload_uploader_files(uuid) from public, anon, authenticated, service_role;
grant execute on function public.upload_uploader_files(uuid) to authenticated;

-- What the server action needs to work the token out (plan A3). copy = true is Copy link: a history
-- row naming who copied it, to trace a leak. Showing the masked link writes nothing.
create function public.upload_link_secret(p_link_id uuid, p_copy boolean)
returns table (link_id uuid, token_salt bytea, key_version smallint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_link public.upload_links;
begin
  v_link := app.upload_link_guard(p_link_id);
  if v_link.stopped_at is not null then
    perform app.fail('INVALID_STATE', 'This link was stopped and no longer works.');
  end if;
  if coalesce(p_copy, false) then
    insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
    values (v_link.org_id, auth.uid(), 'upload_links', v_link.id, 'copied', '{}'::jsonb,
      jsonb_build_object('task_id', v_link.task_id));
  end if;
  link_id := v_link.id;
  token_salt := v_link.token_salt;
  key_version := v_link.key_version;
  return next;
end;
$$;
comment on function public.upload_link_secret(uuid, boolean) is
  'v4.5 (plan A3), uploads.manage and the task''s Admin: (link_id, token_salt, key_version) of an '
  'active link, for the server action that derives the token with UPLOAD_LINK_KEY. p_copy = true '
  'writes the history row ''copied'' (who). INVALID_STATE for a stopped link.';
revoke all on function public.upload_link_secret(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.upload_link_secret(uuid, boolean) to authenticated;

create function public.upload_link_create(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_task public.tasks;
  v_id uuid;
begin
  v_caller := app.upload_guard(p_task_id);
  v_task := app.task_lock(p_task_id, v_caller.org_id);
  perform app.upload_can_make_link(v_task);
  if exists (select 1 from public.upload_links l where l.task_id = v_task.id and l.stopped_at is null) then
    perform app.fail('INVALID_STATE', 'This task already has an upload link.');
  end if;
  insert into public.upload_links (org_id, task_id, token_salt, key_version, created_by)
  values (v_task.org_id, v_task.id, extensions.gen_random_bytes(16), 1, v_caller.id)
  returning id into v_id;
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (v_task.org_id, v_caller.id, 'upload_links', v_id, 'created', '{}'::jsonb,
    jsonb_build_object('task_id', v_task.id));
  return v_id;
end;
$$;
comment on function public.upload_link_create(uuid) is
  'v4.5 (WORKFLOWS §5B.1), uploads.manage and the task''s Admin: "Get upload link". The task is todo, '
  'in_progress or changes_requested and not archived, has no active link, and the Drive is connected or '
  'needs reconnecting (INVALID_STATE otherwise). Makes the link with a random 16-byte salt; the server '
  'then derives the token and stores its hash with upload_link_seal (service_role). History ''created''. '
  'Returns the link id.';
revoke all on function public.upload_link_create(uuid) from public, anon, authenticated, service_role;
grant execute on function public.upload_link_create(uuid) to authenticated;

create function public.upload_link_stop(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.upload_links;
begin
  v_link := app.upload_link_guard(p_link_id);
  if v_link.stopped_at is not null then
    perform app.fail('INVALID_STATE', 'This link is already stopped.');
  end if;
  perform app.upload_stop_link(v_link.task_id, 'stopped', auth.uid());
end;
$$;
comment on function public.upload_link_stop(uuid) is
  'v4.5 (WORKFLOWS §5B.1), uploads.manage and the task''s Admin: "Stop link". The link never works '
  'again (stop_reason stopped); a file already uploading may finish (after_stop). History ''stopped''. '
  'INVALID_STATE when already stopped.';
revoke all on function public.upload_link_stop(uuid) from public, anon, authenticated, service_role;
grant execute on function public.upload_link_stop(uuid) to authenticated;

create function public.upload_link_renew(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_task public.tasks;
  v_old uuid;
  v_id uuid;
begin
  v_caller := app.upload_guard(p_task_id);
  v_task := app.task_lock(p_task_id, v_caller.org_id);
  perform app.upload_can_make_link(v_task);
  v_old := app.upload_stop_link(v_task.id, 'renewed', v_caller.id);
  if v_old is null then
    -- From the closed card: the newest stopped link is the one this replaces.
    select l.id into v_old from public.upload_links l where l.task_id = v_task.id order by l.created_at desc limit 1;
  end if;
  insert into public.upload_links (org_id, task_id, token_salt, key_version, created_by, renewed_from_id)
  values (v_task.org_id, v_task.id, extensions.gen_random_bytes(16), 1, v_caller.id, v_old)
  returning id into v_id;
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (v_task.org_id, v_caller.id, 'upload_links', v_id, 'renewed', '{}'::jsonb,
    jsonb_build_object('task_id', v_task.id, 'from', v_old, 'to', v_id));
  return v_id;
end;
$$;
comment on function public.upload_link_renew(uuid) is
  'v4.5 (WORKFLOWS §5B.1, Q9), uploads.manage and the task''s Admin: "Make a new link". Stops the active '
  'link if there is one (stop_reason renewed) and makes a new one whose renewed_from_id is the link it '
  'replaces (the active one, else the newest), in the same task states and Drive states as '
  'upload_link_create. History ''renewed'' (meta: from, to). Returns the new link id.';
revoke all on function public.upload_link_renew(uuid) from public, anon, authenticated, service_role;
grant execute on function public.upload_link_renew(uuid) to authenticated;

-- All files received (WORKFLOWS §5B.5): stops the link, then either the existing Done (the caller is
-- the primary owner, or the current coordinator of a freelancer primary owner) or the primary owner
-- is told "mark it done". Invariants 5 and 6 are unchanged: task_submit_done decides as it always has.
create function public.upload_files_received(p_link_id uuid, p_mark_done boolean, p_late_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.upload_links;
  v_task public.tasks;
  v_caller uuid := auth.uid();
  v_org uuid;
  v_task_id uuid;
  v_primary public.members;
  v_on_behalf uuid;
  v_path text;
  v_files bigint;
  v_bytes bigint;
  v_people bigint;
  v_names text;
begin
  -- The task first, then the link: the order of task_submit_done, task_cancel and upload_link_renew
  -- (task_lock, then the link row), so two of them never wait on each other.
  select m.org_id into v_org from app.current_member() m;
  if v_org is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  select l.task_id into v_task_id from public.upload_links l where l.id = p_link_id and l.org_id = v_org;
  if v_task_id is not null then
    perform app.task_lock(v_task_id, v_org);
  end if;
  v_link := app.upload_link_guard(p_link_id);
  if v_link.stopped_at is not null then
    perform app.fail('INVALID_STATE', 'This link is already stopped.');
  end if;
  select t.* into v_task from public.tasks t where t.id = v_link.task_id;
  select m.* into v_primary from public.members m where m.id = v_task.primary_owner_id;

  if coalesce(p_mark_done, false) and v_primary.id = v_caller then
    v_path := 'marked_done';
  elsif coalesce(p_mark_done, false) and v_primary.engagement = 'freelance' and v_primary.status = 'active'
        and app.coordinator_of(v_primary.id) = v_caller then
    v_path := 'marked_done';
    v_on_behalf := v_primary.id;
  else
    v_path := 'primary_told';
  end if;

  update public.upload_links l
  set stopped_at = now(), stopped_by = v_caller, stop_reason = 'files_received',
      files_received_at = now(), files_received_by = v_caller
  where l.id = v_link.id;

  select count(*) filter (where f.state in ('done', 'missing_in_drive')),
         coalesce(sum(f.size_bytes) filter (where f.state in ('done', 'missing_in_drive')), 0),
         count(distinct f.uploader_id) filter (where f.state in ('done', 'missing_in_drive'))
    into v_files, v_bytes, v_people
  from public.upload_files f where f.link_id = v_link.id;
  select string_agg(x.name, ', ' order by x.first) into v_names
  from (select u.name, min(f.done_at) as first from public.upload_uploaders u
        join public.upload_files f on f.uploader_id = u.id and f.state in ('done', 'missing_in_drive')
        where u.link_id = v_link.id group by u.id, u.name) x;

  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (v_link.org_id, v_caller, 'upload_links', v_link.id, 'files_received',
    jsonb_build_object('stop_reason', jsonb_build_object('from', null, 'to', 'files_received')),
    jsonb_build_object('task_id', v_task.id, 'files', v_files, 'bytes', v_bytes, 'uploaders', v_people,
                       'path', v_path));

  if v_path = 'marked_done' then
    -- The existing Done, unchanged: the primary owner's own, or on behalf of the freelancer. Its
    -- refusals (the late reason past due_at, a state that cannot be Done) undo the stop too.
    perform public.task_submit_done(v_task.id, null, p_late_reason, v_on_behalf);
    return 'marked_done';
  end if;

  -- WORKFLOWS §9: the primary owner only (a freelancer's goes to their coordinator); never the actor.
  perform app.notify(array[v_task.primary_owner_id], 'upload_files_received',
    format('Files received for %s: mark it done', v_task.title),
    format('%s %s · %s%s', v_files, case when v_files = 1 then 'file' else 'files' end,
           app.upload_size_text(v_bytes), coalesce(' from ' || v_names, '')),
    '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), v_caller);
  return 'primary_told';
end;
$$;
comment on function public.upload_files_received(uuid, boolean, text) is
  'v4.5 (WORKFLOWS §5B.5), uploads.manage and the task''s Admin: "All files received". Stops the link '
  '(stop_reason files_received, files_received_at/by) and writes the history row ''files_received'' '
  '(meta: files, bytes, uploaders, path). With p_mark_done and a caller who may mark Done (the task''s '
  'primary owner, or the current coordinator of a freelancer primary owner, as task_submit_done '
  'allows), it runs task_submit_done(task, null, p_late_reason, on_behalf_of) unchanged (REASON_REQUIRED '
  'past due_at) and returns ''marked_done''; otherwise the primary owner (a freelancer''s coordinator) '
  'gets upload_files_received and it returns ''primary_told''. INVALID_STATE for a stopped link.';
revoke all on function public.upload_files_received(uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.upload_files_received(uuid, boolean, text) to authenticated;

-- The Owner erases an uploader's network details now (plan I4, uploads.network).
create function public.upload_uploader_erase_network(p_uploader_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_up public.upload_uploaders;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  select u.* into v_up from public.upload_uploaders u
  where u.id = p_uploader_id and u.org_id = v_caller.org_id for update;
  if v_up.id is null or not app.task_visible(v_up.task_id) then
    perform app.fail('NOT_FOUND', 'This uploader does not exist.');
  end if;
  if not app.has_permission('uploads.network') then
    perform app.fail('FORBIDDEN', 'Only the Owner erases an uploader''s network details.');
  end if;
  if v_up.network_erased_at is not null and v_up.ip is null and v_up.user_agent is null
     and v_up.device_label is null and v_up.device_key_hash is null
     and not exists (select 1 from public.upload_files f where f.uploader_id = v_up.id
                     and (f.ip is not null or f.user_agent is not null)) then
    return false;
  end if;
  update public.upload_uploaders
  set ip = null, user_agent = null, device_label = null, device_key_hash = null, network_erased_at = now()
  where id = v_up.id;
  update public.upload_files set ip = null, user_agent = null
  where uploader_id = v_up.id and (ip is not null or user_agent is not null);
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (v_up.org_id, v_caller.id, 'upload_uploaders', v_up.id, 'network_erased', '{}'::jsonb,
    jsonb_build_object('task_id', v_up.task_id, 'uploader_id', v_up.id));
  return true;
end;
$$;
comment on function public.upload_uploader_erase_network(uuid) is
  'v4.5 (plan I4), uploads.network (the Owner): nulls the uploader''s and their files'' ip and '
  'user_agent and the uploader''s device_label and device_key_hash now, sets network_erased_at. History '
  '''network_erased'' (who; no values). False and nothing written when nothing is left to erase. '
  'NOT_FOUND outside what the caller sees, FORBIDDEN without the key.';
revoke all on function public.upload_uploader_erase_network(uuid) from public, anon, authenticated, service_role;
grant execute on function public.upload_uploader_erase_network(uuid) to authenticated;

-- 7. Done and Cancel stop the task's link -----------------------------------------------------------
-- task_submit_done: copied from migration 20261015045552_tasks_for_owner (its latest definition); the
-- only change is app.upload_stop_link(..., 'task_done', actor) on both Done paths.
create or replace function public.task_submit_done(
  task_id uuid,
  note text default null,
  late_reason text default null,
  on_behalf_of uuid default null
)
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
  select coalesce(max(s.version), 0) + 1 into v_version from public.task_submissions s where s.task_id = v_task.id;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submission_added',
    'on_behalf_of', task_submit_done.on_behalf_of,
    'meta', jsonb_build_object('version', v_version))::text, true);
  insert into public.task_submissions (task_id, version, note, submitted_by, on_behalf_of)
  values (v_task.id, v_version, v_note, v_actor, task_submit_done.on_behalf_of)
  returning id into v_submission;

  -- 6b.2 (owner 2026-10-07): a task whose primary owner is the Owner completes on Done. Final
  -- completion is always the Owner's, and here the Owner did the work: no Admin check, no review
  -- row (nobody reviewed it). The audit entry is "completed", meta.step owner_done.
  if v_task.primary_owner_id = app.org_owner_id(v_org) then
    v_step := case when v_task.approving_admin_id is null then 'none' else 'skipped' end;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'completed',
      'meta', jsonb_build_object('step', 'owner_done', 'version', v_version, 'late', v_late,
                                 'submission_id', v_submission))::text, true);
    update public.tasks
    set state = 'completed', admin_step = v_step, submitted_at = now(), submitted_by = v_actor,
        submitted_on_behalf_of = null,
        late_reason = case when v_late then v_late_reason else tasks.late_reason end,
        admin_approved_at = null, completed_at = now()
    where id = v_task.id;
    -- WORKFLOWS §9 "Task completed": the assignees and the creator; never the actor (the Owner).
    perform app.notify(app.task_people(v_task.id, true), 'task_completed',
      'Completed: ' || v_task.title,
      format('%s marked it done%s', app.member_name(v_subject), case when v_late then ' (late)' else '' end),
      '/tasks/' || v_task.id, 'tasks', v_task.id,
      jsonb_build_object('task_id', v_task.id, 'version', v_version), v_actor);
    -- v4.5 (WORKFLOWS §3.1, §5B.1): Done stops the task's upload link in the same transaction.
    perform app.upload_stop_link(v_task.id, 'task_done', v_actor);
    return 'completed'::public.task_state;
  end if;

  -- The route (PRODUCT §4.6): the Admin step is required, none (no approver) or skipped (the
  -- approver is on the task: an assignee, or the coordinator of a freelancer on it, decision 34;
  -- the reason lives only in the activity log).
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

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'on_behalf_of', task_submit_done.on_behalf_of, 'meta', v_meta)::text, true);
  update public.tasks
  set state = v_state, admin_step = v_step, submitted_at = now(), submitted_by = v_actor,
      submitted_on_behalf_of = task_submit_done.on_behalf_of,
      late_reason = case when v_late then v_late_reason else tasks.late_reason end,
      admin_approved_at = null
  where id = v_task.id;

  -- WORKFLOWS §9 "Task submitted (Done)": the approving Admin, or the Owner when there is no
  -- Admin step (5.1).
  perform app.notify(
    array[case when v_state = 'submitted' then v_task.approving_admin_id else app.org_owner_id(v_org) end],
    'task_submitted', 'Done: ' || v_task.title,
    format('%s marked it Done%s', app.member_name(v_subject), case when v_late then ' (late)' else '' end),
    '/tasks/' || v_task.id, 'tasks', v_task.id,
    jsonb_build_object('task_id', v_task.id, 'version', v_version), v_actor);
  -- v4.5 (WORKFLOWS §3.1, §5B.1): Done stops the task's upload link in the same transaction.
  perform app.upload_stop_link(v_task.id, 'task_done', v_actor);
  return v_state;
end;
$$;

revoke all on function public.task_submit_done(uuid, text, text, uuid) from public, anon;
grant execute on function public.task_submit_done(uuid, text, text, uuid) to authenticated, service_role;

comment on function public.task_submit_done(uuid, text, text, uuid) is
  'tasks.work, the primary owner (or their current coordinator with on_behalf_of, ADR-0013), from '
  'todo / in_progress / changes_requested. Records the primary owner''s acknowledgement if missing '
  '(audit acknowledged, meta.implied), writes the next task_submissions version (the optional note, '
  'links allowed), requires late_reason past due_at (REASON_REQUIRED), then routes: submitted with '
  'admin_step required when an approving Admin exists and is not on the task; otherwise '
  'admin_approved with admin_step none (no approver) or skipped (the approver is an assignee, '
  'meta.reason approver_is_assignee, or the current coordinator of an active freelancer assignee, '
  'meta.reason approver_is_coordinator: Kickoff 4 decision 34). Audit action: submitted. 5.1: '
  'notifies the approving Admin, or the Owner when there is no Admin step (task_submitted) through '
  'app.notify(). 6b.2: when the primary owner is the Owner the task goes straight to completed '
  '(admin_step skipped with an approver, else none; audit completed, meta.step owner_done; no '
  'task_reviews row) and the assignees and creator get task_completed. v4.5: every path stops the '
  'task''s active upload link (stop_reason task_done, stopped_by the actor).';

-- task_cancel: copied from migration 20260930050132_notifications_core (its latest definition); the
-- only change is app.upload_stop_link(..., 'task_cancelled', caller). Its grants stay; its comment gains
-- the link stop (below).
create or replace function public.task_cancel(task_id uuid, reason text)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_task public.tasks;
  v_reason text := app.clean_reason(task_cancel.reason);
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say why the task is cancelled.');
  end if;
  v_task := app.task_lock(task_cancel.task_id, v_org);
  -- The key and the scope (PERMISSIONS §1/§3): tasks.create, and the creator / approver / Owner.
  if not app.has_permission('tasks.create') or not app.task_manager(v_task.id) then
    perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner cancels it.');
  end if;
  if v_task.state = 'cancelled' then
    perform app.fail('INVALID_STATE', 'This task is already cancelled.');
  end if;
  if v_task.state = 'completed' then
    perform app.fail('INVALID_STATE', 'A completed task is reopened, not cancelled.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'cancelled',
    'meta', jsonb_build_object('reason', v_reason, 'from_state', v_task.state))::text, true);
  update public.tasks
  set state = 'cancelled', cancelled_at = now(), cancelled_reason = v_reason
  where id = v_task.id;
  -- WORKFLOWS §9 "Task cancelled": the assignees (+ creator) (5.1).
  perform app.notify(app.task_people(v_task.id, true), 'task_cancelled',
    'Cancelled: ' || v_task.title, v_reason,
    '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  -- v4.5 (WORKFLOWS §3.1, §5B.1): Cancel stops the task's upload link in the same transaction.
  perform app.upload_stop_link(v_task.id, 'task_cancelled', v_caller);
  return 'cancelled';
end;
$$;

comment on function public.task_cancel(uuid, text) is
  'The task''s creator, its approving Admin or the Owner (app.task_manager). Any state but '
  'completed or cancelled -> cancelled with the reason (REASON_REQUIRED); the task stays in '
  'history and reports, reminders stop (5.1). Audit action: cancelled. 5.1: notifies the assignees '
  'and the creator (task_cancelled) through app.notify(). v4.5: stops the task''s active upload link '
  'in the same transaction (stop_reason task_cancelled, stopped_by the caller).';
