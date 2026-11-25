-- v6.5 "Team view", unit 13 (migration v65_people_glance; the approved sample "4": "On leave · back
-- Tue 17"; the advisor on #89, 25 Nov): member_people_glance() for each role, allowed and denied.
-- An Admin and the Owner read each person's next booking (member_next_booking()'s rules) and, for a
-- person on approved full-day leave or comp leave that day, the first working day they are back:
-- past weekly offs, holidays and more leave; a half day counts as back and is no "away". Crew, a
-- freelancer, a deactivated member and a signed-out caller read nothing; app.member_back_on is
-- service_role only (review must-fix, migration v65_member_back_on_internal). Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner',  '10000000-0000-4000-8000-000000000001'),
  ('admin',  '10000000-0000-4000-8000-000000000002'),
  ('staff',  '10000000-0000-4000-8000-000000000003'),
  ('staff2', '20000000-0000-4000-8000-000000000001'),
  ('lancer', '40000000-0000-4000-8000-000000000001'),
  ('admin2', '20000000-0000-4000-8000-000000000002'),
  ('gone',   '10000000-0000-4000-8000-000000000004');
insert into fx select 'org', id from public.organizations order by created_at limit 1;
insert into fx select 'shoot', id from public.task_types
  where org_id = (select id from fx where key = 'org') and name = 'Shoot / Site Visit';
grant select on fx to authenticated, anon;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.fx(k)::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;
-- The day the People page asks about, far from anything the seed holds.
create function pg_temp.d(n integer default 0) returns date language sql stable as $$ select app.today_ist() + 40 + n; $$;
create function pg_temp.leave(k text, t public.leave_type, from_n integer, to_n integer) returns void
language sql as $$
  insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at)
  values (pg_temp.fx(k), t, pg_temp.d(from_n), pg_temp.d(to_n), 'approved', 'owner', pg_temp.fx('owner'), now());
$$;
-- One person's row as the caller reads it (or null).
create function pg_temp.glance(who text) returns jsonb language sql stable as $$
  select to_jsonb(g) - 'member_id' from public.member_people_glance(pg_temp.d(), 30) g
  where g.member_id = pg_temp.fx(who);
$$;
create function pg_temp.raised(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
grant execute on function pg_temp.fx(text), pg_temp.d(integer), pg_temp.glance(text), pg_temp.raised(text)
  to authenticated, anon;

-- Every day a working day except a weekly off on day 1's weekday and a holiday on day 3, so each
-- "back" is exact.
update public.org_settings set weekly_off_days = array[extract(dow from pg_temp.d(1))::smallint]
where org_id = pg_temp.fx('org');
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), pg_temp.d(3), 'Holiday 152');
-- staff: leave days 0–2, the holiday on 3: back on day 4. lancer: comp leave on day 0, then leave
-- on day 1: back on day 2. staff2: a half day on day 0 (not away), and a shoot on day 5. The Owner on
-- leave (never "away", 6b.2).
select pg_temp.leave('staff', 'leave', 0, 2);
select pg_temp.leave('lancer', 'comp_leave', 0, 0);
select pg_temp.leave('lancer', 'leave', 1, 1);
select pg_temp.leave('staff2', 'half_day', 0, 0);
select pg_temp.leave('owner', 'leave', 0, 0);
-- admin2: leave on day 0 only, day 1 is the weekly off: back on day 2. The Admin: 70 days of leave,
-- past the 62-day look: no day back (People says "On leave").
select pg_temp.leave('admin2', 'leave', 0, 0);
select pg_temp.leave('admin', 'leave', 0, 70);
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id,
                          event_date, location)
values (pg_temp.fx('org'), 'Secret title 152', pg_temp.fx('shoot'), 'medium', now() + interval '60 days', 'todo',
        pg_temp.fx('admin'), pg_temp.fx('staff2'), pg_temp.d(5), 'Secret place 152');
insert into public.task_assignees (task_id, member_id, is_primary)
select id, pg_temp.fx('staff2'), true from public.tasks where title = 'Secret title 152';

-- 1. An Admin: allowed ----------------------------------------------------------------------------
select pg_temp.as_member('admin');
select is((pg_temp.glance('staff') ->> 'back_on')::date, pg_temp.d(4),
  'on leave days 0–2 with a holiday on day 3: back on day 4');
select is(pg_temp.glance('staff') ->> 'on_date', null, 'with no next booking');
select is((pg_temp.glance('lancer') ->> 'back_on')::date, pg_temp.d(2),
  'comp leave then leave: back after both (a freelancer too)');
select is(pg_temp.glance('staff2') ->> 'back_on', null, 'a half day is no "away"');
select is((pg_temp.glance('admin2') ->> 'back_on')::date, pg_temp.d(2), 'a weekly off is skipped: back on day 2');
select ok(pg_temp.glance('admin') is not null and pg_temp.glance('admin') ->> 'back_on' is null,
  'leave past the 62-day look: listed, with no day back');
select is((pg_temp.glance('staff2') ->> 'on_date')::date, pg_temp.d(5), 'staff2''s next booking, as member_next_booking');
select is(pg_temp.glance('owner'), null, 'the Owner is never listed as away');
select ok(not exists (select 1 from public.member_people_glance(pg_temp.d(), 30) g where to_jsonb(g)::text ~ 'Secret'),
  'never a title or a location');
select is(pg_temp.raised('select * from public.member_people_glance(current_date, 63)'), 'VALIDATION',
  'more than 62 days: VALIDATION');

-- 2. The Owner: allowed ---------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is((pg_temp.glance('staff') ->> 'back_on')::date, pg_temp.d(4), 'the Owner reads the same');

-- 3. Refused --------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(pg_temp.raised('select * from public.member_people_glance(current_date, 30)'), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_member('lancer');
select is(pg_temp.raised('select * from public.member_people_glance(current_date, 30)'), 'UNAUTHENTICATED',
  'a freelancer (no account) reads nothing');
select pg_temp.as_member('gone');
select is(pg_temp.raised('select * from public.member_people_glance(current_date, 30)'), 'UNAUTHENTICATED',
  'a deactivated member: UNAUTHENTICATED');
select pg_temp.as_anon();
select is(pg_temp.raised('select * from public.member_people_glance(current_date, 30)'),
  'permission denied for function member_people_glance', 'anon: no EXECUTE');
select pg_temp.as_system();
select ok(not has_function_privilege('anon', 'public.member_people_glance(date, integer)', 'execute'),
  'revoked from anon');
select ok(has_function_privilege('authenticated', 'public.member_people_glance(date, integer)', 'execute'),
  'authenticated may call the read (the function decides)');
select ok(not has_function_privilege('authenticated', 'app.member_back_on(uuid, date)', 'execute'),
  'the helper: no EXECUTE for authenticated (review must-fix: it checks no permission or organisation)');
select ok(not has_function_privilege('anon', 'app.member_back_on(uuid, date)', 'execute'),
  'nor for anon');

select * from finish();
rollback;
