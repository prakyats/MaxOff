-- v4.0 (owner Q3, 18 Nov 2026: a renamed client renames its Drive folder). Expand-only: one new
-- service_role function beside drive_connect's (already on staging, so not edited).

create function public.drive_folder_rename(p_org uuid, p_id uuid, p_name text)
returns public.drive_folders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.drive_folders;
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 255 then
    perform app.fail('VALIDATION', 'A folder name needs 1 to 255 characters.');
  end if;
  update public.drive_folders f set name = btrim(p_name)
  where f.id = p_id and f.org_id = p_org
  returning * into v_row;
  if v_row.id is null then
    perform app.fail('NOT_FOUND', 'That folder is not cached here.');
  end if;
  return v_row;
end;
$$;
comment on function public.drive_folder_rename(uuid, uuid, text) is
  'v4.0 (owner Q3, 18 Nov: a renamed client renames its Drive folder), service_role only: records '
  'the new name of a cached folder the Worker has just renamed in Drive. The key (kind, ids, month) '
  'never changes, so the folder stays the same one. NOT_FOUND outside the organisation; VALIDATION '
  'for an empty or over-long name.';
revoke all on function public.drive_folder_rename(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.drive_folder_rename(uuid, uuid, text) to service_role;
