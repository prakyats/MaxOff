-- v6.5 "Team view", unit 13 (migration v65_member_next_booking; owner 14 Nov 2026, #89 6874350719,
-- 6874389662, 6874423650; plan docs/handoff/v65-team-view-plan.md §2): member_next_booking() for each
-- role, allowed and denied. The Owner and an Admin read each person's first booking within the
-- window, with its type and who booked it, their own and the Owner's included, a date-only event as
-- all day; never a title, a client or a location; completed and cancelled events are no booking;
-- Crew, a freelancer, a deactivated member and a signed-out caller read nothing. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner',   '10000000-0000-4000-8000-000000000001'),
  ('admin',   '10000000-0000-4000-8000-000000000002'),
  ('staff',   '10000000-0000-4000-8000-000000000003'),
  ('staff2',  '20000000-0000-4000-8000-000000000001'),
  ('admin2',  '20000000-0000-4000-8000-000000000002'),
  ('lancer',  '40000000-0000-4000-8000-000000000001'),
  ('gone',    '10000000-0000-4000-8000-000000000004'),
  ('client',  '00000000-0000-4000-8000-000000015101'),
  ('org_b',   '00000000-0000-4000-8000-000000014410'),
  ('b_owner', '00000000-0000-4000-8000-000000014411'),
  ('b_admin', '00000000-0000-4000-8000-000000014412'),
  ('b_staff', '00000000-0000-4000-8000-000000014413'),
  ('b_type',  '00000000-0000-4000-8000-000000014414');
insert into fx select 'org', id from public.organizations order by created_at limit 1;
insert into fx select 'shoot', id from public.task_types
  where org_id = (select id from fx where key = 'org') and name = 'Shoot / Site Visit';
insert into fx select 'meeting', id from public.task_types
  where org_id = (select id from fx where key = 'org') and name = 'Meeting';
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
-- The day the bookings are on, far from anything the seed holds.
create function pg_temp.d(n integer default 0) returns date language sql stable as $$ select app.today_ist() + 20 + n; $$;
create function pg_temp.at(n integer, h integer) returns timestamptz language sql stable as $$
  select app.ist_day_start(pg_temp.d(n)) + make_interval(hours => h);
$$;
-- An event task written as the system: who made it, who is on it, its type, day and times.
create function pg_temp.book(k text, by text, who text[], type_key text, day date,
                             starts timestamptz default null, ends timestamptz default null,
                             st public.task_state default 'todo') returns void
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id,
                            client_id, event_date, event_start_at, event_end_at, location,
                            completed_at, cancelled_at, cancelled_reason)
  values (pg_temp.fx('org'), 'Secret title ' || k, pg_temp.fx(type_key), 'medium', now() + interval '30 days', st,
          pg_temp.fx(by), pg_temp.fx(who[1]), pg_temp.fx('client'), day, starts, ends, 'Secret place ' || k,
          case when st = 'completed' then now() end, case when st = 'cancelled' then now() end,
          case when st = 'cancelled' then 'Not needed' end)
  returning id into v_id;
  insert into public.task_assignees (task_id, member_id, is_primary)
  select v_id, pg_temp.fx(m), m = who[1] from unnest(who) m;
end;
$$;
-- A person's next booking after day -1 within `days`, as the caller reads it (one row or none).
create function pg_temp.next(who text, days integer default 30) returns jsonb language sql stable as $$
  select to_jsonb(n) - 'member_id' from public.member_next_booking(pg_temp.d(-1), days) n
  where n.member_id = pg_temp.fx(who);
$$;
create function pg_temp.raised(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
grant execute on function pg_temp.fx(text), pg_temp.d(integer), pg_temp.at(integer, integer),
  pg_temp.next(text, integer), pg_temp.raised(text) to authenticated, anon;

insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Secret client 151', 'active', pg_temp.fx('admin'), now());

-- Bookings: staff's next is a 2–4 pm shoot on day 0 booked by admin2 (a later one on day 3 does not
-- count); staff2's next is a date-only shoot on day 1 booked by the Owner, ahead of a timed one the
-- same day; the Owner on a 10 am meeting with no end on day 2; the Admin on their own shoot on day 0;
-- the freelancer on the same shoot as staff. Completed and cancelled events (day 0, staff2) are no
-- booking; admin2's only event is 40 days out, past the 30-day window.
select pg_temp.book('a', 'admin2', array['staff', 'lancer'], 'shoot', pg_temp.d(), pg_temp.at(0, 14), pg_temp.at(0, 16));
select pg_temp.book('a2', 'admin', array['staff'], 'meeting', pg_temp.d(3), pg_temp.at(3, 9), pg_temp.at(3, 10));
select pg_temp.book('b', 'owner', array['staff2'], 'shoot', pg_temp.d(1));
select pg_temp.book('b2', 'admin', array['staff2'], 'meeting', pg_temp.d(1), pg_temp.at(1, 8), pg_temp.at(1, 9));
select pg_temp.book('g', 'admin', array['staff2'], 'shoot', pg_temp.d(), pg_temp.at(0, 9), pg_temp.at(0, 10), 'completed');
select pg_temp.book('h', 'admin', array['staff2'], 'shoot', pg_temp.d(), null, null, 'cancelled');
select pg_temp.book('c', 'owner', array['owner'], 'meeting', pg_temp.d(2), pg_temp.at(2, 10));
select pg_temp.book('d', 'admin', array['admin'], 'shoot', pg_temp.d(), pg_temp.at(0, 11), pg_temp.at(0, 13));
select pg_temp.book('far', 'admin', array['admin2'], 'shoot', pg_temp.d(40), pg_temp.at(40, 11), pg_temp.at(40, 12));

-- 1. An Admin: allowed ---------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select is(pg_temp.next('staff'),
  jsonb_build_object('on_date', pg_temp.d(), 'start_at', pg_temp.at(0, 14), 'end_at', pg_temp.at(0, 16),
    'all_day', false, 'type_id', pg_temp.fx('shoot'), 'type_name', 'Shoot / Site Visit',
    'booked_by', pg_temp.fx('admin2'), 'booked_by_name', 'Test Gate Admin (desktop)'),
  'an Admin reads a person''s first booking: its day, time, type and who booked it');
select is((pg_temp.next('staff2') ->> 'on_date')::date, pg_temp.d(1),
  'completed and cancelled events are no booking: staff2''s next is day 1');
select is(pg_temp.next('staff2') ->> 'all_day', 'true', 'a date-only event comes first that day, all day');
select is(pg_temp.next('staff2') ->> 'start_at', null, 'with no start');
select is((pg_temp.next('owner') ->> 'end_at')::timestamptz, pg_temp.at(2, 10) + interval '1 hour',
  'the Owner''s booking is answered too; no end = one hour');
select is(pg_temp.next('admin') ->> 'booked_by', pg_temp.fx('admin')::text, 'the caller''s own booking is answered');
select is((pg_temp.next('lancer') ->> 'on_date')::date, pg_temp.d(), 'a freelancer''s booking is answered');
select is(pg_temp.next('admin2'), null, 'nothing within 30 days: no row');
select is((pg_temp.next('admin2', 45) ->> 'on_date')::date, pg_temp.d(40), 'a wider window finds it');
select ok(not exists (select 1 from public.member_next_booking(pg_temp.d(-1), 30) n
                      where to_jsonb(n)::text ~ 'Secret'),
  'never a title, a client or a location');
select is(pg_temp.raised('select * from public.member_next_booking(current_date, 63)'), 'VALIDATION',
  'more than 62 days: VALIDATION');
select is(pg_temp.raised('select * from public.member_next_booking(null, 30)'), 'VALIDATION', 'no date: VALIDATION');

-- 2. The Owner: allowed -----------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is((pg_temp.next('staff') ->> 'on_date')::date, pg_temp.d(), 'the Owner reads the same');

-- 3. Refused ---------------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(pg_temp.raised('select * from public.member_next_booking(current_date, 30)'), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_member('lancer');
select ok(pg_temp.raised('select * from public.member_next_booking(current_date, 30)') in ('FORBIDDEN', 'UNAUTHENTICATED'),
  'a freelancer reads nothing');
select pg_temp.as_member('gone');
select is(pg_temp.raised('select * from public.member_next_booking(current_date, 30)'), 'UNAUTHENTICATED',
  'a deactivated member: UNAUTHENTICATED');
select pg_temp.as_anon();
select is(pg_temp.raised('select * from public.member_next_booking(current_date, 30)'),
  'permission denied for function member_next_booking', 'anon: no EXECUTE');
select pg_temp.as_system();
select ok(not has_function_privilege('anon', 'public.member_next_booking(date, integer)', 'execute'),
  'revoked from anon');

select * from finish();
rollback;
