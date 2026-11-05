-- v2.0 X3 step 3 (2026-11-05; DATA-MODEL §1 "v2.0 X3"; ARCHITECTURE §19 "Six connections";
-- advisor-approved on #89). Expand-only: one new function.
--
-- public.own_week(from_date, to_date): the week strip's two reads in one round trip, the holidays
-- and the event tasks in [from_date, to_date], exactly as the app read them apart: holidays by date;
-- tasks with an event date in the window, not cancelled, by event date then start (no start
-- first), each with its current assignees (removed ones left out). Security invoker: RLS decides
-- every task and assignee, as for the two API reads (Crew their own, an Admin their scope, the
-- Owner all). No client record, no money, no Owner-only table. The window is at most 62 days (the
-- Admin's Issues read events that far, Today's eventsHorizon); anything else is refused.

create function public.own_week(from_date date, to_date date)
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
      where t.event_date between from_date and to_date and t.state <> 'cancelled'), '[]'::jsonb)
  );
end;
$$;

comment on function public.own_week(date, date) is
  'v2.0 X3: the week strip''s holidays and event tasks in [from_date, to_date] (at most 62 days, '
  'else VALIDATION) in one read: holidays {id, date, name} by date; tasks with an event date in the '
  'window, not cancelled, {id, title, state, event_date, event_start_at, event_end_at, location, '
  'client_id, task_type_id, primary_owner_id, assignee_ids (current)} by event date and start. '
  'Security invoker: RLS decides every row, as for the two API reads.';

revoke all on function public.own_week(date, date) from public, anon, service_role;
grant execute on function public.own_week(date, date) to authenticated;
