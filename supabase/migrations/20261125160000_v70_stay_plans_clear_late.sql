-- v7.0 "Reliable anywhere": the database half of two owner decisions. Expand-only: one new table, three
-- new columns, new functions and one trigger; month_summary_hours re-created with the same signature,
-- security and grants (its Late counts leave out a cleared Late). Nothing dropped, renamed or rewritten.
-- The screens follow the owner's OK on docs/design/v70-clear-late-sample.html.
--
-- A. "Stay until", ahead of time (owner 12 Nov, #89 6815077432; Q1-Q4 answered 25 Nov, #89 7162359369):
--    the Owner sets it for a person on a date, today or later, before or after they start: one date per
--    set; refused on an approved full-day leave and not applied if a leave covers the day later ("Not
--    used: on leave"); the person is told at once; Change and "Back to 6:00 pm" clear it (kept, never
--    deleted). A plan is applied to the day when it starts (app.apply_stay_plan, a trigger), so the
--    day's end time works exactly as today's Stay until from then on.
-- B. Clear Late (owner Q2, 14 Nov 2026): the phone's note of a Start tried with no network
--    (attendance_days.offline_tried_at, phone time, never the record) and the Owner's one-tap Clear Late,
--    a correction with a written reason beside the original: late_minutes stays; late_cleared_* say who
--    cleared it, when and why; an attendance_events row each way; Undo puts it back (another event).

-- A. Stay until, ahead of time -------------------------------------------------------------------------

create table public.attendance_stay_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  member_id uuid not null references public.members (id),
  work_date date not null,
  until timestamptz not null,
  set_by uuid not null references public.members (id),
  set_at timestamptz not null default now(),
  cleared_at timestamptz null,
  cleared_by uuid null references public.members (id),
  applied_day_id uuid null references public.attendance_days (id),
  check ((cleared_at is null) = (cleared_by is null))
);

comment on table public.attendance_stay_plans is
  'v7.0: the Owner''s "Stay until" set ahead of time for a person''s date (owner 12 Nov 2026; Q1-Q4 25 Nov). '
  'One live plan per person and date (cleared_at null); Change and "Back to 6:00 pm" clear it, kept. '
  'Applied to attendance_days.stay_until when the day starts (app.apply_stay_plan). The Owner and the '
  'person read it; written only by attendance_stay_plan_set / attendance_stay_plan_clear.';

create unique index attendance_stay_plans_live_idx
  on public.attendance_stay_plans (member_id, work_date) where cleared_at is null;
create index attendance_stay_plans_org_date_idx on public.attendance_stay_plans (org_id, work_date);

alter table public.attendance_stay_plans enable row level security;
create policy attendance_stay_plans_select on public.attendance_stay_plans for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (member_id = (select c.id from app.current_member() c)
              or (select app.has_permission('attendance.decide'))));
revoke all on public.attendance_stay_plans from anon;
revoke insert, update, delete, truncate, references, trigger on public.attendance_stay_plans from authenticated;
grant select on public.attendance_stay_plans to authenticated;

create trigger audit_row_change after insert or update or delete on public.attendance_stay_plans
  for each row execute function app.audit_row_change();

/** Sets (or, for a live plan on that date, changes) a person's Stay until on a date, today or later. */
create function public.attendance_stay_plan_set(member_id uuid, work_date date, until timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.to_ist_date(app.now());
  v_member public.members;
  v_set public.org_settings;
  v_day public.attendance_days;
  v_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;
  select m.* into v_member from public.members m
  where m.id = attendance_stay_plan_set.member_id and m.org_id = v_org;
  if v_member.id is null then
    perform app.fail('NOT_FOUND', 'That person isn''t in your team.');
  end if;
  if v_member.engagement <> 'permanent' then
    perform app.fail('VALIDATION', 'Freelancers have no attendance in MaxOff.');
  end if;
  if v_member.status <> 'active' or not exists (
      select 1 from public.role_permissions rp where rp.role = v_member.role and rp.permission = 'attendance.self') then
    perform app.fail('VALIDATION', 'Stay until is for an active member who records attendance.');
  end if;
  select s.* into v_set from public.org_settings s where s.org_id = v_org;
  if not v_set.working_hours_on then
    perform app.fail('INVALID_STATE', 'Working hours are switched off.');
  end if;
  if work_date is null or work_date < v_today then
    perform app.fail('VALIDATION', 'Choose today or a later day.');
  end if;
  if until is null or app.to_ist_date(until) <> work_date
      or until <= app.ist_day_start(work_date) + (v_set.work_end_time - time '00:00')
      or until <= app.now() then
    perform app.fail('VALIDATION', format('Choose a time on that day, after %s.', app.wall_time(v_set.work_end_time)));
  end if;
  if exists (select 1 from public.leave_requests l
             where l.member_id = v_member.id and l.state = 'approved' and l.half is null
               and work_date between l.start_date and l.end_date) then
    perform app.fail('INVALID_STATE', format('%s is on leave that day.', v_member.full_name));
  end if;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_member.id::text));
  -- Today, once the day has started: exactly today's Stay until, as from Today's attendance list.
  if work_date = v_today then
    select d.* into v_day from public.attendance_days d
    where d.member_id = v_member.id and d.work_date = v_today;
    if v_day.started_at is not null then
      if v_day.ended_at is not null then
        perform app.fail('INVALID_STATE', format('%s''s day today has already ended.', v_member.full_name));
      end if;
      perform public.attendance_stay_until(v_member.id, until);
      return null;
    end if;
  end if;

  -- A change: the live plan for that date is cleared (kept), the new one takes its place.
  update public.attendance_stay_plans p set cleared_at = now(), cleared_by = v_caller
  where p.member_id = v_member.id and p.work_date = attendance_stay_plan_set.work_date and p.cleared_at is null;
  insert into public.attendance_stay_plans (org_id, member_id, work_date, until, set_by)
  values (v_org, v_member.id, attendance_stay_plan_set.work_date, until, v_caller)
  returning id into v_id;

  -- WORKFLOWS §9: the person, at once; never email.
  perform app.notify(array[v_member.id], 'stay_until_set',
    format('Please stay until %s on %s', app.ist_time(until), to_char(work_date, 'FMDy FMDD Mon')),
    'Your end time that day moves to this time.',
    case when v_member.role = 'admin' then '/today' else '/my-day' end,
    'attendance_stay_plans', v_id, jsonb_build_object('work_date', work_date, 'until', until), v_caller);
  return v_id;
end;
$$;

comment on function public.attendance_stay_plan_set(uuid, date, timestamptz) is
  'v7.0: the Owner sets a person''s Stay until for a date, today or later (attendance.decide). Today with '
  'the day started: attendance_stay_until(). Otherwise a plan (a live one for that date is cleared and '
  'replaced), applied when the day starts. Refused on an approved full-day leave. The person is told.';
revoke all on function public.attendance_stay_plan_set(uuid, date, timestamptz) from public, anon;
grant execute on function public.attendance_stay_plan_set(uuid, date, timestamptz) to authenticated, service_role;

/** "Back to 6:00 pm": the plan is cleared (kept, never deleted); the person is told. */
create function public.attendance_stay_plan_clear(plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_plan public.attendance_stay_plans;
  v_member public.members;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;
  select p.* into v_plan from public.attendance_stay_plans p
  where p.id = plan_id and p.org_id = v_org for update;
  if v_plan.id is null then
    perform app.fail('NOT_FOUND', 'That Stay until doesn''t exist.');
  end if;
  if v_plan.cleared_at is not null or v_plan.applied_day_id is not null then
    perform app.fail('INVALID_STATE', 'That Stay until is no longer waiting: change it from Today''s attendance.');
  end if;
  update public.attendance_stay_plans set cleared_at = now(), cleared_by = v_caller where id = v_plan.id;
  select m.* into v_member from public.members m where m.id = v_plan.member_id;
  perform app.notify(array[v_member.id], 'stay_until_set',
    format('Your Stay until on %s was removed', to_char(v_plan.work_date, 'FMDy FMDD Mon')),
    'Your usual end time applies that day.',
    case when v_member.role = 'admin' then '/today' else '/my-day' end,
    'attendance_stay_plans', v_plan.id, jsonb_build_object('work_date', v_plan.work_date, 'until', null), v_caller);
end;
$$;

comment on function public.attendance_stay_plan_clear(uuid) is
  'v7.0: "Back to 6:00 pm" for a Stay until set ahead and not yet applied (attendance.decide). Kept, '
  'never deleted; the person is told.';
revoke all on function public.attendance_stay_plan_clear(uuid) from public, anon;
grant execute on function public.attendance_stay_plan_clear(uuid) to authenticated, service_role;

/** Applies the live plan of the day's date when the day starts, unless a leave covers that date. */
create function app.apply_stay_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.attendance_stay_plans;
begin
  if new.started_at is null or new.stay_until is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.started_at is not null then
    return new;
  end if;
  select p.* into v_plan from public.attendance_stay_plans p
  where p.member_id = new.member_id and p.work_date = new.work_date and p.cleared_at is null
    and p.applied_day_id is null;
  if v_plan.id is null then
    return new;
  end if;
  -- "Not used: on leave": an approved leave on the date (a full day, or the afternoon off) wins.
  if exists (select 1 from public.leave_requests l
             where l.member_id = new.member_id and l.state = 'approved'
               and new.work_date between l.start_date and l.end_date
               and (l.half is null or l.half = 'afternoon')) then
    return new;
  end if;
  new.stay_until := v_plan.until;
  new.stay_until_by := v_plan.set_by;
  if tg_op = 'UPDATE' then
    update public.attendance_stay_plans set applied_day_id = new.id where id = v_plan.id;
  else
    -- The day's row does not exist yet: recorded once it does (after insert).
    perform set_config('app.stay_plan_applied', v_plan.id::text, true);
  end if;
  return new;
end;
$$;

create function app.record_stay_plan_applied()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text := nullif(current_setting('app.stay_plan_applied', true), '');
begin
  if v_plan is not null then
    perform set_config('app.stay_plan_applied', '', true);
    update public.attendance_stay_plans set applied_day_id = new.id
    where id = v_plan::uuid and member_id = new.member_id;
  end if;
  return null;
end;
$$;

revoke all on function app.apply_stay_plan() from public, anon;
revoke all on function app.record_stay_plan_applied() from public, anon;
grant execute on function app.apply_stay_plan() to authenticated, service_role;
grant execute on function app.record_stay_plan_applied() to authenticated, service_role;

create trigger apply_stay_plan before insert or update of started_at on public.attendance_days
  for each row execute function app.apply_stay_plan();
create trigger record_stay_plan_applied after insert on public.attendance_days
  for each row execute function app.record_stay_plan_applied();

-- B. Clear Late ----------------------------------------------------------------------------------------

alter table public.attendance_days
  add column offline_tried_at timestamptz null,
  add column late_cleared_at timestamptz null,
  add column late_cleared_by uuid null references public.members (id),
  add column late_clear_reason text null;

comment on column public.attendance_days.offline_tried_at is
  'v7.0 (owner Q2): when the person''s phone first tried Start day with no network that day, by the '
  'PHONE''S clock: a note beside started_at, never the record (a phone clock can be changed).';
comment on column public.attendance_days.late_cleared_at is
  'v7.0 (owner Q2): the Owner cleared this day''s Late (Clear Late): late_minutes stays as recorded; '
  'a cleared Late is left out of the month''s Late counts. late_cleared_by and late_clear_reason with it.';

-- The day's history names the two new actions (widened, as client_work_alerts' kind was: every
-- existing row still passes; NOT VALID as before).
alter table public.attendance_events drop constraint attendance_events_action_check;
alter table public.attendance_events add constraint attendance_events_action_check check (action in (
  'submitted', 'proposed_absent', 'derived_from_leave', 'approved', 'corrected',
  'overtime_flagged', 'started', 'ended', 'late_cleared', 'late_clear_undone')) not valid;

/** The person's own note: today's Late start was first tried, by the phone's clock, at this time. */
create function public.attendance_note_offline_try(tried_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_today date := app.to_ist_date(app.now());
  v_day public.attendance_days;
begin
  select r.caller_id into v_caller from app.attendance_require_self() r;
  select d.* into v_day from public.attendance_days d
  where d.member_id = v_caller and d.work_date = v_today for update;
  if v_day.started_at is null then
    perform app.fail('INVALID_STATE', 'Your day hasn''t started.');
  end if;
  -- Only a Late start, a try before it on the same IST day, and only the first note counts.
  if v_day.late_minutes is null or v_day.offline_tried_at is not null then
    return;
  end if;
  if tried_at is null or tried_at >= v_day.started_at or app.to_ist_date(tried_at) <> v_today then
    perform app.fail('VALIDATION', 'That try isn''t before this morning''s start.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'offline_try_noted')::text, true);
  update public.attendance_days set offline_tried_at = tried_at where id = v_day.id;
end;
$$;

comment on function public.attendance_note_offline_try(timestamptz) is
  'v7.0 (owner Q2): the caller''s own note on today''s Late start, sent once the Start reached MaxOff: '
  'the phone first tried at tried_at with no network (phone time). Only before started_at, on the same '
  'IST day, once; a start that was not Late keeps no note. Never changes started_at or late_minutes.';
revoke all on function public.attendance_note_offline_try(timestamptz) from public, anon;
grant execute on function public.attendance_note_offline_try(timestamptz) to authenticated, service_role;

/** The Owner's one tap: clear (or, with undo, put back) a Late the phone tried to avoid with no network. */
create function public.attendance_clear_late(day_id uuid, undo boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_day public.attendance_days;
  v_reason text;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;
  select d.* into v_day from public.attendance_days d
  join public.members m on m.id = d.member_id and m.org_id = v_org
  where d.id = day_id;
  if v_day.id is null then
    perform app.fail('NOT_FOUND', 'That day doesn''t exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_day.member_id::text));
  select d.* into v_day from public.attendance_days d where d.id = attendance_clear_late.day_id for update;
  if v_day.late_minutes is null then
    perform app.fail('INVALID_STATE', 'That day wasn''t Late.');
  end if;
  if undo then
    if v_day.late_cleared_at is null then
      perform app.fail('INVALID_STATE', 'That Late isn''t cleared.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object('action', 'late_clear_undone')::text, true);
    update public.attendance_days
    set late_cleared_at = null, late_cleared_by = null, late_clear_reason = null where id = v_day.id;
    perform app.attendance_event(v_day.id, 'late_clear_undone', v_day.final_status, v_day.final_status,
      v_day.late_clear_reason, v_caller);
    return;
  end if;
  if v_day.late_cleared_at is not null then
    perform app.fail('INVALID_STATE', 'That Late is already cleared.');
  end if;
  if v_day.offline_tried_at is null then
    perform app.fail('INVALID_STATE', 'Only a Late start tried with no network can be cleared here.');
  end if;
  v_reason := format('No network at the start; tried %s by the phone''s clock.', app.ist_time(v_day.offline_tried_at));
  perform set_config('app.audit_override', jsonb_build_object('action', 'late_cleared')::text, true);
  update public.attendance_days
  set late_cleared_at = now(), late_cleared_by = v_caller, late_clear_reason = v_reason where id = v_day.id;
  perform app.attendance_event(v_day.id, 'late_cleared', v_day.final_status, v_day.final_status, v_reason, v_caller);
end;
$$;

comment on function public.attendance_clear_late(uuid, boolean) is
  'v7.0 (owner Q2): the Owner''s Clear Late (attendance.decide) on a Late day the phone tried with no '
  'network: a correction with a written reason beside the original (late_minutes kept; an '
  'attendance_events row); undo => true puts it back (another event). No notification.';
revoke all on function public.attendance_clear_late(uuid, boolean) from public, anon;
grant execute on function public.attendance_clear_late(uuid, boolean) to authenticated, service_role;

-- The month's Late counts leave out a cleared Late (sample confirmation 2, recommended).
create or replace function public.month_summary_hours(month date, member_id uuid default null)
returns table (
  id uuid,
  late_days integer,
  early_leaves integer,
  left_unanswered integer,
  late_minutes integer,
  early_leaves_approved integer,
  half_days_morning integer,
  half_days_afternoon integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_first date;
  v_last date;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'The month summary is the Owner''s.');
  end if;
  if month_summary_hours.month is null then
    perform app.fail('VALIDATION', 'Pick a month.');
  end if;
  v_first := date_trunc('month', month_summary_hours.month::timestamp)::date;
  v_last := app.ist_month_end(v_first);
  return query
  with people as (
    select m.id, m.full_name
    from public.members m
    where m.org_id = v_org
      and (month_summary_hours.member_id is null or m.id = month_summary_hours.member_id)
      and m.status <> 'invited' and m.joined_at is not null
      and app.to_ist_date(m.joined_at) <= v_last
      and (m.deactivated_at is null or app.to_ist_date(m.deactivated_at) >= v_first)
      and m.engagement = 'permanent'
      and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'attendance.self')
  ),
  days as (
    select d.member_id,
           count(*) filter (where d.late_minutes is not null and d.late_cleared_at is null) as late_days,
           coalesce(sum(d.late_minutes) filter (where d.late_cleared_at is null), 0) as late_minutes,
           -- A half day the Owner settled (approved or corrected), by the half its leave records.
           count(*) filter (where d.state in ('approved', 'corrected') and d.final_status = 'half_day'
                              and l.half = 'morning') as half_morning,
           count(*) filter (where d.state in ('approved', 'corrected') and d.final_status = 'half_day'
                              and l.half = 'afternoon') as half_afternoon
    from public.attendance_days d
    left join public.leave_requests l on l.id = d.leave_request_id
    where d.member_id in (select p.id from people p) and d.work_date between v_first and v_last
    group by d.member_id
  ),
  early as (
    select e.member_id,
           count(*) filter (where e.state in ('approved', 'left_unanswered', 'corrected')) as early_leaves,
           count(*) filter (where e.left_at is not null) as left_unanswered,
           count(*) filter (where e.state = 'approved') as approved
    from public.early_leave_requests e
    join public.attendance_days d on d.id = e.day_id
    where e.member_id in (select p.id from people p) and d.work_date between v_first and v_last
    group by e.member_id
  )
  select p.id,
         coalesce(x.late_days, 0)::integer,
         coalesce(e.early_leaves, 0)::integer,
         coalesce(e.left_unanswered, 0)::integer,
         coalesce(x.late_minutes, 0)::integer,
         coalesce(e.approved, 0)::integer,
         coalesce(x.half_morning, 0)::integer,
         coalesce(x.half_afternoon, 0)::integer
  from people p
  left join days x on x.member_id = p.id
  left join early e on e.member_id = p.id
  order by p.full_name, p.id;
end;
$$;
