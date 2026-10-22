-- v1.8 V5a item 6b, the Owner-only Delete (owner, 22 Oct 2026; DATA-MODEL §2 "The Owner-only Delete",
-- PERMISSIONS, WORKFLOWS §1a / §5): the Owner deletes any project, deliverable or task template or
-- stage preset at any time, and a holiday only before its date.
--
-- Expand-only, works on the team's existing data:
-- 1. Two nullable columns on each of the four template tables (every existing row: both null) and
--    two checks every existing row meets. A soft "deleted" state, not a row delete: the foreign keys
--    projects.template_id and tasks.template_id stay valid and the name stays on the row, so whatever
--    was made from it reads "‹name› (deleted)". A deleted template is also archived, so every existing
--    filter (archived_at is null) already leaves it out.
-- 2. app.template_deleted_guard: a deleted template never changes again (no edit, restore or undo).
-- 3. template_usage / template_delete: the Owner only; the activity_log row first, then the change.
--    Task templates: the template's reminder rules are copied onto every open task that follows it
--    first, so nobody's reminders change.
-- 4. holidays: a restrictive DELETE policy (only after today, IST) and holiday_delete.
-- No existing row is rewritten by the migration itself.

-- 1. The deleted state ------------------------------------------------------------------------------
alter table public.project_templates
  add column deleted_at timestamptz null,
  add column deleted_by uuid null references public.members (id),
  add constraint project_templates_deleted_pair check ((deleted_at is null) = (deleted_by is null)),
  add constraint project_templates_deleted_archived check (deleted_at is null or archived_at is not null);
alter table public.deliverable_templates
  add column deleted_at timestamptz null,
  add column deleted_by uuid null references public.members (id),
  add constraint deliverable_templates_deleted_pair check ((deleted_at is null) = (deleted_by is null)),
  add constraint deliverable_templates_deleted_archived check (deleted_at is null or archived_at is not null);
alter table public.task_templates
  add column deleted_at timestamptz null,
  add column deleted_by uuid null references public.members (id),
  add constraint task_templates_deleted_pair check ((deleted_at is null) = (deleted_by is null)),
  add constraint task_templates_deleted_archived check (deleted_at is null or archived_at is not null);
alter table public.stage_presets
  add column deleted_at timestamptz null,
  add column deleted_by uuid null references public.members (id),
  add constraint stage_presets_deleted_pair check ((deleted_at is null) = (deleted_by is null)),
  add constraint stage_presets_deleted_archived check (deleted_at is null or archived_at is not null);

comment on column public.project_templates.deleted_at is
  'V5a 6b: deleted by the Owner (template_delete). Also archived; never changes again; its name stays so a '
  'project started from it reads "‹name› (deleted)". No API grant.';
comment on column public.deliverable_templates.deleted_at is
  'V5a 6b: deleted by the Owner (template_delete). Also archived; never changes again. No API grant.';
comment on column public.task_templates.deleted_at is
  'V5a 6b: deleted by the Owner (template_delete), after its reminder rules were copied onto the open tasks '
  'that followed it. Also archived; never changes again. No API grant.';
comment on column public.stage_presets.deleted_at is
  'V5a 6b: deleted by the Owner (template_delete). Also archived; never changes again. No API grant.';

-- 2. A deleted template never changes again ---------------------------------------------------------
create function app.template_deleted_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    perform app.fail('INVALID_STATE', 'This template was deleted.');
  end if;
  return new;
end;
$$;
revoke all on function app.template_deleted_guard() from public, anon;
grant execute on function app.template_deleted_guard() to authenticated, service_role;
comment on function app.template_deleted_guard() is
  'V5a 6b, BEFORE UPDATE on project_templates, deliverable_templates, task_templates and stage_presets: a '
  'deleted row never changes again (INVALID_STATE), so it cannot be edited, restored or un-deleted.';

create trigger template_deleted_guard before update on public.project_templates
  for each row execute function app.template_deleted_guard();
create trigger template_deleted_guard before update on public.deliverable_templates
  for each row execute function app.template_deleted_guard();
create trigger template_deleted_guard before update on public.task_templates
  for each row execute function app.template_deleted_guard();
create trigger template_deleted_guard before update on public.stage_presets
  for each row execute function app.template_deleted_guard();

-- 3. Usage and delete -------------------------------------------------------------------------------
-- The Owner, or a refusal. Returns the caller's org.
create function app.owner_delete_caller()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.is_owner() then
    perform app.fail('FORBIDDEN', 'Only the Owner deletes these.');
  end if;
  return v_org;
end;
$$;
revoke all on function app.owner_delete_caller() from public, anon, authenticated;
grant execute on function app.owner_delete_caller() to service_role;
comment on function app.owner_delete_caller() is
  'V5a 6b, internal: the caller''s organisation when the caller is the active Owner; UNAUTHENTICATED or '
  'FORBIDDEN otherwise.';

-- What a template is used by: {used, open}. Projects: started from it / still open or in progress.
-- Tasks: following it / todo, in progress or changes requested. Deliverable templates and stage
-- presets are copied, never linked: always {0, 0}.
create function app.template_usage_of(p_kind text, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'project' then (
      select jsonb_build_object('used', count(*)::integer,
                                'open', (count(*) filter (where p.state in ('open', 'in_progress')))::integer)
      from public.projects p where p.template_id = p_id)
    when 'task' then (
      select jsonb_build_object('used', count(*)::integer,
                                'open', (count(*) filter (where t.state in ('todo', 'in_progress', 'changes_requested')))::integer)
      from public.tasks t where t.template_id = p_id)
    else jsonb_build_object('used', 0, 'open', 0)
  end;
$$;
revoke all on function app.template_usage_of(text, uuid) from public, anon, authenticated;
grant execute on function app.template_usage_of(text, uuid) to service_role;
comment on function app.template_usage_of(text, uuid) is
  'V5a 6b, internal: {used, open} for a template (projects or tasks made from it; copied kinds 0).';

-- The template row of a kind: its name, or a refusal when it is not the org's or already deleted.
create function app.template_name_for_delete(p_kind text, p_id uuid, p_org uuid, p_lock boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if p_kind = 'project' then
    if p_lock then
      select t.name into v_name from public.project_templates t
      where t.id = p_id and t.org_id = p_org and t.deleted_at is null for update;
    else
      select t.name into v_name from public.project_templates t
      where t.id = p_id and t.org_id = p_org and t.deleted_at is null;
    end if;
  elsif p_kind = 'deliverable' then
    if p_lock then
      select t.name into v_name from public.deliverable_templates t
      where t.id = p_id and t.org_id = p_org and t.deleted_at is null for update;
    else
      select t.name into v_name from public.deliverable_templates t
      where t.id = p_id and t.org_id = p_org and t.deleted_at is null;
    end if;
  elsif p_kind = 'task' then
    if p_lock then
      select t.name into v_name from public.task_templates t
      where t.id = p_id and t.org_id = p_org and t.deleted_at is null for update;
    else
      select t.name into v_name from public.task_templates t
      where t.id = p_id and t.org_id = p_org and t.deleted_at is null;
    end if;
  elsif p_kind = 'stage_preset' then
    if p_lock then
      select t.name into v_name from public.stage_presets t
      where t.id = p_id and t.org_id = p_org and t.deleted_at is null for update;
    else
      select t.name into v_name from public.stage_presets t
      where t.id = p_id and t.org_id = p_org and t.deleted_at is null;
    end if;
  else
    perform app.fail('VALIDATION', 'Choose a project, deliverable or task template, or a stage preset.');
  end if;
  if v_name is null then
    perform app.fail('NOT_FOUND', 'This template is already gone.');
  end if;
  return v_name;
end;
$$;
revoke all on function app.template_name_for_delete(text, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function app.template_name_for_delete(text, uuid, uuid, boolean) to service_role;
comment on function app.template_name_for_delete(text, uuid, uuid, boolean) is
  'V5a 6b, internal: the name of a template of a kind in the org, not deleted (locked when asked); '
  'VALIDATION on an unknown kind, NOT_FOUND otherwise.';

create function public.template_usage(kind text, template_id uuid)
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
  perform app.template_name_for_delete(template_usage.kind, template_usage.template_id, v_org, false);
  return app.template_usage_of(template_usage.kind, template_usage.template_id);
end;
$$;
revoke all on function public.template_usage(text, uuid) from public, anon;
grant execute on function public.template_usage(text, uuid) to authenticated, service_role;
comment on function public.template_usage(text, uuid) is
  'V5a 6b: the Owner only. What the Delete confirm says: {used, open} (projects started from a project '
  'template, tasks following a task template; deliverable templates and stage presets 0). Reads only.';

create function public.template_delete(kind text, template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text;
  v_usage jsonb;
  v_table text;
  v_rules jsonb;
  v_copied integer := 0;
begin
  v_org := app.owner_delete_caller();
  v_name := app.template_name_for_delete(template_delete.kind, template_delete.template_id, v_org, true);
  v_usage := app.template_usage_of(template_delete.kind, template_delete.template_id);
  v_table := case template_delete.kind
    when 'project' then 'project_templates'
    when 'deliverable' then 'deliverable_templates'
    when 'task' then 'task_templates'
    else 'stage_presets' end;

  -- The history row first ("deleted the template ‹name›").
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, meta)
  values (v_org, auth.uid(), v_table, template_delete.template_id, 'deleted',
          jsonb_build_object('name', v_name, 'kind', template_delete.kind,
                             'used', v_usage -> 'used', 'open', v_usage -> 'open'));

  if template_delete.kind = 'project' then
    update public.project_templates
    set deleted_at = now(), deleted_by = auth.uid(), archived_at = coalesce(archived_at, now())
    where id = template_delete.template_id;
  elsif template_delete.kind = 'deliverable' then
    update public.deliverable_templates
    set deleted_at = now(), deleted_by = auth.uid(),
        archived_reason = case when archived_at is null then 'Deleted' else archived_reason end,
        archived_at = coalesce(archived_at, now())
    where id = template_delete.template_id;
  elsif template_delete.kind = 'task' then
    -- Nobody's reminders change: every open task that follows the template's list (its own list is
    -- empty) gets that list as its own first. The tasks trigger re-arms it with the same rules.
    select t.reminder_rules into v_rules from public.task_templates t where t.id = template_delete.template_id;
    if v_rules is not null and v_rules <> '[]'::jsonb then
      update public.tasks t
      set reminder_rules = v_rules
      where t.template_id = template_delete.template_id
        and t.state in ('todo', 'in_progress', 'changes_requested')
        and t.reminder_rules = '[]'::jsonb;
      get diagnostics v_copied = row_count;
    end if;
    update public.task_templates
    set deleted_at = now(), deleted_by = auth.uid(), archived_at = coalesce(archived_at, now())
    where id = template_delete.template_id;
  else
    update public.stage_presets
    set deleted_at = now(), deleted_by = auth.uid(), archived_at = coalesce(archived_at, now())
    where id = template_delete.template_id;
  end if;

  return v_usage || jsonb_build_object('copied', v_copied);
end;
$$;
revoke all on function public.template_delete(text, uuid) from public, anon;
grant execute on function public.template_delete(text, uuid) to authenticated, service_role;
comment on function public.template_delete(text, uuid) is
  'V5a 6b (owner 2026-10-22): the Owner only, any time, used or not. One activity_log row first '
  '(entity = the table, action deleted, meta {name, kind, used, open}); a task template''s reminder rules '
  'are copied onto every open task (todo, in progress, changes requested) that follows it with no list of '
  'its own; then the row is marked deleted (and archived). Nothing made from it changes. Returns '
  '{used, open, copied}. VALIDATION on an unknown kind, NOT_FOUND when not the org''s or already deleted.';

-- 4. Holidays: only before their date ---------------------------------------------------------------
create policy holidays_delete_before_date on public.holidays as restrictive for delete to authenticated
  using (date > app.today_ist());

create function public.holiday_delete(holiday_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_holiday public.holidays;
begin
  v_org := app.owner_delete_caller();
  select h.* into v_holiday from public.holidays h
  where h.id = holiday_delete.holiday_id and h.org_id = v_org for update;
  if v_holiday.id is null then
    perform app.fail('NOT_FOUND', 'That holiday is already gone.');
  end if;
  if v_holiday.date <= app.today_ist() then
    perform app.fail('INVALID_STATE', 'A holiday on or before today stays: it already shaped attendance and leave.');
  end if;
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, meta)
  values (v_org, auth.uid(), 'holidays', v_holiday.id, 'deleted',
          jsonb_build_object('name', v_holiday.name, 'date', v_holiday.date));
  delete from public.holidays where id = v_holiday.id;
end;
$$;
revoke all on function public.holiday_delete(uuid) from public, anon;
grant execute on function public.holiday_delete(uuid) to authenticated, service_role;
comment on function public.holiday_delete(uuid) is
  'V5a 6b: the Owner only. A holiday after today (IST) is deleted, one activity_log row first (holidays, '
  'deleted, meta {name, date}); on or before today INVALID_STATE; not the org''s NOT_FOUND.';
