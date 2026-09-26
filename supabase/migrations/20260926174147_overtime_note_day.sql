-- Phase 2 review, fix 1 (2026-09-26): the overtime note written in the Log out confirmation lands
-- on the day the logout itself will land on.
--
-- Before, the app looked up the caller's day for today's IST date only, so someone who stayed past
-- midnight without navigating (no touch, so no row for the new date) was refused at 00:10 with
-- "There is no attendance day to add a note to yet" and had to clear the note to leave, while
-- app.attendance_logout() then correctly put the logout on yesterday's day. The rule now lives in
-- one place: today's own day, else yesterday's with a login and no logout, exactly the day
-- app.attendance_logout() picks (2.5). Keep the two in step.

create or replace function public.attendance_flag_overtime_today(reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_day_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  select d.id into v_day_id
  from public.attendance_days d
  where d.member_id = v_caller and d.work_date = v_today;
  if v_day_id is null then
    -- Worked past midnight: the note belongs with the logout, on yesterday's still-open day.
    select d.id into v_day_id
    from public.attendance_days d
    where d.member_id = v_caller and d.work_date = v_today - 1
      and d.first_login_at is not null and d.last_logout_at is null;
  end if;
  if v_day_id is null then
    perform app.fail('INVALID_STATE', 'There is no attendance day to add a note to yet.');
  end if;

  perform public.attendance_flag_overtime(v_day_id, reason);
  return v_day_id;
end;
$$;

comment on function public.attendance_flag_overtime_today(text) is
  'attendance.self. The Log out note: attendance_flag_overtime() on the caller''s day for today, '
  'or on yesterday''s when there is none today and yesterday has a login and no logout (the day '
  'app.attendance_logout() will pick; keep the two rules in step). INVALID_STATE when neither '
  'exists (the joining day). Returns the day id. Audit action: overtime_flagged (the inner call).';

revoke all on function public.attendance_flag_overtime_today(text) from public, anon;
grant execute on function public.attendance_flag_overtime_today(text) to authenticated, service_role;
