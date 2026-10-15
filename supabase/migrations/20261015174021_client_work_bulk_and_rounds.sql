-- Phase 6b, Release 2 (v1.7.1; ROADMAP 6b.16 (c)(d)(e); DATA-MODEL §5b "Revision rounds, extras kept and
-- bulk edits"). EXPAND-ONLY, ON THE TEAM'S EXISTING DATA: three nullable columns on project_cycles (with a
-- pair check every existing row meets: all null), new functions and the history describer re-created with
-- every earlier answer kept. No row is rewritten, nothing dropped or renamed. NOTHING IS PRE-DEFINED: no
-- stage, group, deliverable or list line is seeded; the one generic name, "Revision round N", is what a
-- deliverable with no revision stage of its own gets. Append-only: never edit once applied.
--
-- 1. item_add_revision_round(item_id): one more revision stage on one open deliverable, named after its
--    own revision stages ("Revision 2" -> "Revision 3"), in their group; ticks kept.
-- 2. cycle_keep_extras(cycle_id, keep): "Keep this month's extra deliverables next month?", asked once
--    per cycle: Yes adds the cycle's extras (deliverables added in it whose title is not on the
--    deliverables list) to the list for the cycles still to be built; No leaves the list as it is.
-- 3. Bulk edits on selected open deliverables, each ONE call (one transaction), all or nothing:
--    items_set_planned_date, items_shift_planned_dates, items_add_stage_groups, items_rename.
-- Every write is audited by the row trigger (one entry per deliverable, stage or line).

-- 1. Columns ---------------------------------------------------------------------------------------------------
alter table public.project_cycles
  add column extras_decided_at timestamptz null,
  add column extras_decided_by uuid null references public.members (id),
  add column extras_kept integer null check (extras_kept is null or extras_kept between 0 and 100),
  add constraint project_cycles_extras_pair check ((extras_decided_at is null) = (extras_kept is null));
create index project_cycles_extras_decided_by_idx on public.project_cycles (extras_decided_by);
comment on column public.project_cycles.extras_decided_at is
  '6b Release 2 (ROADMAP 6b.16 (d)): when "Keep this month''s extra deliverables next month?" was answered '
  'for this cycle (cycle_keep_extras); null = not yet. Asked once: an answered cycle is never asked again.';
comment on column public.project_cycles.extras_decided_by is
  '6b Release 2: who answered it (the Owner or the client''s Admin).';
comment on column public.project_cycles.extras_kept is
  '6b Release 2: how many extras the answer added to the deliverables list (0 = No, or nothing to keep).';

-- 2. Helpers ---------------------------------------------------------------------------------------------------
-- The selected deliverables, checked and locked in the order given (duplicates once, first place kept):
-- at least one, at most 100; each the caller's (NOT_FOUND otherwise, never "forbidden"), its project open
-- or in progress, and the deliverable itself open (INVALID_STATE naming it). All or nothing.
create function app.client_work_bulk_items(p_ids uuid[])
returns public.project_items[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_item public.project_items;
  v_project public.projects;
  v_out public.project_items[] := '{}';
begin
  select array_agg(d.id order by d.first) into v_ids
  from (select u.id, min(u.n) as first from unnest(p_ids) with ordinality as u(id, n)
        where u.id is not null group by u.id) d;
  if v_ids is null or cardinality(v_ids) = 0 then
    perform app.fail('VALIDATION', 'Select at least one deliverable.');
  end if;
  if cardinality(v_ids) > 100 then
    perform app.fail('VALIDATION', 'Select at most 100 deliverables at a time.');
  end if;
  foreach v_id in array v_ids loop
    v_item := app.item_lock(v_id);
    select p.* into v_project from public.projects p where p.id = v_item.project_id;
    perform app.project_check_writable(v_project);
    if v_item.state <> 'open' then
      perform app.fail('INVALID_STATE', format('%s is %s: only open deliverables change together.', v_item.title,
        case v_item.state when 'cancelled' then 'closed' when 'carried' then 'carried forward' else 'done' end));
    end if;
    v_out := v_out || v_item;
  end loop;
  return v_out;
end;
$$;

-- A cycle's extras: the deliverables added in it (not carried in), not closed, whose title (trimmed,
-- ignoring case) is on no active line of the project's deliverables list; one per title (the first in
-- the list), in the cycle's order, each with its active stages in their groups (names only).
create function app.cycle_extras(p_cycle_id uuid)
returns table (item_id uuid, title text, stage_groups jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.title, e.stage_groups
  from (
    select distinct on (lower(btrim(i.title))) i.id, btrim(i.title) as title, i.position,
      (select coalesce(jsonb_agg(jsonb_build_object('label', g.group_label, 'stages', g.stages)
                                 order by g.group_position collate "C" nulls first), '[]'::jsonb)
       from (select s.group_label, s.group_position,
                    to_jsonb(array_agg(s.name order by s.position collate "C")) as stages
             from public.project_item_stage_list s
             where s.item_id = i.id and s.archived_at is null
             group by s.group_label, s.group_position) g) as stage_groups
    from public.project_items i
    where i.cycle_id = p_cycle_id and i.origin_cycle_id = p_cycle_id and i.state <> 'cancelled'
      and not exists (select 1 from public.project_item_blueprints b
                      where b.project_id = i.project_id and b.archived_at is null
                        and lower(btrim(b.title)) = lower(btrim(i.title)))
    order by lower(btrim(i.title)), i.position collate "C", i.id
  ) e
  order by e.position collate "C", e.id;
$$;

revoke all on function app.client_work_bulk_items(uuid[]), app.cycle_extras(uuid) from public, anon, authenticated;
grant execute on function app.client_work_bulk_items(uuid[]), app.cycle_extras(uuid) to service_role;
comment on function app.client_work_bulk_items(uuid[]) is
  'Internal (6b Release 2, ROADMAP 6b.16 (e)): the selected deliverables, de-duplicated (first place kept), '
  '1..100 (VALIDATION), each locked through app.item_lock (NOT_FOUND outside the caller''s clients), its '
  'project writable, the deliverable open (INVALID_STATE naming it). In the order given.';
comment on function app.cycle_extras(uuid) is
  'Internal (6b Release 2, ROADMAP 6b.16 (d)): a cycle''s extra deliverables (added in it, not carried in, '
  'not closed, a title on no active deliverables-list line, ignoring case; one per title), in order, with '
  'their active stage groups. The same rule as cycleExtras in modules/client-work/domain/extras.ts.';

-- 3. Another revision round on one deliverable ---------------------------------------------------------------------
create function public.item_add_revision_round(item_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
  v_base text;
  v_number integer;
  v_label text;
  v_found boolean;
  v_name text;
  v_guard integer := 0;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  v_item := app.item_lock(item_add_revision_round.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if v_item.state <> 'open' then
    perform app.fail('INVALID_STATE', format('%s is %s: reopen it to add another revision round.', v_item.title,
      case v_item.state when 'cancelled' then 'closed' when 'carried' then 'carried forward' else 'done' end));
  end if;
  if (select count(*) from public.project_item_stage_list s
      where s.item_id = v_item.id and s.archived_at is null) >= 100 then
    perform app.fail('VALIDATION', 'A deliverable has at most 100 stages.');
  end if;

  -- Its latest numbered revision stage ("Revision 2", "Client revision 3"): the next number, its group.
  select btrim(regexp_replace(s.name, '\s*[0-9]{1,6}\s*$', '')), substring(s.name from '([0-9]{1,6})\s*$')::integer,
         s.group_label, true
    into v_base, v_number, v_label, v_found
  from public.project_item_stage_list s
  where s.item_id = v_item.id and s.archived_at is null
    and s.name ~ '[0-9]{1,6}\s*$'
    and btrim(regexp_replace(s.name, '\s*[0-9]{1,6}\s*$', '')) ~* '\mrevision'
  order by substring(s.name from '([0-9]{1,6})\s*$')::integer desc,
           s.group_position collate "C" desc nulls last, s.position collate "C" desc
  limit 1;
  if v_found then
    v_number := v_number + 1;
  else
    -- An unnumbered one ("Revision"): the second round, in its group.
    select s.name, s.group_label, true into v_base, v_label, v_found
    from public.project_item_stage_list s
    where s.item_id = v_item.id and s.archived_at is null and s.name ~* '\mrevision'
    order by s.group_position collate "C" desc nulls last, s.position collate "C" desc
    limit 1;
    if v_found then
      v_number := 2;
    else
      -- None at all: the first round, after the last stage, in its group.
      v_base := 'Revision round';
      v_number := 1;
      select s.group_label into v_label
      from public.project_item_stage_list s
      where s.item_id = v_item.id and s.archived_at is null
      order by s.group_position collate "C" desc nulls last, s.position collate "C" desc
      limit 1;
    end if;
  end if;
  loop
    v_name := v_base || ' ' || v_number;
    exit when not exists (select 1 from public.project_item_stage_list s
                          where s.item_id = v_item.id and s.archived_at is null
                            and s.group_label is not distinct from v_label and lower(s.name) = lower(v_name));
    v_number := v_number + 1;
    v_guard := v_guard + 1;
    if v_guard > 100 then
      perform app.fail('CONFLICT', 'Name the next revision stage yourself in Edit stages.');
    end if;
  end loop;
  if length(v_name) > 120 then
    perform app.fail('VALIDATION', 'Name the next revision stage yourself in Edit stages.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'insert', 'meta', jsonb_build_object('group', v_label, 'revision_round', true))::text, true);
  perform public.item_stage_add(v_item.id, v_name, v_label);
  return v_name;
end;
$$;
revoke all on function public.item_add_revision_round(uuid) from public, anon;
grant execute on function public.item_add_revision_round(uuid) to authenticated, service_role;
comment on function public.item_add_revision_round(uuid) is
  '6b Release 2 (ROADMAP 6b.16 (c), "+ Another revision round"): projects.manage on the caller''s clients, '
  'the project open or in progress, the deliverable open (INVALID_STATE otherwise). Adds one stage at the end '
  'of a group: after the deliverable''s highest numbered stage with "revision" in its name, the next number '
  '("Revision 2" -> "Revision 3", in its group); after an unnumbered one ("Revision"), "Revision 2"; with '
  'none, "Revision round 1" in the last stage''s group. A taken name moves to the next number. Ticks kept. '
  'Audited (insert, meta {group, revision_round: true}). Returns the new stage''s name.';

-- 4. Keep this month's extras next month? ---------------------------------------------------------------------------
create function public.cycle_keep_extras(cycle_id uuid, keep boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_cycle public.project_cycles;
  v_project public.projects;
  v_extra record;
  v_groups jsonb;
  v_last text;
  v_titles jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  select c.* into v_cycle from public.project_cycles c
  where c.id = cycle_keep_extras.cycle_id and c.org_id = v_caller.org_id;
  if v_cycle.id is null then
    perform app.fail('NOT_FOUND', 'This cycle is not one of yours.');
  end if;
  v_project := app.project_lock(v_cycle.project_id);
  perform app.project_check_writable(v_project);
  if v_project.recurrence = 'one_time' then
    perform app.fail('VALIDATION', 'A one-time project has no deliverables list.');
  end if;
  if cycle_keep_extras.keep is null then
    perform app.fail('VALIDATION', 'Answer yes or no.');
  end if;
  select c.* into v_cycle from public.project_cycles c where c.id = v_cycle.id for update;
  if v_cycle.extras_decided_at is not null then
    perform app.fail('INVALID_STATE', format('%s''s extra deliverables were decided already.',
      coalesce(v_cycle.label, 'This cycle')));
  end if;
  if cycle_keep_extras.keep then
    if (select count(*) from public.project_item_blueprints b
        where b.project_id = v_project.id and b.archived_at is null)
       + (select count(*) from app.cycle_extras(v_cycle.id)) > 100 then
      perform app.fail('VALIDATION', 'The deliverables list holds at most 100 deliverables: remove some first.');
    end if;
    select max(b.position collate "C") into v_last from public.project_item_blueprints b where b.project_id = v_project.id;
    for v_extra in select e.* from app.cycle_extras(v_cycle.id) e loop
      v_groups := app.stage_groups_check(v_extra.stage_groups);
      v_last := app.client_work_next_position(v_last);
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'insert', 'meta', jsonb_build_object('kept_from_item_id', v_extra.item_id, 'cycle_id', v_cycle.id))::text, true);
      insert into public.project_item_blueprints (org_id, project_id, title, position, stages, stage_groups)
      values (v_project.org_id, v_project.id, v_extra.title, v_last, app.stage_groups_flat(v_groups), v_groups);
      v_titles := v_titles || to_jsonb(v_extra.title);
      v_count := v_count + 1;
    end loop;
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', case when cycle_keep_extras.keep then 'extras_kept' else 'extras_not_kept' end,
    'meta', jsonb_build_object('count', v_count, 'titles', v_titles))::text, true);
  update public.project_cycles
  set extras_decided_at = now(), extras_decided_by = v_caller.id, extras_kept = v_count
  where id = v_cycle.id;
  return v_count;
end;
$$;
revoke all on function public.cycle_keep_extras(uuid, boolean) from public, anon;
grant execute on function public.cycle_keep_extras(uuid, boolean) to authenticated, service_role;
comment on function public.cycle_keep_extras(uuid, boolean) is
  '6b Release 2 (ROADMAP 6b.16 (d)): projects.manage on the caller''s clients, the project open or in '
  'progress and recurring. Answers "Keep this month''s extra deliverables next month?" once per cycle '
  '(INVALID_STATE when answered): keep = true adds each of app.cycle_extras to the end of the deliverables '
  'list with its stage groups (one audited line each, meta {kept_from_item_id, cycle_id}; at most 100 lines, '
  'VALIDATION), for the cycles still to be built from the list (no existing cycle changes); false adds '
  'nothing. The cycle records the answer (extras_decided_at / _by / extras_kept), audited extras_kept or '
  'extras_not_kept with meta {count, titles}. Returns how many lines were added.';

-- 5. Bulk edits on selected open deliverables ------------------------------------------------------------------------
create function public.items_set_planned_date(item_ids uuid[], planned_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_items public.project_items[];
  v_item public.project_items;
  v_count integer := 0;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  v_items := app.client_work_bulk_items(items_set_planned_date.item_ids);
  foreach v_item in array v_items loop
    if v_item.planned_date is distinct from items_set_planned_date.planned_date then
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'update', 'meta', jsonb_build_object('bulk', cardinality(v_items)))::text, true);
      update public.project_items set planned_date = items_set_planned_date.planned_date where id = v_item.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create function public.items_shift_planned_dates(item_ids uuid[], days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_items public.project_items[];
  v_item public.project_items;
  v_count integer := 0;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  if items_shift_planned_dates.days is null or items_shift_planned_dates.days = 0
     or abs(items_shift_planned_dates.days) > 365 then
    perform app.fail('VALIDATION', 'Move the dates by 1 to 365 days, earlier or later.');
  end if;
  v_items := app.client_work_bulk_items(items_shift_planned_dates.item_ids);
  foreach v_item in array v_items loop
    -- A deliverable with no planned date has nothing to move.
    if v_item.planned_date is not null then
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'update', 'meta', jsonb_build_object('bulk', cardinality(v_items),
                                                       'shift_days', items_shift_planned_dates.days))::text, true);
      update public.project_items set planned_date = v_item.planned_date + items_shift_planned_dates.days
      where id = v_item.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create function public.items_add_stage_groups(item_ids uuid[], stage_groups jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_items public.project_items[];
  v_item public.project_items;
  v_groups jsonb;
  v_group jsonb;
  v_stages integer;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  v_groups := app.stage_groups_check(items_add_stage_groups.stage_groups);
  if jsonb_array_length(v_groups) = 0 then
    perform app.fail('VALIDATION', 'Add a group with at least one stage.');
  end if;
  if exists (select 1 from jsonb_array_elements(v_groups) e where e ->> 'label' is null) then
    perform app.fail('VALIDATION', 'Name each group you add.');
  end if;
  v_stages := cardinality(app.stage_groups_flat(v_groups));
  v_items := app.client_work_bulk_items(items_add_stage_groups.item_ids);
  -- Every deliverable is checked before anything is written: the whole selection or none.
  foreach v_item in array v_items loop
    for v_group in select e from jsonb_array_elements(v_groups) e loop
      if app.item_stage_group_find(v_item.id, v_group ->> 'label') is not null then
        perform app.fail('CONFLICT', format('%s already has a group called %s.', v_item.title, v_group ->> 'label'));
      end if;
    end loop;
    if (select count(*) from public.project_item_stage_list s where s.item_id = v_item.id and s.archived_at is null)
       + v_stages > 100 then
      perform app.fail('VALIDATION', format('%s would have more than 100 stages.', v_item.title));
    end if;
  end loop;
  foreach v_item in array v_items loop
    for v_group in select e from jsonb_array_elements(v_groups) e loop
      perform public.item_stage_group_add(v_item.id, v_group ->> 'label',
        array(select jsonb_array_elements_text(v_group -> 'stages')));
    end loop;
  end loop;
  return cardinality(v_items);
end;
$$;

create function public.items_rename(item_ids uuid[], pattern text, start_at integer default 1, apply boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_items public.project_items[];
  v_item public.project_items;
  v_pattern text := btrim(coalesce(items_rename.pattern, ''));
  v_start integer := coalesce(items_rename.start_at, 1);
  v_index integer := 0;
  v_name text;
  v_out jsonb := '[]'::jsonb;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  if v_pattern = '' then
    perform app.fail('VALIDATION', 'Type the new name, with {n} where its number goes.');
  end if;
  if v_start < 0 or v_start > 9999 then
    perform app.fail('VALIDATION', 'Start the numbers between 0 and 9999.');
  end if;
  v_items := app.client_work_bulk_items(items_rename.item_ids);
  if cardinality(v_items) > 1 and position('{n}' in v_pattern) = 0 and position('{title}' in v_pattern) = 0 then
    perform app.fail('VALIDATION', 'Add {n} so each deliverable gets its own number.');
  end if;
  foreach v_item in array v_items loop
    -- {n} first, then {title}: a title's own "{n}" is never replaced.
    v_name := btrim(replace(replace(v_pattern, '{n}', (v_start + v_index)::text), '{title}', v_item.title));
    if v_name = '' or length(v_name) > 200 then
      perform app.fail('VALIDATION', format('The new name of %s needs 1 to 200 characters.', v_item.title));
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_item.id, 'from', v_item.title, 'to', v_name));
    if coalesce(items_rename.apply, true) and v_name is distinct from v_item.title then
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'update', 'meta', jsonb_build_object('bulk', cardinality(v_items)))::text, true);
      update public.project_items set title = v_name where id = v_item.id;
    end if;
    v_index := v_index + 1;
  end loop;
  return v_out;
end;
$$;

revoke all on function public.items_set_planned_date(uuid[], date), public.items_shift_planned_dates(uuid[], integer),
  public.items_add_stage_groups(uuid[], jsonb), public.items_rename(uuid[], text, integer, boolean) from public, anon;
grant execute on function public.items_set_planned_date(uuid[], date), public.items_shift_planned_dates(uuid[], integer),
  public.items_add_stage_groups(uuid[], jsonb), public.items_rename(uuid[], text, integer, boolean)
  to authenticated, service_role;
comment on function public.items_set_planned_date(uuid[], date) is
  '6b Release 2 (ROADMAP 6b.16 (e)): projects.manage; the selected open deliverables (app.client_work_bulk_items: '
  'all or nothing) planned for the date (null clears it). One audited update per deliverable that changed (meta '
  '{bulk}). Returns how many changed.';
comment on function public.items_shift_planned_dates(uuid[], integer) is
  '6b Release 2 (ROADMAP 6b.16 (e)): projects.manage; each selected open deliverable''s planned date moved by '
  'days (1..365 either way, VALIDATION otherwise; across months as the calendar goes); one without a date is '
  'left as it is. One audited update each (meta {bulk, shift_days}). Returns how many moved.';
comment on function public.items_add_stage_groups(uuid[], jsonb) is
  '6b Release 2 (ROADMAP 6b.16 (e)): projects.manage; the named stage groups (StageGroupsJson, every group '
  'named, VALIDATION) added after the last group of each selected open deliverable, as item_stage_group_add. '
  'All checked first: CONFLICT naming a deliverable that already has such a group, VALIDATION past 100 stages. '
  'Returns how many deliverables took them.';
comment on function public.items_rename(uuid[], text, integer, boolean) is
  '6b Release 2 (ROADMAP 6b.16 (e)): projects.manage; renames the selected open deliverables by a pattern in '
  'the order given: {n} = start_at, start_at + 1, ...; {title} = the current title; trimmed, 1..200 '
  '(VALIDATION); more than one needs {n} or {title}. apply = false is the preview (nothing written). '
  'Returns [{id, from, to}]. One audited update per renamed deliverable (meta {bulk}). The same rule as '
  'renamePreview in modules/client-work/domain/bulk.ts.';

-- 6. The history shows the new entries -------------------------------------------------------------------------------
create or replace function app.client_work_activity_shown(p_entity text, p_action text, p_diff jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_entity
    when 'projects' then
      p_action in ('insert', 'started', 'completed', 'cancelled', 'reopened', 'saved_as_template')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['delivery_date', 'name', 'description', 'custom_fields'])
    when 'project_stages' then
      p_action in ('insert', 'archived', 'group_renamed', 'group_moved')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['name', 'position', 'group_label', 'group_position'])
    when 'project_item_blueprints' then
      p_action in ('insert', 'archived')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['title', 'position', 'stages', 'stage_groups'])
    when 'project_item_stage_list' then
      p_action in ('insert', 'archived', 'ticked', 'unticked', 'group_renamed', 'group_moved')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['name', 'position', 'group_label', 'group_position'])
    when 'project_cycles' then
      p_action in ('generated', 'insert', 'item_list_added', 'extras_kept', 'extras_not_kept')
    when 'project_items' then
      p_action in ('insert', 'done', 'not_done', 'approved', 'rejected', 'sent_back', 'reopened', 'cancelled',
                   'closed', 'carried', 'carried_in', 'left_pending', 'saved_as_template')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['title', 'notes', 'planned_date', 'custom_fields', 'position'])
    when 'project_item_stages' then
      p_action in ('ticked', 'unticked')
  end, false);
$$;
comment on function app.client_work_activity_shown(text, text, jsonb) is
  'Internal (review fix 2026-10-09; 6b Release 1; 6b Release 2: + saved_as_template on a project and a '
  'deliverable, + extras_kept / extras_not_kept on a cycle): whether the project''s history describes an audit '
  'entry: the same list as describeProjectActivity in modules/client-work/domain/activity.ts. Read by '
  'project_activity and item_last_changes; change both together.';
