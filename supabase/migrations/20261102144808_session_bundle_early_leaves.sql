-- v1.9 W4 Q2 (advisor 2026-11-02, owner-approved): the Owner's Approvals badge counts the early-leave
-- requests waiting for him, from the shell's one read (no new read in the shared layout).
--
-- public.session_bundle() is re-created from its only definition (20261015182915_p2_session_bundle)
-- with one more column at the end, pending_early_leaves: early_leave_requests in state 'waiting'
-- ("Leaving early") or 'left_unanswered' ("Left early, not answered": not yet decided; the Owner's
-- approve or correct moves it on), counted only for a caller holding attendance.decide (the Owner);
-- 0 for anyone else. Everything else is unchanged: security invoker (RLS decides every row), stable,
-- execute for authenticated only.
--
-- A function's result columns cannot grow in place, so it is dropped first (nothing depends on it;
-- same name, no arguments). Expand-only for the app: the released v1.8 app reads the columns it
-- knows by name, and the new one is last.

drop function public.session_bundle();

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
  pending_claims integer,
  pending_early_leaves integer
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
         end,
         case when (select app.has_permission('attendance.decide')) then
           (select count(*) from public.early_leave_requests e
            where e.state in ('waiting', 'left_unanswered'))::integer
         else 0
         end
  from (values (1)) as one (x)
  left join lateral public.task_counts() tc on true;
$$;

comment on function public.session_bundle() is
  'P2 (2026-10-15, ARCHITECTURE §19): the signed-in shell''s counts in one round trip, '
  'security invoker (RLS decides every row): task_counts()''s four counts, the caller''s unread '
  'notifications, the Owner''s pending attendance days, leave requests (not from attendance) and '
  'extra-work notes (attendance.decide, else null) and submitted expense claims (attendance.decide '
  'and expenses.decide, else null; a count, never an amount). v1.9 W4 Q2: pending_early_leaves, '
  'the early-leave requests waiting or left unanswered (attendance.decide, else 0). One row for any '
  'authenticated caller; zeros and nulls for anyone not an active member.';

revoke all on function public.session_bundle() from public, anon, service_role;
grant execute on function public.session_bundle() to authenticated;
