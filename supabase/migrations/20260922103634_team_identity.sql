-- 1.1 team identity: organizations, org_settings, members, role_permissions, session_events,
-- activity_log, the identity helpers and the generic audit + column guards.
-- Documented in DATA-MODEL §0a / §1 / §9, PERMISSIONS §1-§3 and ARCHITECTURE §4-§5.
-- Append-only: never edit once applied.

-- Enums (DATA-MODEL §0) ----------------------------------------------------------------------

create type public.member_role as enum ('ceo', 'admin', 'staff');
create type public.member_status as enum ('invited', 'active', 'deactivated');

-- Tables -------------------------------------------------------------------------------------
-- Supabase's default privileges grant every verb on a new public table to anon, authenticated
-- and service_role. Each table below takes back what its role may never do (anon: everything),
-- and RLS decides the rows. Both layers are tested.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.organizations is
  'The company. One row in the prototype (the org seam, DATA-MODEL). logo_file_id arrives with files (3.3).';

create table public.org_settings (
  org_id uuid primary key references public.organizations (id),
  weekly_off_days smallint[] not null default '{0}'
    check (weekly_off_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  logout_reminder_time time not null default '20:30',
  ack_repeat_hours integer not null default 2 check (ack_repeat_hours > 0),
  ack_escalate_hours integer not null default 4 check (ack_escalate_hours > 0),
  ack_escalate_ceo_hours integer not null default 8 check (ack_escalate_ceo_hours > 0),
  overdue_escalate_hours integer not null default 24 check (overdue_escalate_hours > 0),
  email_daily_cap_per_member integer not null default 20 check (email_daily_cap_per_member >= 0),
  default_task_reminders jsonb not null default '[]'::jsonb,
  workload_warning_threshold integer null check (workload_warning_threshold > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.org_settings is
  'Launch settings (PRODUCT §7), created with the organization by app.create_org_settings(). '
  'weekly_off_days: 0 = Sunday .. 6 = Saturday. Edited by settings.manage (1.4).';

create table public.members (
  id uuid primary key references auth.users (id),
  org_id uuid not null references public.organizations (id),
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  email text not null check (position('@' in email) > 1 and length(email) <= 254),
  phone text null check (phone is null or length(btrim(phone)) between 3 and 32),
  role public.member_role not null,
  status public.member_status not null default 'invited',
  invited_at timestamptz not null default now(),
  joined_at timestamptz null,
  deactivated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint members_deactivated_at_matches_status
    check ((status = 'deactivated') = (deactivated_at is not null)),
  constraint members_active_has_joined check (status <> 'active' or joined_at is not null)
);
comment on table public.members is
  'One row per person, id = auth.users.id. job_title_id arrives in 1.3, avatar_file_id in 3.3. '
  'status and its timestamps (and email) change only through transition functions.';
create unique index members_single_ceo on public.members (org_id) where role = 'ceo';
create unique index members_email_unique on public.members (lower(email));
create index members_org_id_idx on public.members (org_id);

create table public.role_permissions (
  role public.member_role not null,
  permission text not null check (permission ~ '^[a-z_]+\.[a-z_]+$'),
  primary key (role, permission)
);
comment on table public.role_permissions is
  'PERMISSIONS §1 as data, seeded below. Read by app.has_permission(). No writes from the API.';

create table public.session_events (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id),
  kind text not null check (kind in ('login', 'logout')),
  at timestamptz not null default now(),
  user_agent text null,
  ip_hash text null
);
comment on table public.session_events is
  'Append-only login/logout history, written by functions only (1.2, 2.1).';
create index session_events_member_at_idx on public.session_events (member_id, at desc);

create table public.activity_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id),
  actor_id uuid null references public.members (id),
  entity text not null,
  entity_id uuid not null,
  action text not null,
  diff jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
comment on table public.activity_log is
  'Append-only audit (PRODUCT §4.14). Written by app.audit_row_change() and transition functions '
  'in the same transaction as the change. actor_id null = the system or a service-role job.';
create index activity_log_entity_idx on public.activity_log (entity, entity_id, at desc);
create index activity_log_actor_idx on public.activity_log (actor_id, at desc);

-- Identity helpers (ARCHITECTURE §5) ---------------------------------------------------------
-- security definer + search_path '' so policies can read members without RLS recursion.

create or replace function app.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.org_id from public.members m where m.id = auth.uid()),
    (select o.id from public.organizations o
      where not exists (select 1 from public.organizations o2 where o2.id <> o.id))
  );
$$;

revoke all on function app.current_org_id() from public;
grant execute on function app.current_org_id() to authenticated, service_role;

comment on function app.current_org_id() is
  'The caller''s organization. Without a member row (bootstrap, service role) the single '
  'organizations row; null when there are none or several. Default of every root table''s org_id.';

create or replace function app.current_member()
returns setof public.members
language sql
stable
security definer
set search_path = ''
rows 1
as $$
  select m.* from public.members m where m.id = auth.uid() and m.status = 'active';
$$;

revoke all on function app.current_member() from public;
grant execute on function app.current_member() to authenticated, service_role;

comment on function app.current_member() is
  'The caller''s member row while status = active. Deactivated or invited means no rows, so '
  'every policy that uses it ends access immediately.';

create or replace function app.has_permission(key text)
returns boolean
language sql
stable
strict
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.role_permissions rp on rp.role = m.role
    where m.id = auth.uid() and m.status = 'active' and rp.permission = key
  );
$$;

revoke all on function app.has_permission(text) from public;
grant execute on function app.has_permission(text) to authenticated, service_role;

comment on function app.has_permission(text) is
  'True when the caller is an active member whose role holds this PERMISSIONS §1 key. '
  'Use as (select app.has_permission(''x'')) in policies so it is evaluated once per statement.';

-- Guards (ADR-0006) --------------------------------------------------------------------------

create or replace function app.in_transition()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user not in ('authenticated', 'anon');
$$;

revoke all on function app.in_transition() from public;
grant execute on function app.in_transition() to authenticated, service_role;

comment on function app.in_transition() is
  'True while the statement runs as the function owner: inside a security definer transition '
  'function, a migration, a seed or a service-role job. False for a direct API write, whatever '
  'the RLS policies allow. No flag to set, so nothing can switch it on from a client.';

create or replace function app.protect_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if app.in_transition() then
    return new;
  end if;
  foreach col in array tg_argv loop
    if old_row -> col is distinct from new_row -> col then
      perform app.fail('FORBIDDEN', format('%s changes only through a workflow action.', col));
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function app.protect_columns() from public;
grant execute on function app.protect_columns() to authenticated, service_role;

comment on function app.protect_columns() is
  'BEFORE UPDATE trigger. Arguments = the columns that may change only inside a transition '
  'function (state columns and the timestamps that move with them). Attach with: create trigger '
  'protect_columns before update on <table> for each row execute function '
  'app.protect_columns(''status'', ''deactivated_at'');';

-- Audit (ARCHITECTURE §4.2) -------------------------------------------------------------------

create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  id_column text := coalesce(tg_argv[0], 'id');
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  diff_old jsonb := '{}'::jsonb;
  diff_new jsonb := '{}'::jsonb;
  key text;
  entity_uuid uuid;
  org uuid;
begin
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
    lower(tg_op),
    jsonb_build_object('old', diff_old, 'new', diff_new),
    '{}'::jsonb
  );
  return null;
end;
$$;

revoke all on function app.audit_row_change() from public;
grant execute on function app.audit_row_change() to authenticated, service_role;

comment on function app.audit_row_change() is
  'AFTER INSERT OR UPDATE OR DELETE row trigger for plain edits. Writes activity_log with '
  'entity = the table name, action = insert|update|delete, entity_id = the row''s id (or the '
  'column named by the first trigger argument), diff = {old, new} of the changed columns only '
  '(updated_at excluded), actor_id = auth.uid() or null. A no-op update writes nothing.';

create or replace function app.create_org_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.org_settings (org_id) values (new.id);
  return null;
end;
$$;

revoke all on function app.create_org_settings() from public;
grant execute on function app.create_org_settings() to authenticated, service_role;

comment on function app.create_org_settings() is
  'AFTER INSERT on organizations: every organization has its org_settings row from the start.';

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
  -- Nobody demotes the only CEO by editing a row (invariant: exactly one CEO). A CEO handover
  -- would be a workflow action of its own; the prototype has none.
  if old.role = 'ceo' and new.role <> 'ceo' and not app.in_transition() then
    perform app.fail('FORBIDDEN', 'The CEO role cannot be changed here.');
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

revoke all on function app.members_self_edit_guard() from public;
grant execute on function app.members_self_edit_guard() to authenticated, service_role;

comment on function app.members_self_edit_guard() is
  'BEFORE UPDATE on members. Without team.manage only full_name and phone may change '
  '(PERMISSIONS §3), and the CEO row never loses its role outside a transition function.';

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
  return new;
end;
$$;

revoke all on function app.members_insert_guard() from public;
grant execute on function app.members_insert_guard() to authenticated, service_role;

comment on function app.members_insert_guard() is
  'BEFORE INSERT on members: outside a transition function a new row is invited, with no '
  'joined_at or deactivated_at.';

-- Defaults and triggers ------------------------------------------------------------------------

alter table public.members alter column org_id set default app.current_org_id();

create trigger set_updated_at before update on public.organizations
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.org_settings
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.members
  for each row execute function app.set_updated_at();

create trigger create_org_settings after insert on public.organizations
  for each row execute function app.create_org_settings();

-- Guards run before the audit so a refused change leaves no trace.
create trigger protect_columns before update on public.members
  for each row execute function app.protect_columns('status', 'invited_at', 'joined_at', 'deactivated_at', 'email');
create trigger self_edit_guard before update on public.members
  for each row execute function app.members_self_edit_guard();
create trigger insert_guard before insert on public.members
  for each row execute function app.members_insert_guard();

create trigger audit_row_change after insert or update or delete on public.organizations
  for each row execute function app.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.org_settings
  for each row execute function app.audit_row_change('org_id');
create trigger audit_row_change after insert or update or delete on public.members
  for each row execute function app.audit_row_change();

-- The directory (PERMISSIONS §2) ---------------------------------------------------------------
-- Owned by postgres, so it reads members past RLS; its WHERE is the gate. No email: that is the
-- login identity and CEO-only. job_title_id (1.3) and avatar_file_id (3.3) join when they exist.

create view public.member_directory
with (security_invoker = false, security_barrier = true)
as
  select m.id, m.org_id, m.full_name, m.phone, m.role, m.status, m.created_at
  from public.members m
  where m.org_id = (select c.org_id from app.current_member() c)
    and (m.id = auth.uid() or (select app.has_permission('team.view')));

comment on view public.member_directory is
  'Who is on the team, without email. Everyone''s row for team.view, always the caller''s own. '
  'Names of people on a member''s own tasks join in 4.1.';

-- Grants ---------------------------------------------------------------------------------------

revoke all on public.organizations, public.org_settings, public.members, public.role_permissions,
  public.session_events, public.activity_log, public.member_directory from anon;

-- The API role never truncates, adds triggers to, or references these tables. TRUNCATE ignores
-- RLS, so it must be revoked, not just left unexposed.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

revoke delete on public.organizations, public.org_settings, public.members, public.role_permissions
  from authenticated;
-- Protected columns (ADR-0006, ARCHITECTURE §4.1): no UPDATE privilege for the API role, plus the
-- guard trigger. A later column that members may edit (job_title_id in 1.3, avatar_file_id in
-- 3.3) is added to this grant by its own migration.
revoke update on public.members from authenticated;
grant update (full_name, phone, role) on public.members to authenticated;
revoke insert on public.organizations, public.org_settings, public.role_permissions from authenticated;
revoke update on public.role_permissions from authenticated;
-- Append-only (ARCHITECTURE §6): written by triggers and transition functions only.
revoke insert, update, delete on public.session_events, public.activity_log from authenticated;
revoke all on public.member_directory from authenticated;
grant select on public.member_directory to authenticated;

-- RLS ------------------------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.org_settings enable row level security;
alter table public.members enable row level security;
alter table public.role_permissions enable row level security;
alter table public.session_events enable row level security;
alter table public.activity_log enable row level security;

create policy organizations_select on public.organizations for select to authenticated
  using (id = (select c.org_id from app.current_member() c));
create policy organizations_update on public.organizations for update to authenticated
  using (id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('settings.manage')))
  with check (id = (select c.org_id from app.current_member() c));

create policy org_settings_select on public.org_settings for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c));
create policy org_settings_update on public.org_settings for update to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('settings.manage')))
  with check (org_id = (select c.org_id from app.current_member() c));

-- The base table shows a full row (with email) only to its owner and to team.manage. Everyone
-- else reads other people through member_directory.
create policy members_select_own on public.members for select to authenticated
  using (id = (select c.id from app.current_member() c));
create policy members_select_manage on public.members for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('team.manage')));
create policy members_insert_manage on public.members for insert to authenticated
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('team.manage')));
-- Permissive policies OR their WITH CHECKs, so each one restates its own condition there.
create policy members_update_own on public.members for update to authenticated
  using (id = (select c.id from app.current_member() c))
  with check (id = (select c.id from app.current_member() c)
              and org_id = (select c.org_id from app.current_member() c)
              and role = (select c.role from app.current_member() c));
create policy members_update_manage on public.members for update to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('team.manage')))
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('team.manage')));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from app.current_member()));

create policy session_events_select on public.session_events for select to authenticated
  using (member_id = (select c.id from app.current_member() c)
         or (select app.has_permission('attendance.view_all')));

-- Scope is per entity (PERMISSIONS §2), never "entries where I was the actor": a row written by
-- a function an Admin invoked may describe a CEO-only table. Each module adds a policy for the
-- entities it owns.
create policy activity_log_select on public.activity_log for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and ((select app.has_permission('activity.view_all'))
              or (entity = 'members' and entity_id = (select c.id from app.current_member() c))));

-- Seed: PERMISSIONS §1 -------------------------------------------------------------------------
-- Kept in sync with core/permissions and docs/PERMISSIONS.md by tests/permissions-drift.test.ts.

insert into public.role_permissions (role, permission) values
  ('ceo', 'team.manage'),
  ('ceo', 'team.view'),
  ('admin', 'team.view'),
  ('ceo', 'availability.view'),
  ('admin', 'availability.view'),
  ('ceo', 'settings.manage'),
  ('ceo', 'drive.manage'),
  ('ceo', 'drive.view_status'),
  ('admin', 'drive.view_status'),
  ('staff', 'drive.view_status'),
  ('ceo', 'notifications.reachability'),
  ('admin', 'notifications.reachability'),
  ('ceo', 'lists.manage'),
  ('admin', 'lists.manage'),
  ('ceo', 'templates.manage'),
  ('admin', 'templates.manage'),
  ('ceo', 'clients.manage'),
  ('ceo', 'clients.edit_assigned'),
  ('admin', 'clients.edit_assigned'),
  ('ceo', 'clients.private_notes'),
  ('ceo', 'projects.manage'),
  ('admin', 'projects.manage'),
  ('ceo', 'items.tick'),
  ('admin', 'items.tick'),
  ('ceo', 'items.approve'),
  ('ceo', 'cycles.carry_decide'),
  ('ceo', 'projects.complete'),
  ('ceo', 'tasks.create'),
  ('admin', 'tasks.create'),
  ('admin', 'tasks.approve_admin'),
  ('ceo', 'tasks.approve_final'),
  ('ceo', 'tasks.work'),
  ('admin', 'tasks.work'),
  ('staff', 'tasks.work'),
  ('admin', 'task_requests.create'),
  ('staff', 'task_requests.create'),
  ('ceo', 'task_requests.decide'),
  ('admin', 'task_requests.decide'),
  ('admin', 'attendance.self'),
  ('staff', 'attendance.self'),
  ('ceo', 'attendance.decide'),
  ('ceo', 'attendance.view_all'),
  ('ceo', 'finance.view'),
  ('ceo', 'finance.edit'),
  ('ceo', 'reports.all'),
  ('admin', 'reports.scoped'),
  ('ceo', 'months.close'),
  ('ceo', 'activity.view_all'),
  ('ceo', 'records.hard_delete');
