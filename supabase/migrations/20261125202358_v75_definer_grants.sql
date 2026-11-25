-- v7.5 definer audit (pgTAP 175; docs/handoff/v7.5-plan.md §2.3; DATA-MODEL §0a). Expand-only:
-- grants change, nothing is dropped, renamed or rewritten.
--
-- 1. Thirteen app helpers that no policy, view, invoker function, column default or check calls as
--    the caller: only security definer functions use them, and those run as the owner. The API
--    role loses EXECUTE (lock_client_for_edit returns a whole clients row past RLS).
-- 2. The sixteen security definer trigger functions. A trigger function is never called directly
--    and EXECUTE is checked only at create trigger, so this is a tidy-up: nothing changes when a
--    trigger fires.
-- service_role keeps EXECUTE on all of them.
revoke execute on function
  app.admin_client_ids(),
  app.attendance_require_decider(),
  app.directory_visible(p_member_id uuid),
  app.expenses_require_decider(),
  app.field_definition_has_values(def public.field_definitions),
  app.is_approving_admin(p_task_id uuid),
  app.is_working_day(d date),
  app.lock_client_for_edit(p_client_id uuid),
  app.project_visible(p_project_id uuid),
  app.push_endpoint_valid(p_endpoint text),
  app.require_client_manager(),
  app.require_team_manager(),
  app.stage_group_label(p_label text),
  app.audit_row_change(),
  app.client_work_custom_fields_guard(),
  app.clients_after_insert(),
  app.create_org_settings(),
  app.field_definitions_guard(),
  app.files_archive_replaced(),
  app.member_coordinators_task_route(),
  app.members_client_admin_guard(),
  app.members_job_title_guard(),
  app.members_task_route(),
  app.seed_org_lists(),
  app.seed_org_stage_presets(),
  app.seed_org_task_types(),
  app.task_comments_notify(),
  app.task_custom_fields_guard(),
  app.tasks_template_check()
from public, anon, authenticated;
