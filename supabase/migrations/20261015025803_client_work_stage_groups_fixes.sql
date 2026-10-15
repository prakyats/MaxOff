-- Phase 6b Release 1, the review's fixes to `client_work_stage_groups` (2026-10-15, the scoped
-- architecture + security review of the Release 1 diff). EXPAND-ONLY: functions re-created with the
-- same signatures, one grant narrowed; no column, row or constraint touched. Append-only: the first
-- migration had reached staging (the preview workflow applies phase-* migrations), so it is not
-- edited.
--
-- M1  item_add gave a new deliverable the project's defaults as one flat list: the groups were lost,
--     and two groups sharing a stage name made "Add deliverable" fail outright. It now copies the
--     defaults in their groups (app.project_default_stage_groups / app.item_stage_list_init_groups).
-- S2  Rollback safety: after a Worker rollback to v1.6 the old template dialog writes only `stages` /
--     `items`; the guard then overwrote them from the stored groups, so the save changed nothing. An
--     old-shape write (stages changed, stage_groups not; items changed, deliverables not) now wins and
--     clears the stored shape, which is re-created the next time the new builder saves.
-- S3  The history names the stage on the project's default stages too: project_stage_update, the
--     group rename / move and the group archive carry stage_id and name in meta, as the item side does.
-- L1  app.stage_group_key_before gives a key between nothing and the first named group (the same
--     arithmetic as domain/positions.ts positionBetween), so naming the untitled group never runs out
--     of keys.
-- L2  app.stage_groups_of is read by functions only: service_role, not the API role.

-- M1 --------------------------------------------------------------------------------------------------------
create or replace function public.item_add(
  cycle_id uuid,
  title text,
  planned_date date default null,
  notes text default null,
  custom_fields jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_cycle public.project_cycles;
  v_project public.projects;
  v_client public.clients;
  v_last text;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot add deliverables.');
  select c.* into v_cycle from public.project_cycles c
  where c.id = item_add.cycle_id and c.org_id = v_caller.org_id;
  if v_cycle.id is null then
    perform app.fail('NOT_FOUND', 'This cycle is not one of yours.');
  end if;
  v_project := app.project_lock(v_cycle.project_id);
  perform app.project_check_writable(v_project);
  v_client := app.project_client(v_project);
  if v_client.state = 'inactive' then
    perform app.fail('INVALID_STATE', format('%s is closed, so it takes no new deliverables.', v_client.name));
  end if;
  -- Decision 9: never into a past cycle (a one-time project's single cycle always takes them).
  if v_cycle.period_end is not null and v_cycle.period_end < app.today_ist() then
    perform app.fail('INVALID_STATE', format('%s has ended: add the deliverable to the current cycle.', v_cycle.label));
  end if;
  if app.cycle_live_items(v_cycle.id) >= 100 then
    perform app.fail('VALIDATION', 'A cycle holds at most 100 deliverables.');
  end if;
  select max(i.position collate "C") into v_last from public.project_items i where i.cycle_id = v_cycle.id;
  insert into public.project_items (
    org_id, project_id, cycle_id, title, position, planned_date, notes, custom_fields, origin_cycle_id, created_by)
  values (
    v_project.org_id, v_project.id, v_cycle.id,
    app.client_work_text(item_add.title, 200, 'Give the deliverable a title of up to 200 characters.'),
    app.client_work_next_position(v_last), item_add.planned_date,
    app.client_work_text(item_add.notes, 5000, 'Keep the notes under 5000 characters.', false),
    coalesce(item_add.custom_fields, '{}'::jsonb), v_cycle.id, v_caller.id)
  returning id into v_id;
  -- 6b Release 1 (review M1): a new deliverable starts with the project's default stages in their groups.
  perform app.item_stage_list_init_groups(v_id, app.project_default_stage_groups(v_project.id));
  perform app.cycle_refresh(v_cycle.id);
  return v_id;
end;
$$;

comment on function public.item_add(uuid, text, date, text, jsonb) is
  '7.2 (WORKFLOWS §5.4 items 9, 10; amendment D2; 6b Release 1): projects.manage on the caller''s clients; a '
  'new open deliverable at the end of a cycle whose period has not ended (a one-time project''s single cycle '
  'always), the project open or in progress and the client not Inactive; at most 100 live per cycle; it '
  'starts with the project''s default stages in their groups. planned_date any date. Returns its id.';

-- S3 --------------------------------------------------------------------------------------------------------
create or replace function public.project_stage_update(stage_id uuid, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_stage public.project_stages;
  v_project public.projects;
  v_key text;
  v_name text;
  v_position text;
  v_label text;
  v_group_position text;
  v_last text;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  select s.* into v_stage from public.project_stages s
  where s.id = project_stage_update.stage_id and s.org_id = v_caller.org_id;
  if v_stage.id is null then
    perform app.fail('NOT_FOUND', 'This stage is gone.');
  end if;
  v_project := app.project_lock(v_stage.project_id);
  perform app.project_check_writable(v_project);
  select s.* into v_stage from public.project_stages s where s.id = v_stage.id for update;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was removed.');
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('name', 'position', 'group_label') then
      perform app.fail('VALIDATION', format('"%s" is not a stage detail that can change.', v_key));
    end if;
  end loop;
  v_name := case when changes ? 'name'
    then app.client_work_text(changes ->> 'name', 120, 'Give the stage a name of up to 120 characters.')
    else v_stage.name end;
  v_label := v_stage.group_label;
  v_group_position := v_stage.group_position;
  if changes ? 'group_label' then
    v_label := app.stage_group_label(changes ->> 'group_label');
    if v_label is not null then
      v_label := app.project_stage_group_find(v_project.id, v_label);
      if v_label is null then
        perform app.fail('VALIDATION', format('There is no group called %s: add it first.', changes ->> 'group_label'));
      end if;
      select s.group_position into v_group_position from public.project_stages s
      where s.project_id = v_project.id and s.archived_at is null and s.group_label = v_label limit 1;
    else
      v_group_position := null;
    end if;
  end if;
  if changes ? 'position' then
    v_position := app.client_work_position(changes ->> 'position');
  elsif v_label is distinct from v_stage.group_label then
    select max(s.position collate "C") into v_last from public.project_stages s
    where s.project_id = v_project.id and s.group_label is not distinct from v_label;
    v_position := app.client_work_next_position(v_last);
  else
    v_position := v_stage.position;
  end if;
  if v_name is distinct from v_stage.name or v_label is distinct from v_stage.group_label then
    perform app.project_stage_name_free(v_project.id, v_name, v_stage.id, v_label);
  end if;
  if v_name is distinct from v_stage.name then v_changed := array_append(v_changed, 'name'); end if;
  if v_position is distinct from v_stage.position then v_changed := array_append(v_changed, 'position'); end if;
  if v_label is distinct from v_stage.group_label then v_changed := array_append(v_changed, 'group_label'); end if;
  if cardinality(v_changed) > 0 then
    -- The entry names the stage (the project is the audited entity).
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'update', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name))::text, true);
    update public.project_stages
    set name = v_name, position = v_position, group_label = v_label, group_position = v_group_position
    where id = v_stage.id;
  end if;
  return v_changed;
end;
$$;

create or replace function public.project_stage_group_update(project_id uuid, label text, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_label text;
  v_new_label text;
  v_old_position text;
  v_new_position text;
  v_key text;
  v_row public.project_stages;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_stage_group_update.project_id);
  perform app.project_check_writable(v_project);
  v_label := app.stage_group_label(project_stage_group_update.label);
  if v_label is not null then
    v_label := app.project_stage_group_find(v_project.id, v_label);
    if v_label is null then
      perform app.fail('NOT_FOUND', format('There is no group called %s.', project_stage_group_update.label));
    end if;
  elsif not exists (select 1 from public.project_stages s
                    where s.project_id = v_project.id and s.archived_at is null and s.group_label is null) then
    perform app.fail('NOT_FOUND', 'This project has no stages outside a group.');
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('label', 'position') then
      perform app.fail('VALIDATION', format('"%s" is not a group detail that can change.', v_key));
    end if;
  end loop;
  select s.group_position into v_old_position from public.project_stages s
  where s.project_id = v_project.id and s.archived_at is null and s.group_label is not distinct from v_label limit 1;
  v_new_label := v_label;
  v_new_position := v_old_position;
  if changes ? 'label' then
    v_new_label := app.stage_group_label(changes ->> 'label');
    if v_new_label is null then
      if v_label is not null and exists (select 1 from public.project_stages s
          where s.project_id = v_project.id and s.archived_at is null and s.group_label is null) then
        perform app.fail('CONFLICT', 'Name the stages outside a group first: only one group can be without a name.');
      end if;
      v_new_position := null;
    else
      if (v_label is null or lower(v_new_label) <> lower(v_label))
         and app.project_stage_group_find(v_project.id, v_new_label) is not null then
        perform app.fail('CONFLICT', format('This project already has a group called %s.', v_new_label));
      end if;
      if v_label is null then
        -- The untitled group named: it keeps its place, before the first named group.
        v_new_position := app.stage_group_key_before((
          select min(s.group_position collate "C") from public.project_stages s
          where s.project_id = v_project.id and s.archived_at is null and s.group_position is not null));
      end if;
    end if;
  end if;
  if changes ? 'position' then
    if v_new_label is null then
      perform app.fail('VALIDATION', 'Name the group before moving it: the stages outside a group stay first.');
    end if;
    v_new_position := app.client_work_position(changes ->> 'position');
    if exists (select 1 from public.project_stages s
               where s.project_id = v_project.id and s.archived_at is null and s.group_position = v_new_position
                 and s.group_label is distinct from v_label) then
      perform app.fail('VALIDATION', 'Another group already has that place.');
    end if;
  end if;
  if v_new_label is distinct from v_label then v_changed := array_append(v_changed, 'label'); end if;
  -- A rename of the untitled group gives it a key too; only a move the caller asked for is reported.
  if changes ? 'position' and v_new_position is distinct from v_old_position then v_changed := array_append(v_changed, 'position'); end if;
  if cardinality(v_changed) = 0 then
    return v_changed;
  end if;
  for v_row in
    select s.* from public.project_stages s
    where s.project_id = v_project.id and s.archived_at is null and s.group_label is not distinct from v_label
    order by s.position collate "C"
  loop
    -- One override per row: the audit trigger consumes it. Each entry names its stage.
    perform set_config('app.audit_override', jsonb_build_object(
      'action', case when 'label' = any (v_changed) then 'group_renamed' else 'group_moved' end,
      'meta', jsonb_build_object('group', v_label, 'to', v_new_label, 'stage_id', v_row.id, 'name', v_row.name))::text, true);
    update public.project_stages set group_label = v_new_label, group_position = v_new_position where id = v_row.id;
  end loop;
  return v_changed;
end;
$$;

create or replace function public.project_stage_group_archive(project_id uuid, label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_label text;
  v_row public.project_stages;
  v_count integer := 0;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_stage_group_archive.project_id);
  perform app.project_check_writable(v_project);
  v_label := app.stage_group_label(project_stage_group_archive.label);
  if v_label is not null then
    v_label := app.project_stage_group_find(v_project.id, v_label);
    if v_label is null then
      perform app.fail('NOT_FOUND', format('There is no group called %s.', project_stage_group_archive.label));
    end if;
  end if;
  for v_row in
    select s.* from public.project_stages s
    where s.project_id = v_project.id and s.archived_at is null and s.group_label is not distinct from v_label
    order by s.position collate "C"
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'archived', 'meta', jsonb_build_object('group', v_label, 'stage_id', v_row.id, 'name', v_row.name))::text, true);
    update public.project_stages set archived_at = now() where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    perform app.fail('NOT_FOUND', 'This project has no stages outside a group.');
  end if;
end;
$$;

-- S2 --------------------------------------------------------------------------------------------------------
create or replace function app.project_templates_guard()
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
    -- Review S2: an old-shape write (the v1.6 dialog after a rollback, or any caller sending only the
    -- old columns) wins over the stored shape, which the new builder re-creates on its next save.
    if new.stages is distinct from old.stages and new.stage_groups is not distinct from old.stage_groups then
      new.stage_groups := null;
    end if;
    if new.items is distinct from old.items and new.deliverables is not distinct from old.deliverables then
      new.deliverables := null;
    end if;
  elsif not app.in_transition() and new.created_by is distinct from auth.uid() then
    perform app.fail('FORBIDDEN', 'A template is written by the person creating it.');
  end if;
  -- 6b Release 1: the new shape, when given, is checked and the old columns written from it, so
  -- both always say the same thing. A template from before (both null) keeps its old columns.
  if new.stage_groups is not null then
    new.stage_groups := app.stage_groups_check(new.stage_groups);
    new.stages := app.stage_groups_flat(new.stage_groups);
  end if;
  if new.deliverables is not null then
    new.deliverables := app.deliverables_check(new.deliverables);
    new.items := coalesce(array(select e ->> 'title' from jsonb_array_elements(new.deliverables) e), '{}');
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
      perform app.fail('VALIDATION', 'Each deliverable needs a title of up to 200 characters.');
    end if;
  end loop;
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

comment on function app.project_templates_guard() is
  'BEFORE INSERT OR UPDATE on project_templates (kickoff 7 decision 23; 6b Release 1 + review S2): the author '
  'is the caller and never changes; stage_groups and deliverables, when given, are checked and written into '
  'stages / items (flattened titles) so the old columns always match; an update that changes only the old '
  'columns clears the stored shape (an old-shape writer wins); stages 1..120 characters each (at most 100), '
  'items 1..200; field_defaults at most 32 KB, every key the write adds or changes an active project field '
  'holding a value of its type.';

-- L1 --------------------------------------------------------------------------------------------------------
create or replace function app.stage_group_key_before(p_min text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_key text := '';
  v_high text := p_min;
  v_i integer;
  v_low_digit integer := 0;
  v_high_digit integer;
begin
  if p_min is null then
    return app.next_position(null);
  end if;
  -- The key between nothing (all zeros) and p_min: the same arithmetic as positionBetween in
  -- modules/client-work/domain/positions.ts, so a key always fits.
  for v_i in 1..64 loop
    v_high_digit := case when v_high is not null and v_i <= length(v_high)
                         then position(substr(v_high, v_i, 1) in digits) - 1 else 36 end;
    if v_high_digit - v_low_digit > 1 then
      return v_key || substr(digits, ((v_low_digit + v_high_digit) / 2) + 1, 1);
    end if;
    v_key := v_key || '0';
    if v_high_digit - v_low_digit = 1 then
      v_high := null;
    end if;
  end loop;
  perform app.fail('VALIDATION', 'Move another group first: there is no place before this one.');
  return null;
end;
$$;

-- L2 --------------------------------------------------------------------------------------------------------
revoke execute on function app.stage_groups_of(text[], jsonb) from authenticated;
