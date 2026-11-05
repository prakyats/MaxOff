-- v2.0 X3 step 3, /leave and its tabs (2026-11-06; DATA-MODEL §1 "v2.0 X3"; the advisor's standing
-- rule on #89: read-only, security-invoker folds equal to the reads they replace): /leave and
-- /leave/attendance read the caller's comp leave twice (the balance and the dates), and
-- /leave/attendance and /leave/extra-work read the working-day rule twice (the weekly off days and
-- the holidays), so each first wave was seven. Two new functions, nothing existing changes.
--
-- public.own_comp_leave() → jsonb {balance, balance_refused, dates, dates_refused}:
--   balance          comp_leave_balance(auth.uid())'s one row {available_days, use_by}, as
--                    getCompBalance(own id) reads it, or null with
--   balance_refused  the code that function refuses the caller with (app.fail: UNAUTHENTICATED,
--                    FORBIDDEN), never raised here, so the dates still answer; null otherwise;
--   dates            comp_leave_dates()'s rows {work_date, available_days} in its own order
--                    (listCompDates), or null with
--   dates_refused    the code it refuses the caller with (app.attendance_require_self: the Owner,
--                    a freelancer, an inactive member), never raised here; null otherwise.
-- Only an app.fail refusal (SQLSTATE P0001) is caught; any other error fails the call as the reads
-- did. Both functions are called unchanged: their own checks decide.
--
-- public.working_day_rule(from_date, to_date) → jsonb {weekly_off_days, holidays}:
--   weekly_off_days  org_settings.weekly_off_days of the row RLS shows (getWorkingDayRule), or null;
--   holidays         the holiday dates in [from_date, to_date], by date.
-- At most 62 days, else VALIDATION, so it can never become an unbounded read.
--
-- Both: security invoker (every policy decides, as for the API reads), stable, empty search_path,
-- execute for authenticated only. No money; no attendance decision (reads only).

create function public.own_comp_leave()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_balance jsonb := null;
  v_refused text := null;
  v_dates jsonb := null;
  v_dates_refused text := null;
begin
  begin
    select to_jsonb(b) into v_balance from public.comp_leave_balance((select auth.uid())) b limit 1;
  exception when sqlstate 'P0001' then
    v_refused := sqlerrm;
  end;
  begin
    select coalesce(jsonb_agg(to_jsonb(d) - 'ordinality' order by d.ordinality), '[]'::jsonb) into v_dates
    from public.comp_leave_dates() with ordinality as d;
  exception when sqlstate 'P0001' then
    v_dates_refused := sqlerrm;
  end;
  return jsonb_build_object('balance', v_balance, 'balance_refused', v_refused,
                            'dates', v_dates, 'dates_refused', v_dates_refused);
end;
$$;

comment on function public.own_comp_leave() is
  'v2.0 X3: the caller''s comp leave in one read: balance (comp_leave_balance(auth.uid())''s row, or '
  'null with balance_refused, the app.fail code it refused with, never raised here) and dates '
  '(comp_leave_dates()''s rows in its order, or null with dates_refused). Security invoker; both '
  'functions called unchanged.';

revoke all on function public.own_comp_leave() from public, anon, service_role;
grant execute on function public.own_comp_leave() to authenticated;

create function public.working_day_rule(from_date date, to_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if from_date is null or to_date is null or to_date < from_date or to_date - from_date > 61 then
    perform app.fail('VALIDATION', 'The window runs from_date to to_date, at most 62 days.');
  end if;
  return jsonb_build_object(
    'weekly_off_days', (select to_jsonb(s.weekly_off_days) from public.org_settings s limit 1),
    'holidays', coalesce((
      select jsonb_agg(h.date order by h.date)
      from public.holidays h
      where h.date between from_date and to_date), '[]'::jsonb)
  );
end;
$$;

comment on function public.working_day_rule(date, date) is
  'v2.0 X3: the note dialog''s working-day rule in one read: weekly_off_days (org_settings, as RLS '
  'shows it, or null) and the holiday dates in [from_date, to_date] by date (at most 62 days, else '
  'VALIDATION). Security invoker.';

revoke all on function public.working_day_rule(date, date) from public, anon, service_role;
grant execute on function public.working_day_rule(date, date) to authenticated;
