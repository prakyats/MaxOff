-- 3.2 Custom fields: the field_type enum and the field_definitions table (DATA-MODEL §0 / §2,
-- PERMISSIONS §1 ¹ ², WORKFLOWS §4a; kickoff 3 decisions 6-10, 2026-09-27). Values live in each
-- record's custom_fields jsonb (clients and client_contacts since 3.1; projects, items and tasks
-- later) and are validated against these rows by core/custom-fields before every write.
-- Append-only: never edit once applied.
--
-- Who writes a definition (app.field_definition_writable): lists.manage, and then
--   * a global client / contact row (client_id null): the Owner only;
--   * a client-scoped row (client_id set; entity client or contact): the Owner or that client's
--     current Admin;
--   * a project / item row: the Owner only (no currency type exists, and this closes the "amount
--     in a number field" loophole, PERMISSIONS ¹);
--   * a task row: lists.manage (per-task-type scoping arrives with 4.1).
-- A definition's type is immutable once any record holds a value for its key; a definition is
-- archived, never deleted (values stay, hidden from forms, read-only under "Archived fields").

-- Enum (DATA-MODEL §0). Deliberately no currency type: money lives only in the Owner-only tables.
create type public.field_type as enum (
  'text', 'long_text', 'number', 'date', 'datetime', 'checkbox', 'select', 'multi_select',
  'url', 'email', 'phone', 'color', 'member', 'rating'
);

create table public.field_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default app.current_org_id() references public.organizations (id),
  entity text not null check (entity in ('client', 'contact', 'project', 'item', 'task')),
  -- A field that exists for one client only (kickoff 3: an Admin's own additions).
  client_id uuid null references public.clients (id),
  -- A field that exists for one task type only (4.1; no task_types table yet, so no FK here).
  task_type_id uuid null,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(btrim(label)) between 1 and 80),
  help_text text null check (help_text is null or length(help_text) <= 300),
  type public.field_type not null,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  required boolean not null default false,
  section text null check (section is null or length(btrim(section)) between 1 and 60),
  position text not null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_definitions_scope check (
    (client_id is null or entity in ('client', 'contact'))
    and (task_type_id is null or entity = 'task')
    and not (client_id is not null and task_type_id is not null)
  ),
  constraint field_definitions_options check (
    (type in ('select', 'multi_select') and jsonb_array_length(options) > 0)
    or (type not in ('select', 'multi_select') and options = '[]'::jsonb)
  )
);
comment on table public.field_definitions is
  'Custom field definitions per entity (ADR-0002, DATA-MODEL §2): global, or for one client '
  '(client_id) or one task type (task_type_id). type is immutable once a value exists; archived, '
  'never deleted; select values store the option key (kickoff 3).';

create unique index field_definitions_key_unique on public.field_definitions (
  org_id, entity, key,
  coalesce(client_id, '00000000-0000-0000-0000-000000000000'),
  coalesce(task_type_id, '00000000-0000-0000-0000-000000000000')
);
create index field_definitions_entity_idx on public.field_definitions (org_id, entity, position);
create index field_definitions_client_idx on public.field_definitions (client_id);

-- Who may write which definition (PERMISSIONS ¹ ²) ---------------------------------------------

create or replace function app.field_definition_writable(p_entity text, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.has_permission('lists.manage'))
    and case
      when p_client_id is not null then
        p_entity in ('client', 'contact')
        and ((select app.is_owner()) or p_client_id in (select app.admin_client_ids()))
      when p_entity in ('client', 'contact', 'project', 'item') then (select app.is_owner())
      when p_entity = 'task' then true
      else false
    end;
$$;

revoke all on function app.field_definition_writable(text, uuid) from public;
grant execute on function app.field_definition_writable(text, uuid) to authenticated, service_role;

comment on function app.field_definition_writable(text, uuid) is
  'May the caller add or change a definition of this entity and scope? lists.manage, then: a '
  'client-scoped row for the Owner or that client''s current Admin; a global client / contact '
  'row and every project / item row for the Owner; a task row for lists.manage (PERMISSIONS ¹ ²).';

-- The guard ---------------------------------------------------------------------------------------

-- Does any record hold a value for this definition's key, within its scope? Extended by the
-- tables that gain custom_fields later (projects, items, tasks).
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
    else false
  end;
$$;

revoke all on function app.field_definition_has_values(public.field_definitions) from public;
grant execute on function app.field_definition_has_values(public.field_definitions) to authenticated, service_role;

comment on function app.field_definition_has_values(public.field_definitions) is
  'True when any record in the definition''s scope holds a value under its key. clients and '
  'client_contacts now; projects, items and tasks join when they gain custom_fields.';

create or replace function app.field_definitions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  opt jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.entity <> old.entity or new.key <> old.key
       or new.client_id is distinct from old.client_id
       or new.task_type_id is distinct from old.task_type_id
       or new.org_id <> old.org_id then
      perform app.fail('FORBIDDEN', 'A field''s entity, key and scope never change. Archive it and add a new one.');
    end if;
    -- Kickoff 3 (9): the type is immutable once a value exists.
    if new.type <> old.type and app.field_definition_has_values(old) then
      perform app.fail('INVALID_STATE', 'This field already holds values, so its type cannot change. Archive it and add a new field.');
    end if;
  end if;
  if new.client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.client_id and c.org_id = new.org_id
  ) then
    perform app.fail('NOT_FOUND', 'This client does not exist.');
  end if;
  -- Options are {key, label} objects with distinct keys in the same format as a field key.
  for opt in select * from jsonb_array_elements(new.options) loop
    if jsonb_typeof(opt) <> 'object'
       or not (opt ->> 'key') ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
       or length(btrim(coalesce(opt ->> 'label', ''))) not between 1 and 80 then
      perform app.fail('VALIDATION', 'Each option needs a key and a label.');
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(new.options) o) <> (select count(distinct o ->> 'key') from jsonb_array_elements(new.options) o) then
    perform app.fail('VALIDATION', 'Option keys must be distinct.');
  end if;
  return new;
end;
$$;

revoke all on function app.field_definitions_guard() from public;
grant execute on function app.field_definitions_guard() to authenticated, service_role;

comment on function app.field_definitions_guard() is
  'BEFORE INSERT OR UPDATE on field_definitions: entity, key and scope never change; the type is '
  'immutable once a value exists (INVALID_STATE); a client scope must exist; options are '
  '{key, label} objects with distinct keys.';

create trigger set_updated_at before update on public.field_definitions
  for each row execute function app.set_updated_at();
create trigger guard before insert or update on public.field_definitions
  for each row execute function app.field_definitions_guard();
create trigger audit_row_change after insert or update or delete on public.field_definitions
  for each row execute function app.audit_row_change();

-- Grants -----------------------------------------------------------------------------------------

revoke all on public.field_definitions from anon;
revoke delete, truncate, references, trigger on public.field_definitions from authenticated;
revoke update on public.field_definitions from authenticated;
grant update (label, help_text, type, options, required, section, position, archived_at)
  on public.field_definitions to authenticated;

-- RLS --------------------------------------------------------------------------------------------

alter table public.field_definitions enable row level security;

-- Reads: a task definition for every active member (the task forms of 4.1 need them); every
-- other entity for lists.manage, within a scope the caller may see.
create policy field_definitions_select on public.field_definitions for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and (entity = 'task'
              or ((select app.has_permission('lists.manage'))
                  and (client_id is null or app.client_visible(client_id)))));
create policy field_definitions_insert on public.field_definitions for insert to authenticated
  with check (org_id = (select m.org_id from app.current_member() m)
              and app.field_definition_writable(entity, client_id));
create policy field_definitions_update on public.field_definitions for update to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and app.field_definition_writable(entity, client_id))
  with check (org_id = (select m.org_id from app.current_member() m)
              and app.field_definition_writable(entity, client_id));

-- Activity (PERMISSIONS §2): whoever may read the definition reads its entries.
create policy activity_log_select_field_definitions on public.activity_log for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and entity = 'field_definitions'
         and exists (select 1 from public.field_definitions d where d.id = entity_id));
