-- v2.0 X6 early review, batch 1 must-fix (the advisor on #89, 6785033760; four reviews found it):
-- app.requests_to_decide_count() (20261105210000_own_week_tasks_counts) counted, for an Admin
-- decider, every pending request with no client. app.task_request_visible
-- (20260930070616_phase4_review_fixes §10, Kickoff 4 decision 35; PERMISSIONS §2) leaves out a
-- no-client request made by an Admin: that one is the Owner's to decide. So Admin A's "requests
-- to decide" badge counted Admin B's no-client suggestion, with nothing behind it when tapped,
-- and an Admin could count other Admins' pending suggestions.
--
-- The function is re-created with task_request_visible's decider branch exactly:
--   (no client and not made by an Admin) or (a client of the caller's, app.admin_client_ids()).
-- The header of the earlier migration said "exactly task_request_visible's three branches"; it
-- was not, for an Admin's no-client request. It is now. Everything else is unchanged: the
-- Owner's branch, "never the caller's own", the org check, 0 for anyone else, language sql,
-- stable, security definer, the empty search_path (create or replace keeps the owner and the
-- grants; they are restated below all the same). It stays `language sql`: a security definer
-- function is never inlined, so ARCHITECTURE §5's "Helpers are PL/pgSQL" (the re-planning of a
-- non-inlined SQL helper with SET search_path, inside RLS) does not concern it; it is called once
-- per own_week(), not per row. pgTAP 135 holds it equal to the RLS count as
-- each role, now with a second Admin's pending no-client request. Expand-only: no table, column
-- or data changes.

create or replace function app.requests_to_decide_count()
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
         and ((q.client_id is null
               and not exists (select 1 from public.members m
                               where m.id = q.requested_by and m.role = 'admin'))
              or (q.client_id is not null and q.client_id in (select app.admin_client_ids()))))
    else 0
  end::integer;
$$;

comment on function app.requests_to_decide_count() is
  'v2.0 X3: the pending task requests the caller may decide, never their own (countRequestsToDecide), '
  'as the task_requests_select policy shows them: app.task_request_visible''s branch decided once '
  '(the Owner all; a task_requests.decide holder those with no client not made by an Admin, or one '
  'of their clients; anyone else 0), so the cost follows the pending rows, not the whole history. '
  'For own_week(). X6 review: an Admin''s no-client request is the Owner''s (20261111030554). '
  'language sql on purpose: security definer, never inlined, called once per own_week().';

revoke all on function app.requests_to_decide_count() from public, anon;
grant execute on function app.requests_to_decide_count() to authenticated, service_role;

-- X6 review batch 2, nit 5: 20261106040000_attendance_hours_once left this helper without a
-- comment (a comment only: nothing about the function changes).
comment on function app.attendance_hours_on(uuid, date, public.org_settings, boolean) is
  'v2.0 X3 (b): app.attendance_hours''s body with the organisation''s settings and the day''s '
  'working-day rule given (20261106040000), so attendance_hours_today() reads them once per call '
  'and app.attendance_hours(member, date) reads them and calls it: the same answer for every '
  'transition and job. Read-only; internal (service_role only); pgTAP 142 holds it equal to the '
  'old body for every member over 50 days.';
