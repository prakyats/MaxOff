-- V5a item 6c (v1.8; owner 2026-10-22: "any reference counts as used"; migration
-- v5_owner_delete_unused), with V5b-0 item 8 (owner 2026-10-22: own history never blocks Delete;
-- migration v5_owner_delete_own_history): the Owner deletes a task type, job title, expense category,
-- custom field, draft client or contact only when no OTHER record uses or used it: no live, archived
-- or deleted row pointing at it, no other record's history naming it, no old custom-field value. Its
-- own lifecycle (created, renamed, reordered, edited, archived, restored) never blocks. Everything
-- else is refused ("In use — archive it instead."). The history row is written first. Per role: the Owner allowed; an
-- Admin and a Crew member FORBIDDEN; anon no privilege. Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

delete from public.deliverable_templates;
delete from public.item_reviews;
delete from public.project_item_stage_list;
delete from public.project_item_stages;
delete from public.project_items;
delete from public.project_cycles;
delete from public.project_item_blueprints;
delete from public.project_stages;
delete from public.projects;
delete from public.project_templates;
delete from public.stage_presets;
delete from public.client_work_alerts;
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
delete from public.eod_reports;
delete from public.notification_deliveries;
delete from public.notifications;
delete from public.push_subscriptions;
delete from public.member_reachability;
delete from public.holidays;
delete from public.members;
delete from auth.identities;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000008801'),
  ('admin',    '00000000-0000-4000-8000-000000008802'),
  ('staff',    '00000000-0000-4000-8000-000000008804');
insert into fx select 'org', id from public.organizations limit 1;
grant select, insert on fx to authenticated, anon, service_role;

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
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;
create function pg_temp.entry(p_entity text, p_id uuid) returns public.activity_log language sql stable security definer as $$
  select a from public.activity_log a where a.entity = p_entity and a.action = 'deleted' and a.entity_id = p_id;
$$;
-- True when the 'deleted' history row comes before every other history row the delete wrote.
create function pg_temp.first(p_entity text, p_id uuid) returns boolean language sql stable security definer as $$
  select (select a.id from public.activity_log a where a.entity = p_entity and a.entity_id = p_id and a.action = 'deleted')
       < (select max(a.id) from public.activity_log a where a.entity = p_entity and a.entity_id = p_id);
$$;
create function pg_temp.gone(p_table text, p_id uuid) returns boolean language plpgsql stable security definer as $$
declare
  v boolean;
begin
  execute format('select not exists (select 1 from public.%I where id = $1)', p_table) into v using p_id;
  return v;
end;
$$;
create function pg_temp.deleted_rows() returns integer language sql stable security definer as $$
  select count(*)::integer from public.activity_log a where a.action = 'deleted';
$$;
create function pg_temp.normal_type() returns uuid language sql stable security definer as $$
  select tt.id from public.task_types tt where tt.org_id = pg_temp.fx('org') and tt.name = 'Normal';
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key in ('owner', 'admin', 'staff');
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner@example.com', 'owner', 'active', now()),
  (pg_temp.fx('admin'), pg_temp.fx('org'), 'Test Admin', 'admin@example.com', 'admin', 'active', now()),
  (pg_temp.fx('staff'), pg_temp.fx('org'), 'Test Crew',  'staff@example.com', 'staff', 'active', now());
update public.task_types set default_reminders = '[]' where org_id = pg_temp.fx('org');
update public.org_settings set default_task_reminders = '[]' where org_id = pg_temp.fx('org');

-- Task types: unused; used by a live task; referenced only by a deleted task template; renamed once
-- (its own history); named only by an archived field.
insert into public.task_types (id, org_id, name, kind, position) values
  ('00000000-0000-4000-8000-0000000886b1', pg_temp.fx('org'), 'Type unused', 'normal', 'z1'),
  ('00000000-0000-4000-8000-0000000886b2', pg_temp.fx('org'), 'Type live', 'normal', 'z2'),
  ('00000000-0000-4000-8000-0000000886b3', pg_temp.fx('org'), 'Type template', 'normal', 'z3'),
  ('00000000-0000-4000-8000-0000000886b4', pg_temp.fx('org'), 'Type renamed', 'normal', 'z4'),
  ('00000000-0000-4000-8000-0000000886b5', pg_temp.fx('org'), 'Type field', 'normal', 'z5');
insert into fx values ('tt_unused', '00000000-0000-4000-8000-0000000886b1'), ('tt_live', '00000000-0000-4000-8000-0000000886b2'),
  ('tt_tpl', '00000000-0000-4000-8000-0000000886b3'), ('tt_hist', '00000000-0000-4000-8000-0000000886b4'),
  ('tt_field', '00000000-0000-4000-8000-0000000886b5');
update public.task_types set name = 'Type renamed again' where id = pg_temp.fx('tt_hist');
select pg_temp.as_member('owner');
insert into fx values ('task_live', public.task_create('Live task', null, pg_temp.fx('tt_live'),
  null, 'medium', now() + interval '5 days', array[pg_temp.fx('staff')], pg_temp.fx('staff')));
select pg_temp.as_system();
insert into public.task_templates (id, org_id, name, task_type_id, created_by) values
  ('00000000-0000-4000-8000-0000000886e1', pg_temp.fx('org'), 'A task template', pg_temp.fx('tt_tpl'), pg_temp.fx('owner'));
select pg_temp.as_member('owner');
select public.template_delete('task', '00000000-0000-4000-8000-0000000886e1');
select pg_temp.as_system();
insert into public.field_definitions (id, org_id, entity, task_type_id, key, label, type, position, archived_at) values
  ('00000000-0000-4000-8000-0000000886f1', pg_temp.fx('org'), 'task', pg_temp.fx('tt_field'), 'shot_list', 'Shot list', 'text', 'a0', now());

-- Job titles: unused; held now; held once (changed since); archived and never used.
insert into public.list_items (id, org_id, list_key, name, position, archived_at) values
  ('00000000-0000-4000-8000-0000000881a1', pg_temp.fx('org'), 'job_title', 'Title unused', 'z1', null),
  ('00000000-0000-4000-8000-0000000881a2', pg_temp.fx('org'), 'job_title', 'Title held', 'z2', null),
  ('00000000-0000-4000-8000-0000000881a3', pg_temp.fx('org'), 'job_title', 'Title once held', 'z3', null),
  ('00000000-0000-4000-8000-0000000881a4', pg_temp.fx('org'), 'job_title', 'Title archived', 'z4', now()),
  ('00000000-0000-4000-8000-0000000881a5', pg_temp.fx('org'), 'job_title', 'Title cycle', 'z5', null);
insert into fx values ('jt_unused', '00000000-0000-4000-8000-0000000881a1'), ('jt_held', '00000000-0000-4000-8000-0000000881a2'),
  ('jt_once', '00000000-0000-4000-8000-0000000881a3'), ('jt_archived', '00000000-0000-4000-8000-0000000881a4'),
  ('jt_cycle', '00000000-0000-4000-8000-0000000881a5');
-- Item 8: its whole own lifecycle, nobody ever holding it: renamed, archived, restored.
update public.list_items set name = 'Title cycle renamed' where id = pg_temp.fx('jt_cycle');
update public.list_items set archived_at = now() where id = pg_temp.fx('jt_cycle');
update public.list_items set archived_at = null where id = pg_temp.fx('jt_cycle');
update public.members set job_title_id = pg_temp.fx('jt_once') where id = pg_temp.fx('staff');
update public.members set job_title_id = pg_temp.fx('jt_held') where id = pg_temp.fx('staff');

-- Expense categories: unused; on a paid claim; on a claim only in its history (moved since).
insert into public.list_items (id, org_id, list_key, name, position) values
  ('00000000-0000-4000-8000-0000000882c1', pg_temp.fx('org'), 'expense_category', 'Category unused', 'z1'),
  ('00000000-0000-4000-8000-0000000882c2', pg_temp.fx('org'), 'expense_category', 'Category paid', 'z2'),
  ('00000000-0000-4000-8000-0000000882c3', pg_temp.fx('org'), 'expense_category', 'Category moved', 'z3');
insert into fx values ('ec_unused', '00000000-0000-4000-8000-0000000882c1'), ('ec_paid', '00000000-0000-4000-8000-0000000882c2'),
  ('ec_moved', '00000000-0000-4000-8000-0000000882c3');
insert into public.expense_claims (id, member_id, expense_date, amount, category_id, note, state, decided_by, decided_at, paid_on, paid_by, paid_at) values
  ('00000000-0000-4000-8000-0000000882e1', pg_temp.fx('staff'), app.today_ist() - 5, 120, pg_temp.fx('ec_paid'), 'Neutral note', 'paid',
   pg_temp.fx('owner'), now(), app.today_ist() - 1, pg_temp.fx('owner'), now()),
  ('00000000-0000-4000-8000-0000000882e2', pg_temp.fx('staff'), app.today_ist() - 4, 80, pg_temp.fx('ec_moved'), 'Neutral note', 'submitted',
   null, null, null, null, null);
update public.expense_claims set category_id = pg_temp.fx('ec_paid') where id = '00000000-0000-4000-8000-0000000882e2';

-- A client for fields and contacts.
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  ('00000000-0000-4000-8000-0000000884a0', pg_temp.fx('org'), 'Client A', 'active', pg_temp.fx('admin'), now()),
  ('00000000-0000-4000-8000-0000000884b0', pg_temp.fx('org'), 'Client B', 'active', pg_temp.fx('admin'), now());
insert into fx values ('client_a', '00000000-0000-4000-8000-0000000884a0'), ('client_b', '00000000-0000-4000-8000-0000000884b0');

-- Fields: unused; with a live value; with a value only in history (removed since); a default on an
-- archived task template only.
insert into public.field_definitions (id, org_id, entity, key, label, type, position) values
  ('00000000-0000-4000-8000-0000000883f1', pg_temp.fx('org'), 'client', 'unused_key', 'Field unused', 'text', 'a1'),
  ('00000000-0000-4000-8000-0000000883f2', pg_temp.fx('org'), 'client', 'live_key', 'Field live', 'text', 'a2'),
  ('00000000-0000-4000-8000-0000000883f3', pg_temp.fx('org'), 'client', 'old_key', 'Field old', 'text', 'a3'),
  ('00000000-0000-4000-8000-0000000883f4', pg_temp.fx('org'), 'task', 'tpl_key', 'Field template', 'text', 'a4');
insert into fx values ('f_unused', '00000000-0000-4000-8000-0000000883f1'), ('f_live', '00000000-0000-4000-8000-0000000883f2'),
  ('f_old', '00000000-0000-4000-8000-0000000883f3'), ('f_tpl', '00000000-0000-4000-8000-0000000883f4');
update public.clients set custom_fields = '{"live_key": "A value", "old_key": "Old value"}' where id = pg_temp.fx('client_a');
update public.clients set custom_fields = '{"live_key": "A value"}' where id = pg_temp.fx('client_a');
insert into public.task_templates (id, org_id, name, task_type_id, field_defaults, created_by, archived_at) values
  ('00000000-0000-4000-8000-0000000883e1', pg_temp.fx('org'), 'Archived template', pg_temp.normal_type(), '{"tpl_key": "A default"}', pg_temp.fx('owner'), now());

-- Draft clients: unused; with an archived contact; with a note; edited once; with an Admin given at
-- creation (the assignment row); and an active client (not a draft).
insert into public.clients (id, org_id, name, notes, admin_id) values
  ('00000000-0000-4000-8000-0000000884c1', pg_temp.fx('org'), 'Draft unused', null, null),
  ('00000000-0000-4000-8000-0000000884c2', pg_temp.fx('org'), 'Draft with contact', null, null),
  ('00000000-0000-4000-8000-0000000884c3', pg_temp.fx('org'), 'Draft with note', 'A note', null),
  ('00000000-0000-4000-8000-0000000884c4', pg_temp.fx('org'), 'Draft edited', null, null),
  ('00000000-0000-4000-8000-0000000884c5', pg_temp.fx('org'), 'Draft with Admin', null, pg_temp.fx('admin'));
insert into fx values ('c_unused', '00000000-0000-4000-8000-0000000884c1'), ('c_contact', '00000000-0000-4000-8000-0000000884c2'),
  ('c_note', '00000000-0000-4000-8000-0000000884c3'), ('c_edited', '00000000-0000-4000-8000-0000000884c4'),
  ('c_admin', '00000000-0000-4000-8000-0000000884c5');
update public.clients set city = 'A city' where id = pg_temp.fx('c_edited');

-- Contacts: on Client A the primary (first), an unused one, an edited one, an archived one; on
-- Client B a single primary; and the draft's archived one.
insert into public.client_contacts (id, org_id, client_id, name) values
  ('00000000-0000-4000-8000-0000000885d1', pg_temp.fx('org'), pg_temp.fx('client_a'), 'Contact primary'),
  ('00000000-0000-4000-8000-0000000885d2', pg_temp.fx('org'), pg_temp.fx('client_a'), 'Contact unused'),
  ('00000000-0000-4000-8000-0000000885d3', pg_temp.fx('org'), pg_temp.fx('client_a'), 'Contact edited'),
  ('00000000-0000-4000-8000-0000000885d4', pg_temp.fx('org'), pg_temp.fx('client_a'), 'Contact archived'),
  ('00000000-0000-4000-8000-0000000885d5', pg_temp.fx('org'), pg_temp.fx('client_b'), 'Contact alone'),
  ('00000000-0000-4000-8000-0000000885d6', pg_temp.fx('org'), pg_temp.fx('c_contact'), 'Draft contact');
insert into fx values ('k_primary', '00000000-0000-4000-8000-0000000885d1'), ('k_unused', '00000000-0000-4000-8000-0000000885d2'),
  ('k_edited', '00000000-0000-4000-8000-0000000885d3'), ('k_archived', '00000000-0000-4000-8000-0000000885d4'),
  ('k_alone', '00000000-0000-4000-8000-0000000885d5'), ('k_draft', '00000000-0000-4000-8000-0000000885d6');
update public.client_contacts set phone = '+919800000000' where id = pg_temp.fx('k_edited');
select pg_temp.as_member('owner');
select public.client_contact_archive(pg_temp.fx('k_archived'));
select public.client_contact_archive(pg_temp.fx('k_draft'));
select pg_temp.as_system();

-- 1. Who may: the Owner only ---------------------------------------------------------------------
select pg_temp.as_member('admin');
select throws_ok($$ select public.unused_usage('job_title', pg_temp.fx('jt_unused')) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot read the usage');
select throws_ok($$ select public.unused_delete('job_title', pg_temp.fx('jt_unused')) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot delete a job title (lists.manage is not enough)');
select throws_ok($$ select public.unused_delete('task_type', pg_temp.fx('tt_unused')) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot delete a task type');
select throws_ok($$ select public.unused_delete('field', pg_temp.fx('f_unused')) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot delete a field');
select throws_ok($$ select public.unused_delete('contact', pg_temp.fx('k_unused')) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot delete a contact of their own client');
select throws_ok($$ select public.unused_delete('client', pg_temp.fx('c_unused')) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot delete a draft client');
select pg_temp.as_member('staff');
select throws_ok($$ select public.unused_usage('expense_category', pg_temp.fx('ec_unused')) $$, 'P0001', 'FORBIDDEN', 'Crew cannot read the usage');
select throws_ok($$ select public.unused_delete('expense_category', pg_temp.fx('ec_unused')) $$, 'P0001', 'FORBIDDEN', 'Crew cannot delete an expense category');
select throws_ok($$ select public.unused_delete('job_title', pg_temp.fx('jt_unused')) $$, 'P0001', 'FORBIDDEN', 'Crew cannot delete a job title');
select pg_temp.as_anon();
select throws_ok($$ select public.unused_delete('job_title', '00000000-0000-4000-8000-0000000881a1') $$, '42501', null, 'signed out: no privilege (delete)');
select throws_ok($$ select public.unused_usage('job_title', '00000000-0000-4000-8000-0000000881a1') $$, '42501', null, 'signed out: no privilege (usage)');
select pg_temp.as_system();
select is(pg_temp.deleted_rows(), 1, 'the refusals deleted nothing and wrote no history (the one row is the task template''s)');
select ok(not pg_temp.gone('list_items', pg_temp.fx('jt_unused')) and not pg_temp.gone('task_types', pg_temp.fx('tt_unused'))
          and not pg_temp.gone('clients', pg_temp.fx('c_unused')) and not pg_temp.gone('client_contacts', pg_temp.fx('k_unused')),
  'every row is still there');

-- 2. Kinds and targets ---------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.unused_usage('member', pg_temp.fx('staff')) $$, 'P0001', 'VALIDATION', 'people are not a kind');
select throws_ok($$ select public.unused_delete('expense_category', pg_temp.fx('jt_unused')) $$, 'P0001', 'NOT_FOUND', 'a job title is not an expense category');
select throws_ok($$ select public.unused_delete('client', pg_temp.fx('client_a')) $$, 'P0001', 'NOT_FOUND', 'an active client is not a draft');

-- 3. Task types ----------------------------------------------------------------------------------
select is(public.unused_usage('task_type', pg_temp.fx('tt_unused')), '{"used": false}'::jsonb, 'an unused task type reads unused');
select is(public.unused_usage('task_type', pg_temp.fx('tt_live')), '{"used": true}'::jsonb, 'a type with a task reads used');
select throws_ok($$ select public.unused_delete('task_type', pg_temp.fx('tt_live')) $$, 'P0001', 'INVALID_STATE', 'refused: a live task uses it');
select throws_ok($$ select public.unused_delete('task_type', pg_temp.fx('tt_tpl')) $$, 'P0001', 'INVALID_STATE', 'refused: only a deleted task template names it');
select lives_ok($$ select public.unused_delete('task_type', pg_temp.fx('tt_hist')) $$, 'item 8: renamed (its own history) does not block');
select throws_ok($$ select public.unused_delete('task_type', pg_temp.fx('tt_field')) $$, 'P0001', 'INVALID_STATE', 'refused: only an archived field names it');
select lives_ok($$ select public.unused_delete('task_type', pg_temp.fx('tt_unused')) $$, 'the Owner deletes an unused task type');
select pg_temp.as_system();
select ok(pg_temp.gone('task_types', pg_temp.fx('tt_unused')), 'the row is gone');
select is((pg_temp.entry('task_types', pg_temp.fx('tt_unused'))).meta, '{"name": "Type unused", "kind": "task_type"}'::jsonb, 'the history row names it');
select is((pg_temp.entry('task_types', pg_temp.fx('tt_unused'))).actor_id, pg_temp.fx('owner'), 'by the Owner');
select ok(pg_temp.first('task_types', pg_temp.fx('tt_unused')), 'the history row is written before the delete');
select ok(not pg_temp.gone('task_types', pg_temp.fx('tt_live')) and not pg_temp.gone('task_types', pg_temp.fx('tt_tpl'))
          and pg_temp.gone('task_types', pg_temp.fx('tt_hist')) and not pg_temp.gone('task_types', pg_temp.fx('tt_field')),
  'the used types stay');

-- 4. Job titles ----------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.unused_delete('job_title', pg_temp.fx('jt_held')) $$, 'P0001', 'INVALID_STATE', 'refused: someone holds it');
select throws_ok($$ select public.unused_delete('job_title', pg_temp.fx('jt_once')) $$, 'P0001', 'INVALID_STATE', 'refused: someone once held it (history only)');
select is(public.unused_usage('job_title', pg_temp.fx('jt_archived')), '{"used": false}'::jsonb, 'an archived title nobody held reads unused');
select lives_ok($$ select public.unused_delete('job_title', pg_temp.fx('jt_archived')) $$, 'the Owner deletes it');
select lives_ok($$ select public.unused_delete('job_title', pg_temp.fx('jt_unused')) $$, 'and an unused active one');
select is(public.unused_usage('job_title', pg_temp.fx('jt_cycle')), '{"used": false}'::jsonb,
  'item 8: renamed, archived and restored, nobody holding it: reads unused');
select lives_ok($$ select public.unused_delete('job_title', pg_temp.fx('jt_cycle')) $$, 'item 8: the Owner deletes it');
select pg_temp.as_system();
select ok(pg_temp.gone('list_items', pg_temp.fx('jt_unused')) and pg_temp.gone('list_items', pg_temp.fx('jt_archived')), 'both rows are gone');
select is((pg_temp.entry('list_items', pg_temp.fx('jt_unused'))).meta, '{"name": "Title unused", "kind": "job_title"}'::jsonb, 'its history row');
select ok(pg_temp.first('list_items', pg_temp.fx('jt_unused')), 'written first');
select ok(pg_temp.gone('list_items', pg_temp.fx('jt_cycle')) and pg_temp.first('list_items', pg_temp.fx('jt_cycle')),
  'item 8: gone, its history row first');
select is((pg_temp.entry('list_items', pg_temp.fx('jt_cycle'))).meta, '{"name": "Title cycle renamed", "kind": "job_title"}'::jsonb,
  'item 8: the history row names it as it was last called');

-- 5. Expense categories --------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is((select array_agg(k order by k) from jsonb_object_keys(public.unused_usage('expense_category', pg_temp.fx('ec_paid'))) k),
  array['used'], 'the usage says only used or not: nothing about the claims');
select throws_ok($$ select public.unused_delete('expense_category', pg_temp.fx('ec_paid')) $$, 'P0001', 'INVALID_STATE', 'refused: a paid claim uses it');
select throws_ok($$ select public.unused_delete('expense_category', pg_temp.fx('ec_moved')) $$, 'P0001', 'INVALID_STATE', 'refused: a claim once used it (history only)');
select lives_ok($$ select public.unused_delete('expense_category', pg_temp.fx('ec_unused')) $$, 'the Owner deletes an unused category');
select pg_temp.as_system();
select ok(pg_temp.gone('list_items', pg_temp.fx('ec_unused')) and pg_temp.first('list_items', pg_temp.fx('ec_unused')),
  'gone, its history row first');
select is((select count(*)::integer from public.expense_claims), 2, 'no claim changed hands or went away');

-- 6. Fields --------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.unused_delete('field', pg_temp.fx('f_live')) $$, 'P0001', 'INVALID_STATE', 'refused: a client holds a value');
select throws_ok($$ select public.unused_delete('field', pg_temp.fx('f_old')) $$, 'P0001', 'INVALID_STATE', 'refused: an old value sits in history only');
select throws_ok($$ select public.unused_delete('field', pg_temp.fx('f_tpl')) $$, 'P0001', 'INVALID_STATE', 'refused: an archived task template holds a default');
select is(public.unused_usage('field', pg_temp.fx('f_unused')), '{"used": false}'::jsonb, 'an unused field reads unused');
select lives_ok($$ select public.unused_delete('field', pg_temp.fx('f_unused')) $$, 'the Owner deletes it');
select pg_temp.as_system();
select ok(pg_temp.gone('field_definitions', pg_temp.fx('f_unused')) and pg_temp.first('field_definitions', pg_temp.fx('f_unused'))
          and (pg_temp.entry('field_definitions', pg_temp.fx('f_unused'))).meta ->> 'name' = 'Field unused',
  'gone, its history row first and named');

-- 7. Draft clients -------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.unused_delete('client', pg_temp.fx('c_contact')) $$, 'P0001', 'INVALID_STATE', 'refused: an archived contact points at it');
select throws_ok($$ select public.unused_delete('client', pg_temp.fx('c_note')) $$, 'P0001', 'INVALID_STATE', 'refused: it has a note');
select lives_ok($$ select public.unused_delete('client', pg_temp.fx('c_edited')) $$, 'item 8: edited once (its own history) does not block');
select throws_ok($$ select public.unused_delete('client', pg_temp.fx('c_admin')) $$, 'P0001', 'INVALID_STATE', 'refused: an Admin assignment points at it');
select is(public.unused_usage('client', pg_temp.fx('c_unused')), '{"used": false}'::jsonb, 'a fresh draft reads unused');
select lives_ok($$ select public.unused_delete('client', pg_temp.fx('c_unused')) $$, 'the Owner deletes a fresh draft');
select pg_temp.as_system();
select ok(pg_temp.gone('clients', pg_temp.fx('c_unused'))
          and not exists (select 1 from public.client_brand b where b.client_id = pg_temp.fx('c_unused'))
          and not exists (select 1 from public.client_private p where p.client_id = pg_temp.fx('c_unused')),
  'the client and its empty brand and private rows are gone');
select ok(pg_temp.first('clients', pg_temp.fx('c_unused')), 'its history row first');

-- 8. Contacts ------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.unused_delete('contact', pg_temp.fx('k_primary')) $$, 'P0001', 'INVALID_STATE', 'refused: the primary while other live contacts exist');
select lives_ok($$ select public.unused_delete('contact', pg_temp.fx('k_edited')) $$, 'item 8: edited once (its own history) does not block');
select lives_ok($$ select public.unused_delete('contact', pg_temp.fx('k_archived')) $$, 'item 8: archived (its own history) does not block');
select lives_ok($$ select public.unused_delete('contact', pg_temp.fx('k_unused')) $$, 'the Owner deletes an unused contact');
select lives_ok($$ select public.unused_delete('contact', pg_temp.fx('k_alone')) $$, 'and a client''s only contact, nothing else pointing at it');
select pg_temp.as_system();
select ok(pg_temp.gone('client_contacts', pg_temp.fx('k_unused')) and pg_temp.first('client_contacts', pg_temp.fx('k_unused')),
  'gone, its history row first');
select is((pg_temp.entry('client_contacts', pg_temp.fx('k_unused'))).meta,
  jsonb_build_object('name', 'Contact unused', 'kind', 'contact', 'client_id', pg_temp.fx('client_a')), 'the history row names it and its client');

-- 9. The last active task type stays --------------------------------------------------------------
insert into public.task_types (id, org_id, name, kind, position) values
  ('00000000-0000-4000-8000-0000000886b9', pg_temp.fx('org'), 'Type last', 'normal', 'z9');
update public.task_types set archived_at = now()
where org_id = pg_temp.fx('org') and id <> '00000000-0000-4000-8000-0000000886b9' and archived_at is null;
select pg_temp.as_member('owner');
select throws_ok($$ select public.unused_delete('task_type', '00000000-0000-4000-8000-0000000886b9') $$, 'P0001', 'INVALID_STATE',
  'the organisation''s last active type is never deleted');

select * from finish();
rollback;
