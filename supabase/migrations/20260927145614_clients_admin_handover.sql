-- Phase 3 review (security must-fix + owner decision, 2026-09-27): a client's Admin read the client
-- through `admin_id = caller` alone, so a member demoted from Admin to Staff kept reading their
-- clients through the API. Now:
--   * the Admin branch of app.client_visible(), app.admin_client_ids() and the two policies that
--     name admin_id also needs clients.edit_assigned (an Admin's permission);
--   * no client is ever left without an Admin (owner): demoting or deactivating a member who still
--     runs a client is refused (members_client_admin_guard), and client_hand_over() moves their
--     clients to other Admins in one transaction, first (the Owner's dialog offers it inline).
-- Expand-only (ARCHITECTURE §18): the client relations are phase-3 only; the members trigger only
-- refuses a change that would orphan a client, which cannot exist on main.

create or replace function app.admin_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.clients c
  where c.org_id = (select m.org_id from app.current_member() m)
    and c.admin_id = (select m.id from app.current_member() m)
    and (select app.has_permission('clients.edit_assigned'));
$$;

comment on function app.admin_client_ids() is
  'The clients whose current Admin is the caller, while the caller holds clients.edit_assigned '
  '(PERMISSIONS §2; phase 3 review: a role change alone never leaves access behind). Read live from '
  'clients.admin_id, so a reassignment moves access at once. Empty for the Owner, who sees '
  'everything through clients.manage.';

create or replace function app.client_visible(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.org_id = (select m.org_id from app.current_member() m)
      and ((select app.has_permission('clients.manage'))
           or ((select app.has_permission('clients.edit_assigned'))
               and c.admin_id = (select m.id from app.current_member() m)))
  );
$$;

drop policy clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and ((select app.has_permission('clients.manage'))
              or ((select app.has_permission('clients.edit_assigned'))
                  and admin_id = (select m.id from app.current_member() m))));

drop policy client_admin_assignments_select on public.client_admin_assignments;
create policy client_admin_assignments_select on public.client_admin_assignments for select to authenticated
  using (app.client_visible(client_id)
         and ((select app.has_permission('clients.manage'))
              or ((select app.has_permission('clients.edit_assigned'))
                  and admin_id = (select m.id from app.current_member() m))));

-- The guard: a member who runs a client stays an active Admin until their clients have moved.
create or replace function app.members_client_admin_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if old.role = 'admin' and (new.role <> 'admin' or new.status <> 'active') then
    select count(*) into v_count from public.clients c where c.admin_id = old.id;
    if v_count > 0 then
      perform app.fail('CONFLICT', format(
        'Move %s''s %s to another Admin first.', old.full_name,
        case when v_count = 1 then '1 client' else v_count || ' clients' end));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app.members_client_admin_guard() from public;
grant execute on function app.members_client_admin_guard() to authenticated, service_role;

comment on function app.members_client_admin_guard() is
  'BEFORE UPDATE on members (phase 3 review, owner): refuses CONFLICT when an Admin who is still some '
  'client''s Admin (any client state) would stop being an active Admin (a role change or '
  'member_deactivate()). No client is ever left without an Admin; client_hand_over() moves them first.';

create trigger client_admin_guard before update of role, status on public.members
  for each row execute function app.members_client_admin_guard();

create or replace function public.client_hand_over(from_admin uuid, moves jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_move jsonb;
  v_client uuid;
  v_count int := 0;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_client_manager() r;
  if jsonb_typeof(moves) is distinct from 'array' or jsonb_array_length(moves) = 0 then
    perform app.fail('VALIDATION', 'Choose where the clients go.');
  end if;
  for v_move in select value from jsonb_array_elements(moves) loop
    v_client := nullif(v_move ->> 'client_id', '')::uuid;
    if not exists (
      select 1 from public.clients c
      where c.id = v_client and c.org_id = v_org and c.admin_id = client_hand_over.from_admin
    ) then
      perform app.fail('VALIDATION', 'Only a client this person runs can be handed over.');
    end if;
    perform public.client_assign_admin(v_client, nullif(v_move ->> 'admin_id', '')::uuid);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.client_hand_over(uuid, jsonb) from public, anon;
grant execute on function public.client_hand_over(uuid, jsonb) to authenticated, service_role;

comment on function public.client_hand_over(uuid, jsonb) is
  'clients.manage. Moves some or all of from_admin''s clients to other active Admins in one '
  'transaction: moves = [{client_id, admin_id}], each through client_assign_admin() (its history '
  'row, audit and notifications). Refuses a client from_admin does not run (VALIDATION). Used '
  'before a demotion or deactivation (members_client_admin_guard). Returns the number moved.';
