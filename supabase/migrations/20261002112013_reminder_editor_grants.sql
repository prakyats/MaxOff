-- 5.3, the reminder editor (owner decisions 2026-10-02, PROGRESS "Slice 6c"). Expand-only: one
-- column grant back, nothing else.
--
-- Settings → Templates edits a template's reminders with the same editor as a task's, a task
-- type's and the organisation's. Migration phase4c_review_fixes (4C review S1) revoked the API
-- insert and update of `task_templates.reminder_rules` until this editor existed ("nothing writes
-- it before 5.3"); it is granted back. Who writes a template is unchanged: the template policies
-- (templates.manage; an Admin their own, the Owner any) and app.task_templates_guard(). What is
-- written is checked by `task_templates_reminder_rules_valid` (migration task_reminders,
-- app.reminder_rules_valid: up to 5 rules, whole numbers, at most 60 days, no two the same): an
-- invalid list is refused with 23514. A task started from a template follows the template's list
-- through tasks.template_id (app.task_reminder_rules) while it has none of its own; nothing is
-- copied onto the task.
--
-- The other two levels need no grant: `task_types.default_reminders` (the Owner's, settings.manage
-- and app.task_types_owner_guard()) and `org_settings.default_task_reminders` (settings.manage)
-- were in their tables' update grants from the start (tasks_schema, phase1_review_hardening).

grant insert (reminder_rules), update (reminder_rules) on public.task_templates to authenticated;

comment on column public.task_templates.reminder_rules is
  'The template''s reminders (5.3): a reminder rule list (app.reminder_rules_valid); ''[]'' = its '
  'type''s default. Edited in Settings → Templates by whoever may edit the template; a task started '
  'from it follows it through tasks.template_id while the task has no list of its own.';
