-- 2.2 Two devices at once (WORKFLOWS §1 "Settled in 2.2"): attendance_touch() is serialised per
-- member, so a phone and a laptop opening the app at the same instant give one day and ONE
-- session_events(login). One pgTAP session cannot prove that, so this file opens two more real
-- connections with dblink and orders them deterministically:
--   A touches and keeps its transaction open; B touches and must be WAITING ON THE ADVISORY LOCK
--   (polled in pg_stat_activity with a bounded timeout, no fixed sleep); A commits; B finishes.
-- Without the lock B would insert its own login row and only block later on the day's unique key,
-- which is exactly the double login this file refuses.
--
-- The other connections cannot see this file's uncommitted rows, so the fixture member is
-- COMMITTED through a third connection and removed again at the start and at the end (a failed
-- run leaves nothing that the next run does not clean up). The seed is not touched.
-- dblink needs a password for a non-superuser: it connects over TCP to the address this session
-- came in on, with the local stack's default `postgres` password (local and CI only, not a secret).
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(9);

create function pg_temp.conninfo() returns text language sql stable as $$
  select format('hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database());
$$;

-- The fixture member (fixed id, committed through c0).
create function pg_temp.member() returns uuid language sql immutable as $$
  select '0e000000-0000-4000-8000-000000000009'::uuid;
$$;

create function pg_temp.cleanup() returns void language plpgsql as $$
begin
  perform extensions.dblink_exec('c0', format($q$
    delete from public.attendance_events where attendance_day_id in (select id from public.attendance_days where member_id = %1$L);
    delete from public.activity_log where entity = 'attendance_days'
      and entity_id in (select id from public.attendance_days where member_id = %1$L);
    delete from public.attendance_days where member_id = %1$L;
    delete from public.session_events where member_id = %1$L;
    delete from public.members where id = %1$L;
    delete from public.activity_log where entity = 'members' and entity_id = %1$L;
    delete from auth.users where id = %1$L;
  $q$, pg_temp.member()));
end;
$$;

-- Opens a transaction on connection c as the fixture member, the way PostgREST would.
create function pg_temp.begin_as_member(c text) returns void language plpgsql as $$
begin
  perform extensions.dblink_exec(c, 'begin');
  perform extensions.dblink_exec(c, format(
    'set local request.jwt.claim.sub = %L; set local request.jwt.claims = %L; set local role authenticated',
    pg_temp.member(), json_build_object('sub', pg_temp.member(), 'role', 'authenticated')::text));
end;
$$;

-- Waits (bounded, ~5 s) until backend p waits on a lock; answers the wait event, or null.
create function pg_temp.lock_wait_of(p integer) returns text language plpgsql as $$
declare
  v text;
begin
  for i in 1..250 loop
    perform pg_stat_clear_snapshot(); -- pg_stat_activity is otherwise frozen for this transaction
    select a.wait_event into v from pg_stat_activity a where a.pid = p and a.wait_event_type = 'Lock';
    if v is not null then
      return v;
    end if;
    perform pg_sleep(0.02);
  end loop;
  return null;
end;
$$;

select extensions.dblink_connect('c0', pg_temp.conninfo());
select extensions.dblink_connect('a', pg_temp.conninfo());
select extensions.dblink_connect('b', pg_temp.conninfo());

-- A committed staff member who joined a month ago (so the gate asks today).
select pg_temp.cleanup();
select extensions.dblink_exec('c0', format($q$
  insert into auth.users (id, email) values (%1$L, 'concurrency@example.com');
  insert into public.members (id, org_id, full_name, email, role, status, joined_at)
  values (%1$L, (select id from public.organizations limit 1), 'Two Devices',
          'concurrency@example.com', 'staff', 'active', now() - interval '30 days');
$q$, pg_temp.member()));

create temporary table b_pid as
  select pid from extensions.dblink('b', 'select pg_backend_pid()') as t(pid integer);
create temporary table result (device text, day_id uuid);

-- A: the laptop touches first and holds its transaction open.
select pg_temp.begin_as_member('a');
insert into result
  select 'a', day_id from extensions.dblink('a', 'select day_id from public.attendance_touch()') as t(day_id uuid);

-- B: the phone touches at the same instant.
select pg_temp.begin_as_member('b');
select is(extensions.dblink_send_query('b', 'select day_id from public.attendance_touch()'), 1,
  'the second device sends its touch while the first is still open');
select is(pg_temp.lock_wait_of((select pid from b_pid)), 'advisory',
  'the second touch waits on the member''s touch lock, before writing anything');
select is((select count(*) from public.session_events where member_id = pg_temp.member()), 0::bigint,
  'nothing is committed yet by either device');

-- A commits; B continues and finds A's login and day.
select extensions.dblink_exec('a', 'commit');
insert into result
  select 'b', day_id from extensions.dblink_get_result('b') as t(day_id uuid);
select is((select count(*) from extensions.dblink_get_result('b') as t(day_id uuid)), 0::bigint,
  'the second touch returned exactly one row');
select extensions.dblink_exec('b', 'commit');

select is((select count(*) from public.session_events where member_id = pg_temp.member() and kind = 'login'), 1::bigint,
  'two devices at once: exactly one login row');
select is((select count(*) from public.attendance_days where member_id = pg_temp.member()), 1::bigint,
  'and exactly one day');
select is((select count(distinct day_id) from result where day_id is not null), 1::bigint,
  'both devices were handed the same day');
select is((select count(*) from result), 2::bigint, 'and both got an answer');
select is(
  (select count(*) from public.activity_log where entity = 'attendance_days' and action = 'opened'
     and entity_id in (select id from public.attendance_days where member_id = pg_temp.member())),
  1::bigint, 'the day was opened once, audited once');

select pg_temp.cleanup();
select extensions.dblink_disconnect('a');
select extensions.dblink_disconnect('b');
select extensions.dblink_disconnect('c0');

select * from finish();
rollback;
