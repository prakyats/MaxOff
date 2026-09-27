-- 3.1 Clients: clients, client_private (Owner-only), client_admin_assignments (history),
-- client_contacts, client_brand, the client_labels view, the scope helpers and the lifecycle
-- transition functions. Documented in DATA-MODEL §0 / §4 / §9, PERMISSIONS §1-§3, WORKFLOWS §4
-- and §9 (kickoff 3 decisions, 2026-09-27). Append-only: never edit once applied.
--
-- Shape: a client is created by a plain INSERT under clients.manage (draft), edited as a plain
-- edit under clients.edit_assigned (the audit trigger records it), and moved between states only
-- by the functions below (ADR-0006). The Owner sees every client; an Admin sees the clients whose
-- admin_id is theirs, live (PERMISSIONS §2 "scope changes are live"); Staff never read a client
-- record and reach the label columns only through client_labels, which is empty for them until
-- tasks exist (4.1).

-- Enum (DATA-MODEL §0) ---------------------------------------------------------------------------

create type public.client_state as enum ('draft', 'active', 'paused', 'inactive');

-- Tables -----------------------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default app.current_org_id() references public.organizations (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  legal_name text null check (legal_name is null or length(btrim(legal_name)) between 1 and 200),
  state public.client_state not null default 'draft',
  admin_id uuid null references public.members (id),
  -- The 15-character GSTIN: state code, PAN, entity number, Z, check character (kickoff 3).
  gstin text null check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  address text null check (address is null or length(address) <= 500),
  city text null check (city is null or length(city) <= 120),
  phone text null check (phone is null or length(btrim(phone)) between 3 and 32),
  email text null check (email is null or (position('@' in email) > 1 and length(email) <= 254)),
  website text null check (website is null or (website ~ '^https://[^[:space:]]+$' and length(website) <= 500)),
  drive_url text null check (drive_url is null or (drive_url ~ '^https://[^[:space:]]+$' and length(drive_url) <= 500)),
  requirements text null check (requirements is null or length(requirements) <= 5000),
  notes text null check (notes is null or length(notes) <= 5000),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  activated_at timestamptz null,
  archived_at timestamptz null,
  created_by uuid null default auth.uid() references public.members (id),
  search tsvector generated always as (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(legal_name, '') || ' ' || coalesce(city, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_activated_matches_state check (state = 'draft' or activated_at is not null)
);
comment on table public.clients is
  'One row per client (PRODUCT §4.4). state, activated_at, admin_id and archived_at move only '
  'through the client_* transition functions; everything else is a plain edit under '
  'clients.edit_assigned. archived_at is reserved (kickoff 3: inactive is the end state).';

-- Kickoff 3 (1): the name is unique, case-insensitively, among clients that are not Inactive.
create unique index clients_name_unique on public.clients (org_id, lower(btrim(name)))
  where state <> 'inactive';
create index clients_admin_id_idx on public.clients (admin_id);
create index clients_org_state_idx on public.clients (org_id, state);
create index clients_search_idx on public.clients using gin (search);

create table public.client_private (
  client_id uuid primary key references public.clients (id),
  owner_notes text null check (owner_notes is null or length(owner_notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.client_private is
  'The Owner-only notes on a client (PERMISSIONS §1 clients.private_notes). One row per client, '
  'created with it by trigger. Never in an Admin or Staff payload.';

create table public.client_admin_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  admin_id uuid not null references public.members (id),
  assigned_by uuid null references public.members (id),
  from_at timestamptz not null default now(),
  to_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint client_admin_assignments_span check (to_at is null or to_at >= from_at)
);
comment on table public.client_admin_assignments is
  'Who ran the client, and when (WORKFLOWS §4). History: a change closes the open row and opens '
  'the next, only through client_assign_admin() (or the insert trigger for an Admin given at '
  'creation). Never rewritten.';

create unique index client_admin_assignments_open on public.client_admin_assignments (client_id)
  where to_at is null;
create index client_admin_assignments_client_idx on public.client_admin_assignments (client_id, from_at desc);
create index client_admin_assignments_admin_idx on public.client_admin_assignments (admin_id);

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default app.current_org_id() references public.organizations (id),
  client_id uuid not null references public.clients (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  designation text null check (designation is null or length(designation) <= 120),
  email text null check (email is null or (position('@' in email) > 1 and length(email) <= 254)),
  phone text null check (phone is null or length(btrim(phone)) between 3 and 32),
  is_primary boolean not null default false,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.client_contacts is
  'A client''s people (PRODUCT §4.4). Exactly one primary once any live contact exists: the first '
  'live contact becomes primary by trigger; is_primary and archived_at move only through '
  'client_contact_set_primary(), client_contact_archive() and client_contact_restore(). No '
  'uniqueness on email or phone (kickoff 3).';

create unique index client_contacts_one_primary on public.client_contacts (client_id)
  where is_primary and archived_at is null;
create index client_contacts_client_idx on public.client_contacts (client_id);

create table public.client_brand (
  client_id uuid primary key references public.clients (id),
  -- The FK to files arrives with the files table (3.3).
  logo_file_id uuid null,
  colors jsonb not null default '[]'::jsonb check (jsonb_typeof(colors) = 'array'),
  fonts jsonb not null default '[]'::jsonb check (jsonb_typeof(fonts) = 'array'),
  tone_of_voice text null check (tone_of_voice is null or length(tone_of_voice) <= 2000),
  brand_notes text null check (brand_notes is null or length(brand_notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.client_brand is
  'The light brand kit (PRODUCT §4.4): logo, colours [{name, hex}], fonts [{family, usage}], tone '
  'and notes. One row per client, created with it by trigger; the element shape is zod''s.';

-- Scope helpers ----------------------------------------------------------------------------------
-- security definer: they read clients past RLS, or a policy on clients would call a helper that
-- reads clients under that same policy.

create or replace function app.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select m.role = 'owner' from app.current_member() m), false);
$$;

revoke all on function app.is_owner() from public;
grant execute on function app.is_owner() to authenticated, service_role;

comment on function app.is_owner() is
  'True when the caller is the active Owner. For the few rules PERMISSIONS names as Owner-only '
  'by role rather than by key (custom field definitions, kickoff 3).';

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
    and c.admin_id = (select m.id from app.current_member() m);
$$;

revoke all on function app.admin_client_ids() from public;
grant execute on function app.admin_client_ids() to authenticated, service_role;

comment on function app.admin_client_ids() is
  'The clients whose current Admin is the caller (PERMISSIONS §2). Read live from clients.admin_id, '
  'so a reassignment moves access at once. Empty for the Owner: the Owner sees everything through '
  'clients.manage, not through an assignment.';

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
           or c.admin_id = (select m.id from app.current_member() m))
  );
$$;

revoke all on function app.client_visible(uuid) from public;
grant execute on function app.client_visible(uuid) to authenticated, service_role;

comment on function app.client_visible(uuid) is
  'May the caller read this client''s full record? clients.manage (the Owner) or the current '
  'Admin (PERMISSIONS §2). The gate for every child table and for client_labels.';

-- 4.1 replaces this: the clients that label a task the caller is assigned to (a Staff member's
-- only way to a client label, PERMISSIONS §2). Nothing labels anything yet, so it returns no rows.
create or replace function app.labelled_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.clients c where false;
$$;

revoke all on function app.labelled_client_ids() from public;
grant execute on function app.labelled_client_ids() to authenticated, service_role;

comment on function app.labelled_client_ids() is
  'Placeholder until tasks exist (4.1): the clients whose label sits on a task the caller is '
  'assigned to. Returns nothing yet; 4.1 re-creates it over task_assignees.';

-- Guards and triggers ----------------------------------------------------------------------------

-- An Admin is an active member of the organization with the admin role (PRODUCT §3: "each client
-- has exactly one Admin"). Shared by the insert guard and client_assign_admin().
create or replace function app.client_check_admin(p_admin_id uuid, p_org_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin public.members;
begin
  select m.* into v_admin from public.members m where m.id = p_admin_id and m.org_id = p_org_id;
  if v_admin.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_admin.role <> 'admin' or v_admin.status <> 'active' then
    perform app.fail('VALIDATION', 'A client''s Admin must be an active member with the Admin role.');
  end if;
end;
$$;

revoke all on function app.client_check_admin(uuid, uuid) from public;
grant execute on function app.client_check_admin(uuid, uuid) to authenticated, service_role;

comment on function app.client_check_admin(uuid, uuid) is
  'NOT_FOUND unless the member exists in the org; VALIDATION unless they are an active Admin.';

create or replace function app.clients_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A client is born a draft; only the functions move it (ADR-0006). A migration or a job may
  -- insert any state (in_transition()).
  if not app.in_transition() then
    new.state := 'draft';
    new.activated_at := null;
    new.archived_at := null;
  end if;
  if new.admin_id is not null then
    perform app.client_check_admin(new.admin_id, new.org_id);
  end if;
  return new;
end;
$$;

revoke all on function app.clients_insert_guard() from public;
grant execute on function app.clients_insert_guard() to authenticated, service_role;

comment on function app.clients_insert_guard() is
  'BEFORE INSERT on clients: the API creates drafts only; an admin_id given at creation must be an '
  'active Admin.';

create or replace function app.clients_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.client_private (client_id) values (new.id);
  insert into public.client_brand (client_id) values (new.id);
  if new.admin_id is not null then
    insert into public.client_admin_assignments (client_id, admin_id, assigned_by)
    values (new.id, new.admin_id, coalesce(auth.uid(), new.created_by));
  end if;
  return null;
end;
$$;

revoke all on function app.clients_after_insert() from public;
grant execute on function app.clients_after_insert() to authenticated, service_role;

comment on function app.clients_after_insert() is
  'AFTER INSERT on clients: the Owner-only notes row, the brand row and, when an Admin was given, '
  'the first assignment row are created with the client.';

create or replace function app.client_contacts_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.in_transition() then
    new.archived_at := null;
  end if;
  -- The first live contact is the primary one; a second primary goes through
  -- client_contact_set_primary(), which demotes the current one in the same transaction.
  if not exists (
    select 1 from public.client_contacts c
    where c.client_id = new.client_id and c.is_primary and c.archived_at is null
  ) then
    new.is_primary := true;
  elsif new.is_primary then
    perform app.fail('VALIDATION', 'This client already has a primary contact. Add the contact, then make it primary.');
  end if;
  return new;
end;
$$;

revoke all on function app.client_contacts_insert_guard() from public;
grant execute on function app.client_contacts_insert_guard() to authenticated, service_role;

comment on function app.client_contacts_insert_guard() is
  'BEFORE INSERT on client_contacts: the first live contact is made primary; a second primary is '
  'refused (use client_contact_set_primary). archived_at starts null.';

alter table public.clients alter column org_id set default app.current_org_id();

create trigger set_updated_at before update on public.clients
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.client_private
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.client_contacts
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.client_brand
  for each row execute function app.set_updated_at();

create trigger insert_guard before insert on public.clients
  for each row execute function app.clients_insert_guard();
create trigger after_insert after insert on public.clients
  for each row execute function app.clients_after_insert();
create trigger protect_columns before update on public.clients
  for each row execute function app.protect_columns('state', 'activated_at', 'admin_id', 'archived_at');
create trigger insert_guard before insert on public.client_contacts
  for each row execute function app.client_contacts_insert_guard();
create trigger protect_columns before update on public.client_contacts
  for each row execute function app.protect_columns('is_primary', 'archived_at', 'client_id');

create trigger audit_row_change after insert or update or delete on public.clients
  for each row execute function app.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.client_private
  for each row execute function app.audit_row_change('client_id');
create trigger audit_row_change after insert or update or delete on public.client_admin_assignments
  for each row execute function app.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.client_contacts
  for each row execute function app.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.client_brand
  for each row execute function app.audit_row_change('client_id');

-- The label view (PERMISSIONS §2) ------------------------------------------------------------------
-- Owned by postgres, so it reads past RLS; its WHERE is the gate. Columns are only ever appended.

create view public.client_labels
with (security_invoker = false, security_barrier = true)
as
  select c.id, c.name, c.state, b.logo_file_id, b.colors, b.fonts, b.tone_of_voice, b.brand_notes
  from public.clients c
  join public.client_brand b on b.client_id = c.id
  where c.org_id = (select m.org_id from app.current_member() m)
    and (app.client_visible(c.id) or c.id in (select app.labelled_client_ids()));

comment on view public.client_labels is
  'A client''s name and brand basics (never contacts, notes, GSTIN or money): rows for clients the '
  'caller may see, or whose label sits on a task the caller is assigned to (4.1). What Staff see of '
  'a client (ADR-0005).';

-- Grants -----------------------------------------------------------------------------------------

revoke all on public.clients, public.client_private, public.client_admin_assignments,
  public.client_contacts, public.client_brand, public.client_labels from anon;
revoke truncate, references, trigger on public.clients, public.client_private,
  public.client_admin_assignments, public.client_contacts, public.client_brand from authenticated;
-- Nothing is deleted (invariant 9): archive, close, cancel with a reason.
revoke delete on public.clients, public.client_private, public.client_admin_assignments,
  public.client_contacts, public.client_brand from authenticated;
-- Rows the triggers and functions create.
revoke insert on public.client_private, public.client_admin_assignments, public.client_brand
  from authenticated;
revoke update on public.client_admin_assignments from authenticated;
-- Column-level UPDATE grants: RLS decides who, the grant decides which columns (ARCHITECTURE §5).
revoke update on public.clients from authenticated;
grant update (name, legal_name, gstin, address, city, phone, email, website, drive_url,
  requirements, notes, custom_fields) on public.clients to authenticated;
revoke update on public.client_private from authenticated;
grant update (owner_notes) on public.client_private to authenticated;
revoke update on public.client_contacts from authenticated;
grant update (name, designation, email, phone, custom_fields) on public.client_contacts to authenticated;
revoke update on public.client_brand from authenticated;
grant update (logo_file_id, colors, fonts, tone_of_voice, brand_notes) on public.client_brand to authenticated;
revoke all on public.client_labels from authenticated;
grant select on public.client_labels to authenticated;

-- RLS --------------------------------------------------------------------------------------------

alter table public.clients enable row level security;
alter table public.client_private enable row level security;
alter table public.client_admin_assignments enable row level security;
alter table public.client_contacts enable row level security;
alter table public.client_brand enable row level security;

create policy clients_select on public.clients for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and ((select app.has_permission('clients.manage'))
              or admin_id = (select m.id from app.current_member() m)));
create policy clients_insert on public.clients for insert to authenticated
  with check (org_id = (select m.org_id from app.current_member() m)
              and (select app.has_permission('clients.manage')));
create policy clients_update on public.clients for update to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and (select app.has_permission('clients.edit_assigned'))
         and ((select app.has_permission('clients.manage'))
              or admin_id = (select m.id from app.current_member() m)))
  with check (org_id = (select m.org_id from app.current_member() m));

-- Owner-only table: one policy (PERMISSIONS §1 clients.private_notes), like the money tables.
create policy client_private_select on public.client_private for select to authenticated
  using ((select app.has_permission('clients.private_notes')) and app.client_visible(client_id));
create policy client_private_update on public.client_private for update to authenticated
  using ((select app.has_permission('clients.private_notes')) and app.client_visible(client_id))
  with check ((select app.has_permission('clients.private_notes')) and app.client_visible(client_id));

create policy client_admin_assignments_select on public.client_admin_assignments for select to authenticated
  using (app.client_visible(client_id)
         and ((select app.has_permission('clients.manage'))
              or admin_id = (select m.id from app.current_member() m)));

create policy client_contacts_select on public.client_contacts for select to authenticated
  using (app.client_visible(client_id));
create policy client_contacts_insert on public.client_contacts for insert to authenticated
  with check (org_id = (select m.org_id from app.current_member() m)
              and (select app.has_permission('clients.edit_assigned'))
              and app.client_visible(client_id));
create policy client_contacts_update on public.client_contacts for update to authenticated
  using ((select app.has_permission('clients.edit_assigned')) and app.client_visible(client_id))
  with check ((select app.has_permission('clients.edit_assigned')) and app.client_visible(client_id));

create policy client_brand_select on public.client_brand for select to authenticated
  using (app.client_visible(client_id));
create policy client_brand_update on public.client_brand for update to authenticated
  using ((select app.has_permission('clients.edit_assigned')) and app.client_visible(client_id))
  with check ((select app.has_permission('clients.edit_assigned')) and app.client_visible(client_id));

-- Activity (PERMISSIONS §2): entries about records the caller can see. client_private stays with
-- the base policy (activity.view_all), so an Admin never reads an entry about the Owner's notes.
create policy activity_log_select_clients on public.activity_log for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and ((entity in ('clients', 'client_brand') and app.client_visible(entity_id))
              or (entity = 'client_contacts'
                  and exists (select 1 from public.client_contacts cc
                              where cc.id = entity_id and app.client_visible(cc.client_id)))
              or (entity = 'client_admin_assignments'
                  and exists (select 1 from public.client_admin_assignments a
                              where a.id = entity_id
                                and a.admin_id = (select m.id from app.current_member() m)))));

-- Transition functions (ADR-0006) ---------------------------------------------------------------

create or replace function app.require_client_manager(out caller_id uuid, out org_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.id, m.org_id into caller_id, org_id from app.current_member() m;
  if caller_id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('clients.manage') then
    perform app.fail('FORBIDDEN', 'Only the Owner activates, pauses, closes or assigns a client.');
  end if;
end;
$$;

revoke all on function app.require_client_manager() from public;
grant execute on function app.require_client_manager() to authenticated, service_role;

comment on function app.require_client_manager() is
  'The lifecycle functions'' caller check: an active member with clients.manage.';

-- The caller may edit this client (clients.edit_assigned on a visible client). Locks the client
-- row and returns it.
create or replace function app.lock_client_for_edit(p_client_id uuid)
returns public.clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_client public.clients;
begin
  select m.id into v_caller from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('clients.edit_assigned') then
    perform app.fail('FORBIDDEN', 'You cannot edit clients.');
  end if;
  if not app.client_visible(p_client_id) then
    perform app.fail('NOT_FOUND', 'This client is not one of yours.');
  end if;
  select c.* into v_client from public.clients c where c.id = p_client_id for update;
  return v_client;
end;
$$;

revoke all on function app.lock_client_for_edit(uuid) from public;
grant execute on function app.lock_client_for_edit(uuid) to authenticated, service_role;

comment on function app.lock_client_for_edit(uuid) is
  'The contact functions'' caller check: clients.edit_assigned on a client the caller may see; '
  'NOT_FOUND for any other client (never "forbidden", which would confirm it exists).';

create or replace function public.client_activate(client_id uuid)
returns public.client_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_client public.clients;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_client_manager() r;
  select c.* into v_client from public.clients c
  where c.id = client_activate.client_id and c.org_id = v_org for update;
  if v_client.id is null then
    perform app.fail('NOT_FOUND', 'This client does not exist.');
  end if;
  if v_client.state not in ('draft', 'paused') then
    perform app.fail('INVALID_STATE', 'Only a draft or paused client can be activated.');
  end if;
  if v_client.admin_id is null then
    perform app.fail('VALIDATION', 'Assign an Admin before activating this client.');
  end if;
  perform app.client_check_admin(v_client.admin_id, v_org);

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'activated',
    'meta', jsonb_build_object('from_state', v_client.state)
  )::text, true);
  update public.clients
  set state = 'active', activated_at = coalesce(activated_at, now())
  where id = v_client.id;
  return 'active';
end;
$$;

revoke all on function public.client_activate(uuid) from public, anon;
grant execute on function public.client_activate(uuid) to authenticated, service_role;

comment on function public.client_activate(uuid) is
  'clients.manage. draft | paused → active (WORKFLOWS §4); needs an active Admin. Audit action: '
  'activated (meta.from_state).';

create or replace function public.client_pause(client_id uuid)
returns public.client_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_client public.clients;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_client_manager() r;
  select c.* into v_client from public.clients c
  where c.id = client_pause.client_id and c.org_id = v_org for update;
  if v_client.id is null then
    perform app.fail('NOT_FOUND', 'This client does not exist.');
  end if;
  if v_client.state <> 'active' then
    perform app.fail('INVALID_STATE', 'Only an active client can be paused.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'paused', 'meta', '{}'::jsonb
  )::text, true);
  update public.clients set state = 'paused' where id = v_client.id;
  return 'paused';
end;
$$;

revoke all on function public.client_pause(uuid) from public, anon;
grant execute on function public.client_pause(uuid) to authenticated, service_role;

comment on function public.client_pause(uuid) is
  'clients.manage. active → paused: readable, no new cycles (WORKFLOWS §4). Audit action: paused.';

create or replace function public.client_close(client_id uuid, reason text default null)
returns public.client_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_client public.clients;
  v_reason text := nullif(btrim(coalesce(reason, '')), '');
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_client_manager() r;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;
  select c.* into v_client from public.clients c
  where c.id = client_close.client_id and c.org_id = v_org for update;
  if v_client.id is null then
    perform app.fail('NOT_FOUND', 'This client does not exist.');
  end if;
  if v_client.state not in ('active', 'paused') then
    perform app.fail('INVALID_STATE', 'Only an active or paused client can be closed.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'closed',
    'meta', jsonb_build_object('reason', v_reason, 'from_state', v_client.state)
  )::text, true);
  update public.clients set state = 'inactive' where id = v_client.id;
  return 'inactive';
end;
$$;

revoke all on function public.client_close(uuid, text) from public, anon;
grant execute on function public.client_close(uuid, text) to authenticated, service_role;

comment on function public.client_close(uuid, text) is
  'clients.manage. active | paused → inactive, the end state (kickoff 3): readable and searchable, '
  'no new work until reactivated. The optional reason is kept in the activity log (meta.reason). '
  'Audit action: closed.';

create or replace function public.client_reactivate(client_id uuid)
returns public.client_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_client public.clients;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_client_manager() r;
  select c.* into v_client from public.clients c
  where c.id = client_reactivate.client_id and c.org_id = v_org for update;
  if v_client.id is null then
    perform app.fail('NOT_FOUND', 'This client does not exist.');
  end if;
  if v_client.state <> 'inactive' then
    perform app.fail('INVALID_STATE', 'Only an inactive client can be reactivated.');
  end if;
  if v_client.admin_id is null then
    perform app.fail('VALIDATION', 'Assign an Admin before reactivating this client.');
  end if;
  perform app.client_check_admin(v_client.admin_id, v_org);
  -- The name went out of the unique set when the client became inactive (kickoff 3 rule 1).
  if exists (
    select 1 from public.clients c
    where c.org_id = v_org and c.id <> v_client.id and c.state <> 'inactive'
      and lower(btrim(c.name)) = lower(btrim(v_client.name))
  ) then
    perform app.fail('CONFLICT', 'Another client already uses this name. Rename one of them first.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'reactivated', 'meta', '{}'::jsonb
  )::text, true);
  update public.clients set state = 'active' where id = v_client.id;
  return 'active';
end;
$$;

revoke all on function public.client_reactivate(uuid) from public, anon;
grant execute on function public.client_reactivate(uuid) to authenticated, service_role;

comment on function public.client_reactivate(uuid) is
  'clients.manage. inactive → active (WORKFLOWS §4); needs an active Admin and a name no '
  'not-inactive client uses (CONFLICT otherwise). Audit action: reactivated.';

create or replace function public.client_assign_admin(client_id uuid, admin_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_client public.clients;
  v_previous uuid;
  v_assignment uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_client_manager() r;
  select c.* into v_client from public.clients c
  where c.id = client_assign_admin.client_id and c.org_id = v_org for update;
  if v_client.id is null then
    perform app.fail('NOT_FOUND', 'This client does not exist.');
  end if;
  perform app.client_check_admin(client_assign_admin.admin_id, v_org);
  if v_client.admin_id = client_assign_admin.admin_id then
    perform app.fail('INVALID_STATE', 'This person already runs this client.');
  end if;
  v_previous := v_client.admin_id;

  update public.client_admin_assignments
  set to_at = now()
  where client_admin_assignments.client_id = v_client.id and to_at is null;
  insert into public.client_admin_assignments (client_id, admin_id, assigned_by)
  values (v_client.id, client_assign_admin.admin_id, v_caller)
  returning id into v_assignment;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'admin_assigned',
    'meta', jsonb_build_object('from_admin_id', v_previous, 'to_admin_id', client_assign_admin.admin_id)
  )::text, true);
  update public.clients set admin_id = client_assign_admin.admin_id where id = v_client.id;

  -- Notifications (WORKFLOWS §9 "Client's Admin assigned or changed", delivered by 5.1): the new
  -- Admin ("You now run <client>") and, when still active, the previous one. No notification rows
  -- exist yet; 5.1 inserts them here, in this transaction.
  return v_assignment;
end;
$$;

revoke all on function public.client_assign_admin(uuid, uuid) from public, anon;
grant execute on function public.client_assign_admin(uuid, uuid) to authenticated, service_role;

comment on function public.client_assign_admin(uuid, uuid) is
  'clients.manage, any state. Closes the open client_admin_assignments row, opens the next and '
  'moves clients.admin_id, so access moves at once (PERMISSIONS §2). Refuses the current Admin '
  '(INVALID_STATE) and anyone who is not an active Admin (VALIDATION). Returns the new assignment '
  'id. Audit action: admin_assigned (meta.from_admin_id, meta.to_admin_id). Notifies the new and '
  'the previous Admin (WORKFLOWS §9; 5.1).';

create or replace function public.client_contact_set_primary(contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.client_contacts;
  v_client public.clients;
begin
  select c.* into v_contact from public.client_contacts c where c.id = contact_id;
  if v_contact.id is null or not app.client_visible(v_contact.client_id) then
    perform app.fail('NOT_FOUND', 'This contact does not exist.');
  end if;
  v_client := app.lock_client_for_edit(v_contact.client_id);
  select c.* into v_contact from public.client_contacts c where c.id = contact_id for update;
  if v_contact.archived_at is not null then
    perform app.fail('INVALID_STATE', 'An archived contact cannot be the primary one. Restore it first.');
  end if;
  if v_contact.is_primary then
    perform app.fail('INVALID_STATE', 'This contact is already the primary one.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'primary_removed', 'meta', jsonb_build_object('to_contact_id', v_contact.id)
  )::text, true);
  update public.client_contacts set is_primary = false
  where client_id = v_contact.client_id and is_primary and archived_at is null;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'primary_set', 'meta', '{}'::jsonb
  )::text, true);
  update public.client_contacts set is_primary = true where id = v_contact.id;
end;
$$;

revoke all on function public.client_contact_set_primary(uuid) from public, anon;
grant execute on function public.client_contact_set_primary(uuid) to authenticated, service_role;

comment on function public.client_contact_set_primary(uuid) is
  'clients.edit_assigned on a visible client. Makes a live contact the primary one and demotes the '
  'current primary in the same transaction (exactly one primary, kickoff 3). Audit actions: '
  'primary_removed on the old row, primary_set on the new.';

create or replace function public.client_contact_archive(contact_id uuid, next_primary_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.client_contacts;
  v_next public.client_contacts;
  v_client public.clients;
  v_others int;
begin
  select c.* into v_contact from public.client_contacts c where c.id = contact_id;
  if v_contact.id is null or not app.client_visible(v_contact.client_id) then
    perform app.fail('NOT_FOUND', 'This contact does not exist.');
  end if;
  v_client := app.lock_client_for_edit(v_contact.client_id);
  select c.* into v_contact from public.client_contacts c where c.id = contact_id for update;
  if v_contact.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This contact is already archived.');
  end if;

  if v_contact.is_primary then
    select count(*) into v_others from public.client_contacts c
    where c.client_id = v_contact.client_id and c.id <> v_contact.id and c.archived_at is null;
    if v_others > 0 then
      -- Archiving the primary asks for the next one (PRODUCT §4.4).
      if next_primary_id is null then
        perform app.fail('VALIDATION', 'Choose the next primary contact before archiving this one.');
      end if;
      select c.* into v_next from public.client_contacts c
      where c.id = next_primary_id and c.client_id = v_contact.client_id and c.archived_at is null
      for update;
      if v_next.id is null or v_next.id = v_contact.id then
        perform app.fail('VALIDATION', 'The next primary contact must be another live contact of this client.');
      end if;
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'archived', 'meta', jsonb_build_object('next_primary_id', v_next.id)
  )::text, true);
  update public.client_contacts set archived_at = now(), is_primary = false where id = v_contact.id;
  if v_next.id is not null then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'primary_set', 'meta', '{}'::jsonb
    )::text, true);
    update public.client_contacts set is_primary = true where id = v_next.id;
  end if;
end;
$$;

revoke all on function public.client_contact_archive(uuid, uuid) from public, anon;
grant execute on function public.client_contact_archive(uuid, uuid) to authenticated, service_role;

comment on function public.client_contact_archive(uuid, uuid) is
  'clients.edit_assigned on a visible client. Archives a contact (never deleted, invariant 9). '
  'Archiving the primary while other live contacts exist needs next_primary_id, which becomes '
  'primary in the same transaction. Audit actions: archived, primary_set.';

create or replace function public.client_contact_restore(contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.client_contacts;
  v_client public.clients;
  v_has_primary boolean;
begin
  select c.* into v_contact from public.client_contacts c where c.id = contact_id;
  if v_contact.id is null or not app.client_visible(v_contact.client_id) then
    perform app.fail('NOT_FOUND', 'This contact does not exist.');
  end if;
  v_client := app.lock_client_for_edit(v_contact.client_id);
  select c.* into v_contact from public.client_contacts c where c.id = contact_id for update;
  if v_contact.archived_at is null then
    perform app.fail('INVALID_STATE', 'This contact is not archived.');
  end if;
  select exists (
    select 1 from public.client_contacts c
    where c.client_id = v_contact.client_id and c.is_primary and c.archived_at is null
  ) into v_has_primary;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'restored', 'meta', '{}'::jsonb
  )::text, true);
  -- A restored contact is primary only when the client has none (the one-primary rule).
  update public.client_contacts
  set archived_at = null, is_primary = not v_has_primary
  where id = v_contact.id;
end;
$$;

revoke all on function public.client_contact_restore(uuid) from public, anon;
grant execute on function public.client_contact_restore(uuid) to authenticated, service_role;

comment on function public.client_contact_restore(uuid) is
  'clients.edit_assigned on a visible client. archived → live; becomes primary only when the '
  'client has no primary contact. Audit action: restored.';
