-- P2 item 3 (v1.7.1, owner 2026-10-15 "make the app fast for free"; ARCHITECTURE §19): one round trip
-- for the signed-in shell's counts, instead of up to six.
--
-- Measured first (scripts/measure-nav.mjs, local, 2026-10-15): every signed-in first load made the
-- shell's reads in two waves after the JWT check: the member row, task_counts(), push_status_own()
-- and attendance_own_today() together, then (once the role was known) the unread count and, for the
-- Owner, four more counts (attendance days, leave requests, extra-work notes, expense claims) and
-- push_status_own() a second time. Each wave is a Worker -> Supabase round trip (~250 ms from the
-- US, ~40 ms from India) and each read is one more statement on the Free-plan nano.
--
-- public.session_bundle(): SECURITY INVOKER, so RLS still decides every row it counts, exactly as the
-- separate reads did through the API (the same predicates, the same tables); the security-definer
-- read it wraps (task_counts()) is the very function the layout called, so every number is
-- identical (pgTAP 79 compares them). The Owner's four counts are
-- computed only for a caller holding attendance.decide (the claims for expenses.decide); anyone
-- else gets null and pays nothing for them. One row for any authenticated caller (zeros/nulls when
-- they are not an active member: RLS gives them nothing). A count of claims is not money
-- (invariant 2): no amount is read or returned.
--
-- The member row stays its own read (getSessionState): it is the auth decision, every server
-- action and route handler needs it alone, and the shell paints as soon as it answers. So does the
-- push status (push_status_own()): the shell draws the notifications band from it, so the layout
-- awaits it, and a count must never be part of what the shell waits for. This bundle is started at
-- the same moment as both (keyed by the JWT, no member-row gate) and streams into the bars
-- (ARCHITECTURE §19 "The nav counts stream (4C)"), so the shell never waits for it.
--
-- Expand-only: a new function; nothing existing changes.

create function public.session_bundle()
returns table (
  not_noted integer,
  changes_requested integer,
  badge integer,
  to_decide integer,
  unread integer,
  pending_days integer,
  pending_requests integer,
  pending_notes integer,
  pending_claims integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select tc.not_noted,
         tc.changes_requested,
         tc.badge,
         tc.to_decide,
         (select count(*) from public.notifications n where n.read_at is null)::integer,
         case when (select app.has_permission('attendance.decide')) then
           (select count(*) from public.attendance_days d where d.state = 'pending_review')::integer
         end,
         case when (select app.has_permission('attendance.decide')) then
           (select count(*) from public.leave_requests r
            where r.state = 'submitted' and r.source <> 'attendance')::integer
         end,
         case when (select app.has_permission('attendance.decide')) then
           (select count(*) from public.extra_work_notes x where x.state = 'submitted')::integer
         end,
         case when (select app.has_permission('attendance.decide'))
                and (select app.has_permission('expenses.decide')) then
           (select count(*) from public.expense_claims c where c.state = 'submitted')::integer
         end
  from (values (1)) as one (x)
  left join lateral public.task_counts() tc on true;
$$;

comment on function public.session_bundle() is
  'P2 (2026-10-15, ARCHITECTURE §19): the signed-in shell''s counts in one round trip, '
  'security invoker (RLS decides every row): task_counts()''s four counts, the caller''s unread '
  'notifications, the Owner''s pending attendance days, leave requests (not from attendance) and '
  'extra-work notes (attendance.decide, else null) and submitted expense claims (attendance.decide '
  'and expenses.decide, else null; a count, never an amount). One row for any authenticated '
  'caller; zeros and nulls for anyone not an active member.';

revoke all on function public.session_bundle() from public, anon, service_role;
grant execute on function public.session_bundle() to authenticated;
