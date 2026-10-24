-- v1.9 W2 (ROADMAP 6b.3; owner 2026-10-08, kickoff 6b decision 5): every active member may see
-- every member's profile photo. PERMISSIONS §3 "Profile photos" is the rule.
--
-- app.file_visible() is re-created from its latest definition (20260928025738_expense_claims)
-- with one change: the avatar branch no longer asks for team.view or the person. A file that is
-- a member's current avatar (members.avatar_file_id, same organisation) is visible to any caller
-- app.current_member() resolves, which is already an active permanent member only (a deactivated
-- member, a sign-in on a freelancer's id and anon resolve to nobody and read nothing). Every other
-- branch (uploader, preview follows its original, company logo, client logo, expense receipt) is
-- unchanged, word for word, so no other file kind is widened.
--
-- The read path needs nothing else: files_select (RLS on public.files) and the activity policy on
-- files entries both call app.file_visible(), and /api/files/<id> reads the row under RLS as the
-- viewer (core/storage getFile / getPreviewOf). member_directory, which says whose avatar_file_id a
-- member may read, is not touched.
--
-- EXPAND-ONLY (ARCHITECTURE §18): the same signature, a wider true-branch, no data touched.
-- Append-only: never edit once applied.

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
  -- 6b.3 (W2): any active member, for any member's current avatar in the same organisation.
  if exists (
    select 1 from public.members m
    where m.avatar_file_id = v_file.id and m.org_id = v_org
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
  if app.has_permission('expenses.decide')
     and exists (select 1 from public.expense_claims e where e.receipt_file_id = v_file.id) then
    return true;
  end if;
  return false;
end;
$$;

revoke all on function app.file_visible(uuid) from public;
grant execute on function app.file_visible(uuid) to authenticated, service_role;

comment on function app.file_visible(uuid) is
  'May the caller read this file? The uploader; any member for the company logo; any active member '
  'for a member''s current avatar (6b.3, v1.9 W2, owner 2026-10-08); app.client_visible() or a '
  'label row for a client logo; expenses.decide for an expense receipt (3b.3); a preview follows '
  'its original (PERMISSIONS §3, kickoff 3).';
