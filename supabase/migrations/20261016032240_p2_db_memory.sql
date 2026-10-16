-- P2 item 5, "ease the DB's memory" (owner 2026-10-15: "make the app fast for free"; ADVISOR on #89,
-- 15 Oct 23:55 IST: system logs only, no business data, nothing by hand on production).
-- The production database is a Free-plan instance that swaps (ARCHITECTURE §19, unit P). Three
-- changes, all expand-only, none touching a business table:
--
-- 1. pg_cron's own run log, cron.job_run_details, grows by about 1,200 rows a day (four jobs every
--    five minutes plus the hourly and nightly ones) and pg_cron never trims it. A new internal
--    function app.cron_history_trim() deletes the rows older than 7 days in batches, and a new daily
--    job, cron_history_trim, runs it at 03:45 IST (22:15 UTC), after notifications_remove_read. It is
--    pg_cron's system log, not business data: activity_log and every business table are untouched,
--    and WORKFLOWS §8 "each run is recorded in cron.job_run_details" still holds for the last week.
--
-- 2. Two five-minute jobs skip only the runs their own function provably ignores (the WORKFLOWS §8
--    timing is unchanged; push, reminders and the attendance rules are not touched):
--    - client_work_alerts: */5 * * * * -> 30-55/5 2 * * * (08:00 to 08:25 IST). The function returns
--      0 before reading anything outside app.client_work_send_window (08:00 to before 08:30 IST,
--      Q13 (a), migration client_work_morning_window), so the 282 other runs a day did nothing; the
--      six runs inside the window are the same six as before, and a missed morning still waits for
--      the next morning, as documented.
--    - digest_weekly: */5 * * * * -> */5 2-18 * * * (07:30 IST to 00:25 IST the next day). The
--      function skips every organisation before 08:00 IST (migration digest_since_last), so the runs
--      from 00:30 to 07:25 IST did nothing; every run from 08:00 to 23:55 IST is kept, so the
--      "08:00 or straight after the cutoff saves the last report, whichever is later" rule and the
--      same-day catch-up after an outage behave exactly as before.
--    Unchanged: reminders_tick (push and reminders, any minute of the day), eod_report (acts at the
--    Owner-editable End-day cutoff, 00:00 to 11:59 IST, and catches up any later minute after an
--    outage), reachability_check, and the nightly jobs. cron.schedule replaces a job of the same name.
--
-- 3. The supabase_realtime publication is unchanged: every table in it is subscribed by the app
--    (notifications by the live bell; tasks, task_assignees, attendance_days, leave_requests and
--    project_items by LIVE_DASHBOARD_TABLES in core/notifications/live-rules.ts), so none is removed.
--
-- Append-only: never edit once applied.

-- 1. pg_cron's run log, kept to 7 days ------------------------------------------------------------------
create function app.cron_history_trim(p_now timestamptz default now(), p_batch integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before timestamptz := p_now - interval '7 days';
  v_deleted integer;
  v_total integer := 0;
begin
  if p_batch is null or p_batch < 1 then
    raise exception 'cron_history_trim: the batch size must be at least 1, not %', p_batch;
  end if;
  -- One batch per statement (by runid, the table's only index), so no single delete holds many rows.
  -- A run still going (no end_time) is judged by its start; a row with neither time is kept.
  loop
    delete from cron.job_run_details d
    where d.runid in (
      select r.runid from cron.job_run_details r
      where coalesce(r.end_time, r.start_time) < v_before
      order by r.runid
      limit p_batch
    );
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    exit when v_deleted < p_batch;
  end loop;
  return v_total;
end;
$$;

revoke all on function app.cron_history_trim(timestamptz, integer) from public, anon, authenticated;
grant execute on function app.cron_history_trim(timestamptz, integer) to service_role;

comment on function app.cron_history_trim(timestamptz, integer) is
  'P2 item 5 (owner 2026-10-15; migration p2_db_memory): deletes pg_cron''s own run log rows '
  '(cron.job_run_details) older than 7 days before p_now, p_batch rows per statement, and returns how '
  'many it deleted. System log only: no business table, never activity_log. Run daily by the pg_cron '
  'job cron_history_trim (03:45 IST); service_role only, as every internal app helper.';

select cron.schedule('cron_history_trim', '15 22 * * *', $$select app.cron_history_trim(now())$$);

-- 2. Two five-minute jobs run only when their function can act ------------------------------------------
-- To restore the earlier schedules (a new migration):
--   select cron.schedule('client_work_alerts', '*/5 * * * *', $$select app.client_work_alerts()$$);
--   select cron.schedule('digest_weekly', '*/5 * * * *', $$select public.digest_weekly(now())$$);
select cron.schedule('client_work_alerts', '30-55/5 2 * * *', $$select app.client_work_alerts()$$);
select cron.schedule('digest_weekly', '*/5 2-18 * * *', $$select public.digest_weekly(now())$$);
