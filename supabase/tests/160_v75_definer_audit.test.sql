-- v7.5 security checklist §2.3 (advisor 26 Nov 2026): the SECURITY DEFINER audit, as a catalog test.
-- A definer function runs as its owner, past RLS, so two things must hold for every one in app and
-- public, now and for every function added later:
--   1. its search_path is pinned to '' (no caller-controlled schema can shadow a name it uses);
--   2. who may EXECUTE it is an explicit decision: the API role (authenticated) only for the names
--      listed below, service_role for all, anon and PUBLIC never.
-- A new definer function the API role can call fails here until it is added to a list on purpose
-- (v6.5's app.member_back_on, granted to authenticated by default, would have failed). Internal
-- helpers revoke it (`revoke execute ... from public, anon, authenticated`).
-- Lists are by name: every overload of a listed name gets the same answer.
begin;
select plan(8);

create temporary table definer_fn on commit drop as
  select n.nspname as schema_name, p.proname as name, p.oid,
         n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
         p.proconfig, p.proacl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and p.prosecdef;

-- The app helpers the API role may run: RLS policies, views, invoker functions and triggers call
-- them as the caller (app is not exposed through the API, so they are reachable only from SQL).
create temporary table api_app (name text primary key) on commit drop;
insert into api_app values
  ('admin_client_ids'), ('attendance_require_decider'), ('attendance_require_self'), ('audit_row_change'),
  ('client_check_admin'), ('client_visible'), ('client_work_custom_fields_guard'),
  ('clients_after_insert'), ('coordinator_of'), ('create_org_settings'), ('current_member'),
  ('current_org_id'), ('deliverables_check'), ('directory_visible'), ('directory_visible_ids'),
  ('expenses_require_decider'), ('field_definition_has_values'), ('field_definition_writable'),
  ('field_definitions_guard'), ('file_reference_count'), ('file_visible'), ('files_archive_replaced'),
  ('has_permission'), ('is_approving_admin'), ('is_owner'), ('is_task_assignee'), ('is_working_day'),
  ('labelled_client_ids'), ('lock_client_for_edit'), ('member_coordinators_task_route'),
  ('members_client_admin_guard'), ('members_job_title_guard'), ('members_task_route'), ('project_visible'),
  ('push_endpoint_valid'), ('requests_to_decide_count'), ('require_client_manager'),
  ('require_team_manager'), ('seed_org_lists'), ('seed_org_stage_presets'), ('seed_org_task_types'),
  ('stage_group_label'), ('stage_groups_check'), ('task_comments_notify'), ('task_custom_fields_guard'),
  ('task_manager'), ('task_on_behalf_ok'), ('task_request_visible'), ('task_visible'),
  ('tasks_template_check');

-- The public functions the app calls through the API (each checks its caller itself).
create temporary table api_public (name text primary key) on commit drop;
insert into api_public values
  ('app_open_report'), ('attendance_ask_leave_early'), ('attendance_choose_leave_today'),
  ('attendance_decide'), ('attendance_end_day'), ('attendance_end_not_recorded_yesterday'),
  ('attendance_flag_overtime'), ('attendance_flag_overtime_today'), ('attendance_hours_today'),
  ('attendance_late_reason'), ('attendance_own_hours'), ('attendance_own_today'), ('attendance_start_day'),
  ('attendance_stay_until'), ('attendance_submit'), ('attendance_today_detail'), ('client_activate'),
  ('client_assign_admin'), ('client_close'), ('client_contact_archive'), ('client_contact_restore'),
  ('client_contact_set_primary'), ('client_create'), ('client_hand_over'), ('client_pause'),
  ('client_reactivate'), ('comp_leave_balance'), ('comp_leave_dates'), ('comp_leave_grant'),
  ('comp_leave_revoke'), ('cycle_carry_decide'), ('cycle_keep_extras'), ('cycle_start_next'),
  ('dashboard_not_noted'), ('dashboard_unreachable'), ('early_leave_decide'), ('emails_held_today'),
  ('eod_report_preview'), ('expense_claim_decide'), ('expense_claim_mark_paid'), ('expense_claim_submit'),
  ('expense_claim_withdraw'), ('extra_work_note_decide'), ('extra_work_note_submit'), ('file_fail'),
  ('holiday_delete'), ('item_add'), ('item_add_grouped'), ('item_add_revision_round'), ('item_approve'),
  ('item_cancel'), ('item_mark_done'), ('item_reject'), ('item_reopen'), ('item_save_as_template'),
  ('item_set_close_kind'), ('item_stage_add'), ('item_stage_archive'), ('item_stage_group_add'),
  ('item_stage_group_archive'), ('item_stage_group_update'), ('item_stage_tick'), ('item_stage_update'),
  ('item_stages_group'), ('item_tick_stage'), ('item_unmark_done'), ('item_update'),
  ('items_add_stage_groups'), ('items_rename'), ('items_set_planned_date'), ('items_shift_planned_dates'),
  ('leave_decide'), ('leave_owner_cancel'), ('leave_owner_edit'), ('leave_request_change'), ('leave_submit'),
  ('leave_submit_comp'), ('leave_withdraw'), ('list_item_move'), ('member_accept_invite'),
  ('member_add_freelancer'), ('member_availability'), ('member_change_email'), ('member_deactivate'),
  ('member_invite'), ('member_invite_employee'), ('member_invite_refresh'), ('member_reactivate'),
  ('member_self_status'), ('member_set_coordinator'), ('month_summary'), ('month_summary_hours'),
  ('notifications_mark_all_read'), ('notifications_mark_read'), ('onboarding_finish'),
  ('owner_digest_preview'), ('owner_digest_weekly_preview'), ('project_blueprint_add'),
  ('project_blueprint_add_to_cycle'), ('project_blueprint_archive'), ('project_blueprint_update'),
  ('project_cancel'), ('project_complete'), ('project_create'), ('project_create_grouped'), ('project_hold'),
  ('project_reopen'), ('project_resume'), ('project_resume_list'), ('project_save_as_template'),
  ('project_stage_add'), ('project_stage_archive'), ('project_stage_group_add'),
  ('project_stage_group_archive'), ('project_stage_group_update'), ('project_stage_update'),
  ('project_update'), ('push_status_own'), ('push_subscription_remove'), ('push_subscription_remove_own'),
  ('push_subscription_turn_on'), ('push_subscription_upsert'), ('push_subscriptions_tested'),
  ('push_test_claim'), ('reachability_overview'), ('session_login'), ('session_sign_out'),
  ('task_acknowledge'), ('task_cancel'), ('task_counts'), ('task_create'), ('task_hold'), ('task_mark_read'),
  ('task_remind'), ('task_reopen'), ('task_request_convert'), ('task_request_create'),
  ('task_request_decline'), ('task_request_withdraw'), ('task_resume'), ('task_review'),
  ('task_set_approver'), ('task_stage_move'), ('task_start'), ('task_submit_done'), ('task_type_move'),
  ('task_unread_counts'), ('task_update_assignment'), ('template_delete'), ('template_usage'),
  ('unused_delete'), ('unused_usage');

select cmp_ok((select count(*) from definer_fn), '>=', 300::bigint,
  'the audit saw the definer functions');

select is(
  (select coalesce(array_agg(signature order by signature), '{}') from definer_fn
    where not coalesce(proconfig, '{}') @> array['search_path=""']),
  '{}'::text[],
  'every definer function in app and public pins search_path to empty');

select is(
  (select coalesce(array_agg(signature order by signature), '{}') from definer_fn
    where has_function_privilege('anon', oid, 'execute')
       or exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', 0::oid))) a
                   where a.grantee = 0 and a.privilege_type = 'EXECUTE')),
  '{}'::text[],
  'no definer function is executable by anon or PUBLIC');

select is(
  (select coalesce(array_agg(signature order by signature), '{}') from definer_fn
    where not has_function_privilege('service_role', oid, 'execute')),
  '{}'::text[],
  'service_role may execute every definer function');

select set_eq(
  $$select distinct name from definer_fn
     where schema_name = 'app' and has_function_privilege('authenticated', oid, 'execute')$$,
  $$select name from api_app$$,
  'the app definer functions the API role may run are exactly the api_app list');

select set_eq(
  $$select distinct name from definer_fn
     where schema_name = 'public' and has_function_privilege('authenticated', oid, 'execute')$$,
  $$select name from api_public$$,
  'the public definer functions the API role may run are exactly the api_public list');

-- Every overload of a listed name answers the same (no service-only twin of an API function).
select is(
  (select coalesce(array_agg(signature order by signature), '{}') from definer_fn f
    where ((f.schema_name = 'app' and f.name in (select name from api_app))
        or (f.schema_name = 'public' and f.name in (select name from api_public)))
      and not has_function_privilege('authenticated', f.oid, 'execute')),
  '{}'::text[],
  'every overload of a listed function is executable by the API role');

-- The internal jobs stay off the API: a sample the job runners rely on.
select is(
  (select coalesce(array_agg(signature order by signature), '{}') from definer_fn
    where schema_name = 'public'
      and name in ('bootstrap_owner', 'email_claim', 'push_claim', 'file_complete', 'digest_daily')
      and has_function_privilege('authenticated', oid, 'execute')),
  '{}'::text[],
  'the job and service functions are not executable by the API role');

select * from finish();
rollback;
