-- v6.5 review (advisor on #89, 25 Nov 2026, must-fix): app.member_back_on (20261125173603) is security
-- definer with no permission or organisation check and wraps app.leave_covering, which is
-- service_role only (20260923160918). authenticated has usage on schema app, so its EXECUTE grant
-- re-opened that door: any member's leave and return day, through any future SQL path. Only
-- member_people_glance() (a definer, availability.view) calls it, and needs no grant.
--
-- Expand-only: grants only (20261125173603 is pushed and frozen).
revoke all on function app.member_back_on(uuid, date) from public, anon, authenticated;
grant execute on function app.member_back_on(uuid, date) to service_role;
comment on function app.member_back_on(uuid, date) is
  'v6.5 (unit 13): the first working day after after_date (app.is_working_day: weekly offs and '
  'holidays) on which no approved full-day leave or comp leave covers the member; a half day counts '
  'as back. Null beyond 62 days. Internal (service_role only, like app.leave_covering): read by '
  'member_people_glance() only.';
