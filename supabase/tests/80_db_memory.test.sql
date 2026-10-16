-- P2 item 5 (migration p2_db_memory; ARCHITECTURE §19): app.cron_history_trim() keeps pg_cron's own
-- run log (cron.job_run_details) to 7 days, in batches; only the service role and pg_cron may call it; the daily job
-- cron_history_trim runs it at 03:45 IST. client_work_alerts runs only in its 08:00 to 08:25 IST
-- send window and digest_weekly only from 07:30 IST to 00:25 IST, the runs their functions act on;
-- reminders_tick and eod_report keep every 5 minutes. The supabase_realtime publication is unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- The function and who may call it.
select has_function('app', 'cron_history_trim', array['timestamp with time zone', 'integer'],
  'app.cron_history_trim(timestamptz, integer) exists');
select ok(not has_function_privilege('anon', 'app.cron_history_trim(timestamptz, integer)', 'execute'),
  'anon cannot call it');
select ok(not has_function_privilege('authenticated', 'app.cron_history_trim(timestamptz, integer)', 'execute'),
  'a signed-in member cannot call it');
select ok(has_function_privilege('service_role', 'app.cron_history_trim(timestamptz, integer)', 'execute'),
  'the service role may call it (as every internal app helper; pg_cron runs it as postgres)');
select is((select prosecdef from pg_proc where oid = 'app.cron_history_trim(timestamptz, integer)'::regprocedure),
  true, 'it runs as its owner (security definer)');

-- The run log fixtures: r(runid, ended this long ago, started this long ago).
create function pg_temp.r(p_runid bigint, p_end interval, p_start interval) returns void language sql as $$
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message,
                                    start_time, end_time)
  values (1, p_runid, 1, 'postgres', 'postgres', 'select 1', 'succeeded', '1 row',
          now() - p_start, now() - p_end);
$$;
create function pg_temp.kept(p_runid bigint) returns boolean language sql stable as $$
  select exists (select 1 from cron.job_run_details where runid = p_runid);
$$;
select pg_temp.r(980000001, interval '30 days', interval '30 days');
select pg_temp.r(980000002, interval '8 days', interval '8 days');
select pg_temp.r(980000003, interval '7 days 1 minute', interval '7 days 2 minutes');
select pg_temp.r(980000004, interval '10 days', interval '10 days');
select pg_temp.r(980000005, interval '9 days', interval '9 days');
select pg_temp.r(980000006, interval '6 days 23 hours', interval '6 days 23 hours');
select pg_temp.r(980000007, interval '1 hour', interval '1 hour');
-- A run still going (no end_time) that started 8 days ago, and one that started an hour ago.
insert into cron.job_run_details (jobid, runid, database, username, command, status, start_time)
values (1, 980000008, 'postgres', 'postgres', 'select 1', 'running', now() - interval '8 days'),
       (1, 980000009, 'postgres', 'postgres', 'select 1', 'running', now() - interval '1 hour');
-- A row with neither time (pg_cron's "starting").
insert into cron.job_run_details (jobid, runid, database, username, command, status)
values (1, 980000010, 'postgres', 'postgres', 'select 1', 'starting');

select throws_ok($$ select app.cron_history_trim(now(), 0) $$, 'P0001',
  'cron_history_trim: the batch size must be at least 1, not 0', 'a batch size below 1 is refused');

-- Batches of 2: six rows are older than 7 days, so the loop runs four statements (2, 2, 2, 0).
select is(app.cron_history_trim(now(), 2), 6, 'in batches of 2 it deletes all six rows older than 7 days');
select ok(not pg_temp.kept(980000001) and not pg_temp.kept(980000002) and not pg_temp.kept(980000003)
          and not pg_temp.kept(980000004) and not pg_temp.kept(980000005),
  'the finished runs older than 7 days are gone');
select ok(not pg_temp.kept(980000008), 'a run still going that started more than 7 days ago is gone');
select ok(pg_temp.kept(980000006) and pg_temp.kept(980000007), 'the runs of the last 7 days stay');
select ok(pg_temp.kept(980000009), 'a run still going that started an hour ago stays');
select ok(pg_temp.kept(980000010), 'a row with neither time stays');
select is(app.cron_history_trim(now(), 2), 0, 'a second run deletes nothing more');
-- Run a day later: the 6 days 23 hours row is now older than 7 days.
select is(app.cron_history_trim(now() + interval '1 day'), 1, 'a day later the next old row goes (default batch)');

-- The schedules.
select results_eq(
  $$ select jobname::text, schedule::text, command::text, active from cron.job where jobname = 'cron_history_trim' $$,
  $$ values ('cron_history_trim', '15 22 * * *', 'select app.cron_history_trim(now())', true) $$,
  'cron_history_trim runs daily at 03:45 IST (22:15 UTC), after notifications_remove_read');
select is((select schedule || ' ' || command from cron.job where jobname = 'client_work_alerts'),
  '30-55/5 2 * * * select app.client_work_alerts()',
  'client_work_alerts runs every 5 minutes from 08:00 to 08:25 IST, its whole send window (Q13 (a))');
select is((select schedule || ' ' || command from cron.job where jobname = 'digest_weekly'),
  '*/5 2-18 * * * select public.digest_weekly(now())',
  'digest_weekly runs every 5 minutes from 07:30 IST to 00:25 IST, every minute it can send at');
select results_eq(
  $$ select jobname::text, schedule::text from cron.job where jobname in ('reminders_tick', 'eod_report') order by 1 $$,
  $$ values ('eod_report', '*/5 * * * *'), ('reminders_tick', '*/5 * * * *') $$,
  'reminders_tick and eod_report still run every 5 minutes, all day');
-- The two send windows the narrowed schedules rely on.
select ok(app.client_work_send_window('2026-10-16 02:30+00') and app.client_work_send_window('2026-10-16 02:55+00')
          and not app.client_work_send_window('2026-10-16 02:25+00')
          and not app.client_work_send_window('2026-10-16 03:00+00'),
  'the client-work send window is 08:00 to before 08:30 IST: the first and last scheduled runs are in it');
select is(
  (select string_agg(tablename::text, ', ' order by tablename::text collate "C")
   from pg_publication_tables where pubname = 'supabase_realtime'),
  'attendance_days, leave_requests, notifications, project_items, task_assignees, tasks',
  'the supabase_realtime publication is unchanged: every table in it is subscribed by the app');

select * from finish();
rollback;
