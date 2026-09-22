-- Rename the system role "CEO" to "Owner" (decided 2026-09-22): it is a role, not a job title,
-- and this is the last cheap moment. Append-only: the 1.1 and 1.2 migrations keep their
-- 'ceo' text, and everything they created is renamed or re-created here.
--
-- Data needs no touching: role_permissions and members store the enum by OID, and the
-- partial index predicate is rewritten with the type, so RENAME VALUE carries them along.

alter type public.member_role rename value 'ceo' to 'owner';

comment on type public.member_role is
  'The three system roles (PRODUCT §3): one Owner, any number of Admins and Staff. Job titles '
  'are data, not roles.';

-- Objects whose name carried the old word ----------------------------------------------------

alter index public.members_single_ceo rename to members_single_owner;

alter table public.org_settings rename column ack_escalate_ceo_hours to ack_escalate_owner_hours;

comment on column public.org_settings.ack_escalate_owner_hours is
  'Hours after assignment without acknowledgement before the Owner is told (level 2). '
  'PRODUCT §7: 8.';

-- Functions whose body named the role ---------------------------------------------------------

create or replace function app.members_self_edit_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  key text;
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  -- Nobody demotes the only Owner by editing a row (invariant: exactly one Owner). A handover
  -- would be a workflow action of its own; the prototype has none.
  if old.role = 'owner' and new.role <> 'owner' and not app.in_transition() then
    perform app.fail('FORBIDDEN', 'The Owner role cannot be changed here.');
  end if;
  if app.in_transition() or app.has_permission('team.manage') then
    return new;
  end if;
  -- PERMISSIONS §3: a member edits only their own name and phone (avatar joins in 3.3).
  for key in select jsonb_object_keys(new_row) loop
    if key not in ('full_name', 'phone', 'updated_at')
       and old_row -> key is distinct from new_row -> key then
      perform app.fail('FORBIDDEN', 'Only your name and phone can be edited here.');
    end if;
  end loop;
  return new;
end;
$$;

comment on function app.members_self_edit_guard() is
  'BEFORE UPDATE on members. Without team.manage only full_name and phone may change '
  '(PERMISSIONS §3), and the Owner row never loses its role outside a transition function.';

-- bootstrap_ceo() inserted the literal 'ceo', which the renamed enum no longer accepts, so it is
-- replaced by bootstrap_owner() with the same contract (service role only, once per team).

drop function public.bootstrap_ceo(uuid, text, text, text);

create or replace function public.bootstrap_owner(user_id uuid, email text, full_name text, org_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(email));
  v_name text := trim(full_name);
  v_org_id uuid;
  v_org_count bigint;
begin
  if exists (select 1 from public.members) then
    perform app.fail('CONFLICT', 'The team already has members; the bootstrap runs only once.');
  end if;
  if user_id is null or not exists (select 1 from auth.users u where u.id = user_id) then
    perform app.fail('NOT_FOUND', 'Create the auth user first (auth.admin.createUser).');
  end if;
  if v_email is null or position('@' in v_email) <= 1 then
    perform app.fail('VALIDATION', 'A valid email is required.');
  end if;
  -- members.email is the login identity (PERMISSIONS §2): it must be the auth user's email.
  if not exists (select 1 from auth.users u where u.id = user_id and lower(u.email) = v_email) then
    perform app.fail('VALIDATION', 'The email must match the auth user''s email.');
  end if;
  if v_name is null or v_name = '' then
    perform app.fail('VALIDATION', 'The Owner''s name is required.');
  end if;

  select count(*) into v_org_count from public.organizations;
  if v_org_count > 1 then
    perform app.fail('CONFLICT', 'Several organizations exist; the bootstrap needs exactly one or none.');
  elsif v_org_count = 1 then
    select o.id into v_org_id from public.organizations o;
  else
    if org_name is null or trim(org_name) = '' then
      perform app.fail('VALIDATION', 'The organization name is required when none exists yet.');
    end if;
    insert into public.organizations (name) values (trim(org_name)) returning id into v_org_id;
  end if;

  -- Runs as the owner of the function, so the insert guard accepts an already-active member
  -- (the Owner sets a password from the printed recovery link; there is no invite to accept).
  insert into public.members (id, org_id, full_name, email, role, status, joined_at)
  values (user_id, v_org_id, v_name, v_email, 'owner', 'active', now());

  return user_id;
end;
$$;

revoke all on function public.bootstrap_owner(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_owner(uuid, text, text, text) to service_role;

comment on function public.bootstrap_owner(uuid, text, text, text) is
  'Creates the single organization (if none) and the first, active Owner member for an '
  'existing auth user. Service role only, and only while the team is empty. The members insert '
  'is audited by app.audit_row_change() with actor_id null (system).';
