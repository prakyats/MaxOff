-- V5a item 6b (v1.8; owner 2026-10-22; migration v5_owner_delete): the Owner-only Delete. Templates
-- and stage presets: deleted at any time, used or not; nothing made from them changes; the name stays
-- readable ("‹name› (deleted)"); a task template's reminder rules are copied onto the open tasks that
-- follow it first, so nobody's reminders change; the history row is written first. Holidays: only
-- before their date. Per role: the Owner allowed; an Admin and a Crew member FORBIDDEN; anon no
-- privilege. Every name here is neutral.
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
  ('owner',    '00000000-0000-4000-8000-000000008701'),
  ('admin',    '00000000-0000-4000-8000-000000008702'),
  ('staff',    '00000000-0000-4000-8000-000000008704'),
  ('client_a', '00000000-0000-4000-8000-0000000087a1');
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
create function pg_temp.entries(p_entity text, p_action text, p_id uuid) returns integer language sql stable security definer as $$
  select count(*)::integer from public.activity_log a where a.entity = p_entity and a.action = p_action and a.entity_id = p_id;
$$;
create function pg_temp.entry(p_entity text, p_id uuid) returns public.activity_log language sql stable security definer as $$
  select a from public.activity_log a where a.entity = p_entity and a.action = 'deleted' and a.entity_id = p_id;
$$;
-- True when the 'deleted' history row comes before every other history row the delete wrote.
create function pg_temp.first(p_entity text, p_id uuid) returns boolean language sql stable security definer as $$
  select (select a.id from public.activity_log a where a.entity = p_entity and a.entity_id = p_id and a.action = 'deleted')
       < (select max(a.id) from public.activity_log a where a.entity = p_entity and a.entity_id = p_id);
$$;
create function pg_temp.ptemplate(p uuid) returns public.project_templates language sql stable security definer as $$
  select t from public.project_templates t where t.id = p;
$$;
create function pg_temp.ttemplate(p uuid) returns public.task_templates language sql stable security definer as $$
  select t from public.task_templates t where t.id = p;
$$;
create function pg_temp.dtemplate(p uuid) returns public.deliverable_templates language sql stable security definer as $$
  select t from public.deliverable_templates t where t.id = p;
$$;
create function pg_temp.preset(p uuid) returns public.stage_presets language sql stable security definer as $$
  select t from public.stage_presets t where t.id = p;
$$;
create function pg_temp.task(k text) returns public.tasks language sql stable security definer as $$
  select t from public.tasks t where t.id = pg_temp.fx(k);
$$;
-- A project's structure, as the screens read it: its default stages and its deliverables list.
create function pg_temp.shape(p uuid) returns text language sql stable security definer as $$
  select coalesce((select string_agg(s.name, ',' order by s.position collate "C") from public.project_stages s
                   where s.project_id = p and s.archived_at is null), '')
    || '|' || coalesce((select string_agg(b.title, ',' order by b.position collate "C") from public.project_item_blueprints b
                        where b.project_id = p and b.archived_at is null), '')
    || '|' || (select count(*)::text from public.project_items i where i.project_id = p)
    || '|' || (select count(*)::text from public.project_cycles c where c.project_id = p);
$$;
-- A task's waiting deadline reminders, in firing order (kind:minutes).
create function pg_temp.armed(k text) returns text language sql stable security definer as $$
  select coalesce(string_agg(r.kind || ':' || coalesce(r.offset_minutes::text, '-'), ' ' order by r.fire_at, r.kind), '')
  from public.task_reminders r
  where r.task_id = pg_temp.fx(k) and r.member_id is null and r.sent_at is null and r.cancelled_at is null;
$$;
create function pg_temp.mk_task(k text, tpl uuid, rules jsonb) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member('owner');
  v_id := public.task_create(k, null,
    (select tt.id from public.task_types tt where tt.org_id = pg_temp.fx('org') and tt.name = 'Normal'),
    null, 'medium', now() + interval '5 days', array[pg_temp.fx('staff')], pg_temp.fx('staff'),
    reminder_rules => rules, template_id => tpl);
  perform pg_temp.as_system();
  insert into fx values (k, v_id);
  return v_id;
end;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org') and key not like 'client_%';
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner@example.com', 'owner', 'active', now()),
  (pg_temp.fx('admin'), pg_temp.fx('org'), 'Test Admin', 'admin@example.com', 'admin', 'active', now()),
  (pg_temp.fx('staff'), pg_temp.fx('org'), 'Test Crew',  'staff@example.com', 'staff', 'active', now());
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A', 'active', pg_temp.fx('admin'), now());
update public.task_types set default_reminders = '[]' where org_id = pg_temp.fx('org');
update public.org_settings set default_task_reminders = '[]' where org_id = pg_temp.fx('org');

-- The templates (the guard lets the system write them for a named author).
insert into public.project_templates (id, org_id, name, recurrence, stages, items, created_by) values
  ('00000000-0000-4000-8000-0000000087f1', pg_temp.fx('org'), 'Retainer 1', 'monthly', array['Shoot', 'Edit'], array['Reel 1'], pg_temp.fx('admin')),
  ('00000000-0000-4000-8000-0000000087f2', pg_temp.fx('org'), 'Unused project template', 'one_time', '{}', '{}', pg_temp.fx('owner'));
insert into fx values ('pt', '00000000-0000-4000-8000-0000000087f1'), ('pt_unused', '00000000-0000-4000-8000-0000000087f2');
insert into public.task_templates (id, org_id, name, task_type_id, reminder_rules, created_by)
select x.id, pg_temp.fx('org'), x.name,
  (select tt.id from public.task_types tt where tt.org_id = pg_temp.fx('org') and tt.name = 'Normal'), x.rules, pg_temp.fx('admin')
from (values
  ('00000000-0000-4000-8000-0000000087e1'::uuid, 'Weekly post', '[{"before": 1, "unit": "days"}, {"before": 0, "unit": "minutes"}]'::jsonb),
  ('00000000-0000-4000-8000-0000000087e2'::uuid, 'No reminders of its own', '[]'::jsonb)) as x(id, name, rules);
insert into fx values ('tt', '00000000-0000-4000-8000-0000000087e1'), ('tt_empty', '00000000-0000-4000-8000-0000000087e2');
-- Its guard wants the author to be the caller: the system writes it as the Admin.
select set_config('request.jwt.claim.sub', pg_temp.fx('admin')::text, true);
insert into public.deliverable_templates (id, org_id, name, stage_groups, created_by, archived_at, archived_reason) values
  ('00000000-0000-4000-8000-0000000087d1', pg_temp.fx('org'), 'Reel deliverable', '[{"label": null, "stages": ["Cut"]}]', pg_temp.fx('admin'), null, null),
  ('00000000-0000-4000-8000-0000000087d2', pg_temp.fx('org'), 'Old deliverable', '[]', pg_temp.fx('admin'), now(), 'Not used now');
select pg_temp.as_system();
insert into fx values ('dt', '00000000-0000-4000-8000-0000000087d1'), ('dt_archived', '00000000-0000-4000-8000-0000000087d2');
insert into public.stage_presets (id, org_id, name, stages, created_by) values
  ('00000000-0000-4000-8000-0000000087c1', pg_temp.fx('org'), 'A preset', array['One', 'Two'], null);
insert into fx values ('sp', '00000000-0000-4000-8000-0000000087c1');

-- Two projects from "Retainer 1": one open, one cancelled.
select pg_temp.as_member('admin');
insert into fx values ('p_open', public.project_create(pg_temp.fx('client_a'), 'Open project', 'monthly',
  null, null, array['Shoot', 'Edit'], array['Reel 1'], pg_temp.fx('pt')));
insert into fx values ('p_closed', public.project_create(pg_temp.fx('client_a'), 'Closed project', 'monthly',
  null, null, array['Shoot', 'Edit'], array['Reel 1'], pg_temp.fx('pt')));
select public.project_cancel(pg_temp.fx('p_closed'), 'Neutral reason');
select pg_temp.as_system();
create temporary table before_shape as
  select k, pg_temp.shape(pg_temp.fx(k)) as shape from (values ('p_open'), ('p_closed')) v(k);

-- Tasks that follow "Weekly post": open with no list (todo, changes requested), open with its own
-- list, submitted, completed and cancelled.
select pg_temp.mk_task('t_todo', pg_temp.fx('tt'), '[]'::jsonb);
select pg_temp.mk_task('t_changes', pg_temp.fx('tt'), '[]'::jsonb);
select pg_temp.mk_task('t_own', pg_temp.fx('tt'), '[{"before": 3, "unit": "hours"}]'::jsonb);
select pg_temp.mk_task('t_sub', pg_temp.fx('tt'), '[]'::jsonb);
select pg_temp.mk_task('t_done', pg_temp.fx('tt'), '[]'::jsonb);
select pg_temp.mk_task('t_cancel', pg_temp.fx('tt'), '[]'::jsonb);
select pg_temp.mk_task('t_empty', pg_temp.fx('tt_empty'), '[]'::jsonb);
update public.tasks set state = 'changes_requested' where id = pg_temp.fx('t_changes');
update public.tasks set state = 'submitted', submitted_at = now(), submitted_by = pg_temp.fx('staff') where id = pg_temp.fx('t_sub');
update public.tasks set state = 'completed', completed_at = now() where id = pg_temp.fx('t_done');
update public.tasks set state = 'cancelled', cancelled_at = now(), cancelled_reason = 'Neutral reason' where id = pg_temp.fx('t_cancel');
create temporary table before_rules as
  select k, app.task_reminder_rules(pg_temp.fx(k)) as rules, pg_temp.armed(k) as armed
  from (values ('t_todo'), ('t_changes'), ('t_own')) v(k);
select is((select armed from before_rules where k = 't_todo'), 'before_due:1440 due:0 overdue:- overdue_escalation:-',
  'an open task follows its template''s reminders before the delete');

-- 1. Who may: the Owner only ---------------------------------------------------------------------
select pg_temp.as_member('admin');
select throws_ok($$ select public.template_usage('project', pg_temp.fx('pt')) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot read the usage');
select throws_ok($$ select public.template_delete('project', pg_temp.fx('pt')) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot delete a project template (even their own)');
select throws_ok($$ select public.template_delete('task', pg_temp.fx('tt')) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot delete a task template');
select throws_ok($$ select public.template_delete('deliverable', pg_temp.fx('dt')) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot delete a deliverable template');
select throws_ok($$ select public.template_delete('stage_preset', pg_temp.fx('sp')) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot delete a stage preset');
select throws_ok($$ select public.holiday_delete(gen_random_uuid()) $$, 'P0001', 'FORBIDDEN', 'an Admin cannot delete a holiday');
select pg_temp.as_member('staff');
select throws_ok($$ select public.template_usage('task', pg_temp.fx('tt')) $$, 'P0001', 'FORBIDDEN', 'Crew cannot read the usage');
select throws_ok($$ select public.template_delete('project', pg_temp.fx('pt')) $$, 'P0001', 'FORBIDDEN', 'Crew cannot delete a project template');
select throws_ok($$ select public.template_delete('task', pg_temp.fx('tt')) $$, 'P0001', 'FORBIDDEN', 'Crew cannot delete a task template');
select throws_ok($$ select public.template_delete('deliverable', pg_temp.fx('dt')) $$, 'P0001', 'FORBIDDEN', 'Crew cannot delete a deliverable template');
select throws_ok($$ select public.template_delete('stage_preset', pg_temp.fx('sp')) $$, 'P0001', 'FORBIDDEN', 'Crew cannot delete a stage preset');
select throws_ok($$ select public.holiday_delete(gen_random_uuid()) $$, 'P0001', 'FORBIDDEN', 'Crew cannot delete a holiday');
select pg_temp.as_anon();
select throws_ok($$ select public.template_delete('project', '00000000-0000-4000-8000-0000000087f1') $$, '42501', null, 'signed out: no privilege (delete)');
select throws_ok($$ select public.template_usage('project', '00000000-0000-4000-8000-0000000087f1') $$, '42501', null, 'signed out: no privilege (usage)');
select throws_ok($$ select public.holiday_delete(gen_random_uuid()) $$, '42501', null, 'signed out: no privilege (holiday)');
select pg_temp.as_system();
select ok((pg_temp.ptemplate(pg_temp.fx('pt'))).deleted_at is null
          and (pg_temp.ttemplate(pg_temp.fx('tt'))).deleted_at is null
          and (pg_temp.dtemplate(pg_temp.fx('dt'))).deleted_at is null
          and (pg_temp.preset(pg_temp.fx('sp'))).deleted_at is null
          and (select count(*) from public.activity_log where action = 'deleted') = 0,
  'the refusals changed nothing and wrote no history');

-- 2. A used project template ---------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.template_delete('recipe', pg_temp.fx('pt')) $$, 'P0001', 'VALIDATION', 'an unknown kind is refused');
select is(public.template_usage('project', pg_temp.fx('pt')), '{"used": 2, "open": 1}'::jsonb,
  'the usage: two projects, one still open');
select is(public.template_delete('project', pg_temp.fx('pt')), '{"used": 2, "open": 1, "copied": 0}'::jsonb,
  'the Owner deletes a used project template');
select pg_temp.as_system();
select ok((pg_temp.ptemplate(pg_temp.fx('pt'))).deleted_at is not null
          and (pg_temp.ptemplate(pg_temp.fx('pt'))).deleted_by = pg_temp.fx('owner')
          and (pg_temp.ptemplate(pg_temp.fx('pt'))).archived_at is not null,
  'it is marked deleted, by the Owner, and archived');
select is((pg_temp.ptemplate(pg_temp.fx('pt'))).name, 'Retainer 1', 'its name stays stored');
select is((select count(*)::integer from public.projects p where p.template_id = pg_temp.fx('pt')), 2,
  'both projects keep their link');
select is((select string_agg(pg_temp.shape(pg_temp.fx(k)), ';' order by k) from (values ('p_open'), ('p_closed')) v(k)),
          (select string_agg(shape, ';' order by k) from before_shape),
  'both projects keep every stage, deliverable and month');
select is((select p.state::text from public.projects p where p.id = pg_temp.fx('p_closed')), 'cancelled', 'the closed one stays closed');
select is(pg_temp.entries('project_templates', 'deleted', pg_temp.fx('pt')), 1, 'one history row: deleted');
select is((pg_temp.entry('project_templates', pg_temp.fx('pt'))).meta,
  '{"name": "Retainer 1", "kind": "project", "used": 2, "open": 1}'::jsonb, 'the history row names it and its use');
select is((pg_temp.entry('project_templates', pg_temp.fx('pt'))).actor_id, pg_temp.fx('owner'), 'by the Owner');
select ok(pg_temp.first('project_templates', pg_temp.fx('pt')), 'the history row is written before the change');
-- The project's Details still read the name (and that it is deleted) under the reader's RLS.
select pg_temp.as_member('admin');
select is((select t.name || case when t.deleted_at is null then '' else ' (deleted)' end
           from public.projects p join public.project_templates t on t.id = p.template_id where p.id = pg_temp.fx('p_open')),
  'Retainer 1 (deleted)', 'the project''s Details read "Retainer 1 (deleted)"');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'Another project', 'monthly',
  null, null, array['Shoot'], array['Reel 1'], pg_temp.fx('pt')) $$, 'P0001', null, 'new projects cannot use it');
select pg_temp.as_member('owner');
select throws_ok($$ update public.project_templates set archived_at = null where id = pg_temp.fx('pt') $$,
  'P0001', 'INVALID_STATE', 'it cannot be restored');
select throws_ok($$ update public.project_templates set name = 'Renamed' where id = pg_temp.fx('pt') $$,
  'P0001', 'INVALID_STATE', 'nor edited');
select throws_ok($$ select public.template_delete('project', pg_temp.fx('pt')) $$, 'P0001', 'NOT_FOUND', 'nor deleted twice');
select throws_ok($$ select public.template_usage('project', pg_temp.fx('pt')) $$, 'P0001', 'NOT_FOUND', 'and has no usage to read');
select lives_ok($$ insert into public.project_templates (name, recurrence) values ('Retainer 1', 'monthly') $$,
  'its name is free for a new template');

-- 3. An unused project template ------------------------------------------------------------------
select is(public.template_delete('project', pg_temp.fx('pt_unused')), '{"used": 0, "open": 0, "copied": 0}'::jsonb,
  'an unused project template is deleted');
select pg_temp.as_system();
select ok((pg_temp.ptemplate(pg_temp.fx('pt_unused'))).deleted_at is not null
          and pg_temp.entries('project_templates', 'deleted', pg_temp.fx('pt_unused')) = 1,
  'marked deleted, with its history row');

-- 4. A task template: open tasks keep their reminders --------------------------------------------
select pg_temp.as_member('owner');
select is(public.template_usage('task', pg_temp.fx('tt')), '{"used": 6, "open": 3}'::jsonb,
  'the usage: six tasks follow it, three open');
select is(public.template_delete('task', pg_temp.fx('tt')), '{"used": 6, "open": 3, "copied": 2}'::jsonb,
  'the Owner deletes it; two open tasks with no list of their own get its rules');
select pg_temp.as_system();
select is((pg_temp.task('t_todo')).reminder_rules, '[{"before": 1, "unit": "days"}, {"before": 0, "unit": "minutes"}]'::jsonb,
  'a to-do task now holds the template''s rules as its own');
select is((pg_temp.task('t_changes')).reminder_rules, '[{"before": 1, "unit": "days"}, {"before": 0, "unit": "minutes"}]'::jsonb,
  'so does a task with changes requested');
select is((pg_temp.task('t_own')).reminder_rules, '[{"before": 3, "unit": "hours"}]'::jsonb,
  'a task with its own list keeps it');
select is((select string_agg(app.task_reminder_rules(pg_temp.fx(k))::text, ';' order by k) from (values ('t_todo'), ('t_changes'), ('t_own')) v(k)),
          (select string_agg(rules::text, ';' order by k) from before_rules),
  'every open task''s reminder rules are what they were');
select is((select string_agg(pg_temp.armed(k), ';' order by k) from (values ('t_todo'), ('t_changes'), ('t_own')) v(k)),
          (select string_agg(armed, ';' order by k) from before_rules),
  'and so is every waiting reminder');
select ok((pg_temp.task('t_sub')).reminder_rules = '[]'::jsonb and (pg_temp.task('t_done')).reminder_rules = '[]'::jsonb
          and (pg_temp.task('t_cancel')).reminder_rules = '[]'::jsonb,
  'submitted, completed and cancelled tasks are not rewritten');
select is((select count(*)::integer from public.tasks t where t.template_id = pg_temp.fx('tt')), 6, 'all six keep their link (the label)');
select ok((pg_temp.ttemplate(pg_temp.fx('tt'))).deleted_at is not null and (pg_temp.ttemplate(pg_temp.fx('tt'))).archived_at is not null
          and (pg_temp.ttemplate(pg_temp.fx('tt'))).name = 'Weekly post',
  'the task template is deleted and archived, its name kept');
select is((pg_temp.entry('task_templates', pg_temp.fx('tt'))).meta,
  '{"name": "Weekly post", "kind": "task", "used": 6, "open": 3}'::jsonb, 'its history row');
select ok(pg_temp.first('task_templates', pg_temp.fx('tt')), 'written before the change');
select is((select count(*)::integer from public.activity_log a where a.entity = 'tasks' and a.entity_id = pg_temp.fx('t_todo')
           and a.action = 'update' and a.diff -> 'new' ? 'reminder_rules'), 1, 'the copy onto a task is in its history');
select pg_temp.as_member('owner');
select is(public.template_delete('task', pg_temp.fx('tt_empty')), '{"used": 1, "open": 1, "copied": 0}'::jsonb,
  'a task template with no reminders of its own copies nothing');
select pg_temp.as_system();
select is((pg_temp.task('t_empty')).reminder_rules, '[]'::jsonb, 'its task still follows the next level');
select pg_temp.as_member('owner');
select throws_ok($$ select public.task_create('New', null,
    (select tt.id from public.task_types tt where tt.org_id = pg_temp.fx('org') and tt.name = 'Normal'),
    null, 'medium', now() + interval '5 days', array[pg_temp.fx('staff')], pg_temp.fx('staff'),
    template_id => pg_temp.fx('tt')) $$, 'P0001', null, 'a new task cannot follow it');

-- 5. Deliverable templates and stage presets -------------------------------------------------------
select is(public.template_usage('deliverable', pg_temp.fx('dt')), '{"used": 0, "open": 0}'::jsonb,
  'a deliverable template is copied, never linked');
select is(public.template_delete('deliverable', pg_temp.fx('dt')), '{"used": 0, "open": 0, "copied": 0}'::jsonb,
  'the Owner deletes an Admin''s deliverable template');
select is(public.template_delete('deliverable', pg_temp.fx('dt_archived')), '{"used": 0, "open": 0, "copied": 0}'::jsonb,
  'and an archived one');
select is(public.template_delete('stage_preset', pg_temp.fx('sp')), '{"used": 0, "open": 0, "copied": 0}'::jsonb,
  'the Owner deletes a stage preset, even the seeded kind with no author');
select pg_temp.as_system();
select ok((pg_temp.dtemplate(pg_temp.fx('dt'))).deleted_at is not null and (pg_temp.dtemplate(pg_temp.fx('dt'))).archived_reason = 'Deleted',
  'a deliverable template is deleted and archived with the reason "Deleted"');
select is((pg_temp.dtemplate(pg_temp.fx('dt_archived'))).archived_reason, 'Not used now', 'an archived one keeps its reason');
select ok((pg_temp.preset(pg_temp.fx('sp'))).deleted_at is not null and (pg_temp.preset(pg_temp.fx('sp'))).archived_at is not null,
  'the preset is deleted and archived');
select is((select count(*)::integer from public.activity_log a where a.action = 'deleted'
           and a.entity in ('deliverable_templates', 'stage_presets')), 3, 'one history row each');

-- 6. Holidays: only before their date ------------------------------------------------------------
insert into public.holidays (org_id, date, name) values
  (pg_temp.fx('org'), app.today_ist() + 3, 'Future holiday'),
  (pg_temp.fx('org'), app.today_ist() + 4, 'Another future holiday'),
  (pg_temp.fx('org'), app.today_ist(), 'Today holiday'),
  (pg_temp.fx('org'), app.today_ist() - 3, 'Past holiday');
create function pg_temp.holiday(n text) returns uuid language sql stable security definer as $$
  select h.id from public.holidays h where h.name = n;
$$;
insert into fx values ('h_future', pg_temp.holiday('Future holiday')), ('h_future2', pg_temp.holiday('Another future holiday')),
  ('h_today', pg_temp.holiday('Today holiday')), ('h_past', pg_temp.holiday('Past holiday'));
select pg_temp.as_member('owner');
select lives_ok($$ select public.holiday_delete(pg_temp.fx('h_future')) $$, 'the Owner deletes a holiday before its date');
select throws_ok($$ select public.holiday_delete(pg_temp.fx('h_today')) $$, 'P0001', 'INVALID_STATE', 'not on its date');
select throws_ok($$ select public.holiday_delete(pg_temp.fx('h_past')) $$, 'P0001', 'INVALID_STATE', 'nor after it');
select throws_ok($$ select public.holiday_delete(pg_temp.fx('h_future')) $$, 'P0001', 'NOT_FOUND', 'a deleted holiday is gone');
-- A plain DELETE through the API keeps the same rule (the restrictive policy).
delete from public.holidays where id in (pg_temp.fx('h_today'), pg_temp.fx('h_past'));
select pg_temp.as_system();
select is((select string_agg(h.name, ',' order by h.date) from public.holidays h),
  'Past holiday,Today holiday,Another future holiday', 'the holidays on or before today stay, even against a plain delete');
select is((pg_temp.entry('holidays', pg_temp.fx('h_future'))).meta,
  jsonb_build_object('name', 'Future holiday', 'date', app.today_ist() + 3), 'its history row names it and its date');

select * from finish();
rollback;
