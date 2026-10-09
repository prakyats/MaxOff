-- The 7B rework's review fixes (2026-10-09; migration client_work_rework_fixes): stage names once each
-- wherever they enter (S3), the 7A item_tick_stage refusing and the four unused 7A functions marked (S4),
-- the path gaps of amendment D's item stage functions (a completed or cancelled project, a done item, the
-- Owner), item_reopen on a legacy done item, and the activity reads returning only described entries
-- (S7: item_last_changes' cap and roles, project_activity for a deactivated Admin).
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

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
delete from public.members;
delete from auth.identities;
delete from auth.users;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',      '00000000-0000-4000-8000-000000007401'),
  ('admin',      '00000000-0000-4000-8000-000000007402'),
  ('admin2',     '00000000-0000-4000-8000-000000007403'),
  ('staff',      '00000000-0000-4000-8000-000000007404'),
  ('gone_admin', '00000000-0000-4000-8000-000000007405'),
  ('client_a',   '00000000-0000-4000-8000-0000000074a1'),
  ('client_b',   '00000000-0000-4000-8000-0000000074b1'),
  ('client_d',   '00000000-0000-4000-8000-0000000074d1');
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
create function pg_temp.item(t text) returns uuid language sql stable security definer as $$
  select i.id from public.project_items i where i.title = $1 order by i.created_at desc, i.id limit 1;
$$;
-- An item's active stages, in order, as "Name" or "Name✓" when ticked.
create function pg_temp.stages(t text) returns text language sql stable security definer as $$
  select coalesce(string_agg(s.name || case when s.done_at is null then '' else '✓' end, ',' order by s.position collate "C"), '')
  from public.project_item_stage_list s where s.item_id = pg_temp.item($1) and s.archived_at is null;
$$;
create function pg_temp.stage(t text, n text) returns uuid language sql stable security definer as $$
  select s.id from public.project_item_stage_list s
  where s.item_id = pg_temp.item($1) and s.name = $2 and s.archived_at is null;
$$;
create function pg_temp.code(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception when sqlstate 'P0001' then
  return sqlerrm;
end;
$$;
create function pg_temp.n(k text, kind text default null) returns bigint language sql stable security definer as $$
  select count(*) from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and ($2 is null or x.kind = $2);
$$;
create function pg_temp.last(k text, kind text) returns public.notifications language sql stable security definer as $$
  select x.* from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and x.kind = $2 order by x.created_at desc, x.id desc limit 1;
$$;
create function pg_temp.clear() returns void language plpgsql security definer as $$
begin
  delete from public.notification_deliveries;
  delete from public.notifications;
end;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org') and key not like 'client_%';
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),      pg_temp.fx('org'), 'Prishit Owner', 'owner@example.com',      'owner', 'active',      now(), null),
  (pg_temp.fx('admin'),      pg_temp.fx('org'), 'Ravi Admin',    'admin@example.com',      'admin', 'active',      now(), null),
  (pg_temp.fx('admin2'),     pg_temp.fx('org'), 'Other Admin',   'admin2@example.com',     'admin', 'active',      now(), null),
  (pg_temp.fx('staff'),      pg_temp.fx('org'), 'Test Crew',     'staff@example.com',      'staff', 'active',      now(), null),
  (pg_temp.fx('gone_admin'), pg_temp.fx('org'), 'Gone Admin',    'gone_admin@example.com', 'admin', 'deactivated', now(), now());
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery',     'active', pg_temp.fx('admin2'), now()),
  (pg_temp.fx('client_d'), pg_temp.fx('org'), 'Draft Diner',     'draft',  null,                 null);


-- Projects: an open one-time film (stages per item), a monthly retainer (its item list), one to
-- complete, one to cancel, the Owner's own path on the Admin's client.
select pg_temp.as_member('admin');
insert into fx values ('p_f', public.project_create(pg_temp.fx('client_a'), 'Brand film', 'one_time', null, app.today_ist() + 10,
  array['Script', 'Shoot', 'Edit'], array['Film', 'Teaser', 'Legacy', 'Owner cut']));
insert into fx values ('p_m', public.project_create(pg_temp.fx('client_a'), 'Monthly reels', 'monthly', null, null,
  array['Script', 'Edit'], array['Reel 1', 'Reel 2']));
insert into fx values ('p_c', public.project_create(pg_temp.fx('client_a'), 'Done film', 'one_time', null, app.today_ist() + 5,
  array['Edit'], array['Closed cut']));
insert into fx values ('p_x', public.project_create(pg_temp.fx('client_a'), 'Dropped film', 'one_time', null, app.today_ist() + 5,
  array['Edit'], array['Dropped cut']));
insert into fx select 'c_stage', pg_temp.stage('Closed cut', 'Edit');
insert into fx select 'x_stage', pg_temp.stage('Dropped cut', 'Edit');
select public.item_mark_done(pg_temp.item('Closed cut'));
select public.project_complete(pg_temp.fx('p_c'));
select public.project_cancel(pg_temp.fx('p_x'), 'The client dropped it');

-- 1. Stage names, once each (review fix S3) ----------------------------------------------------------------
select pg_temp.as_system();
select throws_ok($$ select app.client_work_stage_names(array['Edit', ' edit ']) $$, 'P0001', 'VALIDATION',
  'a list naming a stage twice (ignoring case and spaces) is refused');
select is(app.client_work_stage_names(array[' Script ', 'Edit']), array['Script', 'Edit'], 'distinct names pass, trimmed');
select throws_ok($$ select app.item_stage_list_init(pg_temp.item('Film'), array['Colour', 'COLOUR']) $$, 'P0001', 'VALIDATION',
  'a new item''s starting stages too');
select pg_temp.as_member('admin');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'Twice film', 'one_time', null, app.today_ist() + 3,
  array['Edit', 'EDIT'], array['T1']) $$, 'P0001', 'VALIDATION', 'project_create: default stages named twice are refused');
select is((select count(*)::integer from public.projects where name = 'Twice film'), 0, 'and nothing is made');
insert into fx select 'bp1', id from public.project_item_blueprints where project_id = pg_temp.fx('p_m') and title = 'Reel 1';
select throws_ok($$ select public.project_blueprint_update(pg_temp.fx('bp1'), '{"stages": ["Shoot", "shoot"]}') $$, 'P0001', 'VALIDATION',
  'project_blueprint_update: a line''s stages named twice are refused');
select is((select stages from public.project_item_blueprints where id = pg_temp.fx('bp1')), array['Script', 'Edit'], 'the line is unchanged');
-- A line holding a name twice from before this fix: a new cycle refuses it rather than seed it.
select pg_temp.as_system();
update public.project_item_blueprints set stages = array['Shoot', 'shoot'] where id = pg_temp.fx('bp1');
select throws_ok($$ select app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p_m')),
  (app.period_start('monthly', app.today_ist()) - interval '1 month')::date, 'schedule', null) $$, 'P0001', 'VALIDATION',
  'cycle_create: a line''s stages named twice never reach an item');
select throws_ok($$ select app.cycle_copy_item_list((select p from public.projects p where p.id = pg_temp.fx('p_m')),
  (select cycle_id from public.project_items where id = pg_temp.item('Reel 1')), null) $$, 'P0001', 'VALIDATION',
  'cycle_copy_item_list: nor through a list copied in');
update public.project_item_blueprints set stages = array['Script', 'Edit'] where id = pg_temp.fx('bp1');
select pg_temp.as_member('admin');
select throws_ok($$ select public.project_stage_add(pg_temp.fx('p_m'), ' script ') $$, 'P0001', 'CONFLICT',
  'project_stage_add: a name already active on the project is refused (ignoring case)');
insert into fx values ('d_cap', public.project_stage_add(pg_temp.fx('p_m'), 'Caption'));
select throws_ok($$ select public.project_stage_update(pg_temp.fx('d_cap'), '{"name": "EDIT"}') $$, 'P0001', 'CONFLICT',
  'project_stage_update: never to a name another active stage has');
select is(public.project_stage_update(pg_temp.fx('d_cap'), '{"name": "CAPTION"}'), array['name'], 'its own name in another case is fine');
select lives_ok($$ select public.project_stage_archive(pg_temp.fx('d_cap')) $$, 'removed');
select ok(public.project_stage_add(pg_temp.fx('p_m'), 'Caption') is not null, 'a removed stage''s name may be used again');

-- 2. The 7A functions amendment D left unused (review fix S4) --------------------------------------------
select throws_ok($$ select public.item_tick_stage(pg_temp.item('Film'),
  (select id from public.project_stages where project_id = pg_temp.fx('p_f') and name = 'Script')) $$, 'P0001', 'INVALID_STATE',
  'item_tick_stage refuses: use the item''s own stages');
select is((select count(*)::integer from public.project_item_stages), 0, 'nothing is written to the old tick table');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_tick_stage(pg_temp.item('Film'), pg_temp.fx('c_stage')) $$), 'FORBIDDEN',
  'its permission check stays first (Crew)');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_tick_stage(pg_temp.item('Film'), pg_temp.fx('c_stage')) $$), 'NOT_FOUND',
  'and its scope check (another Admin)');
select pg_temp.as_system();
select is((select count(*)::integer from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('item_tick_stage', 'item_approve', 'item_reject', 'item_unmark_done')
           and obj_description(p.oid, 'pg_proc') like 'Unused since amendment D (2026-10-09); kept for expand-only; drop in a contract migration.%'),
  4, 'the four 7A functions are marked unused, to drop in a contract migration');
select ok((select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'item_tick_stage'),
  'item_tick_stage keeps its grants');

-- 3. Item stages on a completed or cancelled project, on a done item (review fix S6) ---------------------
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.item_stage_add(pg_temp.item('Closed cut'), 'More') $$), 'INVALID_STATE', 'a completed project: no stage added');
select is(pg_temp.code($$ select public.item_stage_update(pg_temp.fx('c_stage'), '{"name": "Grade"}') $$), 'INVALID_STATE', 'none renamed');
select is(pg_temp.code($$ select public.item_stage_archive(pg_temp.fx('c_stage')) $$), 'INVALID_STATE', 'none removed');
select is(pg_temp.code($$ select public.item_stage_tick(pg_temp.fx('c_stage')) $$), 'INVALID_STATE', 'none ticked');
select is(pg_temp.code($$ select public.item_stage_add(pg_temp.item('Dropped cut'), 'More') $$), 'INVALID_STATE', 'a cancelled project: no stage added');
select is(pg_temp.code($$ select public.item_stage_update(pg_temp.fx('x_stage'), '{"name": "Grade"}') $$), 'INVALID_STATE', 'none renamed');
select is(pg_temp.code($$ select public.item_stage_archive(pg_temp.fx('x_stage')) $$), 'INVALID_STATE', 'none removed');
select is(pg_temp.code($$ select public.item_stage_tick(pg_temp.fx('x_stage')) $$), 'INVALID_STATE', 'none ticked');
select public.item_mark_done(pg_temp.item('Teaser'));
select is(pg_temp.code($$ select public.item_stage_update(pg_temp.stage('Teaser', 'Edit'), '{"name": "Grade"}') $$), 'INVALID_STATE',
  'a done (approved) item''s stages are not renamed');
select is(pg_temp.code($$ select public.item_stage_archive(pg_temp.stage('Teaser', 'Edit')) $$), 'INVALID_STATE', 'nor removed');

-- 4. The Owner's path on another client's item ---------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.item_stage_update(pg_temp.stage('Owner cut', 'Edit'), '{"name": "Final edit"}'), array['name'], 'the Owner renames an item''s stage');
select is(public.item_stage_tick(pg_temp.stage('Owner cut', 'Final edit')), true, 'ticks one');
select lives_ok($$ select public.item_stage_archive(pg_temp.stage('Owner cut', 'Script')) $$, 'removes one');
select is(pg_temp.stages('Owner cut'), 'Shoot,Final edit✓', 'on that item');
select is((select string_agg(action, ',' order by id) from public.activity_log
           where entity = 'project_item_stage_list' and entity_id = pg_temp.item('Owner cut') and actor_id = pg_temp.fx('owner')),
  'update,ticked,archived', 'each audited as the Owner');

-- 5. item_reopen on a legacy done item (from before D3) ------------------------------------------------------
select pg_temp.as_system();
update public.project_items set state = 'done', done_at = now(), done_by = pg_temp.fx('admin') where id = pg_temp.item('Legacy');
select pg_temp.as_member('admin');
select is(public.item_reopen(pg_temp.item('Legacy'), 'Not finished'), 'open'::public.item_state,
  'a legacy done item is reopened too (open again)');
select is((select action || ':' || (meta ->> 'from_state') from public.activity_log
           where entity = 'project_items' and entity_id = pg_temp.item('Legacy') order by id desc limit 1),
  'reopened:done', 'audited ''reopened'', from done');
select is((select state::text || ':' || (done_at is null)::text from public.project_items where id = pg_temp.item('Legacy')), 'open:true',
  'its done mark cleared');

-- 6. The activity reads: only what the history describes (review fix S7) ------------------------------------
select pg_temp.as_system();
select ok(app.client_work_activity_shown('project_items', 'done', '{}'::jsonb)
          and app.client_work_activity_shown('project_items', 'update', '{"new": {"notes": "x", "reopened_at": "x"}}'::jsonb)
          and app.client_work_activity_shown('project_item_stage_list', 'ticked', '{}'::jsonb)
          and app.client_work_activity_shown('project_item_blueprints', 'update', '{"new": {"stages": []}}'::jsonb)
          and app.client_work_activity_shown('project_cycles', 'item_list_added', '{}'::jsonb)
          and app.client_work_activity_shown('projects', 'update', '{"new": {"delivery_date": "2026-11-01"}}'::jsonb),
  'shown: what the history has a sentence for');
select ok(not app.client_work_activity_shown('project_item_stage_list', 'initial', '{}'::jsonb)
          and not app.client_work_activity_shown('project_cycles', 'settled', '{}'::jsonb)
          and not app.client_work_activity_shown('project_items', 'update', '{"new": {"overdue_armed_at": "x"}}'::jsonb)
          and not app.client_work_activity_shown('projects', 'update', '{"new": {"state": "in_progress"}}'::jsonb)
          and not app.client_work_activity_shown('project_item_blueprints', 'update', '{"new": {"archived_at": null}}'::jsonb)
          and not app.client_work_activity_shown('project_items', 'prompted', '{}'::jsonb)
          and not app.client_work_activity_shown('item_reviews', 'insert', '{}'::jsonb),
  'skipped: starting stages, settling, internal keys, a change with no sentence, unknown actions and entities');
-- Entries the history has no sentence for, newest of all: the reads skip them.
insert into public.activity_log (org_id, actor_id, entity, entity_id, action, diff, meta, at)
select pg_temp.fx('org'), pg_temp.fx('admin'), x.entity, x.entity_id, x.action, x.diff, '{}'::jsonb, now() + interval '1 hour'
from (values
  ('projects', pg_temp.fx('p_f'), 'update', '{"old": {"state": "open"}, "new": {"state": "in_progress"}}'::jsonb),
  ('project_cycles', pg_temp.fx('p_f'), 'settled', '{}'::jsonb),
  ('project_items', pg_temp.item('Film'), 'prompted', '{}'::jsonb),
  ('project_items', pg_temp.item('Film'), 'update', '{"old": {}, "new": {"overdue_armed_at": "2026-10-09T00:00:00Z"}}'::jsonb)
) as x(entity, entity_id, action, diff);
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'), 'all', null, null, null, 100) a
           where not app.client_work_activity_shown(a.entity, a.action, a.diff)), 0,
  'project_activity returns only entries the history describes');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'), 'all', null, null, null, 100) a
           where a.at > now() + interval '30 minutes'), 0, 'the newest, undescribed entries are skipped');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'), 'all', null, null, null, 3)), 3,
  'so a page holds as many lines as it asks for');
select is((select action from public.item_last_changes(array[pg_temp.item('Film')])), 'insert',
  'item_last_changes: the latest entry the history describes, past the undescribed ones');
select throws_ok($$ select * from public.item_last_changes(array(select gen_random_uuid() from generate_series(1, 201))) $$,
  'P0001', 'VALIDATION', 'item_last_changes: at most 200 items at once');
select is((select count(*)::integer from public.item_last_changes(
             array(select gen_random_uuid() from generate_series(1, 199)) || pg_temp.item('Film'))), 1,
  '200 are read (unknown ids give nothing)');
select pg_temp.as_member('owner');
select is((select count(*)::integer from public.item_last_changes(array[pg_temp.item('Film'), pg_temp.item('Owner cut')])), 2,
  'the Owner reads each item''s last change');
select is((select action from public.item_last_changes(array[pg_temp.item('Owner cut')])), 'archived', 'the newest one');
select pg_temp.as_member('staff');
select is((select count(*)::integer from public.item_last_changes(array[pg_temp.item('Film')])), 0, 'Crew read nothing');
select pg_temp.as_member('gone_admin');
select is((select count(*)::integer from public.item_last_changes(array[pg_temp.item('Film')])), 0, 'a deactivated Admin reads nothing');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'))), 0,
  'nor the project''s activity (project_activity)');
select pg_temp.as_anon();
select throws_ok($$ select * from public.item_last_changes(array[pg_temp.item('Film')]) $$, '42501', null, 'anon cannot call item_last_changes');

select * from finish();
rollback;
