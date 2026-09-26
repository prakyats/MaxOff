-- pgTAP for the 0.2 base migration. Run with `pnpm db:test` (needs the local stack running).
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- Extensions and schema ------------------------------------------------------------------
select has_extension('pg_cron', 'pg_cron is installed');
select has_extension('pg_net', 'pg_net is installed');
select has_schema('app', 'the app schema exists');
select has_function('app', 'set_updated_at', array[]::text[], 'app.set_updated_at() exists');
select has_function('app', 'to_ist_date', array['timestamp with time zone'], 'app.to_ist_date(timestamptz) exists');
select has_function('app', 'today_ist', array[]::text[], 'app.today_ist() exists');
select has_function('app', 'fail', array['text', 'text'], 'app.fail(text, text) exists');

-- IST boundaries (IST = UTC + 05:30, so the IST day starts at 18:30 UTC the evening before)
select is(app.to_ist_date('2026-09-21 18:29:59+00'), date '2026-09-21', '18:29:59 UTC is still 21 Sep in IST');
select is(app.to_ist_date('2026-09-21 18:30:00+00'), date '2026-09-22', '18:30:00 UTC is already 22 Sep in IST');
select is(app.to_ist_date('2026-09-30 18:30:00+00'), date '2026-10-01', 'the month rolls over at 18:30 UTC');
select is(app.to_ist_date('2026-12-31 18:29:59+00'), date '2026-12-31', 'the year holds until 18:29:59 UTC');
select is(app.to_ist_date('2026-12-31 18:30:00+00'), date '2027-01-01', 'the year rolls over at 18:30 UTC');
select is(app.to_ist_date('2026-09-21 23:59:59+05:30'), date '2026-09-21', 'an IST-offset literal keeps its date');
select is(app.to_ist_date('2026-09-21 00:00:00+05:30'), date '2026-09-21', 'IST midnight belongs to the new day');
select is(app.to_ist_date(null), null, 'null in, null out');
select is(app.today_ist(), app.to_ist_date(now()), 'today_ist() follows to_ist_date(now())');

-- updated_at trigger ---------------------------------------------------------------------
create temporary table t_updated (
  id int primary key,
  name text,
  updated_at timestamptz not null default '2000-01-01 00:00:00+00'
);
create trigger set_updated_at before update on t_updated
  for each row execute function app.set_updated_at();
insert into t_updated (id, name) values (1, 'a');
select is((select updated_at from t_updated where id = 1), '2000-01-01 00:00:00+00'::timestamptz,
  'insert leaves the default alone');
update t_updated set name = 'b' where id = 1;
select is((select updated_at from t_updated where id = 1), now(),
  'update stamps updated_at with the transaction time');
update t_updated set name = 'c', updated_at = '1999-01-01 00:00:00+00' where id = 1;
select is((select updated_at from t_updated where id = 1), now(),
  'a manual updated_at value is overridden');

-- app.fail -------------------------------------------------------------------------------
select throws_ok(
  $$ select app.fail('INVALID_STATE', 'This task is already completed') $$,
  'P0001', 'INVALID_STATE', 'fail raises P0001 with the code as the message');
select throws_ok(
  $$ select app.fail('FORBIDDEN') $$,
  'P0001', 'FORBIDDEN', 'fail works without a detail');

create function pg_temp.fail_detail() returns text language plpgsql as $$
declare d text;
begin
  perform app.fail('INVALID_STATE', 'This task is already completed');
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end;
$$;
select is(pg_temp.fail_detail(), 'This task is already completed',
  'fail passes the human reason as the error detail');

-- Grants ---------------------------------------------------------------------------------
select ok(has_schema_privilege('authenticated', 'app', 'usage'), 'authenticated may use app');
select ok(has_schema_privilege('service_role', 'app', 'usage'), 'service_role may use app');
select ok(not has_schema_privilege('anon', 'app', 'usage'), 'anon may not use app');
-- Self-enforcing for every function ever added to `app` (DATA-MODEL §0a): authenticated and
-- service_role may execute, anon and public may not.
-- Exception (2.1): internal writers and cross-member readers that only security definer
-- functions call (they run as the owner and need no grant). The API role must NOT hold them.
create temporary table app_internal (name text primary key);
insert into app_internal values
  ('attendance_event'), ('attendance_apply_leave'), ('attendance_release_leave'),
  ('attendance_logout'), ('leave_covering'), ('leave_overlaps'),
  -- 2.2
  ('leave_supersede_gate'), ('leave_clash'), ('leave_clash_label'),
  -- 2.5: the jobs (pg_cron runs them as postgres) and the day opener they share with touch
  ('attendance_open_day'), ('absent_check'), ('logout_not_recorded');
select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and p.proname not in (select name from app_internal)
      and (   has_function_privilege('anon', p.oid, 'execute')
           or not has_function_privilege('authenticated', p.oid, 'execute')
           or not has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint,
  'every app function: authenticated and service_role may execute, anon may not');
select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and p.proname in (select name from app_internal)
      and (   has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute')
           or not has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint,
  'the internal helpers: service_role only, never the API role');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in (select name from app_internal)), 12::bigint,
  'the internal helper list matches what exists');
select cmp_ok((select count(*) from pg_proc where pronamespace = 'app'::regnamespace), '>=', 4::bigint,
  'the grant check saw the app functions');

select * from finish();
rollback;
