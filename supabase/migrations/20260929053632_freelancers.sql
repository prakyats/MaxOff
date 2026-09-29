-- 4A (4.1) Freelancers (ADR-0013; PRODUCT §4.17, WORKFLOWS §1b, PERMISSIONS §3, DATA-MODEL §1;
--   kickoff 4 decisions 1, 7, 8; kickoff 3b decisions 20 and 27).
--
-- A freelancer is a person record with no login: engagement = freelance, role = staff, no
-- auth.users row, exactly one current coordinator who acts on their behalf.
--
-- 1. engagement enum, members.engagement, members.email nullable with the check, the FK to
--    auth.users dropped (a freelancer has none), engagement protected, the insert guard.
-- 2. member_coordinators (history, one current) with RLS and audit; app.coordinator_of().
-- 3. member_add_freelancer(), member_set_coordinator(), member_invite_employee(); member_invite(),
--    member_deactivate(), member_reactivate() and member_change_email() re-created with the
--    freelancer refusals (same signatures).
-- 4. member_directory: engagement appended; widened to people on the caller's visible tasks (the
--    tasks tables arrive in the next migration, so the task part is a stub re-created there) and
--    a coordinator's freelancers.
-- 5. activity_log.on_behalf_of_id; app.audit_row_change() reads the override's on_behalf_of key.
-- 6. permanent-only guards: app.attendance_require_self() (every member-side attendance, leave,
--    extra work and expense function), comp_leave_grant(), app.absent_check(),
--    app.end_day_reminder_due(), attendance_today_detail(), month_summary().
-- 7. org_settings.workload_warning_threshold: default 4, set to 4 on existing rows (kickoff 4).
--
-- EXPAND-ONLY (ARCHITECTURE §18): a new enum, a defaulted column, a dropped NOT NULL with a check
-- main's rows satisfy, a dropped FK nothing reads, new tables and functions, re-created functions
-- with the same signatures and stricter guards, a view with one more column and more rows.
-- Append-only: never edit once applied.

-- 1. engagement ------------------------------------------------------------------------------------
create type public.engagement as enum ('permanent', 'freelance');
comment on type public.engagement is
  'ADR-0013: permanent = an employee with a login (the Owner included); freelance = a coordinated '
  'record with no login. Data, not a role.';

alter table public.members add column engagement public.engagement not null default 'permanent';
comment on column public.members.engagement is
  'ADR-0013 (4A). freelance: no auth.users row, no invite, no attendance, one current coordinator '
  '(member_coordinators). Changes only through member_invite_employee() (freelance -> permanent).';

-- A freelancer has no email; an employee always has one (and it is the login identity).
alter table public.members alter column email drop not null;
alter table public.members add constraint members_email_matches_engagement
  check ((engagement = 'permanent') = (email is not null));

-- The id is auth.users.id for a login and a fresh uuid for a freelancer (DATA-MODEL §1). Nothing
-- reads the FK; a later tasks-only login attaches an auth.users row to the same id (ADR-0013 §7).
alter table public.members drop constraint members_id_fkey;

drop trigger protect_columns on public.members;
create trigger protect_columns before update on public.members
  for each row execute function app.protect_columns(
    'status', 'invited_at', 'joined_at', 'deactivated_at', 'email', 'engagement');

create or replace function app.members_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An invite through the API starts as 'invited'; only the accept / deactivate transition
  -- functions (1.2, 1.3) move status and its timestamps.
  if not app.in_transition()
     and (new.status <> 'invited' or new.joined_at is not null or new.deactivated_at is not null) then
    perform app.fail('FORBIDDEN', 'A new member starts as invited.');
  end if;
  -- 4A: a freelancer is added through member_add_freelancer() (the coordinator row comes with it).
  if not app.in_transition() and new.engagement = 'freelance' then
    perform app.fail('FORBIDDEN', 'Add a freelancer through Add person.');
  end if;
  return new;
end;
$$;

comment on function app.members_insert_guard() is
  'BEFORE INSERT on members: outside a transition function a new row is invited, with no '
  'joined_at or deactivated_at, and never a freelancer (member_add_freelancer() creates those).';

-- 2. member_coordinators ---------------------------------------------------------------------------
create table public.member_coordinators (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id),
  coordinator_id uuid not null references public.members (id),
  from_at timestamptz not null default now(),
  to_at timestamptz null,
  set_by uuid null references public.members (id),
  reason text null check (reason is null or length(reason) <= 1000),
  created_at timestamptz not null default now(),
  constraint member_coordinators_not_self check (member_id <> coordinator_id),
  constraint member_coordinators_closed_after_open check (to_at is null or to_at >= from_at)
);
comment on table public.member_coordinators is
  'Who looks after a freelancer (ADR-0013): history, never rewritten. One row with to_at null per '
  'freelancer. Written only by the team functions; RLS: team.view reads all, a coordinator their own.';
create unique index member_coordinators_current_unique on public.member_coordinators (member_id)
  where to_at is null;
create index member_coordinators_member_idx on public.member_coordinators (member_id, from_at desc);
create index member_coordinators_coordinator_idx on public.member_coordinators (coordinator_id)
  where to_at is null;
create index member_coordinators_set_by_idx on public.member_coordinators (set_by);

create trigger audit_row_change after insert or update or delete on public.member_coordinators
  for each row execute function app.audit_row_change();

alter table public.member_coordinators enable row level security;
create policy member_coordinators_select on public.member_coordinators for select to authenticated
  using ((select app.has_permission('team.view'))
         or coordinator_id = (select c.id from app.current_member() c));
comment on policy member_coordinators_select on public.member_coordinators is
  'team.view (the Owner and Admins) reads every row; a member reads the rows where they are the '
  'coordinator (their own freelancers, current and past). Nobody writes through the API.';

revoke all on public.member_coordinators from anon;
revoke insert, update, delete, truncate, references, trigger on public.member_coordinators from authenticated;

-- The activity entries about a freelancer's coordination: team.view and the coordinator named.
create policy activity_log_select_member_coordinators on public.activity_log for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and entity = 'member_coordinators'
         and exists (select 1 from public.member_coordinators mc where mc.id = entity_id
                     and ((select app.has_permission('team.view'))
                          or mc.coordinator_id = (select c.id from app.current_member() c))));

create or replace function app.coordinator_of(p_member_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mc.coordinator_id
  from public.member_coordinators mc
  where mc.member_id = p_member_id and mc.to_at is null;
$$;

revoke all on function app.coordinator_of(uuid) from public;
grant execute on function app.coordinator_of(uuid) to authenticated, service_role;

comment on function app.coordinator_of(uuid) is
  'The freelancer''s current coordinator (the member_coordinators row with to_at null), or null. '
  'Every on-behalf check calls it at the moment of the action (ADR-0013 §3); a former coordinator '
  'has no standing.';

-- 3. The team functions ----------------------------------------------------------------------------

-- An eligible coordinator: an active permanent Admin or Staff of the organization, never the Owner
-- (kickoff 4 decision 8), never the freelancer themselves.
create or replace function app.coordinator_eligible(p_coordinator_id uuid, p_org uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.members;
begin
  if p_coordinator_id is null then
    perform app.fail('VALIDATION', 'Choose a coordinator.');
  end if;
  if p_coordinator_id = p_member_id then
    perform app.fail('VALIDATION', 'A freelancer cannot coordinate themselves.');
  end if;
  select m.* into v from public.members m where m.id = p_coordinator_id and m.org_id = p_org;
  if v.id is null then
    perform app.fail('NOT_FOUND', 'This coordinator is not on the team.');
  end if;
  if v.role = 'owner' then
    perform app.fail('VALIDATION', 'The Owner approves the work, so the Owner cannot coordinate. Choose an Admin or Staff member.');
  end if;
  if v.status <> 'active' or v.engagement <> 'permanent' then
    perform app.fail('VALIDATION', 'A coordinator is an active employee (Admin or Staff).');
  end if;
end;
$$;

revoke all on function app.coordinator_eligible(uuid, uuid, uuid) from public, authenticated;
grant execute on function app.coordinator_eligible(uuid, uuid, uuid) to service_role;

comment on function app.coordinator_eligible(uuid, uuid, uuid) is
  'Internal (4A): VALIDATION / NOT_FOUND unless the coordinator is an active permanent Admin or '
  'Staff of the organization, not the Owner and not the freelancer. Called by the team functions.';

create function public.member_add_freelancer(
  full_name text,
  job_title_id uuid default null,
  phone text default null,
  coordinator_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_name text := btrim(coalesce(full_name, ''));
  v_phone text := nullif(btrim(coalesce(phone, '')), '');
  v_id uuid := gen_random_uuid();
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  if v_name = '' then
    perform app.fail('VALIDATION', 'A name is required.');
  end if;
  if length(v_name) > 120 then
    perform app.fail('VALIDATION', 'Keep the name under 120 characters.');
  end if;
  if v_phone is not null and length(v_phone) not between 3 and 32 then
    perform app.fail('VALIDATION', 'Enter a phone number between 3 and 32 characters.');
  end if;
  perform app.coordinator_eligible(coordinator_id, v_org, v_id);

  -- Active from the start: nothing to accept (no login). joined_at = now() keeps the row's
  -- invariants (an active row has joined) and marks when the person was added.
  perform set_config('app.audit_override', jsonb_build_object('action', 'freelancer_added')::text, true);
  insert into public.members (id, org_id, full_name, email, phone, role, status, engagement, job_title_id, invited_at, joined_at)
  values (v_id, v_org, v_name, null, v_phone, 'staff', 'active', 'freelance', job_title_id, now(), now());

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'coordinator_set', 'meta', jsonb_build_object('coordinator_id', coordinator_id))::text, true);
  insert into public.member_coordinators (member_id, coordinator_id, set_by)
  values (v_id, coordinator_id, v_caller);

  return v_id;
end;
$$;

revoke all on function public.member_add_freelancer(text, uuid, text, uuid) from public, anon;
grant execute on function public.member_add_freelancer(text, uuid, text, uuid) to authenticated, service_role;

comment on function public.member_add_freelancer(text, uuid, text, uuid) is
  'team.manage. "Add person -> Freelancer" (ADR-0013): a members row with a fresh id, role staff, '
  'status active, engagement freelance, no email and no auth user, plus the first '
  'member_coordinators row. The coordinator is an active permanent Admin or Staff, never the Owner. '
  'Audit actions: freelancer_added (members), coordinator_set (member_coordinators). Notifies the '
  'coordinator (WORKFLOWS §9; the notification row is 5.1''s).';

create function public.member_set_coordinator(member_id uuid, coordinator_id uuid, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_target public.members;
  v_current public.member_coordinators;
  v_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  select m.* into v_target
  from public.members m
  where m.id = member_set_coordinator.member_id and m.org_id = v_org
  for update;
  if v_target.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_target.engagement <> 'freelance' then
    perform app.fail('VALIDATION', 'Only a freelancer has a coordinator.');
  end if;
  perform app.coordinator_eligible(member_set_coordinator.coordinator_id, v_org, v_target.id);

  select mc.* into v_current
  from public.member_coordinators mc
  where mc.member_id = v_target.id and mc.to_at is null
  for update;
  if v_current.coordinator_id = member_set_coordinator.coordinator_id then
    perform app.fail('INVALID_STATE', 'They already coordinate this freelancer.');
  end if;

  if v_current.id is not null then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'coordinator_closed',
      'meta', jsonb_build_object('reason', v_reason, 'next_coordinator_id', member_set_coordinator.coordinator_id))::text, true);
    update public.member_coordinators set to_at = now() where id = v_current.id;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', case when v_current.id is null then 'coordinator_set' else 'coordinator_changed' end,
    'meta', jsonb_build_object('reason', v_reason, 'coordinator_id', member_set_coordinator.coordinator_id,
                               'previous_coordinator_id', v_current.coordinator_id))::text, true);
  insert into public.member_coordinators (member_id, coordinator_id, set_by, reason)
  values (v_target.id, member_set_coordinator.coordinator_id, v_caller, v_reason)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.member_set_coordinator(uuid, uuid, text) from public, anon;
grant execute on function public.member_set_coordinator(uuid, uuid, text) to authenticated, service_role;

comment on function public.member_set_coordinator(uuid, uuid, text) is
  'team.manage. "Change coordinator": closes the freelancer''s current member_coordinators row '
  '(to_at) and opens the next (set_by, reason) in one transaction; allowed on a deactivated '
  'freelancer too, which is how a reactivation is prepared. VALIDATION for a permanent member or an '
  'ineligible coordinator (not active permanent Admin / Staff, the Owner, the freelancer), '
  'INVALID_STATE when that coordinator is already current. Returns the new row''s id. Audit actions: '
  'coordinator_closed, then coordinator_changed (or coordinator_set when none was current). Notifies '
  'the new coordinator and the previous one if still active (WORKFLOWS §9; 5.1).';

create function public.member_invite_employee(member_id uuid, email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_email text := lower(btrim(coalesce(email, '')));
  v_target public.members;
  v_auth_email text;
  v_current public.member_coordinators;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  if position('@' in v_email) <= 1 or length(v_email) > 254 then
    perform app.fail('VALIDATION', 'Enter a valid email address.');
  end if;

  select m.* into v_target
  from public.members m
  where m.id = member_invite_employee.member_id and m.org_id = v_org
  for update;
  if v_target.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_target.engagement <> 'freelance' then
    perform app.fail('INVALID_STATE', 'This person is already an employee.');
  end if;
  if v_target.status <> 'active' then
    perform app.fail('INVALID_STATE', 'Reactivate this freelancer before inviting them as an employee.');
  end if;
  if exists (select 1 from public.members m where lower(m.email) = v_email) then
    perform app.fail('CONFLICT', 'Someone with this email is already on the team.');
  end if;
  -- The action created the auth user with this very id (auth.admin.createUser({ id, email })), so
  -- the task history, the on-behalf rows and the audit stay on the same person (kickoff 4 (7)).
  select lower(u.email) into v_auth_email from auth.users u where u.id = v_target.id;
  if v_auth_email is null then
    perform app.fail('NOT_FOUND', 'No sign-in exists for this invite.');
  end if;
  if v_auth_email <> v_email then
    perform app.fail('VALIDATION', 'The email does not match the sign-in.');
  end if;

  select mc.* into v_current
  from public.member_coordinators mc
  where mc.member_id = v_target.id and mc.to_at is null
  for update;
  if v_current.id is not null then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'coordinator_closed', 'meta', jsonb_build_object('reason', 'became_employee'))::text, true);
    update public.member_coordinators set to_at = now() where id = v_current.id;
  end if;

  -- invited -> active on acceptance (member_accept_invite stamps joined_at again, so attendance
  -- starts the IST day after they join, WORKFLOWS §1).
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'invited_as_employee',
    'meta', jsonb_build_object('previous_coordinator_id', v_current.coordinator_id))::text, true);
  update public.members
  set engagement = 'permanent', email = v_email, status = 'invited', invited_at = now(), joined_at = null
  where id = v_target.id;

  return v_target.id;
end;
$$;

revoke all on function public.member_invite_employee(uuid, text) from public, anon;
grant execute on function public.member_invite_employee(uuid, text) to authenticated, service_role;

comment on function public.member_invite_employee(uuid, text) is
  'team.manage. "Invite as employee" (kickoff 4 decision 7): an active freelancer becomes an invited '
  'permanent employee on the SAME members.id, with the email the action gave the auth user it '
  'created under this id; invited_at = now(), joined_at cleared, the current coordinator row closed '
  '(reason became_employee). Refused on a permanent row, a deactivated freelancer, a taken address, a '
  'missing or mismatched sign-in. Audit actions: coordinator_closed, invited_as_employee. The '
  'action then issues the invite link as member_invite''s does (the invite email, WORKFLOWS §9).';

-- member_invite: a freelancer's id is never invited here (the door is member_invite_employee).
create or replace function public.member_invite(
  user_id uuid,
  email text,
  full_name text,
  role public.member_role,
  job_title_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_email text := lower(btrim(coalesce(email, '')));
  v_name text := btrim(coalesce(full_name, ''));
  v_auth_email text;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  if role = 'owner' then
    perform app.fail('VALIDATION', 'Invite people as Admin or Staff.');
  end if;
  if v_name = '' then
    perform app.fail('VALIDATION', 'A name is required.');
  end if;
  if position('@' in v_email) <= 1 or length(v_email) > 254 then
    perform app.fail('VALIDATION', 'Enter a valid email address.');
  end if;

  select lower(u.email) into v_auth_email from auth.users u where u.id = user_id;
  if v_auth_email is null then
    perform app.fail('NOT_FOUND', 'No sign-in exists for this invite.');
  end if;
  if v_auth_email <> v_email then
    perform app.fail('VALIDATION', 'The email does not match the sign-in.');
  end if;
  -- 4A: a freelancer joins as an employee through member_invite_employee(), same id.
  if exists (select 1 from public.members m where m.id = user_id and m.engagement = 'freelance') then
    perform app.fail('CONFLICT', 'This person is a freelancer. Use "Invite as employee" on their page.');
  end if;
  if exists (select 1 from public.members m where lower(m.email) = v_email or m.id = user_id) then
    perform app.fail('CONFLICT', 'Someone with this email is already on the team. Reactivate them instead.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'invited')::text, true);
  insert into public.members (id, org_id, full_name, email, role, status, job_title_id, invited_at)
  values (user_id, v_org, v_name, v_email, role, 'invited', job_title_id, now());

  return user_id;
end;
$$;

comment on function public.member_invite(uuid, text, text, public.member_role, uuid) is
  'team.manage. The invited member row for an auth user the action created with '
  'auth.admin.generateLink(type = invite). Admin or Staff only; CONFLICT when the email is already '
  'a member''s, or the id is a freelancer''s (use member_invite_employee). Audit action: invited.';

-- member_deactivate: a coordinator with active freelancers is CONFLICT; a freelancer's current
-- coordinator row is closed with them.
create or replace function public.member_deactivate(member_id uuid, reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_target public.members;
  v_reason text := nullif(btrim(coalesce(reason, '')), '');
  v_count int;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;

  select m.* into v_target
  from public.members m
  where m.id = member_id and m.org_id = v_org
  for update;
  if v_target.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_target.id = v_caller then
    perform app.fail('FORBIDDEN', 'You cannot deactivate yourself.');
  end if;
  if v_target.role = 'owner' then
    perform app.fail('FORBIDDEN', 'The Owner cannot be deactivated.');
  end if;
  if v_target.status = 'deactivated' then
    perform app.fail('INVALID_STATE', 'This person is already deactivated.');
  end if;
  -- 4A (WORKFLOWS §1b): no freelancer is left without a coordinator.
  select count(*) into v_count
  from public.member_coordinators mc
  join public.members f on f.id = mc.member_id and f.status = 'active'
  where mc.coordinator_id = v_target.id and mc.to_at is null;
  if v_count > 0 then
    perform app.fail('CONFLICT', format(
      'Move %s''s %s to another coordinator first.', v_target.full_name,
      case when v_count = 1 then '1 freelancer' else v_count || ' freelancers' end));
  end if;

  if v_target.engagement = 'freelance' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'coordinator_closed', 'meta', jsonb_build_object('reason', 'deactivated'))::text, true);
    update public.member_coordinators mc set to_at = now()
    where mc.member_id = v_target.id and mc.to_at is null;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'deactivated',
    'meta', jsonb_build_object('reason', v_reason, 'from_status', v_target.status)
  )::text, true);
  update public.members set status = 'deactivated', deactivated_at = now() where id = member_id;

  -- Access ends now, not when the JWT expires: no refresh token of theirs survives (ADR-0012).
  -- A freelancer has neither (no auth user): the deletes find nothing.
  delete from auth.refresh_tokens where user_id = member_id::text;
  delete from auth.sessions where user_id = member_id;

  return 'deactivated';
end;
$$;

comment on function public.member_deactivate(uuid, text) is
  'team.manage. active | invited → deactivated; never the caller, never the Owner; CONFLICT while an '
  'active freelancer has them as current coordinator (4A). A freelancer''s current coordinator row is '
  'closed (reason deactivated). Deletes the person''s auth.refresh_tokens and auth.sessions in the '
  'same transaction. The optional reason is kept in the activity log (meta.reason). Audit action: deactivated.';

-- member_reactivate: a freelancer needs a current coordinator again (member_set_coordinator first).
create or replace function public.member_reactivate(member_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_target public.members;
  v_to public.member_status;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  select m.* into v_target
  from public.members m
  where m.id = member_id and m.org_id = v_org
  for update;
  if v_target.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_target.status <> 'deactivated' then
    perform app.fail('INVALID_STATE', 'Only a deactivated person can be reactivated.');
  end if;
  if v_target.engagement = 'freelance' and app.coordinator_of(v_target.id) is null then
    perform app.fail('INVALID_STATE', 'Set a coordinator first, then reactivate this freelancer.');
  end if;

  v_to := case when v_target.joined_at is not null then 'active' else 'invited' end;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'reactivated',
    'meta', jsonb_build_object('to_status', v_to)
  )::text, true);
  update public.members set status = v_to, deactivated_at = null where id = member_id;

  return v_to::text;
end;
$$;

comment on function public.member_reactivate(uuid) is
  'team.manage. deactivated → active when the person had joined, otherwise back to invited (a new '
  'link is needed). A freelancer is reactivated only once a current coordinator exists again '
  '(member_set_coordinator first; INVALID_STATE otherwise, 4A). deactivated_at is cleared; the '
  'activity log keeps the history. Audit action: reactivated.';

-- member_change_email: a freelancer has no sign-in to move.
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
  if v_target.engagement = 'freelance' then
    perform app.fail('INVALID_STATE', 'A freelancer has no sign-in. Use "Invite as employee" instead.');
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

comment on function public.member_change_email(uuid, text) is
  'team.manage. Changes the login identity of an active, invited or Owner row (never a deactivated '
  'one, never a freelancer: 4A): CONFLICT when the address is another member''s or the sign-in was '
  'not moved first, VALIDATION when malformed or unchanged. Audit action: email_changed (meta.from / to).';

-- 4. member_directory: engagement, and the people a member works with ------------------------------
-- The task part (people on the caller's visible tasks) needs the tasks tables of the next
-- migration, which re-creates app.directory_visible() with it. Here: team.view, the caller, and a
-- coordinator's freelancers.
create or replace function app.directory_visible(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_member_id = auth.uid()
    or (select app.has_permission('team.view'))
    or app.coordinator_of(p_member_id) = auth.uid();
$$;

revoke all on function app.directory_visible(uuid) from public;
grant execute on function app.directory_visible(uuid) to authenticated, service_role;

comment on function app.directory_visible(uuid) is
  'Whose directory row (name, job title, role, status, phone, engagement; never email) the caller '
  'may read: their own, everyone''s for team.view, their current freelancers'' (4A), and (from the '
  'tasks migration) the people on the caller''s visible tasks (PERMISSIONS §2).';

create or replace view public.member_directory
with (security_invoker = false, security_barrier = true)
as
  select m.id, m.org_id, m.full_name, m.phone, m.role, m.status, m.created_at, m.job_title_id,
         m.avatar_file_id, m.engagement
  from public.members m
  where m.org_id = (select c.org_id from app.current_member() c)
    and app.directory_visible(m.id);

comment on view public.member_directory is
  'Who is on the team, without email. Everyone''s row for team.view, always the caller''s own, a '
  'coordinator''s freelancers and the people on the caller''s tasks (4A, PERMISSIONS §2). '
  'engagement marks a freelancer.';

-- 5. activity_log.on_behalf_of_id -------------------------------------------------------------------
alter table public.activity_log add column on_behalf_of_id uuid null references public.members (id);
create index activity_log_on_behalf_of_idx on public.activity_log (on_behalf_of_id) where on_behalf_of_id is not null;
comment on column public.activity_log.on_behalf_of_id is
  'ADR-0013 (4A): the freelancer a coordinator acted for ("Done by Ravi for Asha"); actor_id stays '
  'the coordinator. Set by transition functions, through the override''s on_behalf_of key or directly.';

create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  id_column text := coalesce(tg_argv[0], 'id');
  override jsonb := nullif(current_setting('app.audit_override', true), '')::jsonb;
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  diff_old jsonb := '{}'::jsonb;
  diff_new jsonb := '{}'::jsonb;
  key text;
  entity_uuid uuid;
  org uuid;
begin
  if override is not null then
    perform set_config('app.audit_override', '', true);
  end if;

  if tg_op = 'INSERT' then
    new_row := to_jsonb(new);
    row_data := new_row;
    diff_new := new_row - 'updated_at';
  elsif tg_op = 'UPDATE' then
    old_row := to_jsonb(old);
    new_row := to_jsonb(new);
    row_data := new_row;
    for key in select jsonb_object_keys(new_row) loop
      if key <> 'updated_at' and old_row -> key is distinct from new_row -> key then
        diff_old := diff_old || jsonb_build_object(key, old_row -> key);
        diff_new := diff_new || jsonb_build_object(key, new_row -> key);
      end if;
    end loop;
    if diff_new = '{}'::jsonb then
      return null; -- nothing changed, nothing to record
    end if;
  else
    old_row := to_jsonb(old);
    row_data := old_row;
    diff_old := old_row - 'updated_at';
  end if;

  entity_uuid := (row_data ->> id_column)::uuid;
  org := coalesce(
    (row_data ->> 'org_id')::uuid,
    case when tg_table_name = 'organizations' then entity_uuid end,
    app.current_org_id()
  );

  insert into public.activity_log (org_id, actor_id, on_behalf_of_id, entity, entity_id, action, diff, meta)
  values (
    org,
    auth.uid(),
    nullif(override ->> 'on_behalf_of', '')::uuid,
    tg_table_name,
    entity_uuid,
    coalesce(override ->> 'action', lower(tg_op)),
    jsonb_build_object('old', diff_old, 'new', diff_new),
    coalesce(override -> 'meta', '{}'::jsonb)
  );
  return null;
end;
$$;

comment on function app.audit_row_change() is
  'AFTER INSERT OR UPDATE OR DELETE row trigger. Writes activity_log with entity = the table '
  'name, action = insert|update|delete (or the action named by the app.audit_override setting a '
  'transition function set, with its meta and, since 4A, its on_behalf_of as on_behalf_of_id), '
  'entity_id = the row''s id (or the column named by the first trigger argument), diff = {old, new} '
  'of the changed columns only (updated_at excluded), actor_id = auth.uid() or null. A no-op update '
  'writes nothing.';

-- 6. permanent-only guards (PERMISSIONS §3, ADR-0013 §5) --------------------------------------------

-- Every member-side attendance, leave, extra work and expense function starts here.
create or replace function app.attendance_require_self(out caller_id uuid, out org_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_engagement public.engagement;
begin
  select m.id, m.org_id, m.engagement into caller_id, org_id, v_engagement from app.current_member() m;
  if caller_id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.self') then
    perform app.fail('FORBIDDEN', 'The Owner does not mark attendance.');
  end if;
  if v_engagement <> 'permanent' then
    perform app.fail('FORBIDDEN', 'Freelancers have no attendance or leave in MaxOff.');
  end if;
end;
$$;

comment on function app.attendance_require_self() is
  'The member-side attendance, leave, extra work and expense functions'' caller check: an active '
  'permanent member with attendance.self, else UNAUTHENTICATED / FORBIDDEN (the Owner; since 4A a '
  'freelancer too, ADR-0013 §5).';

-- comp_leave_grant: to a permanent member only.
create or replace function public.comp_leave_grant(member_id uuid, days numeric, note text default null, request_key uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_note text := app.clean_reason(note);
  v_today date := app.today_ist();
  v_id uuid;
  v_prior public.comp_leave_credits;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;
  if days is null or days not in (0.5, 1.0) then
    perform app.fail('VALIDATION', 'Grant half a day or one day.');
  end if;
  if not exists (
    select 1 from public.members m
    where m.id = comp_leave_grant.member_id and m.org_id = v_org and m.status = 'active'
      and m.engagement = 'permanent'
      and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'attendance.self')) then
    perform app.fail('NOT_FOUND', 'Comp leave is granted to an active Admin or Staff employee.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || comp_leave_grant.member_id::text));

  -- A double tap (or a retried request) with the same key is the same grant.
  if request_key is not null then
    select c.* into v_prior from public.comp_leave_credits c
    where c.member_id = comp_leave_grant.member_id and c.request_key = comp_leave_grant.request_key;
    if v_prior.id is not null then
      if v_prior.days <> days then
        perform app.fail('CONFLICT', 'This grant was already made with a different amount. Reload and check.');
      end if;
      return v_prior.id;
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'granted', 'meta', jsonb_build_object('days', days, 'standalone', true))::text, true);
  insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on, note, request_key)
  values (comp_leave_grant.member_id, days, v_caller, v_today, app.ist_month_end(v_today), v_note, request_key)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.comp_leave_grant(uuid, numeric, text, uuid) is
  'attendance.decide. A standalone comp leave grant (PRODUCT §4.3a, decision 14): half a day or one '
  'day to an active permanent member who marks attendance (never a freelancer, 4A), expiring at the '
  'end of this IST month, with an optional note the member sees. Idempotent on request_key (3b '
  'review): the same key returns the first credit (CONFLICT when the amount differs). Audit action: '
  'granted. Notifies the member (5.1).';

-- app.absent_check: permanent members only.
create or replace function app.absent_check(for_date date default null)
returns table (work_date date, member_id uuid, day_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_last date := app.job_day(now(), '23:59');
  v_first date;
  v_date date;
  v_working boolean;
  v_member record;
  v_day public.attendance_days;
begin
  if for_date is null then
    -- Catch-up (WORKFLOWS §8): the last 7 IST dates, oldest first. Idempotent, so a processed
    -- day writes nothing and a missed night is filled on the next run.
    v_first := v_last - 6;
  elsif for_date > v_last then
    perform app.fail('INVALID_STATE', 'That day has not ended yet.');
  else
    v_first := for_date;
    v_last := for_date;
  end if;

  for v_date in select s::date from generate_series(v_first, v_last, interval '1 day') s loop
    v_working := app.is_working_day(v_date);
    if v_working is null then
      -- No single organization in scope: "unknown" is never a working day (DATA-MODEL §0a).
      perform app.fail('INVALID_STATE', 'No organization is in scope; the absent check did nothing.');
    end if;
    if not v_working then
      -- A day off: nothing is expected, so nothing is written, leave-derived days included.
      continue;
    end if;

    -- Everyone attendance applies to (attendance.self by role, PERMISSIONS §1; permanent members
    -- only, ADR-0013 §5) whose attendance had started on that date (the IST day after joined_at,
    -- WORKFLOWS §1), in id order so two overlapping runs take the members' locks in the same order.
    for v_member in
      select m.id
      from public.members m
      where m.status = 'active'
        and m.engagement = 'permanent'
        and app.to_ist_date(m.joined_at) < v_date
        and exists (
          select 1 from public.role_permissions rp
          where rp.role = m.role and rp.permission = 'attendance.self')
      order by m.id
    loop
      perform pg_advisory_xact_lock(hashtext('leave:' || v_member.id::text));

      select d.* into v_day
      from public.attendance_days d
      where d.member_id = v_member.id and d.work_date = v_date
      for update;

      if v_day.id is null then
        if (app.leave_covering(v_member.id, v_date)).id is not null then
          -- Approved leave comes first: the day they never started is a leave day.
          v_day := app.attendance_open_day(v_member.id, v_date);
          return query select v_date, v_member.id, v_day.id, 'derived_from_leave'::text;
          continue;
        end if;
        perform set_config('app.audit_override', jsonb_build_object('action', 'proposed_absent')::text, true);
        insert into public.attendance_days (
          member_id, work_date, is_day_off, state, proposed_by_system, final_status)
        values (v_member.id, v_date, false, 'pending_review', true, 'absent')
        returning * into v_day;
        perform app.attendance_event(v_day.id, 'proposed_absent', null, 'absent', null, null);
        return query select v_date, v_member.id, v_day.id, 'proposed_absent'::text;
      elsif v_day.state = 'awaiting_choice' and not v_day.is_day_off then
        -- Opened (by a leave choice that was cancelled, say) and never chosen: "no submission".
        perform set_config('app.audit_override', jsonb_build_object('action', 'proposed_absent')::text, true);
        update public.attendance_days
        set state = 'pending_review', proposed_by_system = true, final_status = 'absent'
        where id = v_day.id
        returning * into v_day;
        perform app.attendance_event(v_day.id, 'proposed_absent', null, 'absent', null, null);
        return query select v_date, v_member.id, v_day.id, 'proposed_absent'::text;
      end if;
      -- pending_review, approved, corrected, or a row marked is_day_off: nothing to do.
    end loop;
  end loop;
end;
$$;

comment on function app.absent_check(date) is
  'The 23:59 IST job (WORKFLOWS §1/§8). For the last 7 IST dates up to job_day(now(), ''23:59''), '
  'or the one date given (INVALID_STATE before its cutoff): on a working day, every active permanent '
  'member with attendance.self whose attendance has started gets a leave-derived day when approved '
  'leave covers the date and they never started, or a proposed absence (pending_review, absent, '
  'proposed_by_system) when they have no day or an awaiting_choice one. Nothing on a day off, '
  'nothing for a freelancer (4A). Idempotent. Each member under their leave: lock. Returns one row '
  'per day written. Notifies the Owner once per run with everyone proposed (WORKFLOWS §9; 5.1).';

-- app.end_day_reminder_due: a freelancer never has a started day; the join says so explicitly.
create or replace function app.end_day_reminder_due(p_at timestamptz default now())
returns table (member_id uuid, day_id uuid, started_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.member_id, d.id, d.started_at
  from public.attendance_days d
  join public.members m on m.id = d.member_id and m.status = 'active' and m.engagement = 'permanent'
  where d.work_date = app.to_ist_date(p_at)
    and d.started_at is not null and d.ended_at is null
  order by d.member_id;
$$;

comment on function app.end_day_reminder_due(timestamptz) is
  'Read only, service_role. The members to remind at org_settings.logout_reminder_time (20:30 IST): '
  'every day on the IST date of p_at with a Start day and no End day, for active permanent members. '
  'WORKFLOWS §9 recipient: that member ("You haven''t ended your day. If you''re done, end it; if '
  'you''re working late, carry on."). The notification rows and the schedule arrive with 5.1.';

-- attendance_today_detail: the Owner's board never lists a freelancer (PRODUCT §4.17).
create or replace function public.attendance_today_detail()
returns table (
  member_id uuid, full_name text, job_title text, started boolean, day_id uuid,
  state public.attendance_state, final_status public.day_status, submitted_choice public.attendance_choice,
  proposed_by_system boolean, overtime_flag boolean, is_day_off boolean,
  on_leave boolean, leave_type public.leave_type,
  started_at timestamptz, ended_at timestamptz, end_not_recorded boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_today date := app.today_ist();
  v_day_off boolean;
begin
  select m.org_id into v_org from app.current_member() m;
  if v_org is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'Only the Owner sees everyone''s attendance.');
  end if;

  v_day_off := app.is_working_day(v_today) is false;

  return query
  select m.id, m.full_name, j.name,
         app.to_ist_date(m.joined_at) < v_today,
         d.id, d.state, d.final_status, d.submitted_choice,
         coalesce(d.proposed_by_system, false), coalesce(d.overtime_flag, false),
         coalesce(d.is_day_off, v_day_off),
         l.id is not null, l.type,
         d.started_at, d.ended_at, coalesce(d.end_not_recorded, false)
  from public.members m
  left join public.list_items j on j.id = m.job_title_id
  left join public.attendance_days d on d.member_id = m.id and d.work_date = v_today
  left join lateral app.leave_covering(m.id, v_today) l on true
  where m.org_id = v_org
    and m.status = 'active'
    and m.engagement = 'permanent'
    and exists (select 1 from public.role_permissions rp
                where rp.role = m.role and rp.permission = 'attendance.self')
  order by m.full_name, m.id;
end;
$$;

comment on function public.attendance_today_detail() is
  'attendance.view_all (FORBIDDEN otherwise). Read only. One row per active permanent member other '
  'than the Owner (never a freelancer, 4A), for today (IST): (member_id, full_name, job_title, '
  'started: attendance has begun, i.e. today > the IST date of joined_at; day_id, state, '
  'final_status, submitted_choice, proposed_by_system, overtime_flag, is_day_off: the day row''s '
  'value, else app.is_working_day(today) is false; on_leave: approved leave covers today, leave_type; '
  'started_at, ended_at, end_not_recorded). The Owner''s Today card and people board derive their '
  'buckets from it.';

-- month_summary: permanent members only (kickoff 3b decisions 20 and 27).
create or replace function public.month_summary(month date, member_id uuid default null)
returns table (
  id uuid,
  full_name text,
  role public.member_role,
  status public.member_status,
  working_days integer,
  days_worked numeric,
  present_days integer,
  leave_days integer,
  half_days integer,
  absent_days integer,
  comp_leave_days numeric,
  additional_leave numeric,
  days_off_worked integer,
  pending_days integer,
  overtime_notes integer,
  overtime_granted integer,
  credits_granted numeric,
  credits_used numeric,
  credits_expired numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_first date;
  v_last date;
  v_today date := app.today_ist();
  v_working integer;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'The month summary is the Owner''s.');
  end if;
  if month_summary.month is null then
    perform app.fail('VALIDATION', 'Pick a month.');
  end if;

  v_first := date_trunc('month', month_summary.month::timestamp)::date;
  v_last := app.ist_month_end(v_first);
  select count(*)::integer into v_working
  from generate_series(v_first, v_last, interval '1 day') g(d)
  where app.is_working_day(g.d::date) is not false;

  return query
  with people as (
    select m.id, m.full_name, m.role, m.status
    from public.members m
    where m.org_id = v_org
      and (month_summary.member_id is null or m.id = month_summary.member_id)
      and m.status <> 'invited'
      and m.joined_at is not null
      and app.to_ist_date(m.joined_at) <= v_last
      and (m.deactivated_at is null or app.to_ist_date(m.deactivated_at) >= v_first)
      -- Whoever marks attendance (Admins and Staff): the Owner has no day, and a freelancer has
      -- none either (4A, kickoff 3b decisions 20 and 27).
      and m.engagement = 'permanent'
      and exists (select 1 from public.role_permissions rp
                  where rp.role = m.role and rp.permission = 'attendance.self')
  ),
  days as (
    select d.member_id,
           count(*) filter (where d.decided and d.final_status = 'present' and not d.is_day_off) as present,
           count(*) filter (where d.decided and d.final_status = 'present' and d.is_day_off) as off_worked,
           count(*) filter (where d.decided and d.final_status = 'leave' and not d.is_day_off) as leave,
           count(*) filter (where d.decided and d.final_status = 'half_day' and not d.is_day_off and not d.comp_half) as half,
           count(*) filter (where d.decided and d.final_status = 'half_day' and not d.is_day_off and d.comp_half) as comp_half,
           count(*) filter (where d.decided and d.final_status = 'comp_leave' and not d.is_day_off) as comp_full,
           count(*) filter (where d.decided and d.final_status = 'absent' and not d.is_day_off) as absent,
           count(*) filter (where d.state = 'pending_review') as pending
    from (
      select a.member_id, a.final_status, a.is_day_off, a.state,
             a.state in ('approved', 'corrected') as decided,
             -- A half day that used a comp credit (3b.2) is comp leave, never additional leave.
             coalesce(r.credit_days is not null, false) as comp_half
      from public.attendance_days a
      left join public.leave_requests r on r.id = a.leave_request_id
      where a.member_id in (select p.id from people p)
        and a.work_date between v_first and v_last
    ) d
    group by d.member_id
  ),
  notes as (
    select n.member_id,
           count(*) as total,
           count(*) filter (where n.decision = 'granted') as granted
    from public.extra_work_notes n
    where n.member_id in (select p.id from people p)
      and n.kind = 'overtime'
      and n.work_date between v_first and v_last
    group by n.member_id
  ),
  credits as (
    select c.member_id,
           sum(c.days) as granted,
           sum(c.used_days) as used,
           sum(case when c.expires_on < v_today then c.days - c.used_days - c.reserved_days else 0 end) as expired
    from public.comp_leave_credits c
    where c.member_id in (select p.id from people p)
      and c.revoked_at is null
      and c.granted_on between v_first and v_last
    group by c.member_id
  )
  select p.id,
         p.full_name,
         p.role,
         p.status,
         v_working,
         coalesce(d.present, 0) + 0.5 * (coalesce(d.half, 0) + coalesce(d.comp_half, 0)),
         coalesce(d.present, 0)::integer,
         coalesce(d.leave, 0)::integer,
         coalesce(d.half, 0)::integer,
         coalesce(d.absent, 0)::integer,
         coalesce(d.comp_full, 0) + 0.5 * coalesce(d.comp_half, 0),
         coalesce(d.leave, 0) + 0.5 * coalesce(d.half, 0) + coalesce(d.absent, 0),
         coalesce(d.off_worked, 0)::integer,
         coalesce(d.pending, 0)::integer,
         coalesce(n.total, 0)::integer,
         coalesce(n.granted, 0)::integer,
         coalesce(c.granted, 0),
         coalesce(c.used, 0),
         coalesce(c.expired, 0)
  from people p
  left join days d on d.member_id = p.id
  left join notes n on n.member_id = p.id
  left join credits c on c.member_id = p.id
  order by p.full_name, p.id;
end;
$$;

comment on function public.month_summary(date, uuid) is
  'attendance.view_all (the Owner). One row per permanent person who marks attendance (id = the '
  'member; freelancers are out, 4A), over the IST month of `month` (one person with member_id): '
  'working_days, days_worked (decided Present on a working day + ½ per decided half day), present / '
  'leave / half / absent days, comp_leave_days (comp_leave days + ½ per half day that used a comp '
  'credit), additional_leave (leave + ½ × half + absent; comp leave never counts), days_off_worked, '
  'pending_days (waiting for the Owner), overtime notes and grants, the month''s unrevoked comp '
  'credits granted / used / expired. Decided = approved | corrected. Live: no snapshot. No money. '
  'Notifies nobody.';

-- 7. workload_warning_threshold (kickoff 4 decision 11) --------------------------------------------
alter table public.org_settings alter column workload_warning_threshold set default 4;
update public.org_settings set workload_warning_threshold = 4 where workload_warning_threshold is null;
comment on column public.org_settings.workload_warning_threshold is
  'The workload warning fires when a person already has this many open tasks due on the same IST '
  'day as the task being assigned (WORKFLOWS §3.1 "Assignment warnings"; default 4, kickoff 4). '
  'Edited in Settings -> Thresholds.';
