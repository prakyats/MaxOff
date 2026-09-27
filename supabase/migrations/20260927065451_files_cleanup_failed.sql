-- 3A review fixes for files (2026-09-27, architecture-reviewer on main...phase-3). Append-only:
-- (1) file_cleanup_candidates also returns failed rows past the pending window: a browser that
--     gave up after its PUT succeeded (a lost completeUpload answer) leaves an object behind a
--     `failed` row, and file_fail's own contract says the cleanup job removes it.
-- (2) files_archive_replaced audits every archived row: audit_row_change() consumes the
--     override on the first row, so the previews of a replaced logo were logged as plain
--     updates. One override per row now.
-- (3) files_reference_guard resolves the organization of a client_brand row through clients
--     (client_brand has neither org_id nor an organization id), so the org check holds on all
--     three consumers instead of comparing with null.

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
         or (f.status in ('pending', 'failed') and f.created_at <= pending_before))
  order by f.created_at
  limit batch;
$$;

comment on function public.file_cleanup_candidates(timestamptz, timestamptz, int) is
  'service_role only (the storage_cleanup job). Rows whose object should go: archived at or before '
  'the first instant, or still pending (or failed) since before the second. Idempotent: deleted '
  'rows are never returned.';

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
  v_id uuid;
begin
  if v_old_id is null or v_old_id = v_new_id then
    return null;
  end if;
  -- One override per row: app.audit_row_change() consumes it on the row it audits.
  for v_id in
    select f.id from public.files f
    where (f.id = v_old_id or f.preview_of = v_old_id) and f.archived_at is null
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'archived',
      'meta', jsonb_build_object('replaced_on', tg_table_name, 'column', v_column)
    )::text, true);
    update public.files set archived_at = now() where id = v_id;
  end loop;
  return null;
end;
$$;

comment on function app.files_archive_replaced() is
  'AFTER UPDATE on a table with a file column (argument 1): when the column moves to another '
  'file (or to null), the previous file and each of its previews are archived, each audited as '
  'archived.';

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
  v_org uuid;
begin
  if v_file_id is null or v_file_id::text = (v_old ->> v_column) or app.in_transition() then
    return new;
  end if;
  -- The record's organization: its own column; organizations' own id; a client_brand row's
  -- client (read under RLS: whoever may update the brand may see the client).
  v_org := coalesce(
    (v_new ->> 'org_id')::uuid,
    case when tg_table_name = 'organizations' then (v_new ->> 'id')::uuid end,
    (select c.org_id from public.clients c where c.id = (v_new ->> 'client_id')::uuid)
  );
  select f.* into v_file from public.files f where f.id = v_file_id;
  if v_file.id is null or v_org is null or v_file.org_id <> v_org then
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

comment on function app.files_reference_guard() is
  'BEFORE INSERT OR UPDATE on a table with a file column (argument 1 = the column, argument 2 = '
  '''true'' to refuse SVG): the file must be a ready original image of the record''s organization '
  'that the caller uploaded (client_brand resolves its organization through clients).';
