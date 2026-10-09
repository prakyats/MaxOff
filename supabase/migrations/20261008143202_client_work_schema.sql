-- 7A (7.1) Client work: the schema (PRODUCT §4.5, WORKFLOWS §4 / §5, PERMISSIONS §1-§3, DATA-MODEL
--   §0 / §2 / §4 / §5; ADR-0005, ADR-0006, ADR-0007 with its 2026-10-08 amendment; kickoff 7
--   decisions 1-26 and amendments A, B, C).
--
-- 1. Enums (DATA-MODEL §0): recurrence, project_state, cycle_state, item_state, carry_decision.
--    No billing_category: it is money, phase 9's (kickoff 7 amendment C).
-- 2. Grants (PERMISSIONS §1): clients.create for the Owner and Admins (amendment B); items.approve,
--    cycles.carry_decide and projects.complete for Admins on their clients (amendment C).
-- 3. stage_presets (decision 22) with the seeded preset (data only, owner note 3) and
--    project_templates (decision 23; no billing category, amendment C3): shared lists with the
--    task-template rule (an Admin writes the rows they created, the Owner any).
-- 4. projects, project_stages, project_item_blueprints, project_cycles, project_items,
--    project_item_stages, item_reviews: written only by the client-work transition functions
--    (the next migration); SELECT for projects.manage on a visible client (the Owner every client,
--    an Admin their own); Crew never. No amount on any of them (ADR-0007).
-- 5. Custom field values on projects and items, checked in the database; the definitions' type lock
--    (app.field_definition_has_values) covers them.
-- 6. client_create(): an Admin's new client, created Active and assigned to that Admin through a
--    transition function, with the Owner's notification (amendment B).
--
-- EXPAND-ONLY (CLAUDE.md "Production is live", ARCHITECTURE §18): new enums, tables, functions,
-- policies, grants and notification kinds; app.field_definition_has_values() gains two branches.
-- Append-only: never edit once applied.

-- 1. Enums -------------------------------------------------------------------------------------------
create type public.recurrence as enum ('one_time', 'weekly', 'monthly');
create type public.project_state as enum ('open', 'in_progress', 'completed', 'cancelled');
create type public.cycle_state as enum ('open', 'settled');
create type public.item_state as enum ('open', 'done', 'approved', 'cancelled', 'carried');
create type public.carry_decision as enum ('carry_forward', 'close', 'leave_pending');

comment on type public.recurrence is
  'A project''s rhythm (WORKFLOWS §5.2): one_time = one cycle with no period; weekly = Monday to '
  'Sunday; monthly = the calendar month (IST). Fixed after creation (kickoff 7 decision 4).';
comment on type public.project_state is
  'WORKFLOWS §5.1: open -> in_progress (automatic, the first tick or Done) -> completed; any open '
  'state -> cancelled; completed / cancelled -> reopen.';
comment on type public.item_state is
  'WORKFLOWS §5.3: open -> done -> approved (final); done -> open (Not done, reject); open / done -> '
  'cancelled (reason); open -> carried (carry forward: a new item in a later cycle).';

-- 2. Grants (PERMISSIONS §1; tests/permissions-drift.test.ts reads this insert) ---------------------
insert into public.role_permissions (role, permission) values
  ('owner', 'clients.create'),
  ('admin', 'clients.create'),
  ('admin', 'items.approve'),
  ('admin', 'cycles.carry_decide'),
  ('admin', 'projects.complete');

-- 3a. stage_presets ----------------------------------------------------------------------------------
create table public.stage_presets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default app.current_org_id() references public.organizations (id),
  name text not null check (length(btrim(name)) between 1 and 80),
  stages text[] not null check (cardinality(stages) between 1 and 12),
  created_by uuid null default auth.uid() references public.members (id),
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.stage_presets is
  'Named stage lists for projects (kickoff 7 decision 22, PERMISSIONS ⁴): shared by the company; '
  'lists.manage (the Owner, Admins) reads and adds; an Admin edits and archives the presets they '
  'created, the Owner any (the seeded one has no author, so only the Owner). 1-12 stages. Copied '
  'into project_stages when chosen, so an edit never touches a project. Archived, never deleted. '
  'Nothing in code, tests or migrations depends on a preset''s or a stage''s name (owner note 3).';
create unique index stage_presets_active_name_unique
  on public.stage_presets (org_id, lower(btrim(name))) where archived_at is null;
create index stage_presets_org_idx on public.stage_presets (org_id, archived_at);
create index stage_presets_created_by_idx on public.stage_presets (created_by);

create trigger set_updated_at before update on public.stage_presets
  for each row execute function app.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.stage_presets
  for each row execute function app.audit_row_change();

-- Not security definer, so a migration or a function (the owner) passes app.in_transition(), as the
-- task-template guard (4A mechanics 3).
create function app.stage_presets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stage text;
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by or new.org_id is distinct from old.org_id then
      perform app.fail('FORBIDDEN', 'A preset keeps its author.');
    end if;
  elsif not app.in_transition() and new.created_by is distinct from auth.uid() then
    perform app.fail('FORBIDDEN', 'A preset is written by the person creating it.');
  end if;
  new.stages := array(select btrim(s) from unnest(new.stages) s);
  foreach v_stage in array new.stages loop
    if v_stage is null or length(v_stage) not between 1 and 120 then
      perform app.fail('VALIDATION', 'Each stage needs a name of up to 120 characters.');
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function app.stage_presets_guard() from public;
grant execute on function app.stage_presets_guard() to authenticated, service_role;

comment on function app.stage_presets_guard() is
  'BEFORE INSERT OR UPDATE on stage_presets (kickoff 7 decision 22): the author is the caller and '
  'never changes; the name and each stage are trimmed, each stage 1..120 characters.';

create trigger stage_presets_guard before insert or update on public.stage_presets
  for each row execute function app.stage_presets_guard();

alter table public.stage_presets enable row level security;
create policy stage_presets_select on public.stage_presets for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('lists.manage')));
create policy stage_presets_insert on public.stage_presets for insert to authenticated
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('lists.manage'))
              and created_by = (select c.id from app.current_member() c));
create policy stage_presets_update on public.stage_presets for update to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('lists.manage'))
         and ((select app.is_owner()) or created_by = (select c.id from app.current_member() c)))
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('lists.manage'))
              and ((select app.is_owner()) or created_by = (select c.id from app.current_member() c)));

revoke all on public.stage_presets from anon;
revoke all on public.stage_presets from authenticated;
grant select on public.stage_presets to authenticated;
grant insert (name, stages) on public.stage_presets to authenticated;
grant update (name, stages, archived_at) on public.stage_presets to authenticated;

-- The seeded preset (decision 22, owner note 3): one row per organisation, data only.
create function app.seed_org_stage_presets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stage_presets (org_id, name, stages, created_by)
  values (new.id, 'Video', array['Script', 'Shoot', 'Edit', 'Posted'], null);
  return null;
end;
$$;

revoke all on function app.seed_org_stage_presets() from public;
grant execute on function app.seed_org_stage_presets() to authenticated, service_role;

comment on function app.seed_org_stage_presets() is
  'AFTER INSERT on organizations: the launch stage preset (kickoff 7 decision 22). A row, not code: '
  'the Owner renames, edits or archives it in Settings, and nothing depends on its names.';

create trigger seed_org_stage_presets after insert on public.organizations
  for each row execute function app.seed_org_stage_presets();

insert into public.stage_presets (org_id, name, stages, created_by)
select o.id, 'Video', array['Script', 'Shoot', 'Edit', 'Posted'], null
from public.organizations o
where not exists (select 1 from public.stage_presets sp where sp.org_id = o.id);

-- 4. Client work tables ------------------------------------------------------------------------------
-- 3b. project_templates (needs recurrence; projects.template_id points at it).
create table public.project_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default app.current_org_id() references public.organizations (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text null check (description is null or length(description) <= 5000),
  recurrence public.recurrence not null,
  stages text[] not null default '{}' check (cardinality(stages) <= 12),
  items text[] not null default '{}' check (cardinality(items) <= 100),
  field_defaults jsonb not null default '{}'::jsonb check (jsonb_typeof(field_defaults) = 'object'),
  created_by uuid not null default auth.uid() references public.members (id),
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.project_templates is
  'Project templates (kickoff 7 decision 23, PERMISSIONS ⁴): a recurrence, stages (from a preset or '
  'typed, at most 12), an item list (at most 100) and project custom field defaults; never a client, '
  'an amount or a billing category (amendment C3). Shared (templates.manage reads and uses every '
  'active one); an Admin edits and archives their own, the Owner any. Archived, never deleted. '
  'Audited. Screens: 7.4.';
create unique index project_templates_active_name_unique
  on public.project_templates (org_id, lower(btrim(name))) where archived_at is null;
create index project_templates_org_idx on public.project_templates (org_id, archived_at);
create index project_templates_created_by_idx on public.project_templates (created_by);

create trigger set_updated_at before update on public.project_templates
  for each row execute function app.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.project_templates
  for each row execute function app.audit_row_change();

create function app.project_templates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_text text;
  v_old jsonb := case when tg_op = 'UPDATE' then old.field_defaults else '{}'::jsonb end;
  v_key text;
  v_value jsonb;
  v_def public.field_definitions;
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by or new.org_id is distinct from old.org_id then
      perform app.fail('FORBIDDEN', 'A template keeps its author.');
    end if;
  elsif not app.in_transition() and new.created_by is distinct from auth.uid() then
    perform app.fail('FORBIDDEN', 'A template is written by the person creating it.');
  end if;
  new.stages := array(select btrim(s) from unnest(new.stages) s);
  foreach v_text in array new.stages loop
    if v_text is null or length(v_text) not between 1 and 120 then
      perform app.fail('VALIDATION', 'Each stage needs a name of up to 120 characters.');
    end if;
  end loop;
  new.items := array(select btrim(s) from unnest(new.items) s);
  foreach v_text in array new.items loop
    if v_text is null or length(v_text) not between 1 and 200 then
      perform app.fail('VALIDATION', 'Each item needs a title of up to 200 characters.');
    end if;
  end loop;
  -- The field defaults: a project's custom field values, checked as a project's are; keys the
  -- write leaves as they were pass (an archived field keeps its default). A required field may
  -- stay empty (the create dialog asks for it).
  if octet_length(new.field_defaults::text) > 32768 then
    perform app.fail('VALIDATION', 'These field defaults are too long.');
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(new.field_defaults) e loop
    continue when v_old -> v_key is not distinct from v_value;
    select d.* into v_def from public.field_definitions d
    where d.entity = 'project' and d.key = v_key and d.archived_at is null and d.org_id = new.org_id
    limit 1;
    if v_def.id is null then
      perform app.fail('VALIDATION', format('There is no field "%s" here.', v_key));
    end if;
    if not app.custom_field_value_ok(v_def.type, v_def.options, v_value) then
      perform app.fail('VALIDATION', format('%s: this is not a valid value.', v_def.label));
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function app.project_templates_guard() from public;
grant execute on function app.project_templates_guard() to authenticated, service_role;

comment on function app.project_templates_guard() is
  'BEFORE INSERT OR UPDATE on project_templates (kickoff 7 decision 23): the author is the caller and '
  'never changes; stages 1..120 characters each, items 1..200; field_defaults at most 32 KB, every '
  'key the write adds or changes an active project field holding a value of its type.';

create trigger project_templates_guard before insert or update on public.project_templates
  for each row execute function app.project_templates_guard();

alter table public.project_templates enable row level security;
create policy project_templates_select on public.project_templates for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('templates.manage')));
create policy project_templates_insert on public.project_templates for insert to authenticated
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('templates.manage'))
              and created_by = (select c.id from app.current_member() c));
create policy project_templates_update on public.project_templates for update to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('templates.manage'))
         and ((select app.is_owner()) or created_by = (select c.id from app.current_member() c)))
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('templates.manage'))
              and ((select app.is_owner()) or created_by = (select c.id from app.current_member() c)));

revoke all on public.project_templates from anon;
revoke all on public.project_templates from authenticated;
grant select on public.project_templates to authenticated;
grant insert (name, description, recurrence, stages, items, field_defaults)
  on public.project_templates to authenticated;
grant update (name, description, recurrence, stages, items, field_defaults, archived_at)
  on public.project_templates to authenticated;

-- projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  client_id uuid not null references public.clients (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text null check (description is null or length(description) <= 5000),
  recurrence public.recurrence not null,
  delivery_date date null,
  state public.project_state not null default 'open',
  template_id uuid null references public.project_templates (id),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_by uuid not null references public.members (id),
  completed_at timestamptz null,
  completed_by uuid null references public.members (id),
  cancelled_at timestamptz null,
  cancelled_by uuid null references public.members (id),
  cancelled_reason text null check (cancelled_reason is null or length(cancelled_reason) <= 1000),
  archived_at timestamptz null,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Amendment A: a one-time project has a delivery date; a weekly or monthly one needs none.
  constraint projects_one_time_delivery_date check (recurrence <> 'one_time' or delivery_date is not null),
  constraint projects_completed_matches_state check (
    (state = 'completed') = (completed_at is not null and completed_by is not null)),
  constraint projects_cancelled_matches_state check (
    (state = 'cancelled') = (cancelled_at is not null and cancelled_by is not null and cancelled_reason is not null))
);
comment on table public.projects is
  'A client''s project (PRODUCT §4.5, WORKFLOWS §5): every write is a project_* transition function '
  '(no API write at all). client_id and recurrence never change after creation (kickoff 7 decision '
  '4, app.projects_fixed_columns). No amount and no billing category (ADR-0007 amendment '
  '2026-10-08). RLS: projects.manage on a visible client (the Owner every client, the client''s '
  'Admin their own); Crew never. Audited.';
comment on column public.projects.delivery_date is
  'Kickoff 7 amendment A: the IST date a one-time project is due (required for one-time, none for '
  'weekly or monthly). Set or moved by projects.manage while open or in progress; audited. An '
  'operational deadline; phase 9 reads it (Owner-only) to place a one-time project''s revenue.';
-- Decision 5: the name is unique per client, case-insensitively, among open and in-progress projects.
create unique index projects_client_name_unique on public.projects (client_id, lower(btrim(name)))
  where state in ('open', 'in_progress');
create index projects_org_state_idx on public.projects (org_id, state);
create index projects_client_idx on public.projects (client_id, state);
create index projects_template_idx on public.projects (template_id);
create index projects_created_by_idx on public.projects (created_by);
create index projects_completed_by_idx on public.projects (completed_by);
create index projects_cancelled_by_idx on public.projects (cancelled_by);
create index projects_search_idx on public.projects using gin (search);

create table public.project_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  position text not null check (position ~ '^[0-9a-z]{1,64}$'),
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.project_stages is
  'A project''s stages, the same for all its items (WORKFLOWS §5.4 item 8): copied from a preset or '
  'typed (at most 12 active), added, renamed and reordered freely; a removed stage is archived '
  '(hidden from items, its ticks kept). Written by the project_stage_* functions. Audited '
  '(entity_id = the project).';
create index project_stages_project_idx on public.project_stages (project_id, position);

create table public.project_item_blueprints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  title text not null check (length(btrim(title)) between 1 and 200),
  position text not null check (position ~ '^[0-9a-z]{1,64}$'),
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.project_item_blueprints is
  'A recurring project''s item list (WORKFLOWS §5.4 item 9): copied into each new cycle; editing '
  'it never touches an existing cycle. At most 100 active. A removed entry is archived. Written by '
  'the project_blueprint_* functions. Audited (entity_id = the project).';
create index project_item_blueprints_project_idx on public.project_item_blueprints (project_id, position);

create table public.project_cycles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  period_start date null,
  period_end date null,
  label text null check (label is null or length(label) between 1 and 60),
  state public.cycle_state not null default 'open',
  generated_by text not null check (generated_by in ('schedule', 'manual', 'create', 'carry')),
  created_by uuid null references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_cycles_period_pair check (
    (period_start is null) = (period_end is null) and (period_start is null) = (label is null)),
  constraint project_cycles_period_order check (period_end is null or period_end >= period_start),
  constraint project_cycles_project_period_key unique (project_id, period_start)
);
comment on table public.project_cycles is
  'One period of a project (WORKFLOWS §5.2): a one-time project has exactly one cycle with no '
  'period; a recurring one, one per period (a week Monday to Sunday, or a calendar month, IST), '
  'its items copied from the item list at creation. open until a later cycle exists and no item in '
  'it is open or done, then settled (app.cycle_refresh). generated_by: create (project_create), '
  'schedule (the nightly cycle_generate), manual (cycle_start_next), carry (cycle_carry_decide). '
  'Audited (entity_id = the project).';
-- One cycle per one-time project (the period is null there; the unique key above ignores nulls).
create unique index project_cycles_one_time on public.project_cycles (project_id) where period_start is null;
create index project_cycles_org_period_idx on public.project_cycles (org_id, period_end);
create index project_cycles_created_by_idx on public.project_cycles (created_by);

create table public.project_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  cycle_id uuid not null references public.project_cycles (id),
  title text not null check (length(btrim(title)) between 1 and 200),
  position text not null check (position ~ '^[0-9a-z]{1,64}$'),
  planned_date date null,
  notes text null check (notes is null or length(notes) <= 5000),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  state public.item_state not null default 'open',
  done_at timestamptz null,
  done_by uuid null references public.members (id),
  approved_at timestamptz null,
  approved_by uuid null references public.members (id),
  cancelled_reason text null check (cancelled_reason is null or length(cancelled_reason) <= 1000),
  cancelled_by uuid null references public.members (id),
  cancelled_at timestamptz null,
  carry_decision public.carry_decision null,
  carry_decided_by uuid null references public.members (id),
  carry_decided_at timestamptz null,
  carried_from_item_id uuid null references public.project_items (id),
  origin_cycle_id uuid not null references public.project_cycles (id),
  created_by uuid null references public.members (id),
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(notes, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_items_done_pair check ((done_at is null) = (done_by is null)),
  constraint project_items_done_matches_state check (
    (state <> 'done' or done_at is not null) and (state <> 'open' or done_at is null)),
  constraint project_items_approved_matches_state check (
    (state = 'approved') = (approved_at is not null and approved_by is not null)
    and (state <> 'approved' or done_at is not null)),
  constraint project_items_cancelled_matches_state check (
    (state = 'cancelled') = (cancelled_at is not null and cancelled_by is not null and cancelled_reason is not null)),
  constraint project_items_carried_matches_state check (
    (state = 'carried') = (carry_decision is not null and carry_decision = 'carry_forward')),
  constraint project_items_carry_decided check (
    (carry_decision is null) = (carry_decided_by is null and carry_decided_at is null))
);
comment on table public.project_items is
  'One item of a cycle (WORKFLOWS §5.3 / §5.4): at most 100 live (not cancelled, not carried) per '
  'cycle; planned_date optional, any date (overdue = before today IST and open). origin_cycle_id is '
  'the cycle the work belongs to (its own, or the first cycle of a carried chain); '
  'carried_from_item_id the item it was carried from. Every write is a transition function. No '
  'amount, ever (ADR-0007: values live in phase 9''s item_billing). Audited.';
create index project_items_cycle_state_idx on public.project_items (cycle_id, state);
create index project_items_project_state_idx on public.project_items (project_id, state);
create index project_items_org_planned_idx on public.project_items (org_id, planned_date) where state = 'open';
create index project_items_origin_cycle_idx on public.project_items (origin_cycle_id);
create index project_items_carried_from_idx on public.project_items (carried_from_item_id);
create index project_items_done_by_idx on public.project_items (done_by);
create index project_items_approved_by_idx on public.project_items (approved_by);
create index project_items_cancelled_by_idx on public.project_items (cancelled_by);
create index project_items_carry_decided_by_idx on public.project_items (carry_decided_by);
create index project_items_created_by_idx on public.project_items (created_by);
create index project_items_search_idx on public.project_items using gin (search);

create table public.project_item_stages (
  item_id uuid not null references public.project_items (id),
  stage_id uuid not null references public.project_stages (id),
  org_id uuid not null references public.organizations (id),
  done_at timestamptz null,
  done_by uuid null references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (item_id, stage_id),
  constraint project_item_stages_done_pair check ((done_at is null) = (done_by is null))
);
comment on table public.project_item_stages is
  'An item''s stage ticks (WORKFLOWS §5.3): a row is created by the first tick; an untick clears '
  'done_at / done_by (the history keeps both). Independent of the item''s state. Written by '
  'item_tick_stage (and copied by a carry forward). Audited (entity_id = the item).';
create index project_item_stages_stage_idx on public.project_item_stages (stage_id);
create index project_item_stages_done_by_idx on public.project_item_stages (done_by);

create table public.item_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  item_id uuid not null references public.project_items (id),
  decision public.review_decision not null,
  reason text null check (reason is null or length(reason) <= 1000),
  reviewer_id uuid not null references public.members (id),
  at timestamptz not null default now(),
  constraint item_reviews_reason_on_reject check (decision <> 'rejected' or reason is not null)
);
comment on table public.item_reviews is
  'Every approve or reject of an item (WORKFLOWS §5.3): written by item_approve / item_reject only; '
  'append-only. An approval by the Owner or the client''s Admin counts alike (amendment C).';
create index item_reviews_item_idx on public.item_reviews (item_id, at);
create index item_reviews_reviewer_idx on public.item_reviews (reviewer_id);

-- Triggers: updated_at, the protected columns, the fixed columns, the audit.
create trigger set_updated_at before update on public.projects
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.project_stages
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.project_item_blueprints
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.project_cycles
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.project_items
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.project_item_stages
  for each row execute function app.set_updated_at();

create trigger protect_columns before update on public.projects
  for each row execute function app.protect_columns(
    'org_id', 'state', 'created_by', 'completed_at', 'completed_by', 'cancelled_at', 'cancelled_by',
    'cancelled_reason', 'archived_at');
create trigger protect_columns before update on public.project_cycles
  for each row execute function app.protect_columns(
    'org_id', 'project_id', 'period_start', 'period_end', 'state', 'generated_by');
create trigger protect_columns before update on public.project_items
  for each row execute function app.protect_columns(
    'org_id', 'project_id', 'cycle_id', 'state', 'done_at', 'done_by', 'approved_at', 'approved_by',
    'cancelled_reason', 'cancelled_by', 'cancelled_at', 'carry_decision', 'carry_decided_by',
    'carry_decided_at', 'carried_from_item_id', 'origin_cycle_id');

-- Kickoff 7 decision 4 (ARCHITECTURE §4.1): a project's client and recurrence never change, not even
-- inside a function: no phase 7 function changes them, and this guard keeps it so.
create function app.projects_fixed_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_id is distinct from old.client_id or new.recurrence is distinct from old.recurrence
     or new.org_id is distinct from old.org_id then
    perform app.fail('FORBIDDEN', 'A project''s client and recurrence never change. Complete or cancel it and create a new one.');
  end if;
  return new;
end;
$$;

revoke all on function app.projects_fixed_columns() from public;
grant execute on function app.projects_fixed_columns() to authenticated, service_role;

comment on function app.projects_fixed_columns() is
  'BEFORE UPDATE on projects (kickoff 7 decision 4): client_id, recurrence and org_id never change, '
  'for any caller (a function included).';

create trigger fixed_columns before update on public.projects
  for each row execute function app.projects_fixed_columns();

create trigger audit_row_change after insert or update or delete on public.projects
  for each row execute function app.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.project_stages
  for each row execute function app.audit_row_change('project_id');
create trigger audit_row_change after insert or update or delete on public.project_item_blueprints
  for each row execute function app.audit_row_change('project_id');
create trigger audit_row_change after insert or update or delete on public.project_cycles
  for each row execute function app.audit_row_change('project_id');
create trigger audit_row_change after insert or update or delete on public.project_items
  for each row execute function app.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.project_item_stages
  for each row execute function app.audit_row_change('item_id');
create trigger audit_row_change after insert or update or delete on public.item_reviews
  for each row execute function app.audit_row_change('item_id');

-- Visibility (PERMISSIONS §2 "Projects / cycles / items": the Owner all, an Admin the projects of
-- their clients, Crew never) ---------------------------------------------------------------------------
create function app.project_visible(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and p.org_id = (select m.org_id from app.current_member() m)
      and (select app.has_permission('projects.manage'))
      and app.client_visible(p.client_id)
  );
$$;

revoke all on function app.project_visible(uuid) from public;
grant execute on function app.project_visible(uuid) to authenticated, service_role;

comment on function app.project_visible(uuid) is
  'May the caller see this project and everything in it (PERMISSIONS §2)? projects.manage on a '
  'client the caller may see (app.client_visible: the Owner every client, the current Admin their '
  'own, live). Crew hold no projects.manage. The gate of every client-work table.';

alter table public.projects enable row level security;
alter table public.project_stages enable row level security;
alter table public.project_item_blueprints enable row level security;
alter table public.project_cycles enable row level security;
alter table public.project_items enable row level security;
alter table public.project_item_stages enable row level security;
alter table public.item_reviews enable row level security;

create policy projects_select on public.projects for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and (select app.has_permission('projects.manage'))
         and app.client_visible(client_id));
create policy project_stages_select on public.project_stages for select to authenticated
  using (app.project_visible(project_id));
create policy project_item_blueprints_select on public.project_item_blueprints for select to authenticated
  using (app.project_visible(project_id));
create policy project_cycles_select on public.project_cycles for select to authenticated
  using (app.project_visible(project_id));
create policy project_items_select on public.project_items for select to authenticated
  using (app.project_visible(project_id));
create policy project_item_stages_select on public.project_item_stages for select to authenticated
  using (exists (select 1 from public.project_items i where i.id = item_id));
create policy item_reviews_select on public.item_reviews for select to authenticated
  using (exists (select 1 from public.project_items i where i.id = item_id));

-- Function-only tables: SELECT under RLS, not one API write (ADR-0006; invariant 9: no DELETE).
revoke all on public.projects, public.project_stages, public.project_item_blueprints,
  public.project_cycles, public.project_items, public.project_item_stages, public.item_reviews from anon;
revoke all on public.projects, public.project_stages, public.project_item_blueprints,
  public.project_cycles, public.project_items, public.project_item_stages, public.item_reviews from authenticated;
grant select on public.projects, public.project_stages, public.project_item_blueprints,
  public.project_cycles, public.project_items, public.project_item_stages, public.item_reviews to authenticated;

-- The entries about client work the caller can see (PERMISSIONS §2 "Activity log"). entity_id is
-- the project for projects, stages, the item list and cycles; the item for items, ticks and reviews.
create policy activity_log_select_client_work on public.activity_log for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and ((entity in ('projects', 'project_stages', 'project_item_blueprints', 'project_cycles')
               and app.project_visible(entity_id))
              or (entity in ('project_items', 'project_item_stages', 'item_reviews')
                  and exists (select 1 from public.project_items i where i.id = entity_id))));

comment on policy activity_log_select_client_work on public.activity_log is
  '7.1: the history of a project and its items, for whoever sees the project (projects.manage on a '
  'visible client). Crew never.';

-- 5. Custom field values -------------------------------------------------------------------------------
-- One custom-field write against the organization's active definitions of an entity with no scope
-- (project and item fields are company-wide; a client's own new record has no client-scoped field
-- yet). Raises VALIDATION; unchanged keys pass, so an archived field keeps its value. security
-- definer, so a transition function's write is checked too (they are the only writers).
create function app.custom_fields_check(p_entity text, p_org uuid, p_new jsonb, p_old jsonb default '{}'::jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_def public.field_definitions;
begin
  if p_new is null or jsonb_typeof(p_new) <> 'object' then
    perform app.fail('VALIDATION', 'Custom fields are a set of named values.');
  end if;
  if octet_length(p_new::text) > 32768 then
    perform app.fail('VALIDATION', 'These custom fields are too long.');
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(p_new) e loop
    continue when coalesce(p_old, '{}'::jsonb) -> v_key is not distinct from v_value;
    select d.* into v_def from public.field_definitions d
    where d.entity = p_entity and d.key = v_key and d.archived_at is null and d.org_id = p_org
      and d.client_id is null and d.task_type_id is null
    limit 1;
    if v_def.id is null then
      perform app.fail('VALIDATION', format('There is no field "%s" here.', v_key));
    end if;
    if not app.custom_field_value_ok(v_def.type, v_def.options, v_value) then
      perform app.fail('VALIDATION', format('%s: this is not a valid value.', v_def.label));
    end if;
  end loop;
end;
$$;

revoke all on function app.custom_fields_check(text, uuid, jsonb, jsonb) from public, authenticated;
grant execute on function app.custom_fields_check(text, uuid, jsonb, jsonb) to service_role;

comment on function app.custom_fields_check(text, uuid, jsonb, jsonb) is
  'Internal (7.1): custom field values of an unscoped entity (project, item, a new client) against '
  'the organization''s active definitions: at most 32 KB; every key that differs from p_old names an '
  'active definition and holds a value of its type (app.custom_field_value_ok). VALIDATION otherwise.';

create function app.client_work_custom_fields_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text := tg_argv[0];
begin
  perform app.custom_fields_check(v_entity, new.org_id, new.custom_fields,
    case when tg_op = 'UPDATE' then old.custom_fields else '{}'::jsonb end);
  return new;
end;
$$;

revoke all on function app.client_work_custom_fields_guard() from public;
grant execute on function app.client_work_custom_fields_guard() to authenticated, service_role;

comment on function app.client_work_custom_fields_guard() is
  'BEFORE INSERT OR UPDATE OF custom_fields on projects (''project'') and project_items (''item''): '
  'app.custom_fields_check on every write, the functions'' too.';

create trigger custom_fields_guard before insert or update of custom_fields on public.projects
  for each row execute function app.client_work_custom_fields_guard('project');
create trigger custom_fields_guard before insert or update of custom_fields on public.project_items
  for each row execute function app.client_work_custom_fields_guard('item');

-- A definition's type is immutable once a record holds a value for it (3.2 guard; projects and
-- items join, DATA-MODEL §2).
create or replace function app.field_definition_has_values(def public.field_definitions)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case def.entity
    when 'client' then exists (
      select 1 from public.clients c
      where c.org_id = def.org_id and c.custom_fields ? def.key
        and (def.client_id is null or c.id = def.client_id))
    when 'contact' then exists (
      select 1 from public.client_contacts cc
      where cc.org_id = def.org_id and cc.custom_fields ? def.key
        and (def.client_id is null or cc.client_id = def.client_id))
    when 'task' then exists (
      select 1 from public.tasks t
      where t.org_id = def.org_id and t.custom_fields ? def.key
        and (def.task_type_id is null or t.task_type_id = def.task_type_id))
    when 'project' then exists (
      select 1 from public.projects p
      where p.org_id = def.org_id and p.custom_fields ? def.key)
      or exists (
      select 1 from public.project_templates pt
      where pt.org_id = def.org_id and pt.field_defaults ? def.key)
    when 'item' then exists (
      select 1 from public.project_items i
      where i.org_id = def.org_id and i.custom_fields ? def.key)
    else false
  end;
$$;

comment on function app.field_definition_has_values(public.field_definitions) is
  'True when any record in the definition''s scope holds a value under its key: clients, '
  'client_contacts, tasks (4A), projects and project templates'' defaults, project items (7.1).';

-- 6. client_create (kickoff 7 amendment B) --------------------------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('client_created', false, false, true, 'An Admin added a client, created Active (kickoff 7 amendment B)');

create function public.client_create(details jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_row public.clients;
  v_key text;
  v_id uuid;
  v_name text;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('clients.create') then
    perform app.fail('FORBIDDEN', 'You cannot add clients.');
  end if;
  -- The Owner's new client is a draft, added as before (the plain insert under clients.manage).
  if app.has_permission('clients.manage') then
    perform app.fail('FORBIDDEN', 'The Owner adds a client as a draft.');
  end if;
  if details is null or jsonb_typeof(details) <> 'object' then
    perform app.fail('VALIDATION', 'Give the client a name.');
  end if;
  for v_key in select jsonb_object_keys(details) loop
    if v_key not in ('name', 'legal_name', 'gstin', 'address', 'city', 'phone', 'email', 'website',
                     'drive_url', 'requirements', 'notes', 'custom_fields') then
      perform app.fail('VALIDATION', format('"%s" is not a client detail.', v_key));
    end if;
  end loop;
  v_row := jsonb_populate_record(null::public.clients, details);
  v_name := btrim(coalesce(v_row.name, ''));
  if v_name = '' then
    perform app.fail('VALIDATION', 'Give the client a name.');
  end if;
  perform app.custom_fields_check('client', v_caller.org_id, coalesce(v_row.custom_fields, '{}'::jsonb));

  -- Amendment B: created Active, the Admin always the caller (the insert guard checks they are an
  -- active Admin; the after-insert trigger opens the assignment row), the Owner told. The audit
  -- entry is the plain insert (its diff carries state active and the Admin).
  begin
    insert into public.clients (
      org_id, name, legal_name, gstin, address, city, phone, email, website, drive_url, requirements,
      notes, custom_fields, state, admin_id, activated_at, created_by)
    values (
      v_caller.org_id, v_name, v_row.legal_name, v_row.gstin, v_row.address, v_row.city, v_row.phone,
      v_row.email, v_row.website, v_row.drive_url, v_row.requirements, v_row.notes,
      coalesce(v_row.custom_fields, '{}'::jsonb), 'active', v_caller.id, now(), v_caller.id)
    returning id into v_id;
  exception
    when unique_violation then
      perform app.fail('CONFLICT', 'Another client already has this name.');
    when check_violation then
      perform app.fail('VALIDATION', 'Check the client''s details: a GSTIN, an email, a phone or a link is not in its format.');
  end;

  -- WORKFLOWS §9 (amendment B): the Owner, "‹Admin› added the client ‹name›" (info, never email),
  -- opening the client. The creating Admin is the actor and gets nothing.
  perform app.notify(array[app.org_owner_id(v_caller.org_id)], 'client_created',
    format('%s added the client %s', v_caller.full_name, v_name), null,
    '/clients/' || v_id, 'clients', v_id, jsonb_build_object('client_id', v_id), v_caller.id);
  return v_id;
end;
$$;

revoke all on function public.client_create(jsonb) from public, anon;
grant execute on function public.client_create(jsonb) to authenticated, service_role;

comment on function public.client_create(jsonb) is
  'Kickoff 7 amendment B (WORKFLOWS §4, PERMISSIONS §3 "Creating a client"): clients.create without '
  'clients.manage, i.e. an Admin. Creates the client Active with admin_id = the caller (no other '
  'Admin can be named), activated_at, the first client_admin_assignments row (trigger), the audit '
  'entry (insert) and the Owner''s client_created notification, in one '
  'transaction. details: name (required), legal_name, gstin, address, city, phone, email, website, '
  'drive_url, requirements, notes, custom_fields (company-wide client fields). CONFLICT when the '
  'name is taken among clients not Inactive. The Owner adds a draft by the plain insert instead.';
