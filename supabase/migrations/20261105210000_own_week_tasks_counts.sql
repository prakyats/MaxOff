-- v2.0 X3 step 3, /tasks (2026-11-05; DATA-MODEL §1 "v2.0 X3"; advisor on #89: the own_week
-- alternative, session_bundle() untouched): the Tasks tab's two small reads ride in the week read
-- it already makes, so its first wave is six, and the cost lands only on the three pages that read
-- own_week (/today, /my-day, /tasks), never on the shell.
--
-- Expand-only: one new helper, and own_week() re-created (create or replace: the same name,
-- arguments, jsonb result, security invoker, stable, empty search_path and grants) with three more
-- keys and every existing key unchanged (holidays, events, leave, freelancers):
--   requests_to_decide         the pending task requests the caller may decide, never their own
--                              (countRequestsToDecide), from app.requests_to_decide_count();
--   ack_escalate_hours,        the organisation's two "not noted" escalation thresholds, as
--   ack_escalate_owner_hours   org_settings holds them, under RLS (getSettings' row); null when RLS
--                              shows no row, so the app reads the settings the usual way.

-- The requests count as the policy decides it, cheaply. Under RLS the count runs the policy's
-- per-row check (app.task_request_visible, security definer, ~0.4 ms a row: it reads the caller's
-- member row three times) on EVERY request of the org before it may filter on state (enum equality
-- is not leakproof), so it would grow with every request ever made, and it would run on
-- every /today, /my-day and /tasks. This helper decides the caller's branch of that same check ONCE and counts the
-- pending rows through the index (task_requests_org_state_idx), with countRequestsToDecide's
-- filter (never the caller's own) and the task_requests_select policy's org check:
--   the Owner (app.is_owner):                     every pending request of the org;
--   a decider (task_requests.decide: an Admin):   those with no client or one of their clients
--                                                 (app.admin_client_ids);
--   anyone else:                                  0 (RLS shows them only their own, never counted).
-- These are exactly app.task_request_visible's three branches (20260929213501, PERMISSIONS §2);
-- a change there must change this too. Security definer as task_counts() is; pgTAP 135 holds it
-- equal to the RLS count as each role, with a client-labelled request each way.
create function app.requests_to_decide_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select app.is_owner()) then
      (select count(*) from public.task_requests q
       where q.org_id = (select c.org_id from app.current_member() c)
         and q.state = 'pending'
         and q.requested_by <> (select auth.uid()))
    when (select app.has_permission('task_requests.decide')) then
      (select count(*) from public.task_requests q
       where q.org_id = (select c.org_id from app.current_member() c)
         and q.state = 'pending'
         and q.requested_by <> (select auth.uid())
         and (q.client_id is null or q.client_id in (select app.admin_client_ids())))
    else 0
  end::integer;
$$;

comment on function app.requests_to_decide_count() is
  'v2.0 X3: the pending task requests the caller may decide, never their own (countRequestsToDecide), '
  'as the task_requests_select policy shows them: app.task_request_visible''s branch decided once '
  '(the Owner all; a task_requests.decide holder those with no client or one of their clients; '
  'anyone else 0), so the cost follows the pending rows, not the whole history. For own_week().';

revoke all on function app.requests_to_decide_count() from public, anon;
grant execute on function app.requests_to_decide_count() to authenticated, service_role;

create or replace function public.own_week(from_date date, to_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_hours integer;
  v_owner_hours integer;
begin
  if from_date is null or to_date is null or to_date < from_date or to_date - from_date > 61 then
    perform app.fail('VALIDATION', 'The window runs from_date to to_date, at most 62 days.');
  end if;
  -- v2.0 X3 (/tasks): the organisation's thresholds, read once (getSettings' row, under RLS).
  select s.ack_escalate_hours, s.ack_escalate_owner_hours into v_hours, v_owner_hours
  from public.org_settings s limit 1;
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
      where f.to_at is null and f.member_id is not null), '[]'::jsonb),
    -- v2.0 X3 (/tasks): the pending task requests the caller may decide, never their own
    -- (countRequestsToDecide; app.requests_to_decide_count, above), and the organisation's two
    -- "not noted" escalation thresholds (getSettings' org_settings row, under RLS; null when none
    -- is visible). Not windowed.
    'requests_to_decide', (select app.requests_to_decide_count()),
    'ack_escalate_hours', v_hours,
    'ack_escalate_owner_hours', v_owner_hours
  );
end;
$$;

comment on function public.own_week(date, date) is
  'v2.0 X3: the week strip''s holidays and event tasks in [from_date, to_date] (at most 62 days, '
  'else VALIDATION) in one read: holidays {id, date, name} by date; tasks with an event date in the '
  'window, not cancelled, {id, title, state, event_date, event_start_at, event_end_at, location, '
  'client_id, task_type_id, primary_owner_id, assignee_ids (current)} by event date and start; '
  'leave, the caller''s own approved leave touching the window {type, start_date, end_date}; '
  'freelancers, the member ids the caller coordinates now (not windowed); requests_to_decide '
  '(app.requests_to_decide_count()), ack_escalate_hours and ack_escalate_owner_hours (org_settings, '
  'null when none is visible), not windowed. '
  'Security invoker: RLS decides every row, as for the API reads.';

revoke all on function public.own_week(date, date) from public, anon, service_role;
grant execute on function public.own_week(date, date) to authenticated;
