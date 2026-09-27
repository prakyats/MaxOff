-- Phase 3 review (security must-fix, 2026-09-27): a member created their own files row through
-- the API, choosing storage_key (a '..' segment aliased another object's key), mime and
-- created_at, and called file_complete() with any size, around completeUpload's checks (the
-- object's size from the bucket, the SVG rewrite). Aliasing let the action's cleanup delete, or a
-- download read, another member's object. Now:
--   * no API insert on files: file_begin() creates the row and builds the key itself;
--   * file_begin() and file_complete() are service_role only, called by core/storage's actions
--     after their own checks, with the uploader named and re-checked here;
--   * both record the uploader as the activity actor (auth.uid() reads the local claim).
-- file_fail() stays the uploader's: it can only fail their own pending row.
-- Expand-only (ARCHITECTURE §18): files are phase-3 only, nothing on main reads them.

revoke insert on public.files from authenticated;
drop policy files_insert on public.files;

create or replace function public.file_begin(
  file_id uuid,
  uploader uuid,
  name text,
  mime text,
  size_bytes bigint,
  preview_of uuid default null
)
returns public.files
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text := btrim(coalesce(file_begin.name, ''));
  v_segment text;
  v_row public.files;
begin
  select m.org_id into v_org from public.members m
  where m.id = file_begin.uploader and m.status = 'active';
  if v_org is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if v_name = '' or length(v_name) > 255 then
    perform app.fail('VALIDATION', 'The file name is empty or too long.');
  end if;
  if coalesce(file_begin.mime, '') !~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$' then
    perform app.fail('VALIDATION', 'Unknown file type.');
  end if;
  if file_begin.size_bytes is null or file_begin.size_bytes <= 0 then
    perform app.fail('VALIDATION', 'This file is empty.');
  end if;
  if file_begin.preview_of is not null and not exists (
    select 1 from public.files f
    where f.id = file_begin.preview_of and f.org_id = v_org and f.preview_of is null
      and f.uploaded_by = file_begin.uploader
  ) then
    perform app.fail('VALIDATION', 'A preview points at an original you uploaded.');
  end if;

  -- The key's last segment: no separators or control characters, never '.' or '..'.
  v_segment := regexp_replace(v_name, '[/\\[:cntrl:]]', '', 'g');
  if v_segment in ('', '.', '..') then
    v_segment := 'file';
  end if;

  perform set_config('request.jwt.claim.sub', file_begin.uploader::text, true);
  insert into public.files (id, org_id, storage_key, name, mime, size_bytes, uploaded_by, status, preview_of)
  values (
    file_begin.file_id,
    v_org,
    v_org::text || '/' || to_char(app.today_ist(), 'YYYY/MM') || '/' || file_begin.file_id::text
      || '/' || v_segment,
    v_name,
    file_begin.mime,
    file_begin.size_bytes,
    file_begin.uploader,
    'pending',
    file_begin.preview_of
  )
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.file_begin(uuid, uuid, text, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.file_begin(uuid, uuid, text, text, bigint, uuid) to service_role;

comment on function public.file_begin(uuid, uuid, text, text, bigint, uuid) is
  'service_role only (core/storage beginUpload, after the permission, type and size checks for the '
  'purpose). Creates the uploader''s pending row; builds storage_key = <org>/<IST yyyy/mm>/<id>/<name> '
  'itself; a preview must point at the uploader''s own original. Audited as the uploader (insert).';

drop function public.file_complete(uuid, bigint, text);

create or replace function public.file_complete(file_id uuid, uploader uuid, size_bytes bigint, sha256 text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.files;
begin
  select f.* into v_file from public.files f where f.id = file_complete.file_id for update;
  if v_file.id is null or v_file.uploaded_by is distinct from file_complete.uploader then
    perform app.fail('NOT_FOUND', 'This upload does not exist.');
  end if;
  if not exists (select 1 from public.members m where m.id = file_complete.uploader and m.status = 'active') then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if v_file.status <> 'pending' then
    perform app.fail('INVALID_STATE', 'This upload has already finished.');
  end if;
  if file_complete.size_bytes is null or file_complete.size_bytes <= 0 then
    perform app.fail('VALIDATION', 'The uploaded size is unknown.');
  end if;
  perform set_config('request.jwt.claim.sub', file_complete.uploader::text, true);
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'ready', 'meta', jsonb_build_object('size_bytes', file_complete.size_bytes)
  )::text, true);
  update public.files
  set status = 'ready', size_bytes = file_complete.size_bytes, sha256 = file_complete.sha256
  where id = v_file.id;
  return 'ready';
end;
$$;

revoke all on function public.file_complete(uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.file_complete(uuid, uuid, bigint, text) to service_role;

comment on function public.file_complete(uuid, uuid, bigint, text) is
  'service_role only (core/storage completeUpload, once the object''s size is read from the bucket '
  'and an SVG is rewritten). The uploader''s pending row → ready. Audit action: ready, as the uploader.';
