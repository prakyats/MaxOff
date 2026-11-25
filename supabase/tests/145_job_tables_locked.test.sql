-- The pgTAP files that delete members first lock every table the scheduled jobs write
-- (`lib/lock-job-tables.psql`, 25 Nov 2026: pgTAP 34 deadlocked with a pg_cron job around IST midnight).
-- This file keeps that list true: every table that a scheduled job's function, or any app./public.
-- function it calls (four levels down), inserts into, updates or deletes from is on it, with
-- activity_log (the audit trigger) and members (every row's foreign key). A new job, or a job that
-- starts writing a new table, fails here until the table joins the list.
begin;
\ir lib/lock-job-tables.psql
create extension if not exists pgtap with schema extensions;
select plan(3);

create temporary table locked as
  select lower(btrim(t)) as t from unnest(string_to_array(current_setting('tests.job_tables'), ',')) t;

create temporary table written as
with recursive fns(oid, depth) as (
  select p.oid, 0
  from cron.job j
  join pg_proc p on true
  join pg_namespace n on n.oid = p.pronamespace and n.nspname in ('app', 'public')
  where j.command ~* (n.nspname || '\.' || p.proname || '\(')
  union
  select p.oid, f.depth + 1
  from fns f
  join pg_proc caller on caller.oid = f.oid
  join pg_proc p on true
  join pg_namespace n on n.oid = p.pronamespace and n.nspname in ('app', 'public')
  where f.depth < 4 and caller.prosrc ~* (n.nspname || '\.' || p.proname || '\(')
)
select distinct 'public.' || lower(m[1]) as t
from fns f
join pg_proc p on p.oid = f.oid,
lateral regexp_matches(p.prosrc, '(?:insert\s+into|update|delete\s+from)\s+public\.([a-z_]+)', 'gi') m;

select ok((select count(*) from cron.job) > 0, 'the scheduled jobs are in the catalog');
select ok((select count(*) from written) > 0, 'their functions write tables');
select is(
  (select coalesce(string_agg(t, ', ' order by t), '') from written where t not in (select t from locked)),
  '',
  'every table a scheduled job writes is locked by lib/lock-job-tables.psql');

select * from finish();
rollback;
