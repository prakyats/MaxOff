-- 1.3 Team (WORKFLOWS §1a, DATA-MODEL §0a/§1/§2, PERMISSIONS §3):
--   list_items (the core/lists engine, job titles first), members.job_title_id, the
--   member_directory view with it, an audit override so a transition function's row carries its
--   action name and meta, and the membership transition functions: invite, invite link refresh,
--   accept, deactivate (which also deletes the person's auth sessions), reactivate.

-- list_items ----------------------------------------------------------------------------------
create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) default app.current_org_id(),
  list_key text not null check (list_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text null check (description is null or length(description) <= 500),
  color text null check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  icon text null check (icon is null or length(icon) <= 64),
  -- Fractional-index string (ARCHITECTURE §6); 1.3 only appends, 1.4 reorders.
  position text not null default 'a0' check (length(position) between 1 and 64),
  meta jsonb not null default '{}'::jsonb,
  is_system boolean not null default false,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.list_items is
  'Editable lists (ADR-0002): one row per entry, list_key names the list (job_title first). '
  'Archived rows stay for history; nothing is deleted. Managed through core/lists.';
create unique index list_items_active_name_unique
  on public.list_items (org_id, list_key, lower(btrim(name))) where archived_at is null;
create index list_items_org_key_idx on public.list_items (org_id, list_key, position);

create trigger set_updated_at before update on public.list_items
  for each row execute function app.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.list_items
  for each row execute function app.audit_row_change();

alter table public.list_items enable row level security;
-- Every active member reads a list (job titles show on the directory and on /me).
create policy list_items_select on public.list_items for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c));
create policy list_items_insert on public.list_items for insert to authenticated
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('lists.manage')));
create policy list_items_update on public.list_items for update to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('lists.manage')))
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('lists.manage')));

revoke all on public.list_items from anon;
revoke delete, truncate, references, trigger on public.list_items from authenticated;

-- The launch job titles (PRODUCT §7) for every organization: the ones that exist and the ones
-- created later. is_system stays false: the Owner may rename or archive them (1.4).
create or replace function app.seed_org_lists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.list_items (org_id, list_key, name, position)
  values (new.id, 'job_title', 'Video Editor', 'a0'),
         (new.id, 'job_title', 'Graphic Designer', 'a1');
  return null;
end;
$$;

revoke all on function app.seed_org_lists() from public;
grant execute on function app.seed_org_lists() to authenticated, service_role;

comment on function app.seed_org_lists() is
  'AFTER INSERT on organizations: the launch job titles (PRODUCT §7). Rows, not code: 1.4 lets the Owner change them.';

create trigger seed_org_lists after insert on public.organizations
  for each row execute function app.seed_org_lists();

insert into public.list_items (org_id, list_key, name, position)
select o.id, 'job_title', t.name, t.position
from public.organizations o
cross join (values ('Video Editor', 'a0'), ('Graphic Designer', 'a1')) t(name, position)
where not exists (
  select 1 from public.list_items li where li.org_id = o.id and li.list_key = 'job_title'
);

-- members.job_title_id ----------------------------------------------------------------------
alter table public.members add column job_title_id uuid null references public.list_items (id);
create index members_job_title_id_idx on public.members (job_title_id);
comment on column public.members.job_title_id is
  'A job_title row of list_items (PRODUCT §3: data, not a permission). team.manage only: '
  'app.members_self_edit_guard() keeps it out of a self-edit.';

-- Editable through the API by team.manage (the self-edit guard refuses it for everyone else).
grant update (job_title_id) on public.members to authenticated;

create or replace function app.members_job_title_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_title_id is not null
     and (tg_op = 'INSERT' or new.job_title_id is distinct from old.job_title_id)
     and not exists (
       select 1 from public.list_items li
       where li.id = new.job_title_id
         and li.org_id = new.org_id
         and li.list_key = 'job_title'
         and li.archived_at is null
     ) then
    perform app.fail('VALIDATION', 'Choose a job title from the list.');
  end if;
  return new;
end;
$$;

revoke all on function app.members_job_title_guard() from public;
grant execute on function app.members_job_title_guard() to authenticated, service_role;

comment on function app.members_job_title_guard() is
  'BEFORE INSERT OR UPDATE on members: job_title_id, when set, is an unarchived job_title row of the same organization.';

create trigger job_title_guard before insert or update on public.members
  for each row execute function app.members_job_title_guard();

-- Owned by postgres, so it reads members past RLS; its WHERE is the gate. No email (PERMISSIONS
-- §2). Columns are only ever appended (create or replace view).
create or replace view public.member_directory
with (security_invoker = false, security_barrier = true)
as
  select m.id, m.org_id, m.full_name, m.phone, m.role, m.status, m.created_at, m.job_title_id
  from public.members m
  where m.org_id = (select c.org_id from app.current_member() c)
    and (m.id = auth.uid() or (select app.has_permission('team.view')));

-- Audit override --------------------------------------------------------------------------------
-- A transition function sets the transaction setting app.audit_override to
-- '{"action": "...", "meta": {...}}' before its write; the trigger's row then carries that
-- action and meta instead of 'update' / '{}', and the function writes no second row. The
-- setting is consumed (cleared) on the first audited write, so it can never leak to another.
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

  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta)
  values (
    org,
    auth.uid(),
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
  'transition function set, with its meta), entity_id = the row''s id (or the column named by the '
  'first trigger argument), diff = {old, new} of the changed columns only (updated_at excluded), '
  'actor_id = auth.uid() or null. A no-op update writes nothing.';

-- Team transition functions (ADR-0006) ---------------------------------------------------------
-- The caller must be an active member holding team.manage. Returns the caller and their org.
create or replace function app.require_team_manager(out caller_id uuid, out org_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.id, m.org_id into caller_id, org_id from app.current_member() m;
  if caller_id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('team.manage') then
    perform app.fail('FORBIDDEN', 'Only the Owner manages the team.');
  end if;
end;
$$;

revoke all on function app.require_team_manager() from public;
grant execute on function app.require_team_manager() to authenticated, service_role;

comment on function app.require_team_manager() is
  'The team transitions'' caller check: an active member with team.manage, else UNAUTHENTICATED / FORBIDDEN.';

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
  if exists (select 1 from public.members m where lower(m.email) = v_email or m.id = user_id) then
    perform app.fail('CONFLICT', 'Someone with this email is already on the team. Reactivate them instead.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'invited')::text, true);
  insert into public.members (id, org_id, full_name, email, role, status, job_title_id, invited_at)
  values (user_id, v_org, v_name, v_email, role, 'invited', job_title_id, now());

  return user_id;
end;
$$;

revoke all on function public.member_invite(uuid, text, text, public.member_role, uuid) from public, anon;
grant execute on function public.member_invite(uuid, text, text, public.member_role, uuid) to authenticated, service_role;

comment on function public.member_invite(uuid, text, text, public.member_role, uuid) is
  'team.manage. The invited member row for an auth user the action created with '
  'auth.admin.generateLink(type = invite). Admin or Staff only; CONFLICT when the email is already '
  'a member''s. Audit action: invited.';

create or replace function public.member_invite_refresh(member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_status public.member_status;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  select m.status into v_status
  from public.members m
  where m.id = member_id and m.org_id = v_org
  for update;
  if v_status is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_status <> 'invited' then
    perform app.fail('INVALID_STATE', 'Only a pending invite can get a new link.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'invite_link_issued')::text, true);
  update public.members set invited_at = now() where id = member_id;

  return member_id;
end;
$$;

revoke all on function public.member_invite_refresh(uuid) from public, anon;
grant execute on function public.member_invite_refresh(uuid) to authenticated, service_role;

comment on function public.member_invite_refresh(uuid) is
  'team.manage, member invited. Records that a fresh invite link is being issued (invited_at, audit '
  'action invite_link_issued); the action then generates it, and the previous link stops working.';

-- RLS shows a member row only to active members (app.current_member()), so an invited person
-- opening their link cannot read their own status. This answers with the caller's own status
-- and nothing else: null for an auth user with no member row.
create or replace function public.member_self_status()
returns public.member_status
language sql
stable
security definer
set search_path = ''
as $$
  select m.status from public.members m where m.id = auth.uid();
$$;

revoke all on function public.member_self_status() from public, anon;
grant execute on function public.member_self_status() to authenticated, service_role;

comment on function public.member_self_status() is
  'The caller''s own members.status (null without a row), readable whatever the status. Used by '
  'the invite link and set-password steps, which run before the person is active.';

create or replace function public.member_accept_invite()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := auth.uid();
  v_status public.member_status;
begin
  if v_id is null then
    perform app.fail('UNAUTHENTICATED', 'Sign in through your invite link first.');
  end if;

  select m.status into v_status from public.members m where m.id = v_id for update;
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

  return v_id;
end;
$$;

revoke all on function public.member_accept_invite() from public, anon;
grant execute on function public.member_accept_invite() to authenticated, service_role;

comment on function public.member_accept_invite() is
  'The caller''s own row, invited → active (joined_at). Called by setPassword() once the invited '
  'person''s password is stored. Audit action: accepted.';

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

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'deactivated',
    'meta', jsonb_build_object('reason', v_reason, 'from_status', v_target.status)
  )::text, true);
  update public.members set status = 'deactivated', deactivated_at = now() where id = member_id;

  -- Access ends now, not when the JWT expires: no refresh token of theirs survives (ADR-0012).
  delete from auth.refresh_tokens where user_id = member_id::text;
  delete from auth.sessions where user_id = member_id;

  return 'deactivated';
end;
$$;

revoke all on function public.member_deactivate(uuid, text) from public, anon;
grant execute on function public.member_deactivate(uuid, text) to authenticated, service_role;

comment on function public.member_deactivate(uuid, text) is
  'team.manage. active | invited → deactivated; never the caller, never the Owner. Deletes the '
  'person''s auth.refresh_tokens and auth.sessions in the same transaction. The optional reason '
  'is kept in the activity log (meta.reason). Audit action: deactivated.';

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

  v_to := case when v_target.joined_at is not null then 'active' else 'invited' end;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'reactivated',
    'meta', jsonb_build_object('to_status', v_to)
  )::text, true);
  update public.members set status = v_to, deactivated_at = null where id = member_id;

  return v_to::text;
end;
$$;

revoke all on function public.member_reactivate(uuid) from public, anon;
grant execute on function public.member_reactivate(uuid) to authenticated, service_role;

comment on function public.member_reactivate(uuid) is
  'team.manage. deactivated → active when the person had joined, otherwise back to invited (a new '
  'link is needed). deactivated_at is cleared; the activity log keeps the history. Audit action: reactivated.';
