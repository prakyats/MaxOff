-- 2.5 Lock order for the jobs (DATA-MODEL §3 "Lock order", WORKFLOWS §1 "Settled in 2.5"):
-- app.absent_check and app.logout_not_recorded take each member's leave: advisory lock BEFORE
-- that member's rows, so a job running while the Owner decides someone's day or leave waits for
-- the decision instead of deadlocking with it. Built like 12 (dblink, fixtures committed through
-- c0 and removed at both ends): A holds leave:<member>; B runs the job for yesterday and must be
-- WAITING ON THE ADVISORY LOCK; meanwhile C can still lock the member's row (FOR UPDATE NOWAIT),
-- which proves B took no row lock first. A lets go; B finishes and rolls back.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(8);

create function pg_temp.conninfo() returns text language sql stable as $$
  select format('hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
                host(inet_server_addr()), inet_server_port(), current_database());
$$;

-- Fixture members (fixed ids that sort before every seeded person, so the job reaches them first;
-- committed through c0).
create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('waiting', '0e000000-0000-4000-8000-000000000021'),
  ('logged',  '0e000000-0000-4000-8000-000000000022');

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;

create function pg_temp.cleanup() returns void language plpgsql as $$
declare
  v_ids text := format('%L, %L', pg_temp.fx('waiting'), pg_temp.fx('logged'));
begin
  perform extensions.dblink_exec('c0', format($q$
    delete from public.attendance_events where attendance_day_id in (select id from public.attendance_days where member_id in (%1$s));
    delete from public.activity_log where entity = 'attendance_days'
      and entity_id in (select id from public.attendance_days where member_id in (%1$s));
    delete from public.attendance_days where member_id in (%1$s);
    delete from public.session_events where member_id in (%1$s);
    delete from public.members where id in (%1$s);
    delete from public.activity_log where entity = 'members' and entity_id in (%1$s);
    delete from auth.users where id in (%1$s);
  $q$, v_ids));
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
create function pg_temp.row_free(row_id uuid) returns text language plpgsql as $$
declare
  v text;
begin
  perform extensions.dblink_exec('c', 'begin');
  begin
    perform * from extensions.dblink('c', format('select id from public.attendance_days where id = %L for update nowait', row_id))
      as t(id uuid);
    v := 'ok';
  exception when others then
    v := sqlerrm;
  end;
  perform extensions.dblink_exec('c', 'rollback');
  return v;
end;
$$;

-- The whole check for one job: A holds member k's leave: lock, B (postgres, as pg_cron) sends q.
create function pg_temp.waits_first(k text, q text, row_id uuid)
returns text[] language plpgsql as $$
declare
  v_wait text;
  v_free text;
  v_done text;
begin
  perform extensions.dblink_exec('a', 'begin');
  perform * from extensions.dblink('a', format('select pg_advisory_xact_lock(hashtext(%L))', 'leave:' || pg_temp.fx(k)))
    as t(x text);
  perform extensions.dblink_exec('b', 'begin');
  perform extensions.dblink_send_query('b', q);
  v_wait := pg_temp.lock_wait_of((select pid from b_pid));
  v_free := pg_temp.row_free(row_id);
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
-- waiting: logged in yesterday, never chose (the absent check proposes it). logged: logged in
-- yesterday, never logged out (the logout job flags it). Yesterday is a working day for this
-- file: the weekly off days are cleared on c0 and put back at the end.
create temporary table saved as
  select * from extensions.dblink('c0', 'select weekly_off_days::text from public.org_settings limit 1') as t(days text);
select extensions.dblink_exec('c0', format($q$
  update public.org_settings set weekly_off_days = '{}';
  delete from public.holidays where date = app.today_ist() - 1;
  insert into auth.users (id, email) values (%1$L, 'lock-waiting@example.com'), (%2$L, 'lock-logged@example.com');
  insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
    (%1$L, (select id from public.organizations limit 1), 'Lock Waiting', 'lock-waiting@example.com', 'staff', 'active', now() - interval '30 days'),
    (%2$L, (select id from public.organizations limit 1), 'Lock Logged',  'lock-logged@example.com',  'staff', 'active', now() - interval '30 days');
  insert into public.attendance_days (member_id, work_date, first_login_at, state) values
    (%1$L, app.today_ist() - 1, app.ist_day_start(app.today_ist() - 1) + interval '9 hours', 'awaiting_choice');
  insert into public.attendance_days (member_id, work_date, first_login_at, state, submitted_choice, submitted_at) values
    (%2$L, app.today_ist() - 1, app.ist_day_start(app.today_ist() - 1) + interval '9 hours', 'pending_review', 'present', now());
$q$, pg_temp.fx('waiting'), pg_temp.fx('logged')));

create temporary table ids as
select * from extensions.dblink('c0', format($q$
  select 'waiting_day', id from public.attendance_days where member_id = %1$L
  union all select 'logged_day', id from public.attendance_days where member_id = %2$L
$q$, pg_temp.fx('waiting'), pg_temp.fx('logged'))) as t(k text, id uuid);

create function pg_temp.id(k text) returns uuid language sql stable as $$
  select id from ids where ids.k = $1;
$$;

create temporary table checks (fn text primary key, r text[]);
insert into checks values
  ('absent_check', pg_temp.waits_first('waiting',
     'select count(*)::text from app.absent_check(app.today_ist() - 1)', pg_temp.id('waiting_day'))),
  ('logout_not_recorded', pg_temp.waits_first('logged',
     'select count(*)::text from app.logout_not_recorded(app.today_ist() - 1)', pg_temp.id('logged_day')));

select is((select r[1] from checks where fn = 'absent_check'), 'advisory', 'absent_check waits on the member''s leave: lock first');
select is((select r[2] from checks where fn = 'absent_check'), 'ok', 'absent_check: the member''s day is not locked yet');
select is((select r[3] from checks where fn = 'absent_check'), 'ok', 'absent_check then finishes');
select is((select r[1] from checks where fn = 'logout_not_recorded'), 'advisory', 'logout_not_recorded waits on the member''s leave: lock first');
select is((select r[2] from checks where fn = 'logout_not_recorded'), 'ok', 'logout_not_recorded: the member''s day is not locked yet');
select is((select r[3] from checks where fn = 'logout_not_recorded'), 'ok', 'logout_not_recorded then finishes');

-- Both runs were rolled back on B: the fixtures are as arranged.
select is(
  (select state from extensions.dblink('c0', format('select state::text from public.attendance_days where id = %L', pg_temp.id('waiting_day'))) as t(state text)),
  'awaiting_choice', 'the proposal was rolled back with B');
select is(
  (select f from extensions.dblink('c0', format('select logout_not_recorded::text from public.attendance_days where id = %L', pg_temp.id('logged_day'))) as t(f text)),
  'false', 'the flag was rolled back with B');

select pg_temp.cleanup();
select extensions.dblink_exec('c0', format('update public.org_settings set weekly_off_days = %L', (select days from saved)));
select extensions.dblink_disconnect('a');
select extensions.dblink_disconnect('b');
select extensions.dblink_disconnect('c');
select extensions.dblink_disconnect('c0');

select * from finish();
rollback;
