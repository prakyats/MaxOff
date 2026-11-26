-- v7.5 Q1 (owner 2026-11-26): the staff privacy notice (docs/handoff/v7.5-plan.md §3; docs/PRIVACY.md).
-- Everyone reads it at Me → Privacy; a one-time card on the home screen asks each member to read it
-- until they tap "Got it" on the notice. The notice's words live in the app (modules/privacy); its
-- version is a date string the app sends, so a changed notice (the lawyer's check before v8.0) asks
-- everyone again.
--
-- privacy_notice_reads: one row per member, the latest version they read and when. Own row readable;
-- no API write (only privacy_notice_read(), the caller's own row). Audited, so the history keeps every
-- version a member confirmed.
--
-- Expand-only: a new table and a new function.

create table public.privacy_notice_reads (
  member_id uuid primary key references public.members (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  version text not null check (version ~ '^\d{4}-\d{2}-\d{2}$'),
  read_at timestamptz not null default now()
);
comment on table public.privacy_notice_reads is
  'v7.5 Q1: the latest version of the staff privacy notice each member confirmed reading ("Got it" at '
  'Me → Privacy), and when. Written only by privacy_notice_read() (the caller''s own row); own row '
  'readable. Audited on insert and update, so every version confirmed is in the history.';
alter table public.privacy_notice_reads enable row level security;
revoke all on public.privacy_notice_reads from public, anon, authenticated;
grant select on public.privacy_notice_reads to authenticated;
grant select, insert, update on public.privacy_notice_reads to service_role;
create policy privacy_notice_reads_select on public.privacy_notice_reads for select to authenticated
  using (member_id = auth.uid());
create trigger audit_row_change after insert or update on public.privacy_notice_reads
  for each row execute function app.audit_row_change('member_id');

create function public.privacy_notice_read(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select * into v_me from app.current_member();
  if v_me.id is null then
    perform app.fail('FORBIDDEN');
  end if;
  if p_version is null or p_version !~ '^\d{4}-\d{2}-\d{2}$' then
    perform app.fail('VALIDATION', 'That is not a version of the notice.');
  end if;
  insert into public.privacy_notice_reads as r (member_id, org_id, version)
  values (v_me.id, v_me.org_id, p_version)
  on conflict (member_id) do update
    set version = excluded.version, read_at = now()
    where r.version is distinct from excluded.version;
end;
$$;
comment on function public.privacy_notice_read(text) is
  'v7.5 Q1: the caller confirms reading version p_version (YYYY-MM-DD) of the privacy notice: their own '
  'row, inserted or moved to that version (the same version again changes nothing). FORBIDDEN for a '
  'caller who is not an active member; VALIDATION for a malformed version.';
revoke all on function public.privacy_notice_read(text) from public, anon;
grant execute on function public.privacy_notice_read(text) to authenticated, service_role;
