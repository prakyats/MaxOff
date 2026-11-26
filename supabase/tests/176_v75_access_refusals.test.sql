-- v7.5 Q6 (owner 2026-11-26; migration v75_access_refusals): access_refusals' RLS for each role
-- (nobody but the service role reads or writes it), access_refusal_note() on every path (the
-- caller's own row for today and nobody else's; a second call adds one; a deactivated, an invited
-- or an unknown caller writes nothing; anon may not call it), and access_refusals_daily() on every
-- path (20 is not enough and 21 is; one member's note links their profile, two or more one note
-- linking People; each day once; another organisation's counts go to its own Owner only; only the
-- day before counts). Neutral names only.
begin;
\ir lib/lock-job-tables.psql
create extension if not exists pgtap with schema extensions;
select plan(30);

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner',   '10000000-0000-4000-8000-000000000001'),
  ('admin',   '10000000-0000-4000-8000-000000000002'),
  ('staff',   '10000000-0000-4000-8000-000000000003'),
  ('gone',    '00000000-0000-4000-8000-000000017601'),
  ('invited', '00000000-0000-4000-8000-000000017602'),
  ('nobody',  '00000000-0000-4000-8000-000000017609'),
  ('org_b',   '00000000-0000-4000-8000-000000017610'),
  ('b_owner', '00000000-0000-4000-8000-000000017611'),
  ('b_staff', '00000000-0000-4000-8000-000000017612');
insert into fx select 'org', id from public.organizations order by created_at limit 1;
grant select on fx to authenticated;
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
create function pg_temp.raised(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlstate;
end;
$$;
create function pg_temp.refusals(k text, d date default app.today_ist()) returns integer
language sql stable as $$
  select refusals from public.access_refusals where member_id = pg_temp.fx(k) and day = d;
$$;
-- The morning run for "yesterday" = today_ist() - 1: now() is any moment of today (IST).
create function pg_temp.run() returns integer language sql as $$
  select public.access_refusals_daily(now());
$$;
create function pg_temp.notes(k text) returns bigint language sql stable as $$
  select count(*) from public.notifications where recipient_id = pg_temp.fx(k) and kind = 'access_refusals';
$$;

delete from public.access_refusals;
delete from public.notifications where kind = 'access_refusals';

insert into auth.users (id, email) values
  (pg_temp.fx('gone'), 'refusals-gone-17601@example.com'),
  (pg_temp.fx('invited'), 'refusals-invited-17602@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('gone'),    pg_temp.fx('org'), 'Refusals gone 176',    'refusals-gone-17601@example.com',    'staff', 'deactivated', 'permanent', now() - interval '9 days', now()),
  (pg_temp.fx('invited'), pg_temp.fx('org'), 'Refusals invited 176', 'refusals-invited-17602@example.com', 'staff', 'invited',     'permanent', null, null);
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Refusals other org 176');
insert into auth.users (id, email)
select pg_temp.fx(k), 'refusals-' || k || '-176@example.com' from unnest(array['b_owner', 'b_staff']) k;
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at)
select pg_temp.fx(k), pg_temp.fx('org_b'), 'Refusals ' || k || ' 176', 'refusals-' || k || '-176@example.com',
       r::public.member_role, 'active', 'permanent', now() - interval '20 days'
from (values ('b_owner', 'owner'), ('b_staff', 'staff')) v(k, r);

-- 1. The table: RLS on, nothing for the API roles ---------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.access_refusals'::regclass),
  'access_refusals has RLS on');
select ok(not has_table_privilege('authenticated', 'public.access_refusals', 'select')
          and not has_table_privilege('authenticated', 'public.access_refusals', 'insert')
          and not has_table_privilege('authenticated', 'public.access_refusals', 'update')
          and not has_table_privilege('authenticated', 'public.access_refusals', 'delete'),
  'authenticated holds no privilege on access_refusals');
select ok(not has_table_privilege('anon', 'public.access_refusals', 'select')
          and not has_table_privilege('anon', 'public.access_refusals', 'insert'),
  'anon holds no privilege on access_refusals');
select ok(has_table_privilege('service_role', 'public.access_refusals', 'select'),
  'service_role reads access_refusals');
select ok(not has_function_privilege('anon', 'public.access_refusal_note()', 'execute'),
  'anon may not call access_refusal_note');
select ok(has_function_privilege('authenticated', 'public.access_refusal_note()', 'execute'),
  'a member may call access_refusal_note');
select ok(not has_function_privilege('authenticated', 'public.access_refusals_daily(timestamptz)', 'execute')
          and not has_function_privilege('anon', 'public.access_refusals_daily(timestamptz)', 'execute'),
  'only the service role runs access_refusals_daily');

-- 2. Each role reads nothing (allowed paths: none) --------------------------------------------------
select pg_temp.as_member('owner');
select is(pg_temp.raised('select * from public.access_refusals'), '42501', 'the Owner cannot read access_refusals');
select pg_temp.as_member('admin');
select is(pg_temp.raised('select * from public.access_refusals'), '42501', 'an Admin cannot read access_refusals');
select pg_temp.as_member('staff');
select is(pg_temp.raised('select * from public.access_refusals'), '42501', 'Crew cannot read access_refusals');
select is(pg_temp.raised($$insert into public.access_refusals (member_id, org_id, day) values ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', current_date)$$),
  '42501', 'Crew cannot write a row for someone else');

-- 3. A refusal counts against the caller only ------------------------------------------------------
select pg_temp.as_member('staff');
select public.access_refusal_note();
select pg_temp.as_system();
select is(pg_temp.refusals('staff'), 1, 'the first refusal starts the caller''s row for today at 1');
select is((select org_id from public.access_refusals where member_id = pg_temp.fx('staff')), pg_temp.fx('org'),
  'the row is in the caller''s organisation');
select pg_temp.as_member('staff');
select public.access_refusal_note();
select public.access_refusal_note();
select pg_temp.as_system();
select is(pg_temp.refusals('staff'), 3, 'each further refusal adds one');
select ok((select last_at >= first_at from public.access_refusals where member_id = pg_temp.fx('staff')),
  'first_at stays, last_at moves');
select pg_temp.as_member('admin');
select public.access_refusal_note();
select pg_temp.as_system();
select is(pg_temp.refusals('admin'), 1, 'another member has their own row');
select is(pg_temp.refusals('staff'), 3, 'and the first member''s count is untouched');
select pg_temp.as_member('gone');
select public.access_refusal_note();
select pg_temp.as_member('invited');
select public.access_refusal_note();
select pg_temp.as_member('nobody');
select public.access_refusal_note();
select pg_temp.as_system();
select is((select count(*) from public.access_refusals
           where member_id in (pg_temp.fx('gone'), pg_temp.fx('invited'), pg_temp.fx('nobody'))),
  0::bigint, 'a deactivated, an invited or an unknown caller writes nothing');

-- 4. The morning note ------------------------------------------------------------------------------
delete from public.access_refusals;
-- Yesterday: Crew 21 (in the note), the Admin exactly 20 (not); today's counts never count.
insert into public.access_refusals (member_id, org_id, day, refusals) values
  (pg_temp.fx('staff'), pg_temp.fx('org'), app.today_ist() - 1, 21),
  (pg_temp.fx('admin'), pg_temp.fx('org'), app.today_ist() - 1, 20),
  (pg_temp.fx('admin'), pg_temp.fx('org'), app.today_ist(), 90),
  (pg_temp.fx('staff'), pg_temp.fx('org'), app.today_ist() - 2, 50);
select is(pg_temp.run(), 1, 'one note for yesterday');
select is(pg_temp.notes('owner'), 1::bigint, 'the Owner has it');
select is((select count(*) from public.notifications where kind = 'access_refusals' and recipient_id <> pg_temp.fx('owner')),
  0::bigint, 'nobody else does');
select is((select title from public.notifications where kind = 'access_refusals' and recipient_id = pg_temp.fx('owner')),
  (select full_name from public.members where id = pg_temp.fx('staff')) || ' hit "No access" 21 times yesterday',
  'one member: their name and count, not the Admin''s 20 or today''s 90');
select is((select link from public.notifications where kind = 'access_refusals' and recipient_id = pg_temp.fx('owner')),
  '/people/' || pg_temp.fx('staff'), 'it opens their profile');
select ok((select noted_at is not null from public.access_refusals where member_id = pg_temp.fx('staff') and day = app.today_ist() - 1),
  'the day is marked noted');
select is(pg_temp.run(), 0, 'a second run the same morning sends nothing more');

-- Two people over in one organisation; another organisation's member over too.
delete from public.notifications where kind = 'access_refusals';
delete from public.access_refusals;
insert into public.access_refusals (member_id, org_id, day, refusals) values
  (pg_temp.fx('staff'),   pg_temp.fx('org'),   app.today_ist() - 1, 22),
  (pg_temp.fx('admin'),   pg_temp.fx('org'),   app.today_ist() - 1, 40),
  (pg_temp.fx('b_staff'), pg_temp.fx('org_b'), app.today_ist() - 1, 30);
select is(pg_temp.run(), 2, 'one note per organisation');
select is((select title from public.notifications where kind = 'access_refusals' and recipient_id = pg_temp.fx('owner')),
  '2 people hit "No access" more than 20 times yesterday', 'two people: one note, counted');
select is((select link from public.notifications where kind = 'access_refusals' and recipient_id = pg_temp.fx('owner')),
  '/people', 'it opens People');
select ok((select body like (select full_name from public.members where id = pg_temp.fx('admin')) || ' 40 · '
                            || (select full_name from public.members where id = pg_temp.fx('staff')) || ' 22.%'
           from public.notifications where kind = 'access_refusals' and recipient_id = pg_temp.fx('owner')),
  'the body names each, most refused first');
select is((select title from public.notifications where kind = 'access_refusals' and recipient_id = pg_temp.fx('b_owner')),
  'Refusals b_staff 176 hit "No access" 30 times yesterday', 'the other organisation''s Owner gets their own member only');

select * from finish();
rollback;
