-- What the v50 122018 cleanup leaves: run inside the dry run (before its rollback) and on its own after.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and (p.proname like 'handin\_%' or p.proname = 'upload_manager')) as handin_functions_left,
  to_regclass('public.handin_files') is null and to_regclass('public.handin_folders') is null as tables_gone,
  (select count(*) from public.notification_kinds where kind = 'handin_space_held') as kind_left,
  (select count(*) from supabase_migrations.schema_migrations where version = '20261125122018') as history_row_left,
  md5(pg_get_functiondef('public.task_submit_done(uuid, text, text, uuid)'::regprocedure)) = '32bc12bf58c67d6981acb1b7cfb3eba0' as task_submit_done_is_mains;
