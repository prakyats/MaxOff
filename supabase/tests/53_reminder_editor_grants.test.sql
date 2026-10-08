-- 5.3, the reminder editor (migration reminder_editor_grants; owner decisions 2026-10-02). Who
-- writes each level's reminder list, allowed and denied, for the Owner, an Admin, Staff (shown as
-- Crew) and a signed-out caller, and an invalid list refused (23514) at every level:
--   * the organisation's default (org_settings.default_task_reminders): the Owner only
--     (settings.manage);
--   * a task type's default (task_types.default_reminders): the Owner only (settings.manage and
--     app.task_types_owner_guard());
--   * a template's (task_templates.reminder_rules, granted back by this migration): templates.manage,
--     an Admin their own, the Owner any.
-- And a task started from a template with no list of its own follows the template's through
-- tasks.template_id (app.task_reminder_rules); nothing is copied onto the task.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- 7A: client work rows reference clients and members, and the presets the organization (a
-- Playwright run leaves some behind).
delete from public.item_reviews;
delete from public.project_item_stages;
delete from public.project_items;
delete from public.project_cycles;
delete from public.project_item_blueprints;
delete from public.project_stages;
delete from public.projects;
delete from public.project_templates;
delete from public.stage_presets;
delete from public.task_requests;
delete from public.task_warnings;
delete from public.task_reviews;
delete from public.task_submissions;
delete from public.task_comments;
delete from public.task_stages;
delete from public.task_assignees;
delete from public.tasks;
delete from public.task_templates;
delete from public.member_coordinators;
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.expense_claims;
delete from public.comp_leave_credit_uses;
delete from public.comp_leave_credits;
delete from public.extra_work_notes;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.field_definitions;
delete from public.client_contacts;
delete from public.client_admin_assignments;
delete from public.client_brand;
delete from public.client_private;
delete from public.client_close_reasons;
delete from public.clients;
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.notifications;
delete from public.push_subscriptions;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '00000000-0000-4000-8000-000000005301'),
  ('admin', '00000000-0000-4000-8000-000000005302'),
  ('admin2', '00000000-0000-4000-8000-000000005303'),
  ('staff', '00000000-0000-4000-8000-000000005304');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;

create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- How many rows a statement touched, as the caller (RLS decides).
create function pg_temp.rows(q text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

create function pg_temp.type_id(p_name text) returns uuid language sql stable as $$
  select id from public.task_types where org_id = pg_temp.fx('org') and name = p_name;
$$;

-- The three lists as stored (read as the system).
create function pg_temp.org_list() returns jsonb language sql stable as $$
  select default_task_reminders from public.org_settings where org_id = pg_temp.fx('org');
$$;
create function pg_temp.type_list() returns jsonb language sql stable as $$
  select default_reminders from public.task_types where id = pg_temp.type_id('Normal');
$$;
create function pg_temp.tpl_list(k text) returns jsonb language sql stable as $$
  select reminder_rules from public.task_templates where id = pg_temp.fx(k);
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('admin2', 'admin'), ('staff', 'staff')) as v(k, r);

update public.org_settings set default_task_reminders = '[]' where org_id = pg_temp.fx('org');
update public.task_types set default_reminders = '[]' where org_id = pg_temp.fx('org');

-- 1. The organisation's default: the Owner only ------------------------------------------------------
select pg_temp.as_member('owner');
select is(
  pg_temp.rows($q$update public.org_settings set default_task_reminders = '[{"before": 3, "unit": "days"}, {"before": 0, "unit": "minutes"}]'
                where org_id = pg_temp.fx('org')$q$),
  1::bigint, 'the Owner sets the organisation''s default reminders');
select throws_ok(
  $q$update public.org_settings set default_task_reminders = '[{"before": 61, "unit": "days"}]' where org_id = pg_temp.fx('org')$q$,
  '23514', null, 'an invalid list (over 60 days) is refused');
select pg_temp.as_member('admin');
select is(
  pg_temp.rows($q$update public.org_settings set default_task_reminders = '[]' where org_id = pg_temp.fx('org')$q$),
  0::bigint, 'an Admin updates no row (RLS: settings.manage)');
select pg_temp.as_member('staff');
select is(
  pg_temp.rows($q$update public.org_settings set default_task_reminders = '[]' where org_id = pg_temp.fx('org')$q$),
  0::bigint, 'a Crew member (staff) updates no row');
select pg_temp.as_anon();
select throws_ok(
  $q$update public.org_settings set default_task_reminders = '[]'$q$,
  '42501', null, 'a signed-out caller is refused outright');
select pg_temp.as_system();
select is(pg_temp.org_list(), '[{"before": 3, "unit": "days"}, {"before": 0, "unit": "minutes"}]'::jsonb,
  'the list is still the Owner''s');

-- 2. A task type's default: the Owner only -----------------------------------------------------------
select pg_temp.as_member('owner');
select is(
  pg_temp.rows($q$update public.task_types set default_reminders = '[{"before": 6, "unit": "hours"}]'
                where id = pg_temp.type_id('Normal')$q$),
  1::bigint, 'the Owner sets a type''s default reminders');
select throws_ok(
  $q$update public.task_types set default_reminders = '[{"before": 1, "unit": "days"}, {"before": 24, "unit": "hours"}]' where id = pg_temp.type_id('Normal')$q$,
  '23514', null, 'two reminders at the same time (1 day, 24 hours) are refused');
select pg_temp.as_member('admin');
select is(
  pg_temp.rows($q$update public.task_types set default_reminders = '[]' where id = pg_temp.type_id('Normal')$q$),
  0::bigint, 'an Admin updates no type (RLS: settings.manage)');
select pg_temp.as_member('staff');
select is(
  pg_temp.rows($q$update public.task_types set default_reminders = '[]' where id = pg_temp.type_id('Normal')$q$),
  0::bigint, 'a Crew member updates no type');
select pg_temp.as_anon();
select throws_ok(
  $q$update public.task_types set default_reminders = '[]'$q$,
  '42501', null, 'a signed-out caller is refused outright');
select pg_temp.as_system();
select is(pg_temp.type_list(), '[{"before": 6, "unit": "hours"}]'::jsonb, 'the type''s list is the Owner''s');

-- 3. A template's: an Admin their own, the Owner any --------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok($$ with t as (
    insert into public.task_templates (name, task_type_id, reminder_rules)
    values ('Reel', pg_temp.type_id('Normal'), '[{"before": 2, "unit": "days"}]')
    returning id) insert into fx select 'tpl', id from t $$,
  'an Admin adds a template with its reminders');
select throws_ok($$ insert into public.task_templates (name, task_type_id, reminder_rules)
    values ('Bad', pg_temp.type_id('Normal'), '[{"before": 1.5, "unit": "hours"}]') $$,
  '23514', null, 'a template with an invalid list (not a whole number) is refused');
select is(
  pg_temp.rows(format($q$update public.task_templates set reminder_rules = '[{"before": 4, "unit": "hours"}]' where id = %L$q$, pg_temp.fx('tpl'))),
  1::bigint, 'the Admin edits their own template''s reminders');
select throws_ok(
  format($q$update public.task_templates set reminder_rules = '[{"offset": 60}]' where id = %L$q$, pg_temp.fx('tpl')),
  '23514', null, 'and an invalid list is refused on update');
select pg_temp.as_member('admin2');
select is(
  pg_temp.rows(format($q$update public.task_templates set reminder_rules = '[]' where id = %L$q$, pg_temp.fx('tpl'))),
  0::bigint, 'another Admin updates no row of it');
select pg_temp.as_member('staff');
select throws_ok($$ insert into public.task_templates (name, task_type_id, reminder_rules)
    values ('Crew''s', pg_temp.type_id('Normal'), '[]') $$,
  '42501', null, 'a Crew member adds no template (templates.manage)');
select is(
  pg_temp.rows(format($q$update public.task_templates set reminder_rules = '[]' where id = %L$q$, pg_temp.fx('tpl'))),
  0::bigint, 'nor edits one');
select pg_temp.as_anon();
select throws_ok(
  $q$update public.task_templates set reminder_rules = '[]'$q$,
  '42501', null, 'a signed-out caller is refused outright');
select pg_temp.as_system();
select is(pg_temp.tpl_list('tpl'), '[{"before": 4, "unit": "hours"}]'::jsonb, 'the template''s list is its author''s');
select pg_temp.as_member('owner');
select is(
  pg_temp.rows(format($q$update public.task_templates set reminder_rules = '[{"before": 5, "unit": "hours"}, {"before": 0, "unit": "minutes"}]' where id = %L$q$, pg_temp.fx('tpl'))),
  1::bigint, 'the Owner edits any template''s reminders');
select pg_temp.as_system();
select is(
  (select count(*) from public.activity_log
   where entity = 'task_templates' and action = 'update' and entity_id = pg_temp.fx('tpl')
     and diff -> 'new' -> 'reminder_rules' = '[{"before": 5, "unit": "hours"}, {"before": 0, "unit": "minutes"}]'::jsonb),
  1::bigint, 'the change is audited');

-- 4. A task from the template follows it through tasks.template_id -----------------------------------
select pg_temp.as_member('owner');
insert into fx select 'from_tpl', public.task_create(
  title => 'From the template', description => null, task_type_id => pg_temp.type_id('Normal'),
  client_id => null, priority => 'medium', due_at => now() + interval '10 days',
  assignee_ids => array[pg_temp.fx('staff')], primary_owner_id => pg_temp.fx('staff'),
  template_id => pg_temp.fx('tpl'), reminder_rules => '[]');
insert into fx select 'plain', public.task_create(
  title => 'No template', description => null, task_type_id => pg_temp.type_id('Normal'),
  client_id => null, priority => 'medium', due_at => now() + interval '10 days',
  assignee_ids => array[pg_temp.fx('staff')], primary_owner_id => pg_temp.fx('staff'),
  reminder_rules => '[]');
select pg_temp.as_system();
select is((select reminder_rules from public.tasks where id = pg_temp.fx('from_tpl')), '[]'::jsonb,
  'a task sent [] keeps "Using the default": nothing is copied onto it');
select is(app.task_reminder_rules(pg_temp.fx('from_tpl')),
  '[{"before": 5, "unit": "hours"}, {"before": 0, "unit": "minutes"}]'::jsonb,
  'it follows its template''s list');
select is(app.task_reminder_rules(pg_temp.fx('plain')), '[{"before": 6, "unit": "hours"}]'::jsonb,
  'a task with no template follows its type''s');
update public.task_types set default_reminders = '[]' where id = pg_temp.type_id('Normal');
select is(app.task_reminder_rules(pg_temp.fx('plain')),
  '[{"before": 3, "unit": "days"}, {"before": 0, "unit": "minutes"}]'::jsonb,
  'then the organisation''s, when the type has none');
update public.org_settings set default_task_reminders = '[]' where org_id = pg_temp.fx('org');
select is(app.task_reminder_rules(pg_temp.fx('plain')),
  '[{"before": 2, "unit": "days"}, {"before": 1, "unit": "days"}, {"before": 0, "unit": "minutes"}]'::jsonb,
  'then the launch schedule, when every level is empty');

select * from finish();
rollback;
