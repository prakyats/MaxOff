-- 1.4 Settings (PRODUCT §4.16/§7, DATA-MODEL §0a/§1, WORKFLOWS §1a, PERMISSIONS §1/§3):
--   the holidays table, app.is_working_day() for the attendance jobs of phase 2, and
--   member_change_email(), the Owner's way to move a sign-in to another address.
-- Company name, weekly off days and the thresholds need no schema: organizations and
-- org_settings already carry them, with a settings.manage UPDATE policy from 1.1.
-- Append-only: never edit once applied.

-- holidays ------------------------------------------------------------------------------------
-- The one configuration table with a real DELETE: it has no archived_at (DATA-MODEL §1), a
-- mistyped date is the Owner's to remove, and audit_row_change() keeps the removed row. Removing
-- a holiday never rewrites the past: attendance_days carries its own is_day_off, decided on the
-- day itself (2.1).
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) default app.current_org_id(),
  date date not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, date)
);
comment on table public.holidays is
  'Company holidays (PRODUCT §7: none seeded, the Owner adds them). A date here is not a working '
  'day: app.is_working_day() and the phase-2 attendance jobs read it. Edited by settings.manage.';

create trigger set_updated_at before update on public.holidays
  for each row execute function app.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.holidays
  for each row execute function app.audit_row_change();

alter table public.holidays enable row level security;
-- Every active member reads them: a holiday shows on everyone's calendar (PRODUCT §4.8).
create policy holidays_select on public.holidays for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c));
create policy holidays_insert on public.holidays for insert to authenticated
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('settings.manage')));
create policy holidays_update on public.holidays for update to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('settings.manage')))
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('settings.manage')));
create policy holidays_delete on public.holidays for delete to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('settings.manage')));

revoke all on public.holidays from anon;
-- The blanket revoke in 1.1 covered the tables that existed then; a new table takes its own.
revoke truncate, references, trigger on public.holidays from authenticated;

-- app.is_working_day(date) ---------------------------------------------------------------------
-- security definer so a service-role job, a transition function and a member all get the same
-- answer: under RLS a job would read no org_settings row and call every day a working day.
create or replace function app.is_working_day(d date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when d is null then null else not (
    exists (
      select 1
      from public.org_settings s
      where s.org_id = app.current_org_id()
        and extract(dow from d)::smallint = any (s.weekly_off_days)
    )
    or exists (
      select 1
      from public.holidays h
      where h.org_id = app.current_org_id() and h.date = d
    )
  ) end;
$$;

revoke all on function app.is_working_day(date) from public;
grant execute on function app.is_working_day(date) to authenticated, service_role;

comment on function app.is_working_day(date) is
  'False when the date falls on a weekly off day (org_settings.weekly_off_days, 0 = Sunday) or on '
  'a holiday, true otherwise; null in, null out. Scoped by app.current_org_id(). The TS mirror is '
  'core/time isWorkingDay().';

-- member_change_email() ------------------------------------------------------------------------
create or replace function public.member_change_email(member_id uuid, new_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_target public.members;
  v_email text := lower(btrim(coalesce(new_email, '')));
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  if position('@' in v_email) <= 1 or length(v_email) > 254 then
    perform app.fail('VALIDATION', 'Enter a valid email address.');
  end if;

  select m.* into v_target
  from public.members m
  where m.id = member_id and m.org_id = v_org
  for update;
  if v_target.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  -- Active, invited (the invite went to a typo) and the Owner's own row, never a closed sign-in.
  if v_target.status = 'deactivated' then
    perform app.fail('INVALID_STATE', 'Reactivate this person before changing their email.');
  end if;
  if lower(v_target.email) = v_email then
    perform app.fail('VALIDATION', 'That is already their email address.');
  end if;
  if exists (
    select 1 from public.members m where lower(m.email) = v_email and m.id <> v_target.id
  ) then
    perform app.fail('CONFLICT', 'Someone on the team already signs in with that address.');
  end if;
  -- The action moves the sign-in first (auth.admin.updateUserById with email_confirm), so this
  -- holds unless the two ever drift; members.email may never name an address the sign-in lacks,
  -- which is the direction that would lock the person out.
  if not exists (
    select 1 from auth.users u where u.id = v_target.id and lower(u.email) = v_email
  ) then
    perform app.fail('CONFLICT', 'The sign-in was not moved to that address. Try again.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'email_changed',
    'meta', jsonb_build_object('from', v_target.email, 'to', v_email)
  )::text, true);
  update public.members set email = v_email where id = v_target.id;

  return v_email;
end;
$$;

revoke all on function public.member_change_email(uuid, text) from public, anon;
grant execute on function public.member_change_email(uuid, text) to authenticated, service_role;

comment on function public.member_change_email(uuid, text) is
  'team.manage. Moves a member''s login identity (WORKFLOWS §1a): active, invited or the Owner''s '
  'own row; CONFLICT when the address is another member''s or when the sign-in still carries the '
  'old one; INVALID_STATE for a deactivated person. Sessions are left alive. The caller updates '
  'auth.users through the Auth admin API before calling this. Audit action: email_changed.';
