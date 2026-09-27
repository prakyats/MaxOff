-- Phase 3 review (architecture should-fix, owner: fix now, 2026-09-27): the nightly cleanup could
-- delete the object of a file a record still uses. Its archived branch had no "still referenced"
-- test, and a file could get there referenced: an archived upload attached again through the API,
-- or one upload attached to two records (the company logo and a client logo) and replaced on one
-- of them. Now:
--   * app.file_reference_count(id): how many single-column foreign keys point at a file (the same
--     catalog scan as the cleanup, so a new consumer is covered by declaring its FK);
--   * files_reference_guard refuses an archived file and a file already attached elsewhere
--     ("one upload, one place");
--   * file_cleanup_candidates' archived branch spares a file that is still referenced, and a
--     preview whose original is.
-- Expand-only (ARCHITECTURE §18): files are phase-3 only, nothing on main reads them.

create or replace function app.file_reference_count(p_file_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ref record;
  v_count int := 0;
  v_found int;
begin
  for v_ref in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.files'::regclass
      and cardinality(c.conkey) = 1
      and c.conrelid <> 'public.files'::regclass
  loop
    execute format('select count(*) from %s r where r.%I = $1', v_ref.tbl, v_ref.col)
      into v_found using p_file_id;
    v_count := v_count + v_found;
  end loop;
  return v_count;
end;
$$;

revoke all on function app.file_reference_count(uuid) from public;
grant execute on function app.file_reference_count(uuid) to authenticated, service_role;

comment on function app.file_reference_count(uuid) is
  'How many rows point at a file through a single-column foreign key (read from the catalog on '
  'each call; files.preview_of is not a reference). Security definer: counts rows the caller may '
  'not read, so the guard sees every use.';

create or replace function public.file_cleanup_candidates(
  archived_before timestamptz,
  pending_before timestamptz,
  orphaned_before timestamptz,
  batch int default 200
)
returns setof public.files
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- "No foreign key points at this row": the originals (alias o), the row itself (alias f) and
  -- a preview's original (f.preview_of).
  v_unreferenced_o text := 'true';
  v_unreferenced_f text := 'true';
  v_unreferenced_p text := 'true';
  v_ref record;
begin
  for v_ref in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.files'::regclass
      and cardinality(c.conkey) = 1
      and c.conrelid <> 'public.files'::regclass
    order by 1, 2
  loop
    v_unreferenced_o := v_unreferenced_o
      || format(' and not exists (select 1 from %s r where r.%I = o.id)', v_ref.tbl, v_ref.col);
    v_unreferenced_f := v_unreferenced_f
      || format(' and not exists (select 1 from %s r where r.%I = f.id)', v_ref.tbl, v_ref.col);
    v_unreferenced_p := v_unreferenced_p
      || format(' and not exists (select 1 from %s r where r.%I = f.preview_of)', v_ref.tbl, v_ref.col);
  end loop;

  return query execute format($query$
    with orphaned as (
      select o.id
      from public.files o
      where o.status = 'ready'
        and o.archived_at is null
        and o.preview_of is null
        and o.created_at <= $3
        and %1$s
    )
    select f.*
    from public.files f
    where f.status <> 'deleted'
      and (   (f.archived_at is not null and f.archived_at <= $1
               and %2$s
               and (f.preview_of is null or (%3$s)))
           or (f.status in ('pending', 'failed') and f.created_at <= $2)
           or f.id in (select id from orphaned)
           or (f.preview_of is not null
               and %2$s
               and (   f.preview_of in (select id from orphaned)
                    or exists (select 1 from public.files p
                               where p.id = f.preview_of and p.status = 'deleted'))))
    order by f.created_at
    limit $4
  $query$, v_unreferenced_o, v_unreferenced_f, v_unreferenced_p)
  using archived_before, pending_before, orphaned_before, batch;
end;
$$;

comment on function public.file_cleanup_candidates(timestamptz, timestamptz, timestamptz, int) is
  'service_role only (the storage_cleanup job). Rows whose object should go: archived at or before '
  'the first instant and referenced by no foreign key (nor, for a preview, its original: phase 3 '
  'review); pending or failed since before the second; a ready original that no foreign key '
  'references, created at or before the third (7 days); a preview that no foreign key references '
  'whose original is one of those or already deleted (ADR-0010 keeps referenced previews). '
  'Idempotent: deleted rows are never returned.';

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
  -- A replaced file is on its way out (the cleanup takes archived objects after 30 days).
  if v_file.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This file was replaced. Upload it again.');
  end if;
  -- The orphan cleanup takes unattached uploads at 7 days; a day short of that, attaching stops.
  if v_file.created_at <= now() - interval '6 days' then
    perform app.fail('INVALID_STATE', 'This upload has expired. Upload the file again.');
  end if;
  if v_file.preview_of is not null then
    perform app.fail('VALIDATION', 'Attach the original, not its preview.');
  end if;
  if v_file.mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')
     or (v_no_svg and v_file.mime = 'image/svg+xml') then
    perform app.fail('VALIDATION', 'This kind of file cannot be used here.');
  end if;
  -- One upload, one place: replacing it on one record archives it, which must not take it from
  -- another (BEFORE trigger: this row does not point at it yet, so any reference is elsewhere).
  if app.file_reference_count(v_file.id) > 0 then
    perform app.fail('CONFLICT', 'This file is already used elsewhere. Upload it again.');
  end if;
  return new;
end;
$$;

comment on function app.files_reference_guard() is
  'BEFORE INSERT OR UPDATE on a table with a file column (argument 1 = the column, argument 2 = '
  '''true'' to refuse SVG): the file must be a ready, unarchived original image of the record''s '
  'organization that the caller uploaded less than 6 days ago (the orphan cleanup takes it at 7), '
  'and not attached anywhere else (phase 3 review; client_brand resolves its organization through '
  'clients).';
