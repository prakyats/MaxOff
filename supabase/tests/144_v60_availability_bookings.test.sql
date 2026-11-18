-- v6.0 "Admin calendar": the availability data change (migration v60_availability_bookings; owner
-- 13 and 14 Nov 2026, #89 6847654724 and 6874042506; PERMISSIONS §2 "Availability of others",
-- WORKFLOWS §3.1 "Assignment warnings"). member_availability() for each role, allowed and denied:
-- the Owner and an Admin read every booking with its type and who booked it, their own and the
-- Owner's included, a date-only event as busy all day; a block never carries a title, a client, a
-- location or a task id; completed and cancelled events are no booking; Crew, a freelancer and a
-- signed-out caller read nothing; another organisation's bookings never cross. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner',   '10000000-0000-4000-8000-000000000001'),
  ('admin',   '10000000-0000-4000-8000-000000000002'),
  ('staff',   '10000000-0000-4000-8000-000000000003'),
  ('staff2',  '20000000-0000-4000-8000-000000000001'),
  ('admin2',  '20000000-0000-4000-8000-000000000002'),
  ('lancer',  '40000000-0000-4000-8000-000000000001'),
  ('client',  '00000000-0000-4000-8000-000000014401'),
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
-- A person's blocks on a day, as the caller reads them.
create function pg_temp.blocks(who text, n integer default 0) returns jsonb language sql stable as $$
  select a.event_blocks from public.member_availability(pg_temp.d(n), pg_temp.d(n), array[pg_temp.fx(who)]) a;
$$;
grant execute on function pg_temp.fx(text), pg_temp.d(integer), pg_temp.at(integer, integer),
  pg_temp.blocks(text, integer) to authenticated, anon;

insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Secret client 144', 'active', pg_temp.fx('admin'), now());

-- Day 0: staff on a 2–4 pm shoot booked by admin2; staff2 on a date-only shoot booked by the Owner;
-- the Owner on a 10 am meeting with no end, booked by the Owner; the Admin (the caller below) on an
-- 11–1 shoot they booked themselves; the freelancer on the same shoot as staff.
select pg_temp.book('a', 'admin2', array['staff', 'lancer'], 'shoot', pg_temp.d(), pg_temp.at(0, 14), pg_temp.at(0, 16));
select pg_temp.book('b', 'owner', array['staff2'], 'shoot', pg_temp.d());
select pg_temp.book('c', 'owner', array['owner'], 'meeting', pg_temp.d(), pg_temp.at(0, 10));
select pg_temp.book('d', 'admin', array['admin'], 'shoot', pg_temp.d(), pg_temp.at(0, 11), pg_temp.at(0, 13));
-- Day 1: staff on a date-only meeting and a timed shoot (the all-day block comes first); a
-- completed and a cancelled event that are no booking.
select pg_temp.book('e', 'admin', array['staff'], 'shoot', pg_temp.d(1), pg_temp.at(1, 9), pg_temp.at(1, 10));
select pg_temp.book('f', 'admin2', array['staff'], 'meeting', pg_temp.d(1));
select pg_temp.book('g', 'admin', array['staff2'], 'shoot', pg_temp.d(1), pg_temp.at(1, 9), pg_temp.at(1, 10), 'completed');
select pg_temp.book('h', 'admin', array['staff2'], 'shoot', pg_temp.d(1), null, null, 'cancelled');

-- Another organisation with a booking on day 0.
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Other org 144');
insert into auth.users (id, email)
select pg_temp.fx(k), 'v60-' || k || '-144@example.com' from unnest(array['b_owner', 'b_admin', 'b_staff']) k;
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at)
select pg_temp.fx(k), pg_temp.fx('org_b'), 'Other ' || k || ' 144', 'v60-' || k || '-144@example.com',
       r::public.member_role, 'active', 'permanent', now() - interval '20 days'
from (values ('b_owner', 'owner'), ('b_admin', 'admin'), ('b_staff', 'staff')) v(k, r);
-- Written with org B's Owner as the session's member (still the system role): with two
-- organisations and no session the audit trigger has no organisation to file a row under.
select set_config('request.jwt.claim.sub', pg_temp.fx('b_owner')::text, true);
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx('b_owner'), 'role', 'authenticated')::text, true);
insert into public.task_types (id, org_id, name, kind, shows_on_calendar) values
  (pg_temp.fx('b_type'), pg_temp.fx('org_b'), 'Other type 144', 'event', true);
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id, event_date)
values (pg_temp.fx('org_b'), 'Other task 144', pg_temp.fx('b_type'), 'medium', now() + interval '30 days', 'todo',
        pg_temp.fx('b_owner'), pg_temp.fx('b_staff'), pg_temp.d());
insert into public.task_assignees (task_id, member_id, is_primary)
select id, pg_temp.fx('b_staff'), true from public.tasks where title = 'Other task 144';
select pg_temp.as_system();

-- 1. An Admin: allowed ---------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select is(pg_temp.blocks('staff'),
  jsonb_build_array(jsonb_build_object(
    'start_at', pg_temp.at(0, 14), 'end_at', pg_temp.at(0, 16), 'all_day', false,
    'type_id', pg_temp.fx('shoot'), 'type_name', 'Shoot / Site Visit',
    'booked_by', pg_temp.fx('admin2'), 'booked_by_name', 'Test Gate Admin (desktop)')),
  'an Admin reads another person''s booking: the time, the type and who booked it');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.blocks('staff') -> 0) k),
  array['all_day', 'booked_by', 'booked_by_name', 'end_at', 'start_at', 'type_id', 'type_name'],
  'a block has exactly these keys: never a title, a client, a location or a task id');
select ok(pg_temp.blocks('staff')::text !~* 'secret', 'nothing of the task''s title, client or place is in it');
select is(pg_temp.blocks('staff2'),
  jsonb_build_array(jsonb_build_object(
    'start_at', null, 'end_at', null, 'all_day', true,
    'type_id', pg_temp.fx('shoot'), 'type_name', 'Shoot / Site Visit',
    'booked_by', pg_temp.fx('owner'), 'booked_by_name', 'Prishit Shetty')),
  'a date-only event is a block: busy all day, no start or end, booked by the Owner');
select is(pg_temp.blocks('owner') -> 0 ->> 'type_name', 'Meeting', 'the Owner''s booking shows its type to an Admin');
select is((pg_temp.blocks('owner') -> 0 ->> 'end_at')::timestamptz, pg_temp.at(0, 11), 'no end is one hour, as before');
select is((pg_temp.blocks('owner') -> 0 ->> 'booked_by')::uuid, pg_temp.fx('owner'), 'and the Owner booked it');
select is(jsonb_array_length(pg_temp.blocks('admin')), 1, 'the Admin''s own booking counts too');
select is((pg_temp.blocks('admin') -> 0 ->> 'booked_by')::uuid, pg_temp.fx('admin'), 'booked by the Admin');
select is(pg_temp.blocks('lancer') -> 0 ->> 'type_name', 'Shoot / Site Visit', 'a freelancer''s booking is read the same way');
select is(jsonb_array_length(pg_temp.blocks('admin2')), 0, 'booking someone is not being booked');
select is(jsonb_array_length(pg_temp.blocks('staff', 1)), 2, 'two bookings on a day are two blocks');
select is((pg_temp.blocks('staff', 1) -> 0 ->> 'all_day')::boolean, true, 'the all-day one first');
select is(pg_temp.blocks('staff', 1) -> 0 ->> 'type_name', 'Meeting', 'with its own type');
select is((pg_temp.blocks('staff', 1) -> 1 ->> 'start_at')::timestamptz, pg_temp.at(1, 9), 'then the timed one');
select is(jsonb_array_length(pg_temp.blocks('staff2', 1)), 0, 'a completed and a cancelled event are no booking');
select is((select count(*) from public.member_availability(pg_temp.d(), pg_temp.d()) a
           where a.member_id in (pg_temp.fx('b_owner'), pg_temp.fx('b_admin'), pg_temp.fx('b_staff'))), 0::bigint,
  'an Admin reads nobody of another organisation');
select is((select count(*) from public.member_availability(pg_temp.d(), pg_temp.d(), array[pg_temp.fx('b_staff')]) a), 0::bigint,
  'not when asked for by id either');
select is((select a.leave is null and a.present is null from public.member_availability(pg_temp.d(), pg_temp.d(), array[pg_temp.fx('owner')]) a),
  true, 'never leave or attendance for the Owner, as before');
select is((select count(*) from public.member_availability(pg_temp.d(), pg_temp.d(1), array[pg_temp.fx('staff')]) a), 2::bigint,
  'still one row per person per day');

-- 2. The Owner: allowed --------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(pg_temp.blocks('staff') -> 0 ->> 'booked_by_name', 'Test Gate Admin (desktop)', 'the Owner reads who booked a person');
select is((pg_temp.blocks('staff2') -> 0 ->> 'all_day')::boolean, true, 'and a date-only event as busy all day');
select is(jsonb_array_length(pg_temp.blocks('owner')), 1, 'the Owner''s own booking counts too');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.blocks('admin') -> 0) k),
  array['all_day', 'booked_by', 'booked_by_name', 'end_at', 'start_at', 'type_id', 'type_name'],
  'the same keys for the Owner');

-- 3. Another organisation's Admin: their own people only -------------------------------------------------
select pg_temp.as_member('b_admin');
select is((select count(*) from public.member_availability(pg_temp.d(), pg_temp.d(), array[pg_temp.fx('staff')]) a), 0::bigint,
  'another organisation''s Admin reads none of ours');
select is(pg_temp.blocks('b_staff') -> 0 ->> 'type_name', 'Other type 144', 'and their own person''s booking');

-- 4. Crew, a freelancer and a signed-out caller: denied --------------------------------------------------
select pg_temp.as_member('staff');
select throws_ok($$ select * from public.member_availability(pg_temp.d(), pg_temp.d()) $$,
  'P0001', 'FORBIDDEN', 'Crew read nobody''s bookings');
select throws_ok($$ select * from public.member_availability(pg_temp.d(), pg_temp.d(), array[pg_temp.fx('staff')]) $$,
  'P0001', 'FORBIDDEN', 'not their own through this function either');
select pg_temp.as_member('lancer');
select throws_ok($$ select * from public.member_availability(pg_temp.d(), pg_temp.d()) $$,
  'P0001', null, 'a freelancer (no sign-in) reads nothing');
select pg_temp.as_anon();
select throws_ok($$ select * from public.member_availability(pg_temp.d(), pg_temp.d()) $$,
  '42501', null, 'a signed-out caller may not call it');
select pg_temp.as_system();
select ok(not has_function_privilege('anon', 'public.member_availability(date, date, uuid[])', 'execute'),
  'anon holds no execute on it');

select * from finish();
rollback;
