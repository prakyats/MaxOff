-- v2.0 X3 step 3 (2026-11-05; DATA-MODEL §1 "v2.0 X3"; ARCHITECTURE §19; advisor-approved on #89,
-- option A). Expand-only: one new function; attendance_today_detail() and
-- attendance_hours_today() stay as they are.
--
-- public.attendance_board_today(): the Owner's Today board's two attendance reads in one round
-- trip. Both parts exactly as those functions answer, in their own row order: people (today's
-- detail, one row per active permanent member but the Owner) and hours (everyone's working hours
-- today), computed only for a caller holding attendance.view_all, the permission both require;
-- anyone else gets null for both and `refused` naming the refusal those functions would raise
-- (UNAUTHENTICATED not an active member, FORBIDDEN without attendance.view_all), never raised
-- here, so an Admin's /today makes one quick read instead of two refused ones.

create function public.attendance_board_today()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_refused text := null;
  v_people jsonb := null;
  v_hours jsonb := null;
begin
  select m.org_id into v_org from app.current_member() m;
  if v_org is null then
    v_refused := 'UNAUTHENTICATED';
  elsif not app.has_permission('attendance.view_all') then
    v_refused := 'FORBIDDEN';
  else
    select coalesce(jsonb_agg(to_jsonb(p) - 'ordinality' order by p.ordinality), '[]'::jsonb) into v_people
    from public.attendance_today_detail() with ordinality as p;
    select coalesce(jsonb_agg(to_jsonb(h) - 'ordinality' order by h.ordinality), '[]'::jsonb) into v_hours
    from public.attendance_hours_today() with ordinality as h;
  end if;
  return jsonb_build_object('people', v_people, 'hours', v_hours, 'refused', v_refused);
end;
$$;

comment on function public.attendance_board_today() is
  'v2.0 X3: the Owner''s Today board in one read: people (attendance_today_detail()''s rows) and '
  'hours (attendance_hours_today()''s rows), each in its own order, for attendance.view_all only; '
  'otherwise both null and refused UNAUTHENTICATED / FORBIDDEN as those functions would raise. '
  'Security invoker; nothing new is visible.';

revoke all on function public.attendance_board_today() from public, anon, service_role;
grant execute on function public.attendance_board_today() to authenticated;
