-- 2.4 Lock order (WORKFLOWS §1 "Settled in 2.4", DATA-MODEL §3): every function that writes a
-- member's days or leave takes the member's leave: advisory lock BEFORE any row lock, so two
-- actions on one person serialise instead of deadlocking. Built like 09 (dblink, fixtures
-- committed through c0 and removed at both ends):
--   1. For each function: A holds leave:<member>; B calls the function and must be WAITING ON THE
--      ADVISORY LOCK; meanwhile C can still lock the function's row (FOR UPDATE NOWAIT), which
--      proves B took no row lock first. A lets go; B finishes and rolls back.
--      attendance_touch is checked on a member with no day yet: opening one takes leave: too.
--   2. The old deadlock replayed: attendance_decide on a gate day (it used to lock day → request)
--      against leave_decide approving leave over the same date (request → gate request → days).
--      Both now finish, one after the other.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(24);

create function pg_temp.conninfo() returns text language sql stable as $$
  select format('hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database());
$$;

-- Fixture members (fixed ids, committed through c0). The Owner is the seeded one: there is only
-- ever one.
create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('member', '0e000000-0000-4000-8000-000000000012'),
  ('gate',   '0e000000-0000-4000-8000-000000000013'),
  ('race',   '0e000000-0000-4000-8000-000000000014'),
  ('fresh',  '0e000000-0000-4000-8000-000000000015');
insert into fx select 'owner', id from public.members where role = 'owner';

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;

create function pg_temp.cleanup() returns void language plpgsql as $$
declare
  v_ids text := format('%L, %L, %L, %L', pg_temp.fx('member'), pg_temp.fx('gate'), pg_temp.fx('race'),
                        pg_temp.fx('fresh'));
begin
  perform extensions.dblink_exec('c0', format($q$
    delete from public.attendance_events where attendance_day_id in (select id from public.attendance_days where member_id in (%1$s));
    delete from public.activity_log where entity = 'attendance_days'
      and entity_id in (select id from public.attendance_days where member_id in (%1$s));
    delete from public.activity_log where entity = 'leave_requests'
      and entity_id in (select id from public.leave_requests where member_id in (%1$s));
    delete from public.attendance_days where member_id in (%1$s);
    delete from public.leave_requests where member_id in (%1$s);
    delete from public.session_events where member_id in (%1$s);
    delete from public.members where id in (%1$s);
    delete from public.activity_log where entity = 'members' and entity_id in (%1$s);
    delete from auth.users where id in (%1$s);
  $q$, v_ids));
end;
$$;

-- Opens a transaction on connection c as member k, the way PostgREST would.
create function pg_temp.begin_as(c text, k text) returns void language plpgsql as $$
begin
  perform extensions.dblink_exec(c, 'begin');
  perform extensions.dblink_exec(c, format(
    'set local request.jwt.claim.sub = %L; set local request.jwt.claims = %L; set local role authenticated',
    pg_temp.fx(k), json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text));
end;
$$;

-- Waits (bounded, ~5 s) until backend p waits on a lock; answers the wait event, or null.
create function pg_temp.lock_wait_of(p integer) returns text language plpgsql as $$
declare
  v text;
begin
  for i in 1..250 loop
    perform pg_stat_clear_snapshot();
    select a.wait_event into v from pg_stat_activity a where a.pid = p and a.wait_event_type = 'Lock';
    if v is not null then
      return v;
    end if;
    perform pg_sleep(0.02);
  end loop;
  return null;
end;
$$;

-- 'ok' when connection c can lock the row right now, else the error (a row lock held elsewhere).
create function pg_temp.row_free(tbl text, row_id uuid) returns text language plpgsql as $$
declare
  v text;
begin
  perform extensions.dblink_exec('c', 'begin');
  begin
    perform * from extensions.dblink('c', format('select id from public.%I where id = %L for update nowait', tbl, row_id))
      as t(id uuid);
    v := 'ok';
  exception when others then
    v := sqlerrm;
  end;
  perform extensions.dblink_exec('c', 'rollback');
  return v;
end;
$$;

-- The whole check for one function: A holds member k's leave: lock, B (as caller) sends q.
create function pg_temp.waits_first(k text, caller text, q text, tbl text, row_id uuid)
returns text[] language plpgsql as $$
declare
  v_wait text;
  v_free text;
  v_done text;
begin
  perform extensions.dblink_exec('a', 'begin');
  perform * from extensions.dblink('a', format('select pg_advisory_xact_lock(hashtext(%L))', 'leave:' || pg_temp.fx(k)))
    as t(x text);
  perform pg_temp.begin_as('b', caller);
  perform extensions.dblink_send_query('b', q);
  v_wait := pg_temp.lock_wait_of((select pid from b_pid));
  v_free := pg_temp.row_free(tbl, row_id);
  perform extensions.dblink_exec('a', 'rollback');
  -- B now runs; drain its result (and the end-of-results marker), then undo it.
  begin
    perform * from extensions.dblink_get_result('b') as t(x text);
    v_done := 'ok';
  exception when others then
    v_done := sqlerrm;
  end;
  perform * from extensions.dblink_get_result('b', false) as t(x text);
  perform extensions.dblink_exec('b', 'rollback');
  return array[coalesce(v_wait, 'no wait'), v_free, v_done];
end;
$$;

select extensions.dblink_connect('c0', pg_temp.conninfo());
select extensions.dblink_connect('a', pg_temp.conninfo());
select extensions.dblink_connect('b', pg_temp.conninfo());
select extensions.dblink_connect('c', pg_temp.conninfo());

create temporary table b_pid as
  select pid from extensions.dblink('b', 'select pg_backend_pid()') as t(pid integer);

select pg_temp.cleanup();
select extensions.dblink_exec('c0', format($q$
  insert into auth.users (id, email) values
    (%1$L, 'lock-member@example.com'), (%2$L, 'lock-gate@example.com'), (%3$L, 'lock-race@example.com'),
    (%5$L, 'lock-fresh@example.com');
  insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
    (%1$L, (select id from public.organizations limit 1), 'Lock Member', 'lock-member@example.com', 'staff', 'active', now() - interval '30 days'),
    (%2$L, (select id from public.organizations limit 1), 'Lock Gate',   'lock-gate@example.com',   'staff', 'active', now() - interval '30 days'),
    (%3$L, (select id from public.organizations limit 1), 'Lock Race',   'lock-race@example.com',   'staff', 'active', now() - interval '30 days'),
    (%5$L, (select id from public.organizations limit 1), 'Lock Fresh',  'lock-fresh@example.com',  'staff', 'active', now() - interval '30 days');
  -- member: a waiting day, a waiting form request, an approved one, another waiting one.
  insert into public.attendance_days (member_id, work_date, first_login_at, state, submitted_choice, submitted_at)
    values (%1$L, app.today_ist(), now(), 'pending_review', 'present', now());
  insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at) values
    (%1$L, 'leave', app.today_ist() + 20, app.today_ist() + 20, 'submitted', 'form', null, null),
    (%1$L, 'leave', app.today_ist() + 30, app.today_ist() + 31, 'approved',  'form', %4$L, now()),
    (%1$L, 'leave', app.today_ist() + 40, app.today_ist() + 40, 'submitted', 'form', null, null);
  -- gate: today's day still waiting for a choice.
  insert into public.attendance_days (member_id, work_date, first_login_at, state)
    values (%2$L, app.today_ist(), now(), 'awaiting_choice');
  -- race: chose Leave at the gate today (a submitted gate request linked to the waiting day) and
  -- also has a waiting form request covering today.
  insert into public.leave_requests (id, member_id, type, start_date, end_date, state, source) values
    ('0e000000-0000-4000-8000-0000000000a1', %3$L, 'leave', app.today_ist(), app.today_ist(), 'submitted', 'attendance'),
    ('0e000000-0000-4000-8000-0000000000a2', %3$L, 'leave', app.today_ist(), app.today_ist() + 1, 'submitted', 'form');
  insert into public.attendance_days (member_id, work_date, first_login_at, state, submitted_choice, submitted_at, leave_request_id)
    values (%3$L, app.today_ist(), now(), 'pending_review', 'leave', now(), '0e000000-0000-4000-8000-0000000000a1');
$q$, pg_temp.fx('member'), pg_temp.fx('gate'), pg_temp.fx('race'), pg_temp.fx('owner'), pg_temp.fx('fresh')));

create temporary table ids as
select * from extensions.dblink('c0', format($q$
  select 'day', id from public.attendance_days where member_id = %1$L
  union all select 'waiting', id from public.leave_requests where member_id = %1$L and start_date = app.today_ist() + 20
  union all select 'approved', id from public.leave_requests where member_id = %1$L and state = 'approved'
  union all select 'withdraw', id from public.leave_requests where member_id = %1$L and start_date = app.today_ist() + 40
  union all select 'gate_day', id from public.attendance_days where member_id = %2$L
  union all select 'race_day', id from public.attendance_days where member_id = %3$L
$q$, pg_temp.fx('member'), pg_temp.fx('gate'), pg_temp.fx('race'))) as t(k text, id uuid);

create function pg_temp.id(k text) returns uuid language sql stable as $$
  select id from ids where ids.k = $1;
$$;

-- 1. Each function waits on the advisory lock, holding no row lock yet ---------------------------
create temporary table checks (fn text primary key, r text[]);
insert into checks values
  ('attendance_decide', pg_temp.waits_first('member', 'owner',
     format('select public.attendance_decide(%L, ''approve'')::text', pg_temp.id('day')), 'attendance_days', pg_temp.id('day'))),
  ('leave_decide', pg_temp.waits_first('member', 'owner',
     format('select state::text from public.leave_decide(%L, ''approve'')', pg_temp.id('waiting')), 'leave_requests', pg_temp.id('waiting'))),
  ('leave_owner_edit', pg_temp.waits_first('member', 'owner',
     format('select new_id::text from public.leave_owner_edit(%L, ''leave'', app.today_ist() + 32, app.today_ist() + 33)', pg_temp.id('approved')),
     'leave_requests', pg_temp.id('approved'))),
  ('leave_owner_cancel', pg_temp.waits_first('member', 'owner',
     format('select public.leave_owner_cancel(%L, ''Plans changed'')::text', pg_temp.id('approved')), 'leave_requests', pg_temp.id('approved'))),
  ('leave_withdraw', pg_temp.waits_first('member', 'member',
     format('select public.leave_withdraw(%L)::text', pg_temp.id('withdraw')), 'leave_requests', pg_temp.id('withdraw'))),
  ('attendance_submit', pg_temp.waits_first('gate', 'gate',
     'select public.attendance_submit(''leave'')::text', 'attendance_days', pg_temp.id('gate_day'))),
  -- Opening a day (no row yet, so there is no row lock to hold): touch waits for the Owner's
  -- leave decision instead of deriving the day from leave that is being changed.
  ('attendance_touch', pg_temp.waits_first('fresh', 'fresh',
     'select day_id::text from public.attendance_touch()', 'attendance_days', gen_random_uuid()));

select is((select r[1] from checks where fn = 'attendance_decide'), 'advisory', 'attendance_decide waits on the leave: lock first');
select is((select r[2] from checks where fn = 'attendance_decide'), 'ok', 'attendance_decide: the day is not locked yet');
select is((select r[3] from checks where fn = 'attendance_decide'), 'ok', 'attendance_decide then succeeds');
select is((select r[1] from checks where fn = 'leave_decide'), 'advisory', 'leave_decide waits on the leave: lock first');
select is((select r[2] from checks where fn = 'leave_decide'), 'ok', 'leave_decide: the request is not locked yet');
select is((select r[3] from checks where fn = 'leave_decide'), 'ok', 'leave_decide then succeeds');
select is((select r[1] from checks where fn = 'leave_owner_edit'), 'advisory', 'leave_owner_edit waits on the leave: lock first');
select is((select r[2] from checks where fn = 'leave_owner_edit'), 'ok', 'leave_owner_edit: the request is not locked yet');
select is((select r[3] from checks where fn = 'leave_owner_edit'), 'ok', 'leave_owner_edit then succeeds');
select is((select r[1] from checks where fn = 'leave_owner_cancel'), 'advisory', 'leave_owner_cancel waits on the leave: lock first');
select is((select r[2] from checks where fn = 'leave_owner_cancel'), 'ok', 'leave_owner_cancel: the request is not locked yet');
select is((select r[3] from checks where fn = 'leave_owner_cancel'), 'ok', 'leave_owner_cancel then succeeds');
select is((select r[1] from checks where fn = 'leave_withdraw'), 'advisory', 'leave_withdraw waits on the leave: lock first');
select is((select r[2] from checks where fn = 'leave_withdraw'), 'ok', 'leave_withdraw: the request is not locked yet');
select is((select r[3] from checks where fn = 'leave_withdraw'), 'ok', 'leave_withdraw then succeeds');
select is((select r[1] from checks where fn = 'attendance_submit'), 'advisory', 'attendance_submit waits on the leave: lock first');
select is((select r[2] from checks where fn = 'attendance_submit'), 'ok', 'attendance_submit: the day is not locked yet');
select is((select r[3] from checks where fn = 'attendance_submit'), 'ok', 'attendance_submit then succeeds');
select is((select r[1] from checks where fn = 'attendance_touch'), 'advisory', 'attendance_touch opening a day waits on the leave: lock');
select is((select r[3] from checks where fn = 'attendance_touch'), 'ok', 'attendance_touch then opens the day');

-- 2. The old deadlock, replayed ----------------------------------------------------------------
-- A: the Owner approves Race's day from the Attendance group and keeps the transaction open.
select pg_temp.begin_as('a', 'owner');
create temporary table race_a as
  select * from extensions.dblink('a', format('select public.attendance_decide(%L, ''approve'')::text', pg_temp.id('race_day')))
    as t(state text);
-- B: in another tab the Owner approves the form leave over the same date.
select pg_temp.begin_as('b', 'owner');
select extensions.dblink_send_query('b',
  'select state::text from public.leave_decide(''0e000000-0000-4000-8000-0000000000a2'', ''approve'')');
select is(pg_temp.lock_wait_of((select pid from b_pid)), 'advisory',
  'the leave approval waits for the day decision on the person''s lock, holding nothing');
select extensions.dblink_exec('a', 'commit');
create temporary table race_b as
  select * from extensions.dblink_get_result('b') as t(state text);
select * from extensions.dblink_get_result('b', false) as t(state text);
select extensions.dblink_exec('b', 'commit');

select is((select state from race_a), 'approved', 'the day was approved');
select is((select state from race_b), 'approved', 'and the leave was approved after it: no deadlock');
select is(
  (select state from extensions.dblink('c0', 'select state::text from public.leave_requests where id = ''0e000000-0000-4000-8000-0000000000a1''')
     as t(state text)),
  'superseded', 'the later decision wins over the gate leave approved a moment earlier');

select pg_temp.cleanup();
select extensions.dblink_disconnect('a');
select extensions.dblink_disconnect('b');
select extensions.dblink_disconnect('c');
select extensions.dblink_disconnect('c0');

select * from finish();
rollback;
