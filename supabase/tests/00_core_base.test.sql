-- pgTAP for the 0.2 base migration. Run with `pnpm db:test` (needs the local stack running).
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- Extensions and schema ------------------------------------------------------------------
select has_extension('pg_cron', 'pg_cron is installed');
select has_extension('pg_net', 'pg_net is installed');
select has_schema('app', 'the app schema exists');
select has_function('app', 'set_updated_at', array[]::text[], 'app.set_updated_at() exists');
select has_function('app', 'to_ist_date', array['timestamp with time zone'], 'app.to_ist_date(timestamptz) exists');
select has_function('app', 'today_ist', array[]::text[], 'app.today_ist() exists');
select has_function('app', 'fail', array['text', 'text'], 'app.fail(text, text) exists');

-- IST boundaries (IST = UTC + 05:30, so the IST day starts at 18:30 UTC the evening before)
select is(app.to_ist_date('2026-09-21 18:29:59+00'), date '2026-09-21', '18:29:59 UTC is still 21 Sep in IST');
select is(app.to_ist_date('2026-09-21 18:30:00+00'), date '2026-09-22', '18:30:00 UTC is already 22 Sep in IST');
select is(app.to_ist_date('2026-09-30 18:30:00+00'), date '2026-10-01', 'the month rolls over at 18:30 UTC');
select is(app.to_ist_date('2026-12-31 18:29:59+00'), date '2026-12-31', 'the year holds until 18:29:59 UTC');
select is(app.to_ist_date('2026-12-31 18:30:00+00'), date '2027-01-01', 'the year rolls over at 18:30 UTC');
select is(app.to_ist_date('2026-09-21 23:59:59+05:30'), date '2026-09-21', 'an IST-offset literal keeps its date');
select is(app.to_ist_date('2026-09-21 00:00:00+05:30'), date '2026-09-21', 'IST midnight belongs to the new day');
select is(app.to_ist_date(null), null, 'null in, null out');
select is(app.today_ist(), app.to_ist_date(now()), 'today_ist() follows to_ist_date(now())');

-- updated_at trigger ---------------------------------------------------------------------
create temporary table t_updated (
  id int primary key,
  name text,
  updated_at timestamptz not null default '2000-01-01 00:00:00+00'
);
create trigger set_updated_at before update on t_updated
  for each row execute function app.set_updated_at();
insert into t_updated (id, name) values (1, 'a');
select is((select updated_at from t_updated where id = 1), '2000-01-01 00:00:00+00'::timestamptz,
  'insert leaves the default alone');
update t_updated set name = 'b' where id = 1;
select is((select updated_at from t_updated where id = 1), now(),
  'update stamps updated_at with the transaction time');
update t_updated set name = 'c', updated_at = '1999-01-01 00:00:00+00' where id = 1;
select is((select updated_at from t_updated where id = 1), now(),
  'a manual updated_at value is overridden');

-- app.fail -------------------------------------------------------------------------------
select throws_ok(
  $$ select app.fail('INVALID_STATE', 'This task is already completed') $$,
  'P0001', 'INVALID_STATE', 'fail raises P0001 with the code as the message');
select throws_ok(
  $$ select app.fail('FORBIDDEN') $$,
  'P0001', 'FORBIDDEN', 'fail works without a detail');

create function pg_temp.fail_detail() returns text language plpgsql as $$
declare d text;
begin
  perform app.fail('INVALID_STATE', 'This task is already completed');
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end;
$$;
select is(pg_temp.fail_detail(), 'This task is already completed',
  'fail passes the human reason as the error detail');

-- Grants ---------------------------------------------------------------------------------
select ok(has_schema_privilege('authenticated', 'app', 'usage'), 'authenticated may use app');
select ok(has_schema_privilege('service_role', 'app', 'usage'), 'service_role may use app');
select ok(not has_schema_privilege('anon', 'app', 'usage'), 'anon may not use app');
-- Self-enforcing for every function ever added to `app` (DATA-MODEL §0a): authenticated and
-- service_role may execute, anon and public may not.
-- Exception (2.1): internal writers and cross-member readers that only security definer
-- functions call (they run as the owner and need no grant). The API role must NOT hold them.
create temporary table app_internal (name text primary key);
insert into app_internal values
  ('attendance_event'), ('attendance_apply_leave'), ('attendance_release_leave'),
  ('leave_covering'), ('leave_overlaps'),
  -- 2.2
  ('leave_supersede_gate'), ('leave_clash'), ('leave_clash_label'),
  -- 2.5: the jobs (pg_cron runs them as postgres) and the day opener they share with touch
  ('attendance_open_day'), ('absent_check'),
  -- 3b.1: the 00:00 end-not-recorded job and the 20:30 reminder list (service_role only)
  ('end_not_recorded'), ('end_day_reminder_due'),
  -- 3b.2: the settle between a comp leave request and its credits
  ('comp_credit_settle'),
  -- 3b.3: a claim row locked inside the expense functions
  ('expense_claim_lock'),
  -- 3b review: the org's End day cutoff (read inside the attendance functions) and the holidays
  -- trigger that gives comp leave credits back
  ('end_day_cutoff'), ('holiday_release_comp'),
  -- 3c review: the oldest-first draw the Owner's comp leave routes share
  ('comp_credit_draw'),
  -- 4A: the freelancer and task helpers the transition functions call (service_role only)
  ('coordinator_eligible'), ('next_position'), ('task_require_creator'), ('task_lock'),
  ('task_actor'), ('task_assignee_check'), ('task_check_fields'), ('task_record_warnings'),
  -- 4C: a task request row locked inside the request functions
  ('task_request_lock'),
  -- 5.1: app.notify() and the helpers the retrofitted transition functions and jobs call
  ('notify'), ('org_owner_id'), ('member_name'), ('notify_date'), ('notify_when'), ('notify_span'),
  ('task_people'), ('notify_leave_owner'), ('notify_leave_member'), ('coordinator_link'),
  ('end_day_reminder'),
  -- 5.1 review (M1): a comment's recipients kept to the people who can still see the task
  ('task_visible_to'),
  -- Phase 4 review: the reminder rules' bounds task_create and task_update_assignment share, and the
  -- route's rule and move (Kickoff 4 decision 34)
  ('task_check_reminders'), ('task_approver_on_task'), ('task_skip_admin_step'),
  -- 5.2: the dispatcher's backoff (its functions are public, service_role only, for PostgREST)
  ('push_backoff'),
  -- 5A review fixes: the local-only switches (app.local_flags), read inside definer functions
  ('local_flag'),
  -- 5.3: the reminders (service_role only; reminder_rules_valid is the CHECK constraints', so it
  -- keeps the API grant)
  ('reminder_offset'), ('task_reminder_rules'), ('task_arm_reminders'), ('tasks_reminders_trigger'),
  ('reminder_paused'), ('reminder_resume_at'), ('reminder_in'), ('reminders_tick'), ('reminders_backfill'),
  -- 5.3 (owner 2026-10-03): the staging dry run's acknowledgement counts
  ('reminders_backfill_ack_preview'),
  -- 5B slice 7: the Owner digest's payload and its plain-text lines (digest_daily and
  -- owner_digest_preview are public: the job's and the Owner's)
  ('owner_digest_payload'), ('owner_digest_text'),
  -- 5B 5.4: reachability's classification, its live list and the alert's words (reachability_check
  -- and reachability_overview are public: the job's and the Settings screen's)
  ('reachability_state'), ('reachability_live'), ('reachability_reason'),
  -- 5B 5.5: why a member's notifications band shows (push_status_own is public: the layout's read)
  ('push_band'),
  -- 5.5 owner answers (2026-10-06): the subscribe behind push_subscription_upsert (automatic) and
  -- push_subscription_turn_on (a tap), which differ only in whether a removed device comes back
  ('push_subscription_save'),
  -- 6.5: the end-of-day report's builder, its zero check, its notification line and its job, and
  -- the weekly digest's builder, zero check and lines (eod_report_preview, digest_weekly and
  -- owner_digest_weekly_preview are public: the Owner's reads and the job's)
  ('eod_report_payload'), ('eod_report_zero'), ('eod_report_text'), ('eod_report'),
  ('digest_weekly_payload'), ('digest_weekly_zero'), ('digest_weekly_text');
  -- 3c.1 (contract migration): attendance_logout and logout_not_recorded are gone with the 2.x gate.
select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and p.proname not in (select name from app_internal)
      and (   has_function_privilege('anon', p.oid, 'execute')
           or not has_function_privilege('authenticated', p.oid, 'execute')
           or not has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint,
  'every app function: authenticated and service_role may execute, anon may not');
select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and p.proname in (select name from app_internal)
      and (   has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute')
           or not has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint,
  'the internal helpers: service_role only, never the API role');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in (select name from app_internal)), 60::bigint,
  'the internal helper list matches what exists');
select cmp_ok((select count(*) from pg_proc where pronamespace = 'app'::regnamespace), '>=', 4::bigint,
  'the grant check saw the app functions');

select * from finish();
rollback;
