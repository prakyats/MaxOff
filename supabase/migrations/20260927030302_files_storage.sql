-- 3.3 Files: the files table (DATA-MODEL §9, ARCHITECTURE §11, ADR-0010; kickoff 3 decisions
-- 11-14), the two first consumers (organizations.logo_file_id, members.avatar_file_id,
-- client_brand.logo_file_id gains its FK), member_directory re-created with avatar_file_id
-- appended, the visibility helper, the status functions and the cleanup hooks.
-- Append-only: never edit once applied.
--
-- A file row is born pending by the uploader (files_begin_upload), moves to ready through
-- file_complete() once the object is in the bucket (or to failed through file_fail()), is
-- archived when the record that referenced it takes another file (trigger), and is marked
-- deleted by the storage_cleanup job once the object is gone (file_mark_deleted, service_role
-- only). The row is never removed (invariant 9). Originals are never re-encoded; a browser-made
-- JPEG preview is its own row pointing at the original through preview_of.

create table public.files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default app.current_org_id() references public.organizations (id),
  storage_key text not null unique check (length(storage_key) between 1 and 512),
  name text not null check (length(btrim(name)) between 1 and 255),
  mime text not null check (mime ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text null check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid null references public.members (id),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'deleted')),
  preview_of uuid null references public.files (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null
);
comment on table public.files is
  'Uploaded objects in the bucket (R2; MinIO locally). status and archived_at move only through '
  'the file_* functions and the replace trigger; the row stays after the object is deleted '
  '(status deleted). preview_of: a browser-made JPEG preview of that original (3.3).';

create index files_uploaded_by_idx on public.files (uploaded_by);
create index files_preview_of_idx on public.files (preview_of);
-- What storage_cleanup scans (WORKFLOWS §4a "Files"): archived rows and stale pending ones.
create index files_cleanup_idx on public.files (status, archived_at, created_at);

alter table public.organizations add column logo_file_id uuid null references public.files (id);
alter table public.members add column avatar_file_id uuid null references public.files (id);
alter table public.client_brand
  add constraint client_brand_logo_file_id_fkey foreign key (logo_file_id) references public.files (id);
create index organizations_logo_file_idx on public.organizations (logo_file_id);
create index members_avatar_file_idx on public.members (avatar_file_id);
create index client_brand_logo_file_idx on public.client_brand (logo_file_id);

-- Visibility (PERMISSIONS §3) ------------------------------------------------------------------
-- Who may read a file follows the record that carries it: the uploader always (their own upload,
-- before it is attached); any member for the company logo; team.view or the person for an
-- avatar; whoever may see the client or its label for a client logo. A preview follows its
-- original. security definer: it reads the referencing tables past RLS.

create or replace function app.file_visible(p_file_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_file public.files;
  v_caller uuid;
  v_org uuid;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    return false;
  end if;
  select f.* into v_file from public.files f where f.id = p_file_id and f.org_id = v_org;
  if v_file.id is null then
    return false;
  end if;
  if v_file.uploaded_by = v_caller then
    return true;
  end if;
  if v_file.preview_of is not null then
    return app.file_visible(v_file.preview_of);
  end if;
  if exists (select 1 from public.organizations o where o.logo_file_id = v_file.id and o.id = v_org) then
    return true;
  end if;
  if exists (
    select 1 from public.members m
    where m.avatar_file_id = v_file.id and m.org_id = v_org
      and (m.id = v_caller or app.has_permission('team.view'))
  ) then
    return true;
  end if;
  if exists (
    select 1 from public.client_brand b
    where b.logo_file_id = v_file.id
      and (app.client_visible(b.client_id) or b.client_id in (select app.labelled_client_ids()))
  ) then
    return true;
  end if;
  return false;
end;
$$;

revoke all on function app.file_visible(uuid) from public;
grant execute on function app.file_visible(uuid) to authenticated, service_role;

comment on function app.file_visible(uuid) is
  'May the caller read this file? The uploader; anyone for the company logo; team.view or the '
  'person for an avatar; app.client_visible() or a label row for a client logo; a preview follows '
  'its original (PERMISSIONS §3, kickoff 3).';

-- Guards ---------------------------------------------------------------------------------------

-- A record may only reference a ready image the caller uploaded (the browser just finished it).
-- Column-level: the trigger names the column it guards; avatars refuse SVG (kickoff 3).
-- Not security definer: a security definer trigger runs as the owner, where app.in_transition()
-- is true and the guard would skip itself. It reads files under RLS, which shows the caller
-- their own uploads (all a guard needs) and the attached ones.
create or replace function app.files_reference_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_column text := tg_argv[0];
  v_no_svg boolean := coalesce(tg_argv[1], 'false') = 'true';
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_file_id uuid := (v_new ->> v_column)::uuid;
  v_file public.files;
begin
  if v_file_id is null or v_file_id::text = (v_old ->> v_column) or app.in_transition() then
    return new;
  end if;
  select f.* into v_file from public.files f where f.id = v_file_id;
  -- organizations carries no org_id column: its own id is the organization.
  if v_file.id is null
     or v_file.org_id <> coalesce((v_new ->> 'org_id')::uuid, (v_new ->> 'id')::uuid) then
    perform app.fail('NOT_FOUND', 'This file does not exist.');
  end if;
  if v_file.uploaded_by is distinct from auth.uid() then
    perform app.fail('FORBIDDEN', 'Only the person who uploaded a file can attach it.');
  end if;
  if v_file.status <> 'ready' then
    perform app.fail('INVALID_STATE', 'The upload has not finished.');
  end if;
  if v_file.preview_of is not null then
    perform app.fail('VALIDATION', 'Attach the original, not its preview.');
  end if;
  if v_file.mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')
     or (v_no_svg and v_file.mime = 'image/svg+xml') then
    perform app.fail('VALIDATION', 'This kind of file cannot be used here.');
  end if;
  return new;
end;
$$;

revoke all on function app.files_reference_guard() from public;
grant execute on function app.files_reference_guard() to authenticated, service_role;

comment on function app.files_reference_guard() is
  'BEFORE INSERT OR UPDATE on a table with a file column (argument 1 = the column, argument 2 = '
  '''true'' to refuse SVG): the file must be a ready original image the caller uploaded.';

-- Replacing a logo or avatar archives the previous file row and its previews (kickoff 3 rule
-- 13); storage_cleanup deletes the object 30 days later. AFTER UPDATE, per column.
create or replace function app.files_archive_replaced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column text := tg_argv[0];
  v_old_id uuid := (to_jsonb(old) ->> v_column)::uuid;
  v_new_id uuid := (to_jsonb(new) ->> v_column)::uuid;
begin
  if v_old_id is null or v_old_id = v_new_id then
    return null;
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'archived',
    'meta', jsonb_build_object('replaced_on', tg_table_name, 'column', v_column)
  )::text, true);
  update public.files set archived_at = now()
  where (id = v_old_id or preview_of = v_old_id) and archived_at is null;
  return null;
end;
$$;

revoke all on function app.files_archive_replaced() from public;
grant execute on function app.files_archive_replaced() to authenticated, service_role;

comment on function app.files_archive_replaced() is
  'AFTER UPDATE on a table with a file column (argument 1): when the column moves to another '
  'file (or to null), the previous file and its previews are archived. Audit action: archived.';

-- Not security definer, for the same reason as files_reference_guard.
create or replace function app.files_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.in_transition() then
    -- The API creates pending rows of its own; status moves through the functions.
    new.status := 'pending';
    new.archived_at := null;
    new.sha256 := null;
    new.uploaded_by := auth.uid();
  end if;
  if new.preview_of is not null and not exists (
    select 1 from public.files f
    where f.id = new.preview_of and f.org_id = new.org_id and f.preview_of is null
      and (app.in_transition() or f.uploaded_by = new.uploaded_by)
  ) then
    perform app.fail('VALIDATION', 'A preview points at an original you uploaded.');
  end if;
  return new;
end;
$$;

revoke all on function app.files_insert_guard() from public;
grant execute on function app.files_insert_guard() to authenticated, service_role;

comment on function app.files_insert_guard() is
  'BEFORE INSERT on files: the API creates pending rows uploaded by the caller; a preview points '
  'at an original of the same uploader, never at another preview.';

-- 3.1's client_contacts insert guard was security definer, so app.in_transition() was true
-- inside it and archived_at was not forced null for an API insert. Re-created as an ordinary
-- trigger function (append-only fix): it reads the client's contacts under RLS, which the
-- caller may see whenever they may insert one.
create or replace function app.client_contacts_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.in_transition() then
    new.archived_at := null;
  end if;
  if not exists (
    select 1 from public.client_contacts c
    where c.client_id = new.client_id and c.is_primary and c.archived_at is null
  ) then
    new.is_primary := true;
  elsif new.is_primary then
    perform app.fail('VALIDATION', 'This client already has a primary contact. Add the contact, then make it primary.');
  end if;
  return new;
end;
$$;

create trigger set_updated_at before update on public.files
  for each row execute function app.set_updated_at();
create trigger insert_guard before insert on public.files
  for each row execute function app.files_insert_guard();
create trigger protect_columns before update on public.files
  for each row execute function app.protect_columns('status', 'archived_at', 'sha256', 'size_bytes', 'storage_key', 'mime', 'preview_of', 'uploaded_by');
create trigger audit_row_change after insert or update or delete on public.files
  for each row execute function app.audit_row_change();

create trigger logo_reference_guard before insert or update on public.organizations
  for each row execute function app.files_reference_guard('logo_file_id');
create trigger logo_archive_replaced after update on public.organizations
  for each row execute function app.files_archive_replaced('logo_file_id');
create trigger avatar_reference_guard before insert or update on public.members
  for each row execute function app.files_reference_guard('avatar_file_id', 'true');
create trigger avatar_archive_replaced after update on public.members
  for each row execute function app.files_archive_replaced('avatar_file_id');
create trigger logo_reference_guard before insert or update on public.client_brand
  for each row execute function app.files_reference_guard('logo_file_id');
create trigger logo_archive_replaced after update on public.client_brand
  for each row execute function app.files_archive_replaced('logo_file_id');

-- A member edits their own avatar (PERMISSIONS §3), so the self-edit guard lets the column through.
create or replace function app.members_self_edit_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  key text;
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if old.role = 'owner' and new.role <> 'owner' and not app.in_transition() then
    perform app.fail('FORBIDDEN', 'The Owner role cannot be changed here.');
  end if;
  if app.in_transition() or app.has_permission('team.manage') then
    return new;
  end if;
  -- PERMISSIONS §3: a member edits only their own name, phone and avatar (3.3).
  for key in select jsonb_object_keys(new_row) loop
    if key not in ('full_name', 'phone', 'avatar_file_id', 'updated_at')
       and old_row -> key is distinct from new_row -> key then
      perform app.fail('FORBIDDEN', 'Only your name, phone and photo can be edited here.');
    end if;
  end loop;
  return new;
end;
$$;

comment on function app.members_self_edit_guard() is
  'BEFORE UPDATE on members. Without team.manage only full_name, phone and avatar_file_id may '
  'change (PERMISSIONS §3), and the Owner row never loses its role outside a transition function.';

-- The directory gains the avatar (columns are only ever appended) --------------------------------

create or replace view public.member_directory
with (security_invoker = false, security_barrier = true)
as
  select m.id, m.org_id, m.full_name, m.phone, m.role, m.status, m.created_at, m.job_title_id,
         m.avatar_file_id
  from public.members m
  where m.org_id = (select c.org_id from app.current_member() c)
    and (m.id = auth.uid() or (select app.has_permission('team.view')));

-- Status functions (ADR-0006) --------------------------------------------------------------------

create or replace function public.file_complete(file_id uuid, size_bytes bigint, sha256 text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_file public.files;
begin
  select m.id into v_caller from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  select f.* into v_file from public.files f where f.id = file_complete.file_id for update;
  if v_file.id is null or v_file.uploaded_by <> v_caller then
    perform app.fail('NOT_FOUND', 'This upload does not exist.');
  end if;
  if v_file.status <> 'pending' then
    perform app.fail('INVALID_STATE', 'This upload has already finished.');
  end if;
  if file_complete.size_bytes is null or file_complete.size_bytes <= 0 then
    perform app.fail('VALIDATION', 'The uploaded size is unknown.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'ready', 'meta', jsonb_build_object('size_bytes', file_complete.size_bytes)
  )::text, true);
  update public.files
  set status = 'ready', size_bytes = file_complete.size_bytes, sha256 = file_complete.sha256
  where id = v_file.id;
  return 'ready';
end;
$$;

revoke all on function public.file_complete(uuid, bigint, text) from public, anon;
grant execute on function public.file_complete(uuid, bigint, text) to authenticated, service_role;

comment on function public.file_complete(uuid, bigint, text) is
  'The uploader only. pending → ready once the server has confirmed the object (size from the '
  'bucket, sha256 when computed). Audit action: ready.';

create or replace function public.file_fail(file_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_file public.files;
begin
  select m.id into v_caller from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  select f.* into v_file from public.files f where f.id = file_fail.file_id for update;
  if v_file.id is null or v_file.uploaded_by <> v_caller then
    perform app.fail('NOT_FOUND', 'This upload does not exist.');
  end if;
  if v_file.status <> 'pending' then
    perform app.fail('INVALID_STATE', 'This upload has already finished.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'failed', 'meta', '{}'::jsonb)::text, true);
  update public.files set status = 'failed' where id = v_file.id;
  return 'failed';
end;
$$;

revoke all on function public.file_fail(uuid) from public, anon;
grant execute on function public.file_fail(uuid) to authenticated, service_role;

comment on function public.file_fail(uuid) is
  'The uploader only. pending → failed (the browser gave up); the cleanup job removes any partial '
  'object. Audit action: failed.';

-- The cleanup job (WORKFLOWS §8 storage_cleanup, run by the Worker with the service key): what
-- to delete, and the mark once the object is gone. service_role only: the API role never sees
-- these.
create or replace function public.file_cleanup_candidates(archived_before timestamptz, pending_before timestamptz, batch int default 200)
returns setof public.files
language sql
stable
security definer
set search_path = ''
as $$
  select f.*
  from public.files f
  where f.status <> 'deleted'
    and ((f.archived_at is not null and f.archived_at <= archived_before)
         or (f.status = 'pending' and f.created_at <= pending_before))
  order by f.created_at
  limit batch;
$$;

revoke all on function public.file_cleanup_candidates(timestamptz, timestamptz, int) from public, anon, authenticated;
grant execute on function public.file_cleanup_candidates(timestamptz, timestamptz, int) to service_role;

comment on function public.file_cleanup_candidates(timestamptz, timestamptz, int) is
  'service_role only (the storage_cleanup job). Rows whose object should go: archived at or before '
  'the first instant, or still pending since before the second. Idempotent: deleted rows are never '
  'returned.';

create or replace function public.file_mark_deleted(file_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.files;
begin
  select f.* into v_file from public.files f where f.id = file_mark_deleted.file_id for update;
  if v_file.id is null then
    perform app.fail('NOT_FOUND', 'This file does not exist.');
  end if;
  if v_file.status = 'deleted' then
    return 'deleted';
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'deleted', 'meta', jsonb_build_object('from_status', v_file.status)
  )::text, true);
  update public.files
  set status = 'deleted', archived_at = coalesce(archived_at, now())
  where id = v_file.id;
  return 'deleted';
end;
$$;

revoke all on function public.file_mark_deleted(uuid) from public, anon, authenticated;
grant execute on function public.file_mark_deleted(uuid) to service_role;

comment on function public.file_mark_deleted(uuid) is
  'service_role only (the storage_cleanup job), after the object is gone from the bucket: any '
  'status → deleted; the row stays (invariant 9). Idempotent. Audit action: deleted.';

-- Grants -----------------------------------------------------------------------------------------

revoke all on public.files from anon;
revoke delete, truncate, references, trigger on public.files from authenticated;
revoke update on public.files from authenticated;
grant update (name) on public.files to authenticated;
-- Consumers: the logo column joins the organizations grant, the avatar column the members grant.
grant update (logo_file_id) on public.organizations to authenticated;
grant update (avatar_file_id) on public.members to authenticated;
revoke all on public.member_directory from anon;
revoke all on public.member_directory from authenticated;
grant select on public.member_directory to authenticated;

-- RLS --------------------------------------------------------------------------------------------

alter table public.files enable row level security;

-- The uploader's own rows are named inline as well as through app.file_visible(): an INSERT
-- ... RETURNING checks the SELECT policy in the same command, where a stable function's snapshot
-- does not yet hold the new row.
create policy files_select on public.files for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and (uploaded_by = (select m.id from app.current_member() m) or app.file_visible(id)));
-- Any active member may start an upload of their own (submissions in phase 5 need it too).
create policy files_insert on public.files for insert to authenticated
  with check (org_id = (select m.org_id from app.current_member() m)
              and uploaded_by = (select m.id from app.current_member() m));
create policy files_update_own on public.files for update to authenticated
  using (uploaded_by = (select m.id from app.current_member() m))
  with check (uploaded_by = (select m.id from app.current_member() m));

-- Activity (PERMISSIONS §2): whoever may read the file reads its entries.
create policy activity_log_select_files on public.activity_log for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and entity = 'files' and app.file_visible(entity_id));
