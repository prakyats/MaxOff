-- v1.8 V5a item 6c, the Owner-only Delete of what was never used (owner, 22 Oct 2026: "any reference
-- counts as used"; DATA-MODEL §2 "The Owner-only Delete of what was never used", PERMISSIONS,
-- WORKFLOWS §1a): the Owner deletes a task type, a job title, an expense category, a custom field
-- definition, a draft client or a contact only when nothing has ever pointed at it. Everything else
-- stays Archive-only.
--
-- Expand-only, works on the team's existing data: no column, table or policy changes. Two public
-- functions (unused_usage, unused_delete) and three internal helpers. No existing row is rewritten by
-- the migration; a row is removed only when the Owner deletes it, after the check.
--
-- A real row delete, not a soft state: the rule guarantees nothing points at the row. Its name stays
-- in history: its own creation row (diff.new), the 'deleted' row this function writes first
-- (meta.name), and audit_row_change's delete row (diff.old).

-- The row of a kind in the caller's organisation, locked when asked: its name, or a refusal.
create function app.unused_delete_target(p_kind text, p_id uuid, p_org uuid, p_lock boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if p_kind = 'task_type' then
    if p_lock then
      select t.name into v_name from public.task_types t where t.id = p_id and t.org_id = p_org for update;
    else
      select t.name into v_name from public.task_types t where t.id = p_id and t.org_id = p_org;
    end if;
  elsif p_kind in ('job_title', 'expense_category') then
    if p_lock then
      select l.name into v_name from public.list_items l
      where l.id = p_id and l.org_id = p_org and l.list_key = p_kind for update;
    else
      select l.name into v_name from public.list_items l
      where l.id = p_id and l.org_id = p_org and l.list_key = p_kind;
    end if;
  elsif p_kind = 'field' then
    if p_lock then
      select d.label into v_name from public.field_definitions d where d.id = p_id and d.org_id = p_org for update;
    else
      select d.label into v_name from public.field_definitions d where d.id = p_id and d.org_id = p_org;
    end if;
  elsif p_kind = 'client' then
    -- Only a draft: a client that was ever activated has work and history around it.
    if p_lock then
      select c.name into v_name from public.clients c
      where c.id = p_id and c.org_id = p_org and c.state = 'draft' for update;
    else
      select c.name into v_name from public.clients c
      where c.id = p_id and c.org_id = p_org and c.state = 'draft';
    end if;
  elsif p_kind = 'contact' then
    if p_lock then
      select c.name into v_name from public.client_contacts c where c.id = p_id and c.org_id = p_org for update;
    else
      select c.name into v_name from public.client_contacts c where c.id = p_id and c.org_id = p_org;
    end if;
  else
    perform app.fail('VALIDATION', 'Choose a task type, job title, expense category, field, draft client or contact.');
  end if;
  if v_name is null then
    perform app.fail('NOT_FOUND', 'It is already gone.');
  end if;
  return v_name;
end;
$$;
revoke all on function app.unused_delete_target(text, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function app.unused_delete_target(text, uuid, uuid, boolean) to service_role;
comment on function app.unused_delete_target(text, uuid, uuid, boolean) is
  'V5a 6c, internal: the name of a row of a kind (task_type, job_title, expense_category, field, client in '
  'draft, contact) in the org, locked when asked; VALIDATION on an unknown kind, NOT_FOUND otherwise.';

-- Any history, notification or alert that names the row, except the row's own creation rows (action
-- insert on one of its own tables: every row has one, written by audit_row_change, so counting it would
-- leave nothing deletable). Ids are unique, so a text match on the id is exact.
create function app.unused_history_found(p_id uuid, p_own text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.activity_log a
      where (a.entity_id = p_id
             or strpos(a.diff::text, p_id::text) > 0
             or strpos(a.meta::text, p_id::text) > 0)
        and not (a.entity_id = p_id and a.entity = any (p_own) and a.action = 'insert'))
    or exists (
      select 1 from public.notifications n
      where n.entity_id = p_id
         or strpos(n.payload::text, p_id::text) > 0
         or strpos(coalesce(n.link, ''), p_id::text) > 0)
    or exists (select 1 from public.client_work_alerts w where w.entity_id = p_id);
$$;
revoke all on function app.unused_history_found(uuid, text[]) from public, anon, authenticated;
grant execute on function app.unused_history_found(uuid, text[]) to service_role;
comment on function app.unused_history_found(uuid, text[]) is
  'V5a 6c, internal: true when an activity_log row (entity_id, diff or meta), a notification (entity_id, '
  'payload or link) or a client-work alert names the id, other than its own creation rows (action insert '
  'on one of the given tables).';

-- The owner's rule: has anything ever pointed at the row?
create function app.unused_reference_found(p_kind text, p_id uuid, p_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table regclass;
  v_own text[];
  v_ref record;
  v_found boolean;
  v_field public.field_definitions;
  v_value_tables text[];
  v_value record;
begin
  v_table := case p_kind
    when 'task_type' then 'public.task_types'::regclass
    when 'job_title' then 'public.list_items'::regclass
    when 'expense_category' then 'public.list_items'::regclass
    when 'field' then 'public.field_definitions'::regclass
    when 'client' then 'public.clients'::regclass
    when 'contact' then 'public.client_contacts'::regclass
  end;
  if v_table is null then
    perform app.fail('VALIDATION', 'Choose a task type, job title, expense category, field, draft client or contact.');
  end if;

  -- 1. Every foreign key into the table, whatever the referencing row's state (read at run time, so a
  --    table added later counts too). A client's own one-to-one parts are not references.
  for v_ref in
    select c.conrelid::regclass as source, a.attname as column_name
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = v_table and cardinality(c.conkey) = 1
      and not (p_kind = 'client'
               and c.conrelid in ('public.client_private'::regclass, 'public.client_brand'::regclass))
  loop
    execute format('select exists (select 1 from %s where %I = $1)', v_ref.source, v_ref.column_name)
      into v_found using p_id;
    if v_found then
      return true;
    end if;
  end loop;

  -- 2. History, notifications and alerts, except its own creation rows.
  v_own := case p_kind
    when 'client' then array['clients', 'client_private', 'client_brand']
    else array[(select c.relname::text from pg_catalog.pg_class c where c.oid = v_table)]
  end;
  if app.unused_history_found(p_id, v_own) then
    return true;
  end if;

  -- 3. What each kind adds.
  if p_kind = 'field' then
    -- Values live under the field's key: any value or template default on its entity's rows, and any
    -- history of those rows that held the key. Matched across the entity, not only the field's scope.
    select d.* into v_field from public.field_definitions d where d.id = p_id;
    v_value_tables := case v_field.entity
      when 'client' then array['clients']
      when 'contact' then array['client_contacts']
      when 'task' then array['tasks', 'task_templates']
      when 'project' then array['projects', 'project_templates']
      when 'item' then array['project_items']
      else array[]::text[]
    end;
    for v_value in
      select t.name as table_name,
             case when t.name in ('task_templates', 'project_templates') then 'field_defaults'
                  else 'custom_fields' end as column_name
      from unnest(v_value_tables) as t(name)
    loop
      execute format('select exists (select 1 from public.%I where org_id = $1 and %I ? $2)',
                     v_value.table_name, v_value.column_name)
        into v_found using p_org, v_field.key;
      if v_found then
        return true;
      end if;
    end loop;
    if exists (
      select 1 from public.activity_log a
      where a.entity = any (v_value_tables)
        and (a.diff -> 'old' -> 'custom_fields' ? v_field.key
             or a.diff -> 'new' -> 'custom_fields' ? v_field.key
             or a.diff -> 'old' -> 'field_defaults' ? v_field.key
             or a.diff -> 'new' -> 'field_defaults' ? v_field.key)) then
      return true;
    end if;
  elsif p_kind = 'client' then
    -- A note, the Owner's notes or anything on its brand counts; its own details do not.
    if exists (select 1 from public.clients c where c.id = p_id
                 and (nullif(btrim(coalesce(c.notes, '')), '') is not null
                      or nullif(btrim(coalesce(c.requirements, '')), '') is not null))
       or exists (select 1 from public.client_private p where p.client_id = p_id
                    and nullif(btrim(coalesce(p.owner_notes, '')), '') is not null)
       or exists (select 1 from public.client_brand b where b.client_id = p_id
                    and (b.logo_file_id is not null or b.colors <> '[]'::jsonb or b.fonts <> '[]'::jsonb
                         or nullif(btrim(coalesce(b.tone_of_voice, '')), '') is not null
                         or nullif(btrim(coalesce(b.brand_notes, '')), '') is not null)) then
      return true;
    end if;
  elsif p_kind = 'contact' then
    -- The primary while another live contact exists: the client would be left with no primary.
    if exists (select 1 from public.client_contacts c
               where c.id = p_id and c.is_primary
                 and exists (select 1 from public.client_contacts o
                             where o.client_id = c.client_id and o.id <> c.id and o.archived_at is null)) then
      return true;
    end if;
  end if;
  return false;
end;
$$;
revoke all on function app.unused_reference_found(text, uuid, uuid) from public, anon, authenticated;
grant execute on function app.unused_reference_found(text, uuid, uuid) to service_role;
comment on function app.unused_reference_found(text, uuid, uuid) is
  'V5a 6c, internal: true when anything has ever pointed at the row (owner 2026-10-22): any foreign key '
  'into its table in any state, any history, notification or alert naming it (its own creation rows '
  'aside), a field''s values or history under its key, a draft client''s notes or brand, a primary contact '
  'with other live contacts.';

create function public.unused_usage(kind text, target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := app.owner_delete_caller();
  perform app.unused_delete_target(unused_usage.kind, unused_usage.target_id, v_org, false);
  return jsonb_build_object('used',
    app.unused_reference_found(unused_usage.kind, unused_usage.target_id, v_org));
end;
$$;
revoke all on function public.unused_usage(text, uuid) from public, anon;
grant execute on function public.unused_usage(text, uuid) to authenticated, service_role;
comment on function public.unused_usage(text, uuid) is
  'V5a 6c: the Owner only. {used: boolean} for a task type, job title, expense category, field, draft '
  'client or contact: whether anything has ever pointed at it (no count, nothing about what). Reads only.';

create function public.unused_delete(kind text, target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text;
  v_table text;
  v_meta jsonb;
begin
  v_org := app.owner_delete_caller();
  v_name := app.unused_delete_target(unused_delete.kind, unused_delete.target_id, v_org, true);

  if unused_delete.kind = 'task_type' then
    -- The organisation keeps one active type (the archive rule, under the same lock).
    perform pg_advisory_xact_lock(hashtext('task_types_active'), hashtext(v_org::text));
    if exists (select 1 from public.task_types t
               where t.id = unused_delete.target_id and t.archived_at is null)
       and not exists (select 1 from public.task_types t
                       where t.org_id = v_org and t.archived_at is null and t.id <> unused_delete.target_id) then
      perform app.fail('INVALID_STATE', 'Keep at least one task type: add another first.');
    end if;
  end if;

  if app.unused_reference_found(unused_delete.kind, unused_delete.target_id, v_org) then
    if unused_delete.kind = 'client' then
      perform app.fail('INVALID_STATE', 'In use — it stays.');
    end if;
    perform app.fail('INVALID_STATE', 'In use — archive it instead.');
  end if;

  v_table := case unused_delete.kind
    when 'task_type' then 'task_types'
    when 'field' then 'field_definitions'
    when 'client' then 'clients'
    when 'contact' then 'client_contacts'
    else 'list_items' end;
  v_meta := jsonb_build_object('name', v_name, 'kind', unused_delete.kind);
  if unused_delete.kind = 'contact' then
    v_meta := v_meta || jsonb_build_object('client_id',
      (select c.client_id from public.client_contacts c where c.id = unused_delete.target_id));
  end if;

  -- The history row first ("deleted ‹name›").
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, meta)
  values (v_org, auth.uid(), v_table, unused_delete.target_id, 'deleted', v_meta);

  if unused_delete.kind = 'task_type' then
    delete from public.task_types where id = unused_delete.target_id;
  elsif unused_delete.kind = 'field' then
    delete from public.field_definitions where id = unused_delete.target_id;
  elsif unused_delete.kind = 'client' then
    delete from public.client_brand where client_id = unused_delete.target_id;
    delete from public.client_private where client_id = unused_delete.target_id;
    delete from public.clients where id = unused_delete.target_id;
  elsif unused_delete.kind = 'contact' then
    delete from public.client_contacts where id = unused_delete.target_id;
  else
    delete from public.list_items where id = unused_delete.target_id;
  end if;
end;
$$;
revoke all on function public.unused_delete(text, uuid) from public, anon;
grant execute on function public.unused_delete(text, uuid) to authenticated, service_role;
comment on function public.unused_delete(text, uuid) is
  'V5a 6c (owner 2026-10-22): the Owner only. Deletes a task type, job title, expense category, field, '
  'draft client or contact that nothing has ever pointed at (app.unused_reference_found, checked with the '
  'row locked); INVALID_STATE "In use — archive it instead." (a client: "In use — it stays.") otherwise, and '
  'for the last active task type. One activity_log row first (entity = the table, action deleted, meta '
  '{name, kind} and a contact''s client_id), then the row (a client with its empty brand and private rows).';
