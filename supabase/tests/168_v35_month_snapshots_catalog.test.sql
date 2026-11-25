-- v3.5 "Month close", U7: the catalog guard on public.month_snapshots (DATA-MODEL §9; WORKFLOWS §7.4; ADR-0007
-- amendment 2026-11-25). The snapshot is money: only the month-close family may reach it. Read from pg_catalog
-- (pg_proc source text, pg_policy, pg_views, pg_trigger, pg_depend, pg_publication_rel), so a function, view,
-- policy, rule or trigger added later that names the table makes a set below differ and this file goes red.
--
-- The family (the v3.5 migrations, by name):
--   public.month_close, public.month_correct, public.month_close_read, public.month_close_reminder
--     the Owner's entry points: security definer, search_path set, never anon;
--   app.first_priced_month, app.month_snapshot_build, app.month_snapshot_figures, app.month_revenue_changes,
--   app.month_waiting, app.month_close_reminder, app.month_close_reminder_line
--     their internal helpers: service_role only (never anon, never authenticated), search_path set. They are
--     security invoker on purpose: they run inside the definer functions above (or the digest job), as those
--     functions' owner, and the builder checks the caller is an Owner of the organization itself.
-- Of the family, the ones whose source names month_snapshots are exactly month_close, month_correct,
-- month_close_read and app.month_close_reminder; public.month_close_reminder reaches the table only through
-- app.month_close_reminder, whose only callers are it and app.digest_weekly_payload (the weekly digest's
-- payload, service_role only). The TypeScript reads of the table (modules/revenue data/month-close.ts) are
-- table selects under the select policy, not database objects, and are not listed here.
-- Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Every function outside the system schemas whose source names the table.
create temporary table refs on commit drop as
  select (n.nspname::text || '.' || p.proname::text) collate "C" as name, p.oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and p.prosrc ~ '\mmonth_snapshots\M';

-- 1. Who names the table --------------------------------------------------------------------------------------
select is(
  array(select name from refs order by name),
  array['app.month_close_reminder', 'public.month_close', 'public.month_close_read', 'public.month_correct']::text[],
  'only month_close, month_correct, month_close_read and app.month_close_reminder name month_snapshots in their source');

select is(
  array(select (n.nspname::text || '.' || p.proname::text) collate "C"
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname not in ('pg_catalog', 'information_schema')
          and p.prosrc ~ '\mapp\.month_close_reminder\M'
        order by 1),
  array['app.digest_weekly_payload', 'public.month_close_reminder']::text[],
  'app.month_close_reminder is called only by public.month_close_reminder and app.digest_weekly_payload');

select is_empty(
  $$ select 1 from refs r
     where r.name not in ('public.month_close', 'public.month_correct', 'public.month_close_read',
                          'public.month_close_reminder', 'app.first_priced_month', 'app.month_snapshot_build',
                          'app.month_snapshot_figures', 'app.month_revenue_changes', 'app.month_waiting',
                          'app.month_close_reminder', 'app.month_close_reminder_line') $$,
  'no function outside the month-close family names month_snapshots');

-- Nothing else depends on the table or its row type: no view, rule or function signature.
select is_empty(
  $$ select 1 from pg_depend d
     where d.refobjid in ('public.month_snapshots'::regclass, 'public.month_snapshots'::regtype::oid)
       and d.classid in ('pg_rewrite'::regclass, 'pg_proc'::regclass) $$,
  'no view, rule or function signature depends on month_snapshots or its row type');

select is_empty(
  $$ select 1 from pg_views v where v.schemaname not in ('pg_catalog', 'information_schema')
       and v.definition ~ '\mmonth_snapshots\M'
     union all
     select 1 from pg_matviews v where v.definition ~ '\mmonth_snapshots\M' $$,
  'no view or materialized view reads month_snapshots');

-- 2. Policies and triggers -------------------------------------------------------------------------------------
select is(
  array(select (p.polrelid::regclass::text || '.' || p.polname::text) collate "C"
        from pg_policy p
        where p.polrelid = 'public.month_snapshots'::regclass
           or coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ '\mmonth_snapshots\M'
           or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '\mmonth_snapshots\M'
        order by 1),
  array['month_snapshots.month_snapshots_select']::text[],
  'the only policy on or naming month_snapshots is its own select policy');

select is_empty(
  $$ select 1 from pg_trigger t where t.tgrelid = 'public.month_snapshots'::regclass and not t.tgisinternal $$,
  'month_snapshots has no trigger (no audit_row_change: its data is money)');

select is_empty(
  $$ select 1 from pg_publication_rel r where r.prrelid = 'public.month_snapshots'::regclass $$,
  'month_snapshots is in no publication (never Realtime)');

-- 3. The family exists, with search_path set ---------------------------------------------------------------------
select is(
  array(select (n.nspname::text || '.' || p.proname::text) collate "C"
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'public' and p.proname in ('month_close', 'month_correct', 'month_close_read', 'month_close_reminder'))
        or (n.nspname = 'app' and p.proname in ('first_priced_month', 'month_snapshot_build', 'month_snapshot_figures',
                                                'month_revenue_changes', 'month_waiting', 'month_close_reminder',
                                                'month_close_reminder_line'))
     order by 1),
  array['app.first_priced_month', 'app.month_close_reminder', 'app.month_close_reminder_line',
        'app.month_revenue_changes', 'app.month_snapshot_build', 'app.month_snapshot_figures',
        'app.month_waiting', 'public.month_close', 'public.month_close_read', 'public.month_close_reminder',
        'public.month_correct']::text[],
  'the family is eleven functions, one of each name (no overload)');

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where ((n.nspname = 'public' and p.proname in ('month_close', 'month_correct', 'month_close_read', 'month_close_reminder'))
         or (n.nspname = 'app' and p.proname in ('first_priced_month', 'month_snapshot_build', 'month_snapshot_figures',
                                                 'month_revenue_changes', 'month_waiting', 'month_close_reminder',
                                                 'month_close_reminder_line')))
       and not ('search_path=""' = any(coalesce(p.proconfig, '{}'::text[]))) $$,
  'every function of the family has search_path set (empty)');

select is_empty(
  $$ select 1 from refs r join pg_proc p on p.oid = r.oid
     where not ('search_path=""' = any(coalesce(p.proconfig, '{}'::text[]))) $$,
  'every function that names month_snapshots has search_path set (empty)');

-- 4. The public entry points: security definer, never anon --------------------------------------------------------
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('month_close', 'month_correct', 'month_close_read', 'month_close_reminder')
       and not p.prosecdef $$,
  'the four public functions are security definer');

select is_empty(
  $$ select 1 from refs r join pg_proc p on p.oid = r.oid join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and not p.prosecdef $$,
  'every public function that names month_snapshots is security definer');

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('month_close', 'month_correct', 'month_close_read', 'month_close_reminder')
       and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon may execute none of the four public functions');

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'public' and p.proname in ('month_close', 'month_correct', 'month_close_read', 'month_close_reminder')
       and a.grantee = 0 $$,
  'PUBLIC holds no execute on the four public functions');

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('month_close', 'month_correct', 'month_close_read', 'month_close_reminder')
       and not has_function_privilege('authenticated', p.oid, 'execute') $$,
  'authenticated may execute the four public functions (each checks the Owner''s permission itself)');

-- 5. The app helpers: service_role only ---------------------------------------------------------------------------
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname in ('first_priced_month', 'month_snapshot_build', 'month_snapshot_figures',
                                               'month_revenue_changes', 'month_waiting', 'month_close_reminder',
                                               'month_close_reminder_line')
       and (has_function_privilege('authenticated', p.oid, 'execute')
            or has_function_privilege('anon', p.oid, 'execute')) $$,
  'neither authenticated nor anon may execute an app helper of the family');

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'app' and p.proname in ('first_priced_month', 'month_snapshot_build', 'month_snapshot_figures',
                                               'month_revenue_changes', 'month_waiting', 'month_close_reminder',
                                               'month_close_reminder_line')
       and a.grantee = 0 $$,
  'PUBLIC holds no execute on an app helper of the family');

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname in ('first_priced_month', 'month_snapshot_build', 'month_snapshot_figures',
                                               'month_revenue_changes', 'month_waiting', 'month_close_reminder',
                                               'month_close_reminder_line')
       and not has_function_privilege('service_role', p.oid, 'execute') $$,
  'service_role may execute every app helper of the family');

select * from finish();
rollback;
