-- v2.0 X3 step 3, Settings → Templates (2026-11-05; DATA-MODEL §1 "v2.0 X3"; review on #89 before
-- push): the page's five template reads in one, so its first wave is six (ARCHITECTURE §19).
--
-- public.templates_library() → one jsonb object, each key exactly the rows one API read returned,
-- the same columns, the same filter and the same order (an id breaks a tie):
--   task_templates          listTaskTemplates: not deleted, by name;
--   task_types              listTaskTypes: every type, archived ones included, by position;
--   project_templates       listProjectTemplates: not deleted, by name;
--   deliverable_templates   listDeliverableTemplates: not deleted, by name;
--   stage_presets           listStagePresets: not deleted, by name.
-- Security invoker: each table's own select policy decides every row, as for the API reads
-- (templates.manage for the three template tables, lists.manage for the presets, the org for the
-- types), so a caller without a key gets [] for it, as the API read gave them. No client record,
-- no money, no Owner-only table. Stable, empty search_path, execute for authenticated only. A new
-- function: nothing existing changes (expand-only).

create function public.templates_library()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'task_templates', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.name, r.id)
      from (select t.id, t.name, t.task_type_id, t.description, t.default_priority, t.stages,
                   t.field_defaults, t.archived_at, t.created_by, t.reminder_rules
            from public.task_templates t where t.deleted_at is null) r), '[]'::jsonb),
    'task_types', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.position, r.id)
      from (select y.id, y.name, y.kind, y.has_location, y.shows_on_calendar, y.archived_at,
                   y.position, y.default_reminders, y.color
            from public.task_types y) r), '[]'::jsonb),
    'project_templates', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.name, r.id)
      from (select p.id, p.name, p.description, p.recurrence, p.stages, p.items, p.stage_groups,
                   p.deliverables, p.field_defaults, p.archived_at, p.created_by
            from public.project_templates p where p.deleted_at is null) r), '[]'::jsonb),
    'deliverable_templates', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.name, r.id)
      from (select d.id, d.name, d.stage_groups, d.archived_at, d.archived_reason, d.created_by
            from public.deliverable_templates d where d.deleted_at is null) r), '[]'::jsonb),
    'stage_presets', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.name, r.id)
      from (select s.id, s.name, s.stages, s.archived_at, s.created_by
            from public.stage_presets s where s.deleted_at is null) r), '[]'::jsonb)
  );
$$;

comment on function public.templates_library() is
  'v2.0 X3: Settings → Templates'' five reads in one: task_templates, task_types, project_templates, '
  'deliverable_templates and stage_presets, each exactly the rows, columns, filter (not deleted) '
  'and order of its API read (listTaskTemplates, listTaskTypes, listProjectTemplates, '
  'listDeliverableTemplates, listStagePresets). Security invoker: each table''s policy decides.';

revoke all on function public.templates_library() from public, anon, service_role;
grant execute on function public.templates_library() to authenticated;
