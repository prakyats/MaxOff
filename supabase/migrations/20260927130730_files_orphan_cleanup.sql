-- 3B review fixes, storage (owner decision 2026-09-27, the open question from the 3A review):
-- a `ready` file that nothing references, older than 7 days, joins the cleanup. It is an upload
-- that completed but was never attached (the record's save failed after the upload, or the
-- browser lost completeUpload's answer), and until now its object stayed in the bucket forever.
--
-- "References" are the foreign keys that point at files (organizations.logo_file_id,
-- members.avatar_file_id, client_brand.logo_file_id today), read from the catalog on every run,
-- so a later consumer (work submissions in phase 5) is protected by declaring its FK, with no
-- list here to keep in step. files.preview_of is a preview's link to its original, not a
-- reference. A preview follows its original: it is a candidate once the original is one, or once
-- the original's object is gone.
--
-- Append-only: the function gains a third window, so the 3-argument form is dropped and the
-- 4-argument one created (files are phase-3 only; nothing on main calls it). Grants as before:
-- service_role only.

drop function public.file_cleanup_candidates(timestamptz, timestamptz, int);

create function public.file_cleanup_candidates(
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
  v_unreferenced text := 'true';
  v_ref record;
begin
  -- One "not referenced here" test per single-column foreign key that points at files.
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
    v_unreferenced := v_unreferenced
      || format(' and not exists (select 1 from %s r where r.%I = o.id)', v_ref.tbl, v_ref.col);
  end loop;

  return query execute format($query$
    with orphaned as (
      select o.id
      from public.files o
      where o.status = 'ready'
        and o.archived_at is null
        and o.preview_of is null
        and o.created_at <= $3
        and %s
    )
    select f.*
    from public.files f
    where f.status <> 'deleted'
      and (   (f.archived_at is not null and f.archived_at <= $1)
           or (f.status in ('pending', 'failed') and f.created_at <= $2)
           or f.id in (select id from orphaned)
           or (f.preview_of is not null
               and (   f.preview_of in (select id from orphaned)
                    or exists (select 1 from public.files p
                               where p.id = f.preview_of and p.status = 'deleted'))))
    order by f.created_at
    limit $4
  $query$, v_unreferenced)
  using archived_before, pending_before, orphaned_before, batch;
end;
$$;

revoke all on function public.file_cleanup_candidates(timestamptz, timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.file_cleanup_candidates(timestamptz, timestamptz, timestamptz, int)
  to service_role;

comment on function public.file_cleanup_candidates(timestamptz, timestamptz, timestamptz, int) is
  'service_role only (the storage_cleanup job). Rows whose object should go: archived at or before '
  'the first instant; pending or failed since before the second; a ready original that no foreign '
  'key references (read from the catalog), created at or before the third (3B review, owner '
  'decision 2026-09-27: 7 days); a preview whose original is one of those or already deleted. '
  'Idempotent: deleted rows are never returned.';
