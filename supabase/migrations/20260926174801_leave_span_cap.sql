-- Phase 2 review, fix 4 (2026-09-26): a leave request covers at most 365 days.
--
-- app.leave_validate() checked order and the past only, so "2026-09-27 to 9999-12-31" was
-- accepted: while submitted it blocked every further request of that person (leave_overlaps),
-- and approved by mistake it would have derived a leave day for years. The cap is the Owner's
-- (owner decision 2026-09-26): 365 days, so a 26-week maternity leave is never refused. Every
-- caller shares the rule: leave_submit, leave_request_change and leave_owner_edit. The form
-- mirrors it (modules/leave/domain, LEAVE_MAX_DAYS).

create or replace function app.leave_validate(p_type public.leave_type, p_start date, p_end date, p_min_start date)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_type is null or p_start is null or p_end is null then
    perform app.fail('VALIDATION', 'Choose the leave type and its dates.');
  end if;
  if p_end < p_start then
    perform app.fail('VALIDATION', 'The end date is before the start date.');
  end if;
  if p_end - p_start + 1 > 365 then
    perform app.fail('VALIDATION', 'Leave can cover at most 365 days.');
  end if;
  if p_type = 'half_day' and p_start <> p_end then
    perform app.fail('VALIDATION', 'A half day is a single date.');
  end if;
  if p_min_start is not null and p_start < p_min_start then
    perform app.fail('VALIDATION', 'Leave cannot start in the past.');
  end if;
end;
$$;

comment on function app.leave_validate(public.leave_type, date, date, date) is
  'The date rules every leave writer shares (WORKFLOWS §2): type and dates present, end not '
  'before start, at most 365 days (phase 2 review, 2026-09-26), a half day a single date, and '
  'when p_min_start is given, no start before it.';
