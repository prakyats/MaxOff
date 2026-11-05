-- v2.0 X3 step 3, /my-day (2026-11-05; DATA-MODEL §1 "v2.0 X3"; review on #89 before push).
-- Expand-only: own_week() re-created (create or replace: the same name, arguments, jsonb result,
-- security invoker, stable, empty search_path and grants) with two more keys and every existing
-- key unchanged, so the previous Worker reads it as before during a deploy. session_early() is
-- not touched: the shell runs on every page, so it stays lean (the advisor, #89).
--   leave: the caller's own approved leave touching the window (listApprovedLeaveBetween), so the
--     week strip's own leave rides in the same read.
--   freelancers: the members the caller coordinates now (the coordinated_freelancers read, to_at
--     null; not windowed), so /my-day, /tasks and an Admin's /today do not read it apart.

create or replace function public.own_week(from_date date, to_date date)
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
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'date', h.date, 'name', h.name) order by h.date, h.id)
      from public.holidays h
      where h.date between from_date and to_date), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'title', t.title,
               'state', t.state,
               'event_date', t.event_date,
               'event_start_at', t.event_start_at,
               'event_end_at', t.event_end_at,
               'location', t.location,
               'client_id', t.client_id,
               'task_type_id', t.task_type_id,
               'primary_owner_id', t.primary_owner_id,
               'assignee_ids', coalesce((
                 select jsonb_agg(a.member_id order by a.member_id)
                 from public.task_assignees a
                 where a.task_id = t.id and a.removed_at is null), '[]'::jsonb))
             order by t.event_date, t.event_start_at nulls first, t.id)
      from public.tasks t
      where t.event_date between from_date and to_date and t.state <> 'cancelled'), '[]'::jsonb),
    -- v2.0 X3: the caller's own approved leave touching the window (listApprovedLeaveBetween).
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('type', l.type, 'start_date', l.start_date, 'end_date', l.end_date)
                       order by l.start_date, l.id)
      from public.leave_requests l
      where l.member_id = auth.uid() and l.state = 'approved'
        and l.start_date <= to_date and l.end_date >= from_date), '[]'::jsonb),
    -- v2.0 X3: the freelancers the caller coordinates now (listOwnFreelancerIds), under the same
    -- view and RLS; not windowed.
    'freelancers', coalesce((
      select jsonb_agg(f.member_id order by f.member_id)
      from public.coordinated_freelancers f
      where f.to_at is null and f.member_id is not null), '[]'::jsonb)
  );
end;
$$;

comment on function public.own_week(date, date) is
  'v2.0 X3: the week strip''s holidays and event tasks in [from_date, to_date] (at most 62 days, '
  'else VALIDATION) in one read: holidays {id, date, name} by date; tasks with an event date in the '
  'window, not cancelled, {id, title, state, event_date, event_start_at, event_end_at, location, '
  'client_id, task_type_id, primary_owner_id, assignee_ids (current)} by event date and start; '
  'leave, the caller''s own approved leave touching the window {type, start_date, end_date}; '
  'freelancers, the member ids the caller coordinates now (not windowed). '
  'Security invoker: RLS decides every row, as for the API reads.';

revoke all on function public.own_week(date, date) from public, anon, service_role;
grant execute on function public.own_week(date, date) to authenticated;
