-- Kickoff 6 decision 24, amended by the owner (2026-10-08, unit 6B2): the red "End of day not
-- recorded" count on the Owner's Today card counts **yesterday's** days with a Start day and no End
-- day. It shows from the End-day cutoff (org_settings.end_day_cutoff_time, default 05:00 IST:
-- before it a late End day for yesterday is still allowed) through the rest of today; a person
-- drops off once the Owner has decided that day (reviewed it: approved, or corrected it). Tapping
-- the count opens the people board filtered to those people with yesterday's state.
--
-- attendance_today_detail() reads today only, and the 00:00 flag lands on yesterday's day, so the
-- card's count read today's rows and was never above zero. A new read, expand-only (the old
-- function is unchanged; a second signature of it would make a call without arguments ambiguous):
-- * app.attendance_unended_yesterday(p_org, p_now): the rule at a moment, for the job-style tests.
-- * public.attendance_end_not_recorded_yesterday(): the Owner's read at now(),
--   attendance.view_all (FORBIDDEN otherwise), the same columns as attendance_today_detail() so
--   the board draws the rows as it draws today's.

create function app.attendance_unended_yesterday(p_org uuid, p_now timestamptz)
returns table (
  member_id uuid, full_name text, job_title text, started boolean, day_id uuid,
  state public.attendance_state, final_status public.day_status, submitted_choice public.attendance_choice,
  proposed_by_system boolean, overtime_flag boolean, is_day_off boolean,
  on_leave boolean, leave_type public.leave_type,
  started_at timestamptz, ended_at timestamptz, end_not_recorded boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_yesterday date := app.to_ist_date(p_now) - 1;
begin
  -- Until the cutoff yesterday's day can still be ended: nobody is counted yet.
  if app.end_day_late_allowed(p_now, app.end_day_cutoff(p_org)) then
    return;
  end if;

  return query
  select m.id, m.full_name, j.name,
         true,
         d.id, d.state, d.final_status, d.submitted_choice,
         d.proposed_by_system, d.overtime_flag, d.is_day_off,
         l.id is not null, l.type,
         d.started_at, d.ended_at, true
  from public.members m
  join public.attendance_days d on d.member_id = m.id and d.work_date = v_yesterday
  left join public.list_items j on j.id = m.job_title_id
  left join lateral app.leave_covering(m.id, v_yesterday) l on true
  where m.org_id = p_org
    and m.status = 'active'
    and m.engagement = 'permanent'
    and exists (select 1 from public.role_permissions rp
                where rp.role = m.role and rp.permission = 'attendance.self')
    and d.started_at is not null
    and d.ended_at is null
    -- Decided by the Owner (reviewed and approved, or corrected): no longer a problem to show.
    and d.state not in ('approved', 'corrected')
  order by m.full_name, m.id;
end;
$$;

revoke all on function app.attendance_unended_yesterday(uuid, timestamptz) from public, anon, authenticated;
grant execute on function app.attendance_unended_yesterday(uuid, timestamptz) to service_role;

comment on function app.attendance_unended_yesterday(uuid, timestamptz) is
  'Internal (kickoff 6 decision 24, amended 2026-10-08). At p_now, once the IST time of day has '
  'reached the organisation''s end_day_cutoff_time (none before it): every active permanent member '
  'who marks attendance whose day for yesterday (IST) has a Start day and no End day and is not '
  'decided by the Owner (state approved or corrected), with that day''s columns in '
  'attendance_today_detail()''s shape (started and end_not_recorded true).';

create function public.attendance_end_not_recorded_yesterday()
returns table (
  member_id uuid, full_name text, job_title text, started boolean, day_id uuid,
  state public.attendance_state, final_status public.day_status, submitted_choice public.attendance_choice,
  proposed_by_system boolean, overtime_flag boolean, is_day_off boolean,
  on_leave boolean, leave_type public.leave_type,
  started_at timestamptz, ended_at timestamptz, end_not_recorded boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select m.org_id into v_org from app.current_member() m;
  if v_org is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'Only the Owner sees everyone''s attendance.');
  end if;
  return query select * from app.attendance_unended_yesterday(v_org, now());
end;
$$;

revoke all on function public.attendance_end_not_recorded_yesterday() from public, anon;
grant execute on function public.attendance_end_not_recorded_yesterday() to authenticated;

comment on function public.attendance_end_not_recorded_yesterday() is
  'attendance.view_all (FORBIDDEN otherwise). Read only (kickoff 6 decision 24, amended '
  '2026-10-08): from the End-day cutoff on, yesterday''s (IST) days with a Start day and no End day '
  'the Owner has not decided yet, one row per person in attendance_today_detail()''s columns with '
  'yesterday''s state. The Owner''s Today card counts them as "End of day not recorded"; the full '
  'board lists them on that group.';
