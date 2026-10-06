-- 5B 5.5: onboarding for reachability (ROADMAP 5.5; owner decisions 2026-10-03, PROGRESS "Slice 9";
-- WORKFLOWS §9a). Expand-only: one new table, new functions, member_accept_invite() re-created with
-- the same signature and all its behaviour. No data is rewritten; nobody already on the team gets a row.
--
-- * **The onboarding marker** (decision 3 and its clarification): member_onboarding holds one row per
--   member who accepts their invite from now on, written by member_accept_invite() (the real first
--   login: the invited person's password is stored, they become active, joined_at is stamped). The
--   crew onboarded before this release never get a row, so they never see the walkthrough. A row is
--   finished once, by onboarding_finish('test') when the walkthrough's test was delivered, or
--   onboarding_finish('later') on "Later". Own row read; writes only through the two functions.
-- * **The band** (decision 1): push_status_own() gives the layout, in the one call it already made, the
--   caller's active endpoints (PushSync) and why the band shows (app.push_band): none while one of
--   their active devices has received a push (last_success_at) and is not failing; otherwise the
--   reachability state when it is not 'ok', else 'unconfirmed' (turned on, nothing received yet).
-- * **Remove another device** (decision 5): push_subscription_remove_own(id) deletes one of the
--   caller's own subscriptions, by id; anyone else's is refused, the Owner's included. Like
--   push_subscription_remove ("Sign out of this device") it is not audited: push_subscriptions is a
--   member's own device state (5.1 review S5, the table's comment).

-- 1. The onboarding marker ----------------------------------------------------------------------------
create table public.member_onboarding (
  member_id uuid primary key references public.members (id) on delete cascade,
  org_id uuid not null references public.organizations (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  finished_via text null check (finished_via in ('test', 'later')),
  constraint member_onboarding_finished_pair check ((finished_at is null) = (finished_via is null))
);
comment on table public.member_onboarding is
  '5B 5.5 (owner decisions 2026-10-03): the first-login walkthrough (install on iPhone, turn on '
  'notifications, send a test) of a member who accepted their invite after 5.5 shipped. Written by '
  'member_accept_invite(); finished by onboarding_finish() (''test'': the walkthrough''s test was '
  'delivered; ''later''). Members who joined before have no row and never see the walkthrough. Own '
  'row readable; no API write. Audited on insert and update; the cascade exists for the local '
  'stack''s fixture deletes.';
alter table public.member_onboarding enable row level security;
revoke all on public.member_onboarding from public, anon, authenticated;
grant select on public.member_onboarding to authenticated;
create policy member_onboarding_select on public.member_onboarding for select to authenticated
  using (member_id = auth.uid());
create trigger audit_row_change after insert or update on public.member_onboarding
  for each row execute function app.audit_row_change('member_id');

-- The first login: the latest body (20260922133957_team_members) and one insert after it. The audit
-- override is spent by the members update, so the onboarding row is audited as its own 'insert'.
create or replace function public.member_accept_invite()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := auth.uid();
  v_status public.member_status;
  v_org uuid;
begin
  if v_id is null then
    perform app.fail('UNAUTHENTICATED', 'Sign in through your invite link first.');
  end if;

  select m.status, m.org_id into v_status, v_org from public.members m where m.id = v_id for update;
  if v_status is null then
    perform app.fail('UNAUTHENTICATED', 'This sign-in is not on the team.');
  end if;
  if v_status = 'deactivated' then
    perform app.fail('FORBIDDEN', 'This account is not active. Ask the Owner.');
  end if;
  if v_status <> 'invited' then
    perform app.fail('INVALID_STATE', 'This invite was already accepted.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'accepted')::text, true);
  update public.members set status = 'active', joined_at = now() where id = v_id;

  -- 5.5: a new joiner's walkthrough starts at their first login.
  insert into public.member_onboarding (member_id, org_id) values (v_id, v_org)
  on conflict (member_id) do nothing;

  return v_id;
end;
$$;
revoke all on function public.member_accept_invite() from public, anon;
grant execute on function public.member_accept_invite() to authenticated, service_role;
comment on function public.member_accept_invite() is
  'The caller''s own row, invited → active (joined_at). Called by setPassword() once the invited '
  'person''s password is stored. Audit action: accepted. Since 5.5 it also starts the new joiner''s '
  'onboarding walkthrough (member_onboarding).';

create function public.onboarding_finish(p_via text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select m.id from app.current_member() m);
  v_n integer;
begin
  if v_me is null then
    perform app.fail('UNAUTHENTICATED', 'Sign in again.');
  end if;
  if p_via is null or p_via not in ('test', 'later') then
    perform app.fail('VALIDATION', 'Not a way to finish the walkthrough.');
  end if;
  -- 'test' only once a device of theirs has received a push (the walkthrough's test was delivered).
  if p_via = 'test' and not exists (
    select 1 from public.push_subscriptions s
    where s.member_id = v_me and s.disabled_at is null and s.last_success_at is not null
  ) then
    perform app.fail('INVALID_STATE', 'Send a test notification first.');
  end if;
  update public.member_onboarding o set finished_at = now(), finished_via = p_via
  where o.member_id = v_me and o.finished_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
comment on function public.onboarding_finish(text) is
  '5B 5.5: finishes the caller''s own walkthrough, once: ''test'' (refused with INVALID_STATE until an '
  'active device of theirs has received a push) or ''later''. Returns whether it finished now (false '
  'for a member with no walkthrough, or one already finished).';
revoke all on function public.onboarding_finish(text) from public, anon;
grant execute on function public.onboarding_finish(text) to authenticated, service_role;

-- 2. The band ------------------------------------------------------------------------------------------
create function app.push_band(p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- A device that has received a push and is not failing: the band is gone (decision 1).
    when exists (select 1 from public.push_subscriptions s
                 where s.member_id = p_member and s.disabled_at is null
                   and s.last_success_at is not null and s.failure_count < 2) then null
    else coalesce(nullif(app.reachability_state(p_member), 'ok'), 'unconfirmed')
  end;
$$;
comment on function app.push_band(uuid) is
  '5B 5.5 (owner decision 2026-10-03), service_role only: why the member''s notifications band '
  'shows, or null: null while an active device of theirs has received a push and has fewer than 2 '
  'errors in a row; else their reachability state when it is not ok (no_subscription, '
  'permission_revoked, ios_not_installed, failing), else ''unconfirmed'' (on, nothing received yet).';
revoke all on function app.push_band(uuid) from public, anon, authenticated;
grant execute on function app.push_band(uuid) to service_role;

create function public.push_status_own()
returns table (endpoints text[], band text)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select array_agg(s.endpoint order by s.created_at)
                   from public.push_subscriptions s
                   where s.member_id = m.id and s.disabled_at is null), '{}'::text[]),
         app.push_band(m.id)
  from app.current_member() m
  where m.id is not null;
$$;
comment on function public.push_status_own() is
  '5B 5.5: the layout''s one read for the notifications band: the caller''s own active endpoints '
  '(this device''s check, PushSync) and app.push_band(caller). No row for anyone who is not an '
  'active member. Never another member''s.';
revoke all on function public.push_status_own() from public, anon;
grant execute on function public.push_status_own() to authenticated, service_role;

-- 3. Remove another device ------------------------------------------------------------------------------
create function public.push_subscription_remove_own(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select m.id from app.current_member() m);
  v_n integer;
begin
  if v_me is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  delete from public.push_subscriptions s where s.id = p_id and s.member_id = v_me;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    perform app.fail('NOT_FOUND', 'This device is not one of yours.');
  end if;
  return true;
end;
$$;
comment on function public.push_subscription_remove_own(uuid) is
  '5B 5.5 (owner decision 2026-10-03): "Remove" on Me''s device list stops notifications to one of '
  'the caller''s own other devices (the row is deleted; that device is not signed out). Anyone '
  'else''s row, the Owner''s included, is NOT_FOUND. Not audited, as push_subscription_remove: a '
  'member''s own device state (5.1 review S5).';
revoke all on function public.push_subscription_remove_own(uuid) from public, anon;
grant execute on function public.push_subscription_remove_own(uuid) to authenticated, service_role;
