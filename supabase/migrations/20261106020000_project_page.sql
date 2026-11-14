-- v2.0 X3 step 3, a project's page (2026-11-06; DATA-MODEL §1 "v2.0 X3"; the advisor's standing
-- rule on #89: a read-only, security-invoker fold equal to the reads it replaces): the page's own
-- first-wave reads in one, so its first wave is six (ARCHITECTURE §19). The layout's reads (the
-- client row, the directory) and the tab title stay as they are: a prefetch reads no page data.
--
-- public.project_page(p_project_id) → one jsonb object, each key exactly the rows one read gave:
--   project      getProject: the project (PROJECT_COLUMNS), with template {name, deleted_at} (the
--                project_templates row RLS shows, else null) and contact_name (the client's
--                primary live contact, else its first live one, as RLS shows them), or null;
--   cycles       listCycles([id]): CYCLE_COLUMNS, by period_start (no start first), then id;
--   stages       listStages: by group_position (ungrouped first), position, id;
--   blueprints   listBlueprints: the item blueprints (unordered there; by position, id here);
--   unfinished   listItemRows({states: open, done, projectId}): ITEM_COLUMNS with project {name,
--                recurrence, client_id, held_at, client {name, admin_id, state}} and cycle
--                {label, period_end}, inner joins as PostgREST's !inner (each table's policy
--                decides), by planned_date (no date last), then id;
--   fields       listDefinitions('project'): the company-wide project fields, by position, id;
--   presets      listStagePresets: the stage presets not deleted, by name, id.
-- Security invoker: every table's policy decides. Never money: only the columns those reads name
-- (no fee, rate or revenue column; invariant 2's tables are untouched). Stable, empty search_path,
-- authenticated only. A new function: nothing existing changes (expand-only).

create function public.project_page(p_project_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_project_id is null then
    perform app.fail('VALIDATION', 'Choose a project.');
  end if;
  return jsonb_build_object(
    'project', (
      select jsonb_build_object(
               'id', p.id, 'client_id', p.client_id, 'name', p.name, 'description', p.description,
               'recurrence', p.recurrence, 'state', p.state, 'delivery_date', p.delivery_date,
               'custom_fields', p.custom_fields, 'template_id', p.template_id, 'created_by', p.created_by,
               'created_at', p.created_at, 'cancelled_at', p.cancelled_at, 'cancelled_reason', p.cancelled_reason,
               'held_at', p.held_at, 'held_by', p.held_by, 'hold_reason', p.hold_reason,
               'template', (select jsonb_build_object('name', t.name, 'deleted_at', t.deleted_at)
                            from public.project_templates t where t.id = p.template_id),
               'contact_name', (select cc.name
                                from public.clients c
                                join public.client_contacts cc on cc.client_id = c.id
                                where c.id = p.client_id and cc.archived_at is null
                                order by cc.is_primary desc, cc.created_at asc
                                limit 1))
      from public.projects p where p.id = p_project_id),
    'cycles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', y.id, 'project_id', y.project_id, 'period_start', y.period_start,
               'period_end', y.period_end, 'label', y.label, 'state', y.state,
               'item_list_copied', y.item_list_copied, 'extras_decided_at', y.extras_decided_at)
             order by y.period_start nulls first, y.id)
      from public.project_cycles y where y.project_id = p_project_id), '[]'::jsonb),
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'project_id', s.project_id, 'name', s.name, 'position', s.position,
               'group_label', s.group_label, 'group_position', s.group_position, 'archived_at', s.archived_at)
             order by s.group_position nulls first, s.position, s.id)
      from public.project_stages s where s.project_id = p_project_id), '[]'::jsonb),
    'blueprints', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'project_id', b.project_id, 'title', b.title, 'position', b.position,
               'archived_at', b.archived_at, 'stages', b.stages, 'stage_groups', b.stage_groups)
             order by b.position, b.id)
      from public.project_item_blueprints b where b.project_id = p_project_id), '[]'::jsonb),
    'unfinished', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'project_id', i.project_id, 'cycle_id', i.cycle_id, 'title', i.title,
               'position', i.position, 'planned_date', i.planned_date, 'notes', i.notes,
               'custom_fields', i.custom_fields, 'state', i.state, 'done_at', i.done_at,
               'done_by', i.done_by, 'approved_at', i.approved_at, 'approved_by', i.approved_by,
               'cancelled_reason', i.cancelled_reason, 'cancelled_at', i.cancelled_at,
               'cancelled_by', i.cancelled_by, 'close_kind', i.close_kind,
               'carry_decision', i.carry_decision, 'carried_from_item_id', i.carried_from_item_id,
               'origin_cycle_id', i.origin_cycle_id, 'created_at', i.created_at,
               'project', jsonb_build_object(
                 'name', p.name, 'recurrence', p.recurrence, 'client_id', p.client_id, 'held_at', p.held_at,
                 'client', jsonb_build_object('name', c.name, 'admin_id', c.admin_id, 'state', c.state)),
               'cycle', jsonb_build_object('label', y.label, 'period_end', y.period_end))
             order by i.planned_date nulls last, i.id)
      from public.project_items i
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      join public.project_cycles y on y.id = i.cycle_id
      where i.project_id = p_project_id and i.state in ('open', 'done')), '[]'::jsonb),
    'fields', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.position, f.id)
      from public.field_definitions f
      where f.entity = 'project' and f.client_id is null), '[]'::jsonb),
    'presets', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'stages', r.stages,
                                          'archived_at', r.archived_at, 'created_by', r.created_by)
                       order by r.name, r.id)
      from public.stage_presets r where r.deleted_at is null), '[]'::jsonb)
  );
end;
$$;

comment on function public.project_page(uuid) is
  'v2.0 X3: a project''s page''s own reads in one: project (getProject, with its template and '
  'primary contact), cycles, stages, blueprints, unfinished items (with project, client and cycle), '
  'the project fields and the stage presets, each exactly as its read. Security invoker: every '
  'policy decides. Never money. Not the layout''s reads or the tab title (a prefetch reads no page data).';

revoke all on function public.project_page(uuid) from public, anon, service_role;
grant execute on function public.project_page(uuid) to authenticated;
