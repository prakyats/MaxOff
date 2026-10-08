-- 7A (7.2) Client work transition functions, each path (ADR-0006: permission + scope + state +
-- change + activity_log + notifications): project_create / _update / _complete / _cancel / _reopen,
-- the stage and item-list edits, item_add / _update / _cancel / _mark_done / _unmark_done /
-- _tick_stage / _approve (bulk) / _reject, cycle_start_next and cycle_carry_decide. Every role:
-- the Owner (any client), the client's Admin (their clients, amendment C), another Admin (NOT_FOUND),
-- Crew (FORBIDDEN), a deactivated Admin (UNAUTHENTICATED), anon (no EXECUTE). WORKFLOWS §9's rows.
-- Dates are computed from app.today_ist(), so the file holds on any day.
begin;
create extension if not exists pgtap with schema extensions;
select plan(274);

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
delete from public.eod_reports;
delete from public.notification_deliveries;
delete from public.notifications;
delete from public.push_subscriptions;
delete from public.member_reachability;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',      '00000000-0000-4000-8000-000000006801'),
  ('admin',      '00000000-0000-4000-8000-000000006802'),
  ('admin2',     '00000000-0000-4000-8000-000000006803'),
  ('staff',      '00000000-0000-4000-8000-000000006804'),
  ('gone_admin', '00000000-0000-4000-8000-000000006805'),
  ('client_a',   '00000000-0000-4000-8000-0000000068a1'),
  ('client_b',   '00000000-0000-4000-8000-0000000068b1'),
  ('client_p',   '00000000-0000-4000-8000-0000000068c1'),
  ('client_x',   '00000000-0000-4000-8000-0000000068d1'),
  ('client_d',   '00000000-0000-4000-8000-0000000068e1');
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

-- Reads as the system (RLS is 67's), whatever role the test is in.
create function pg_temp.n(k text, kind text default null) returns bigint language sql stable security definer as $$
  select count(*) from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and ($2 is null or x.kind = $2);
$$;
create function pg_temp.last(k text, kind text) returns public.notifications language sql stable security definer as $$
  select x.* from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and x.kind = $2 order by x.created_at desc, x.id desc limit 1;
$$;
create function pg_temp.total() returns bigint language sql stable security definer as $$
  select count(*) from public.notifications
$$;
-- The item of that title in the project's current (or one-time) cycle: the earliest cycle not ended.
create function pg_temp.item(p text, t text) returns public.project_items language sql stable security definer as $$
  select i.* from public.project_items i join public.project_cycles c on c.id = i.cycle_id
  where i.project_id = pg_temp.fx($1) and i.title = $2
    and (c.period_end is null or c.period_end >= app.today_ist())
  order by c.period_start nulls first, i.id limit 1;
$$;
create function pg_temp.project(p text) returns public.projects language sql stable security definer as $$
  select x.* from public.projects x where x.id = pg_temp.fx($1);
$$;
create function pg_temp.stage(p text, s text) returns uuid language sql stable security definer as $$
  select x.id from public.project_stages x where x.project_id = pg_temp.fx($1) and x.name = $2;
$$;
create function pg_temp.cycle_of(p text, d date) returns public.project_cycles language sql stable security definer as $$
  select c.* from public.project_cycles c where c.project_id = pg_temp.fx($1) and c.period_start is not distinct from $2;
$$;
-- The result of one id in a bulk call's answer.
create function pg_temp.res(r jsonb, id uuid) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(r) x where x ->> 'id' = id::text;
$$;
-- 'ok', or the code a P0001 failure carries.
create function pg_temp.code(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception when sqlstate 'P0001' then
  return sqlerrm;
end;
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
  (pg_temp.fx('client_p'), pg_temp.fx('org'), 'Paused Studio',   'paused', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_x'), pg_temp.fx('org'), 'Closing Co',      'active', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_d'), pg_temp.fx('org'), 'Draft Diner',     'draft',  null,                 null);
insert into public.field_definitions (org_id, entity, key, label, type, position)
values (pg_temp.fx('org'), 'item', 'views', 'Views', 'number', 'a0');
delete from public.activity_log;

-- 0. Signatures --------------------------------------------------------------------------------------
select ok((select bool_and(has_function_privilege('authenticated', p.oid, 'execute')
                           and not has_function_privilege('anon', p.oid, 'execute')
                           and p.prosecdef and p.proconfig @> array['search_path=""'])
           from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('project_create', 'project_update', 'project_complete', 'project_cancel',
               'project_reopen', 'project_stage_add', 'project_stage_update', 'project_stage_archive',
               'project_blueprint_add', 'project_blueprint_update', 'project_blueprint_archive', 'item_add',
               'item_update', 'item_cancel', 'item_mark_done', 'item_unmark_done', 'item_tick_stage',
               'item_approve', 'item_reject', 'cycle_start_next', 'cycle_carry_decide')),
  'the 21 client-work functions: authenticated, never anon; SECURITY DEFINER with an empty search_path');
select is((select count(*)::integer from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('project_set_billing_category')), 0,
  'no project_set_billing_category in phase 7 (amendment C: money, phase 9)');
select ok(not (select bool_or(actionable or always_email) from public.notification_kinds
               where kind in ('project_created', 'project_completed', 'project_cancelled', 'project_reopened',
                              'item_cancelled', 'carry_decided'))
          and (select bool_and(actionable and not always_email) from public.notification_kinds
               where kind in ('item_rejected', 'cycle_generated')),
  'info kinds never email; sent back and cycle generated are actionable (the email fallback), never always');

-- A. project_create ---------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok($$ insert into fx values ('p_m', public.project_create(pg_temp.fx('client_a'), ' Monthly reels ', 'monthly',
  'Four reels', null, array['Script', 'Shoot', 'Edit'], array['Reel 1', 'Reel 2'])) $$,
  'the client''s Admin creates a monthly project (amendment C)');
select is((select name || ':' || state::text || ':' || (created_by = pg_temp.fx('admin'))::text from public.projects where id = pg_temp.fx('p_m')),
  'Monthly reels:open:true', 'open, named (trimmed), by the Admin');
select is((select array_agg(name order by position collate "C") from public.project_stages where project_id = pg_temp.fx('p_m')),
  array['Script', 'Shoot', 'Edit'], 'its stages, in order');
select is((select array_agg(title order by position collate "C") from public.project_item_blueprints where project_id = pg_temp.fx('p_m')),
  array['Reel 1', 'Reel 2'], 'its item list');
select is((select generated_by || ':' || label || ':' || period_end::text from public.project_cycles where project_id = pg_temp.fx('p_m')),
  'create:' || app.cycle_label('monthly', app.period_start('monthly', app.today_ist())) || ':'
    || app.period_end('monthly', app.period_start('monthly', app.today_ist()))::text,
  'the current month''s cycle at once (an Active client), labelled "October 2026"-style');
select is((select count(*)::integer from public.project_items i
           join public.project_cycles c on c.id = i.cycle_id
           where i.project_id = pg_temp.fx('p_m') and i.state = 'open' and i.origin_cycle_id = c.id), 2,
  'the item list copied in as open items of that cycle');
select is((pg_temp.last('owner', 'project_created')).title, 'Ravi Admin added the project Monthly reels for Sharma Weddings',
  'the Owner is told (WORKFLOWS §9)');
select is((pg_temp.last('owner', 'project_created')).body, 'Set the amount and billing category.',
  'with the amended wording, and never an amount');
select is((pg_temp.last('owner', 'project_created')).link,
  '/clients/' || pg_temp.fx('client_a') || '/projects/' || pg_temp.fx('p_m'), 'opening the project');
select is(pg_temp.n('admin'), 0::bigint, 'the creating Admin (the actor) gets nothing');
select is((select count(*)::integer from public.activity_log
           where entity = 'projects' and entity_id = pg_temp.fx('p_m') and action = 'insert' and actor_id = pg_temp.fx('admin')), 1,
  'audited: the insert, by the Admin');
select pg_temp.clear();

select pg_temp.as_member('owner');
select lives_ok($$ insert into fx values ('p_w', public.project_create(pg_temp.fx('client_a'), 'Weekly posts', 'weekly',
  null, null, array['Draft', 'Post'], array['Post 1'])) $$, 'the Owner creates a weekly project');
select is((select label from public.project_cycles where project_id = pg_temp.fx('p_w')),
  app.cycle_label('weekly', app.period_start('weekly', app.today_ist())), 'its current week''s cycle ("5–11 Oct 2026"-style)');
select is(pg_temp.total(), 0::bigint, 'the Owner''s own project tells nobody');
select lives_ok($$ insert into fx values ('p_o', public.project_create(pg_temp.fx('client_d'), 'Launch film', 'one_time',
  null, app.today_ist() + 20, array['Shoot'], array['Film', 'Teaser'])) $$,
  'the Owner creates a one-time project on a Draft client with no Admin (decision 1)');
select is((select count(*)::integer || ':' || bool_and(period_start is null and label is null)::text from public.project_cycles where project_id = pg_temp.fx('p_o')),
  '1:true', 'its single cycle, with no period');
select is((select count(*)::integer from public.project_items where project_id = pg_temp.fx('p_o')), 2,
  'its items go straight into it');
select is((select count(*)::integer from public.project_item_blueprints where project_id = pg_temp.fx('p_o')), 0,
  'and it keeps no item list');
select lives_ok($$ insert into fx values ('p_p', public.project_create(pg_temp.fx('client_p'), 'Paused retainer', 'weekly',
  null, null, '{}', array['Story'])) $$, 'a weekly project on a Paused client is created');
select is((select count(*)::integer from public.project_cycles where project_id = pg_temp.fx('p_p')), 0,
  'with no cycle while the client is not Active (decision 1)');
select lives_ok($$ insert into fx values ('p_x', public.project_create(pg_temp.fx('client_x'), 'Closing retainer', 'monthly',
  null, null, array['Edit'], array['Video'])) $$, 'a project on a client about to close');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'monthly REELS', 'weekly') $$, 'P0001', 'CONFLICT',
  'the name is unique per client among open projects, case-insensitive (decision 5)');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'One off', 'one_time') $$, 'P0001', 'VALIDATION',
  'a one-time project needs a delivery date (amendment A)');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'Dated retainer', 'weekly', null, app.today_ist()) $$,
  'P0001', 'VALIDATION', 'a weekly project has none');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'Many stages', 'weekly', null, null,
  array['1','2','3','4','5','6','7','8','9','10','11','12','13']) $$, 'P0001', 'VALIDATION', 'at most 12 stages');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'Many items', 'weekly', null, null, '{}',
  array(select 'Item ' || g from generate_series(1, 101) g)) $$, 'P0001', 'VALIDATION', 'at most 100 items');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), '   ', 'weekly') $$, 'P0001', 'VALIDATION', 'a name is required');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'Templated', 'weekly', null, null, '{}', '{}',
  '00000000-0000-4000-8000-0000000068ff') $$, 'P0001', 'VALIDATION', 'a template must be one of the organisation''s');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'Fields', 'weekly', null, null, '{}', '{}', null,
  '{"nope": 1}') $$, 'P0001', 'VALIDATION', 'project field values are checked');
select pg_temp.as_member('admin');
select throws_ok($$ select public.project_create(pg_temp.fx('client_b'), 'Not mine', 'weekly') $$, 'P0001', 'NOT_FOUND',
  'an Admin cannot create on another Admin''s client');
select throws_ok($$ select public.project_create(pg_temp.fx('client_d'), 'Draft', 'weekly') $$, 'P0001', 'NOT_FOUND',
  'nor on a Draft client with no Admin (only the Owner there)');
select pg_temp.as_member('staff');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'Crew', 'weekly') $$, 'P0001', 'FORBIDDEN', 'Crew cannot');
select pg_temp.as_member('gone_admin');
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'Gone', 'weekly') $$, 'P0001', 'UNAUTHENTICATED',
  'a deactivated Admin cannot');
select pg_temp.as_anon();
select throws_ok($$ select public.project_create(pg_temp.fx('client_a'), 'Anon', 'weekly') $$, '42501', null, 'anon cannot call it');
select pg_temp.as_member('owner');
select public.client_close(pg_temp.fx('client_x'), null);
select throws_ok($$ select public.project_create(pg_temp.fx('client_x'), 'After close', 'weekly') $$, 'P0001', 'INVALID_STATE',
  'an Inactive client takes no new project (decision 1)');
select pg_temp.clear();

-- B. project_update ----------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select is(public.project_update(pg_temp.fx('p_m'), '{"name": "Monthly reels v2", "description": "Five reels"}'),
  array['name', 'description'], 'the Admin renames and describes their project; the changed keys come back');
select is(public.project_update(pg_temp.fx('p_m'), '{"name": "Monthly reels v2"}'), '{}'::text[], 'nothing changed: nothing written');
select throws_ok($$ select public.project_update(pg_temp.fx('p_m'), '{"delivery_date": "2026-12-01"}') $$, 'P0001', 'VALIDATION',
  'a monthly project takes no delivery date');
select throws_ok($$ select public.project_update(pg_temp.fx('p_m'), '{"recurrence": "weekly"}') $$, 'P0001', 'VALIDATION',
  'recurrence is not a detail that changes (decision 4)');
select throws_ok($$ select public.project_update(pg_temp.fx('p_m'), '{"client_id": "00000000-0000-4000-8000-0000000068b1"}') $$,
  'P0001', 'VALIDATION', 'nor the client');
select throws_ok($$ select public.project_update(pg_temp.fx('p_m'), '{"name": "Weekly posts"}') $$, 'P0001', 'CONFLICT',
  'a name another open project of the client holds');
select throws_ok($$ select public.project_update(pg_temp.fx('p_o'), '{"name": "x"}') $$, 'P0001', 'NOT_FOUND',
  'never a project of a client that is not theirs');
select pg_temp.as_member('owner');
select is(public.project_update(pg_temp.fx('p_o'), jsonb_build_object('delivery_date', app.today_ist() + 40)), array['delivery_date'],
  'the Owner moves a one-time project''s delivery date (amendment A)');
select is((select (diff -> 'old' ->> 'delivery_date') || '>' || (diff -> 'new' ->> 'delivery_date') from public.activity_log
           where entity = 'projects' and entity_id = pg_temp.fx('p_o') and action = 'update' order by id desc limit 1),
  (app.today_ist() + 20)::text || '>' || (app.today_ist() + 40)::text, 'audited with the old and new date');
select throws_ok($$ select public.project_update(pg_temp.fx('p_o'), '{"delivery_date": null}') $$, 'P0001', 'VALIDATION',
  'a one-time project keeps a delivery date');
select throws_ok($$ select public.project_update(pg_temp.fx('p_o'), '{"delivery_date": "soon"}') $$, 'P0001', 'VALIDATION',
  'a date must be a date');
select pg_temp.as_member('staff');
select throws_ok($$ select public.project_update(pg_temp.fx('p_m'), '{"name": "Crew"}') $$, 'P0001', 'FORBIDDEN', 'Crew cannot edit');

-- C. Stages (decision 8) ----------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok($$ insert into fx values ('s_new', public.project_stage_add(pg_temp.fx('p_m'), 'Posted')) $$, 'a stage is added');
select is((select array_agg(name order by position collate "C") from public.project_stages where project_id = pg_temp.fx('p_m')),
  array['Script', 'Shoot', 'Edit', 'Posted'], 'at the end');
select throws_ok($$ select public.project_stage_update(pg_temp.fx('s_new'), '{"position": "Z0"}') $$, 'P0001', 'VALIDATION',
  'a position is a key of the list ([0-9a-z])');
select is(public.project_stage_update(pg_temp.fx('s_new'), '{"name": "Published", "position": "0"}'), array['name', 'position'],
  'renamed and moved first');
select is((select array_agg(name order by position collate "C") from public.project_stages where project_id = pg_temp.fx('p_m')),
  array['Published', 'Script', 'Shoot', 'Edit'], 'the new order');
select lives_ok($$ select public.project_stage_archive(pg_temp.fx('s_new')) $$, 'a stage is removed: archived');
select throws_ok($$ select public.project_stage_archive(pg_temp.fx('s_new')) $$, 'P0001', 'INVALID_STATE', 'once');
select throws_ok($$ select public.project_stage_update(pg_temp.fx('s_new'), '{"name": "Back"}') $$, 'P0001', 'INVALID_STATE',
  'a removed stage is not renamed');
select is((select count(*)::integer from public.activity_log
           where entity = 'project_stages' and entity_id = pg_temp.fx('p_m') and action = 'archived'), 1,
  'audited on the project''s history');
select lives_ok($$ select public.project_stage_add(pg_temp.fx('p_m'), 'S' || g) from generate_series(1, 9) g $$,
  'up to 12 active stages');
select throws_ok($$ select public.project_stage_add(pg_temp.fx('p_m'), 'Thirteenth') $$, 'P0001', 'VALIDATION', 'never 13');
select pg_temp.as_member('admin2');
select throws_ok($$ select public.project_stage_add(pg_temp.fx('p_m'), 'Not mine') $$, 'P0001', 'NOT_FOUND',
  'another Admin cannot touch the stages');

-- D. The item list (decision 9) ----------------------------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok($$ insert into fx values ('b_new', public.project_blueprint_add(pg_temp.fx('p_m'), 'Reel 3')) $$,
  'the item list gains an entry');
select is((select count(*)::integer from public.project_items where project_id = pg_temp.fx('p_m')), 2,
  'the current cycle is not touched (later cycles only)');
select is(public.project_blueprint_update(pg_temp.fx('b_new'), '{"title": "Reel three"}'), array['title'], 'renamed');
select lives_ok($$ select public.project_blueprint_archive(pg_temp.fx('b_new')) $$, 'removed (archived)');
select throws_ok($$ select public.project_blueprint_update(pg_temp.fx('b_new'), '{"title": "Back"}') $$, 'P0001', 'INVALID_STATE',
  'a removed entry does not change');
select pg_temp.as_member('owner');
select throws_ok($$ select public.project_blueprint_add(pg_temp.fx('p_o'), 'More') $$, 'P0001', 'VALIDATION',
  'a one-time project has no item list');

-- E. item_add / item_update ---------------------------------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok($$ insert into fx values ('i_extra', public.item_add(
  (pg_temp.cycle_of('p_m', app.period_start('monthly', app.today_ist()))).id, 'Bonus reel', app.today_ist() - 400, ' Rush ',
  '{"views": 10}')) $$,
  'an item is added to the current cycle, any planned date (decision 10)');
select is((select notes || ':' || (origin_cycle_id = cycle_id)::text || ':' || state::text from public.project_items where id = pg_temp.fx('i_extra')),
  'Rush:true:open', 'open, its notes trimmed, its own cycle as origin');
select is(public.item_update(pg_temp.fx('i_extra'), '{"title": "Bonus", "planned_date": null, "notes": ""}'),
  array['title', 'notes', 'planned_date'], 'renamed, the date and notes cleared');
select throws_ok($$ select public.item_update(pg_temp.fx('i_extra'), '{"state": "approved"}') $$, 'P0001', 'VALIDATION',
  'the state is not an item detail');
select throws_ok($$ select public.item_update(pg_temp.fx('i_extra'), '{"custom_fields": {"views": "lots"}}') $$, 'P0001', 'VALIDATION',
  'field values are checked');
select throws_ok($$ select public.item_add((pg_temp.cycle_of('p_o', null)).id, 'Sneaky') $$, 'P0001', 'NOT_FOUND',
  'never into a cycle of another client''s project');
select pg_temp.as_member('owner');
select lives_ok($$ select public.item_add((pg_temp.cycle_of('p_o', null)).id, 'Behind the scenes') $$,
  'a one-time project''s single cycle always takes items');
-- A past cycle (a month back) for the monthly project, made as the system.
select pg_temp.as_system();
select app.cycle_create(pg_temp.project('p_m'), (app.period_start('monthly', app.today_ist()) - interval '1 month')::date, 'schedule', null);
select app.cycle_refresh((pg_temp.cycle_of('p_m', (app.period_start('monthly', app.today_ist()) - interval '1 month')::date)).id);
select pg_temp.as_member('admin');
select throws_ok($$ select public.item_add((pg_temp.cycle_of('p_m', (app.period_start('monthly', app.today_ist()) - interval '1 month')::date)).id, 'Late') $$,
  'P0001', 'INVALID_STATE', 'never into a past cycle (decision 9)');
select throws_ok($$ select public.item_add((pg_temp.cycle_of('p_x', app.period_start('monthly', app.today_ist()))).id, 'After close') $$,
  'P0001', 'INVALID_STATE', 'an Inactive client takes no new item');
select pg_temp.as_system();
insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id)
select pg_temp.fx('org'), pg_temp.fx('p_w'), c.id, 'Filler ' || g, 'f' || lpad(g::text, 3, '0'), c.id
from pg_temp.cycle_of('p_w', app.period_start('weekly', app.today_ist())) c, generate_series(1, 99) g;
select pg_temp.as_member('owner');
select throws_ok($$ select public.item_add((pg_temp.cycle_of('p_w', app.period_start('weekly', app.today_ist()))).id, 'One too many') $$,
  'P0001', 'VALIDATION', 'at most 100 live items per cycle (decision 9)');

-- F. Done, Not done, ticks (decisions 6, 7) ----------------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('admin');
select is(public.item_tick_stage((pg_temp.item('p_m', 'Reel 1')).id, pg_temp.stage('p_m', 'Script')), true,
  'the Admin ticks a stage on an open item');
select is((select state::text from public.projects where id = pg_temp.fx('p_m')), 'in_progress',
  'the project moves open -> in progress on the first tick (WORKFLOWS §5.1)');
select is((select count(*)::integer from public.activity_log where entity = 'projects' and entity_id = pg_temp.fx('p_m') and action = 'started'), 1,
  'audited ''started''');
select is(public.item_tick_stage((pg_temp.item('p_m', 'Reel 1')).id, pg_temp.stage('p_m', 'Script')), false, 'ticking twice changes nothing');
select is(public.item_tick_stage((pg_temp.item('p_m', 'Reel 1')).id, pg_temp.stage('p_m', 'Script'), false), true, 'unticked');
select is((select done_at is null and done_by is null from public.project_item_stages
           where item_id = (pg_temp.item('p_m', 'Reel 1')).id), true, 'the row stays, its tick cleared (the history keeps it)');
select is(public.item_tick_stage((pg_temp.item('p_m', 'Reel 1')).id, pg_temp.stage('p_m', 'Script'), false), false, 'unticking twice changes nothing');
select is(public.item_tick_stage((pg_temp.item('p_m', 'Reel 1')).id, pg_temp.stage('p_m', 'Shoot')), true, 'another stage ticked');
select throws_ok($$ select public.item_tick_stage((pg_temp.item('p_m', 'Reel 1')).id, pg_temp.stage('p_w', 'Draft')) $$, 'P0001', 'NOT_FOUND',
  'a stage of another project is refused');
select throws_ok($$ select public.item_tick_stage((pg_temp.item('p_m', 'Reel 1')).id,
  (select id from public.project_stages where project_id = pg_temp.fx('p_m') and archived_at is not null limit 1)) $$,
  'P0001', 'INVALID_STATE', 'a removed stage is refused');
select is(public.item_mark_done((pg_temp.item('p_m', 'Reel 1')).id), 'done'::public.item_state, 'Mark done: open -> done');
select is((select (done_by = pg_temp.fx('admin'))::text || ':' || (done_at is not null)::text from public.project_items where id = (pg_temp.item('p_m', 'Reel 1')).id),
  'true:true', 'done_at and done_by set');
select throws_ok($$ select public.item_mark_done((pg_temp.item('p_m', 'Reel 1')).id) $$, 'P0001', 'INVALID_STATE', 'not twice');
select is(public.item_tick_stage((pg_temp.item('p_m', 'Reel 1')).id, pg_temp.stage('p_m', 'Edit')), true,
  'a done item still takes ticks (decision 7)');
select is(public.item_unmark_done((pg_temp.item('p_m', 'Reel 1')).id), 'open'::public.item_state, 'Not done: done -> open (decision 6)');
select is((select done_at is null and done_by is null from public.project_items where id = (pg_temp.item('p_m', 'Reel 1')).id), true,
  'done_at and done_by cleared');
select throws_ok($$ select public.item_unmark_done((pg_temp.item('p_m', 'Reel 1')).id) $$, 'P0001', 'INVALID_STATE', 'only a done item');
select is((select array_agg(action order by id) from public.activity_log
           where entity = 'project_items' and entity_id = (pg_temp.item('p_m', 'Reel 1')).id and action in ('done', 'not_done')),
  array['done', 'not_done'], 'both audited');
select is(pg_temp.total(), 0::bigint, 'ticks, Done and Not done notify nobody (WORKFLOWS §9)');
select public.item_mark_done((pg_temp.item('p_m', 'Reel 1')).id);
select public.item_mark_done((pg_temp.item('p_m', 'Reel 2')).id);
select pg_temp.as_member('staff');
select throws_ok($$ select public.item_mark_done((pg_temp.item('p_m', 'Bonus')).id) $$, 'P0001', 'FORBIDDEN', 'Crew cannot mark done');
select throws_ok($$ select public.item_tick_stage((pg_temp.item('p_m', 'Bonus')).id, pg_temp.stage('p_m', 'Script')) $$, 'P0001', 'FORBIDDEN',
  'nor tick');
select pg_temp.as_member('admin2');
select throws_ok($$ select public.item_mark_done((pg_temp.item('p_m', 'Bonus')).id) $$, 'P0001', 'NOT_FOUND',
  'another Admin cannot mark it done');
select pg_temp.as_member('admin');
select lives_ok($$ select public.item_mark_done((pg_temp.item('p_x', 'Video')).id) $$,
  'a closed client''s items can still be marked done (decision 15)');

-- G. Approve (bulk) and reject (amendment C) ----------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('admin');
create temporary table r (k text primary key, v jsonb);
grant select, insert on r to authenticated;
insert into r values ('approve', public.item_approve(array[(pg_temp.item('p_m', 'Reel 1')).id, (pg_temp.item('p_m', 'Bonus')).id,
  (pg_temp.item('p_o', 'Film')).id, '00000000-0000-4000-8000-0000000068fe']));
select is((pg_temp.res((select v from r where k = 'approve'), (pg_temp.item('p_m', 'Reel 1')).id)) ->> 'state', 'approved',
  'the client''s Admin approves a done item of their client (amendment C)');
select is((pg_temp.res((select v from r where k = 'approve'), (pg_temp.item('p_m', 'Bonus')).id)) ->> 'code', 'INVALID_STATE',
  'an open item is not approved (per-id result)');
select is((pg_temp.res((select v from r where k = 'approve'), (pg_temp.item('p_o', 'Film')).id)) ->> 'code', 'NOT_FOUND',
  'another client''s item is NOT_FOUND for them');
select is((pg_temp.res((select v from r where k = 'approve'), '00000000-0000-4000-8000-0000000068fe')) ->> 'code', 'NOT_FOUND',
  'an unknown id too');
select is(jsonb_array_length((select v from r where k = 'approve')), 4, 'one result per id');
select is((select state::text || ':' || (approved_by = pg_temp.fx('admin'))::text from public.project_items where id = (pg_temp.item('p_m', 'Reel 1')).id),
  'approved:true', 'approved, by the Admin');
select is((select count(*)::integer from public.item_reviews
           where item_id = (pg_temp.item('p_m', 'Reel 1')).id and decision = 'approved' and reviewer_id = pg_temp.fx('admin')), 1,
  'an item_reviews row');
select is(pg_temp.total(), 0::bigint, 'an approval notifies nobody (amendment C6)');
select throws_ok($$ select public.item_tick_stage((pg_temp.item('p_m', 'Reel 1')).id, pg_temp.stage('p_m', 'Script')) $$, 'P0001', 'INVALID_STATE',
  'approval locks the ticks (decision 7)');
select throws_ok($$ select public.item_update((pg_temp.item('p_m', 'Reel 1')).id, '{"title": "Changed"}') $$, 'P0001', 'INVALID_STATE',
  'and the item');
select throws_ok($$ select public.item_unmark_done((pg_temp.item('p_m', 'Reel 1')).id) $$, 'P0001', 'INVALID_STATE',
  'Not done ends at approval');
select throws_ok($$ select public.item_approve('{}') $$, 'P0001', 'VALIDATION', 'an empty bulk is refused');
select pg_temp.as_member('staff');
select throws_ok($$ select public.item_approve(array[(pg_temp.item('p_m', 'Reel 2')).id]) $$, 'P0001', 'FORBIDDEN', 'Crew cannot approve');
select pg_temp.as_member('admin2');
select is((pg_temp.res(public.item_approve(array[(pg_temp.item('p_m', 'Reel 2')).id]), (pg_temp.item('p_m', 'Reel 2')).id)) ->> 'code', 'NOT_FOUND',
  'another Admin cannot approve it');

select pg_temp.as_member('owner');
select throws_ok($$ select public.item_reject((pg_temp.item('p_m', 'Reel 2')).id, '  ') $$, 'P0001', 'REASON_REQUIRED', 'a rejection needs a reason');
select is(public.item_reject((pg_temp.item('p_m', 'Reel 2')).id, 'Wrong music'), 'open'::public.item_state,
  'the Owner sends a done item back: open');
select is((select done_at is null from public.project_items where id = (pg_temp.item('p_m', 'Reel 2')).id), true, 'done_at cleared');
select is((select reason from public.item_reviews where item_id = (pg_temp.item('p_m', 'Reel 2')).id and decision = 'rejected'), 'Wrong music',
  'the reason recorded');
select is((pg_temp.last('admin', 'item_rejected')).title, 'Sent back: Reel 2', 'the client''s Admin is told (actionable)');
select is((pg_temp.last('admin', 'item_rejected')).body, 'Monthly reels v2 · Sharma Weddings. Prishit Owner: Wrong music', 'with the reason');
select throws_ok($$ select public.item_reject((pg_temp.item('p_m', 'Reel 2')).id, 'Again') $$, 'P0001', 'INVALID_STATE', 'only a done item');
select pg_temp.clear();
select pg_temp.as_member('admin');
select public.item_mark_done((pg_temp.item('p_m', 'Reel 2')).id);
select is(public.item_reject((pg_temp.item('p_m', 'Reel 2')).id, 'Self check'), 'open'::public.item_state, 'the Admin rejects on their client');
select is(pg_temp.total(), 0::bigint, 'and nobody is told (never the actor)');

-- H. item_cancel -------------------------------------------------------------------------------------
select pg_temp.clear();
select throws_ok($$ select public.item_cancel((pg_temp.item('p_m', 'Bonus')).id, null) $$, 'P0001', 'REASON_REQUIRED', 'a cancel needs a reason');
select is(public.item_cancel((pg_temp.item('p_m', 'Bonus')).id, 'Client dropped it'), 'cancelled'::public.item_state,
  'the Admin cancels an item with a reason');
select is((select cancelled_reason || ':' || (cancelled_by = pg_temp.fx('admin'))::text from public.project_items where id = (pg_temp.item('p_m', 'Bonus')).id),
  'Client dropped it:true', 'the reason and who');
select is((pg_temp.last('owner', 'item_cancelled')).title, 'Ravi Admin cancelled Bonus', 'the Owner is told (info)');
select throws_ok($$ select public.item_cancel((pg_temp.item('p_m', 'Reel 1')).id, 'Too late') $$, 'P0001', 'INVALID_STATE',
  'an approved item is not cancelled');
select pg_temp.clear();
select pg_temp.as_member('owner');
select lives_ok($$ select public.item_cancel((pg_temp.item('p_o', 'Teaser')).id, 'Not needed') $$, 'the Owner cancels an item');
select is(pg_temp.total(), 0::bigint, 'and nobody is told');

-- I. cycle_start_next (decision 3) ----------------------------------------------------------------------
select pg_temp.clear();
select lives_ok($$ insert into fx values ('c_next', public.cycle_start_next(pg_temp.fx('p_w'))) $$,
  'the Owner starts next week''s cycle (always within 7 days of it)');
select is((select generated_by || ':' || period_start::text || ':' || (created_by = pg_temp.fx('owner'))::text
           from public.project_cycles where id = pg_temp.fx('c_next')),
  'manual:' || app.period_next('weekly', app.period_start('weekly', app.today_ist()))::text || ':true', 'the next period, manual');
select is((select array_agg(title) from public.project_items where cycle_id = pg_temp.fx('c_next')), array['Post 1'],
  'the item list copied in');
select is((pg_temp.last('admin', 'cycle_generated')).title,
  (select label from public.project_cycles where id = pg_temp.fx('c_next')) || ' is ready: Weekly posts',
  'the client''s Admin is told when the Owner starts it');
select throws_ok($$ select public.cycle_start_next(pg_temp.fx('p_w')) $$, 'P0001', 'INVALID_STATE', 'never twice');
select is(pg_temp.code($$ select public.cycle_start_next(pg_temp.fx('p_x')) $$), 'INVALID_STATE',
  'an Inactive client takes no new cycle');
select is(pg_temp.code($$ select public.cycle_start_next(pg_temp.fx('p_p')) $$), 'INVALID_STATE', 'nor a Paused one');
select throws_ok($$ select public.cycle_start_next(pg_temp.fx('p_o')) $$, 'P0001', 'VALIDATION', 'a one-time project has one cycle');
select is(pg_temp.code($$ select public.cycle_start_next(pg_temp.fx('p_m')) $$),
  case when app.period_next('monthly', app.period_start('monthly', app.today_ist())) - app.today_ist() > 7
       then 'INVALID_STATE' else 'ok' end,
  'a month starts at most 7 days early');
select pg_temp.clear();
select pg_temp.as_member('admin');
select lives_ok($$ select public.project_create(pg_temp.fx('client_a'), 'Second weekly', 'weekly', null, null, '{}', array['A'])
                  from (select 1) x $$, 'another weekly project');
select lives_ok($$ select public.cycle_start_next((select id from public.projects where name = 'Second weekly')) $$,
  'the Admin starts its next cycle');
select is(pg_temp.n('admin'), 0::bigint, 'an Admin''s own start tells the Admin nothing');
select pg_temp.as_member('staff');
select throws_ok($$ select public.cycle_start_next(pg_temp.fx('p_w')) $$, 'P0001', 'FORBIDDEN', 'Crew cannot start cycles');

-- J. Carry decisions (decisions 11-13, 16; amendment C) ---------------------------------------------------
-- The past month's cycle of the monthly project holds Reel 1 and Reel 2 (open). Give them ticks, a date
-- and a done one.
select pg_temp.as_system();
insert into fx select 'c_past', (pg_temp.cycle_of('p_m', (app.period_start('monthly', app.today_ist()) - interval '1 month')::date)).id;
insert into fx select 'pi1', id from public.project_items where cycle_id = pg_temp.fx('c_past') and title = 'Reel 1';
insert into fx select 'pi2', id from public.project_items where cycle_id = pg_temp.fx('c_past') and title = 'Reel 2';
select pg_temp.as_member('owner');
select pg_temp.as_system();
insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id)
values (pg_temp.fx('org'), pg_temp.fx('p_m'), pg_temp.fx('c_past'), 'Reel 9', 'b0', pg_temp.fx('c_past'));
insert into fx select 'pi9', id from public.project_items where cycle_id = pg_temp.fx('c_past') and title = 'Reel 9';
select pg_temp.as_member('admin');
select public.item_tick_stage(pg_temp.fx('pi1'), pg_temp.stage('p_m', 'Script'));
select public.item_update(pg_temp.fx('pi1'), jsonb_build_object('planned_date', app.today_ist() - 35, 'notes', 'Use the drone shot',
  'custom_fields', '{"views": 5}'::jsonb));
select public.item_mark_done(pg_temp.fx('pi9'));
select pg_temp.clear();

select pg_temp.as_member('staff');
select throws_ok($$ select public.cycle_carry_decide(array[pg_temp.fx('pi1')], 'carry_forward') $$, 'P0001', 'FORBIDDEN', 'Crew cannot decide');
select pg_temp.as_member('admin2');
select throws_ok($$ select public.cycle_carry_decide(array[pg_temp.fx('pi1')], 'carry_forward') $$, 'P0001', 'NOT_FOUND',
  'another Admin cannot');
select pg_temp.as_member('owner');
select throws_ok($$ select public.cycle_carry_decide(array[(pg_temp.item('p_m', 'Reel 2')).id], 'carry_forward') $$, 'P0001', 'INVALID_STATE',
  'the current cycle''s items are not decided yet');
select throws_ok($$ select public.cycle_carry_decide(array[pg_temp.fx('pi1'), (pg_temp.item('p_m', 'Reel 2')).id], 'leave_pending') $$,
  'P0001', 'VALIDATION', 'one cycle at a time');
select throws_ok($$ select public.cycle_carry_decide(array[pg_temp.fx('pi1'), pg_temp.fx('pi2')], 'close', 'x') $$, 'P0001', 'VALIDATION',
  'close is one item at a time');
select throws_ok($$ select public.cycle_carry_decide(array[pg_temp.fx('pi2')], 'close') $$, 'P0001', 'REASON_REQUIRED', 'with a reason');
insert into r values ('carry', public.cycle_carry_decide(array[pg_temp.fx('pi1'), pg_temp.fx('pi9')], 'carry_forward'));
select is((pg_temp.res((select v from r where k = 'carry'), pg_temp.fx('pi9'))) ->> 'code', 'INVALID_STATE',
  'a done item is not in the carry decision: it waits for approval (decision 11)');
select is((select state::text || ':' || carry_decision::text || ':' || (carry_decided_by = pg_temp.fx('owner'))::text
           from public.project_items where id = pg_temp.fx('pi1')), 'carried:carry_forward:true',
  'the Owner carries an open item forward: the original is carried');
insert into fx select 'pi1_new', ((pg_temp.res((select v from r where k = 'carry'), pg_temp.fx('pi1'))) ->> 'new_item_id')::uuid;
select is((select (cycle_id = (pg_temp.cycle_of('p_m', app.period_start('monthly', app.today_ist()))).id)::text
                  || ':' || title || ':' || notes || ':' || (custom_fields ->> 'views') || ':' || coalesce(planned_date::text, 'none')
                  || ':' || (carried_from_item_id = pg_temp.fx('pi1'))::text || ':' || (origin_cycle_id = pg_temp.fx('c_past'))::text
                  || ':' || state::text
           from public.project_items where id = pg_temp.fx('pi1_new')),
  'true:Reel 1:Use the drone shot:5:none:true:true:open',
  'a new open item in the current cycle: title, notes and fields kept, the planned date cleared, carried from, origin kept (decision 12)');
select is((select count(*)::integer from public.project_item_stages s
           join public.project_item_stages o on o.stage_id = s.stage_id and o.item_id = pg_temp.fx('pi1')
           where s.item_id = pg_temp.fx('pi1_new') and s.done_at = o.done_at and s.done_by = o.done_by), 1,
  'its ticks with their original times and people');
select is((pg_temp.last('admin', 'carry_decided')).title,
  '1 item carried into ' || (pg_temp.cycle_of('p_m', app.period_start('monthly', app.today_ist()))).label,
  'the client''s Admin is told, one row for the batch');
select is(pg_temp.n('admin', 'carry_decided'), 1::bigint, 'one row');
select pg_temp.clear();
select pg_temp.as_member('admin');
insert into r values ('pending', public.cycle_carry_decide(array[pg_temp.fx('pi2'), (pg_temp.item('p_o', 'Film')).id], 'leave_pending'));
select is((pg_temp.res((select v from r where k = 'pending'), pg_temp.fx('pi2'))) ->> 'state', 'open',
  'the Admin leaves an item pending on their client: still open');
select is((pg_temp.res((select v from r where k = 'pending'), (pg_temp.item('p_o', 'Film')).id)) ->> 'code', 'NOT_FOUND',
  'an item of a client that is not theirs is NOT_FOUND on its own line, never a VALIDATION for the batch (7A review L4)');
select is((select carry_decision::text from public.project_items where id = pg_temp.fx('pi2')), 'leave_pending', 'marked leave_pending');
select is(pg_temp.total(), 0::bigint, 'an Admin''s own decision tells nobody');
select is((select state::text from public.project_cycles where id = pg_temp.fx('c_past')), 'open',
  'a pending item keeps its cycle open (WORKFLOWS §5.2)');
select is(public.item_mark_done(pg_temp.fx('pi2')), 'done'::public.item_state, 'a pending item stays workable');
select public.item_unmark_done(pg_temp.fx('pi2'));
select pg_temp.as_member('owner');
select is((pg_temp.res(public.cycle_carry_decide(array[pg_temp.fx('pi2')], 'close', 'Out of scope'), pg_temp.fx('pi2'))) ->> 'state', 'cancelled',
  'decided again: the Owner closes it with a reason');
select is((select state::text || ':' || carry_decision::text || ':' || cancelled_reason from public.project_items where id = pg_temp.fx('pi2')),
  'cancelled:close:Out of scope', 'cancelled, close, the reason');
select is((pg_temp.last('admin', 'carry_decided')).title, '1 item closed in ' || (select label from public.project_cycles where id = pg_temp.fx('c_past')),
  'the Admin is told');
select is((select state::text from public.project_cycles where id = pg_temp.fx('c_past')), 'open',
  'the done item still holds the cycle open');
select public.item_approve(array[pg_temp.fx('pi9')]);
select is((select state::text from public.project_cycles where id = pg_temp.fx('c_past')), 'settled',
  'once nothing is open or done and a later cycle exists, the cycle is settled');
select is((select count(*)::integer from public.activity_log where entity = 'project_cycles' and action = 'settled'), 1, 'audited ''settled''');

-- Carry forward on a Paused client creates the next cycle (decision 13); refused on an Inactive one.
select pg_temp.as_system();
select app.cycle_create(pg_temp.project('p_p'), app.period_start('weekly', app.today_ist()) - 14, 'schedule', null);
insert into fx select 'pp1', id from public.project_items
where cycle_id = (pg_temp.cycle_of('p_p', app.period_start('weekly', app.today_ist()) - 14)).id;
select app.cycle_create(pg_temp.project('p_x'), (app.period_start('monthly', app.today_ist()) - interval '1 month')::date, 'schedule', null);
insert into fx select 'px1', id from public.project_items
where cycle_id = (pg_temp.cycle_of('p_x', (app.period_start('monthly', app.today_ist()) - interval '1 month')::date)).id;
-- An item list of 100, so the cycle a carry would make is full the moment it is made (7A review L7).
insert into public.project_item_blueprints (org_id, project_id, title, position)
select pg_temp.fx('org'), pg_temp.fx('p_p'), 'Extra ' || g, 'x' || lpad(g::text, 3, '0') from generate_series(1, 99) g;
select pg_temp.as_member('admin');
select is((pg_temp.res(public.cycle_carry_decide(array[pg_temp.fx('pp1')], 'carry_forward'), pg_temp.fx('pp1'))) ->> 'code', 'VALIDATION',
  'a carry into a cycle that would already hold 100 items fails on its line');
select is((select count(*)::integer from public.project_cycles
           where project_id = pg_temp.fx('p_p') and period_start > app.period_start('weekly', app.today_ist()) - 14), 0,
  'and the target cycle it made is not left behind (7A review L7)');
select pg_temp.as_system();
update public.project_item_blueprints set archived_at = now() where project_id = pg_temp.fx('p_p') and title like 'Extra %';
select pg_temp.as_member('admin');
select is((pg_temp.res(public.cycle_carry_decide(array[pg_temp.fx('pp1')], 'carry_forward'), pg_temp.fx('pp1'))) ->> 'ok', 'true',
  'carry forward on a Paused client is allowed');
select is((select generated_by || ':' || period_start::text from public.project_cycles
           where project_id = pg_temp.fx('p_p') and period_start > app.period_start('weekly', app.today_ist()) - 14),
  'carry:' || app.period_start('weekly', app.today_ist())::text,
  'it creates the cycle (the next period has ended, so the current one; generated_by carry)');
select is((select count(*)::integer from public.project_items i join public.project_cycles c on c.id = i.cycle_id
           where c.project_id = pg_temp.fx('p_p') and c.generated_by = 'carry'), 2,
  'with the item list copied in beside the carried item');
select throws_ok($$ select public.cycle_carry_decide(array[pg_temp.fx('px1')], 'carry_forward') $$, 'P0001', 'INVALID_STATE',
  'carry forward on an Inactive client is refused (decision 13)');
select is((pg_temp.res(public.cycle_carry_decide(array[pg_temp.fx('px1')], 'leave_pending'), pg_temp.fx('px1'))) ->> 'ok', 'true',
  'leave pending is allowed there');

-- K. Project lifecycle (decision 14; amendment C) -------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('admin2');
select throws_ok($$ select public.project_complete(pg_temp.fx('p_m')) $$, 'P0001', 'NOT_FOUND', 'another Admin cannot complete it');
select pg_temp.as_member('staff');
select throws_ok($$ select public.project_complete(pg_temp.fx('p_m')) $$, 'P0001', 'FORBIDDEN', 'Crew cannot');
select pg_temp.as_member('admin');
select throws_ok($$ select public.project_complete(pg_temp.fx('p_m')) $$, 'P0001', 'INVALID_STATE',
  'complete is refused while an item is open or done');
-- Finish the monthly project: approve what is done, cancel the rest.
select public.item_mark_done(i.id) from public.project_items i where i.project_id = pg_temp.fx('p_m') and i.state = 'open';
select public.item_approve(array(select id from public.project_items where project_id = pg_temp.fx('p_m') and state = 'done'));
select is(public.project_complete(pg_temp.fx('p_m')), 'completed'::public.project_state,
  'the client''s Admin completes their project (amendment C)');
select is((select (completed_by = pg_temp.fx('admin'))::text || ':' || (completed_at is not null)::text from public.projects where id = pg_temp.fx('p_m')),
  'true:true', 'completed_at, completed_by');
select is((pg_temp.last('owner', 'project_completed')).title, 'Ravi Admin completed Monthly reels v2', 'the Owner is told (C6)');
select is(pg_temp.n('admin'), 0::bigint, 'the actor is not');
select throws_ok($$ select public.item_add((pg_temp.cycle_of('p_m', app.period_start('monthly', app.today_ist()))).id, 'More') $$,
  'P0001', 'INVALID_STATE', 'a completed project is read-only: no items');
select throws_ok($$ select public.project_update(pg_temp.fx('p_m'), '{"name": "x"}') $$, 'P0001', 'INVALID_STATE', 'no edits');
select throws_ok($$ select public.project_stage_add(pg_temp.fx('p_m'), 'x') $$, 'P0001', 'INVALID_STATE', 'no stages');
select throws_ok($$ select public.project_complete(pg_temp.fx('p_m')) $$, 'P0001', 'INVALID_STATE', 'not completed twice');
select throws_ok($$ select public.project_reopen(pg_temp.fx('p_m'), '') $$, 'P0001', 'REASON_REQUIRED', 'a reopen needs a reason');
select pg_temp.clear();
select pg_temp.as_member('owner');
select is(public.project_reopen(pg_temp.fx('p_m'), 'One more reel'), 'in_progress'::public.project_state,
  'the Owner reopens it: in progress, since items were ticked and done');
select is((select meta ->> 'reason' from public.activity_log where entity = 'projects' and entity_id = pg_temp.fx('p_m') and action = 'reopened'),
  'One more reel', 'the reason in the history');
select is((pg_temp.last('admin', 'project_reopened')).title, 'Prishit Owner reopened Monthly reels v2', 'the client''s Admin is told');
select is((select completed_at is null and completed_by is null from public.projects where id = pg_temp.fx('p_m')), true, 'completion cleared');
select throws_ok($$ select public.project_reopen(pg_temp.fx('p_m'), 'Again') $$, 'P0001', 'INVALID_STATE', 'only a completed or cancelled project');
select public.item_add((pg_temp.cycle_of('p_m', app.period_start('monthly', app.today_ist()))).id, 'One more reel');
select lives_ok($$ select public.project_cancel(pg_temp.fx('p_m'), 'Budget cut') $$, 'a project with approved items is cancelled');
select is((select string_agg(state::text || '=' || n, ',' order by state) from
            (select state, count(*) n from public.project_items where project_id = pg_temp.fx('p_m')
             and state in ('approved', 'open', 'done') group by state) x),
  'approved=' || (select count(*) from public.item_reviews r join public.project_items i on i.id = r.item_id
                  where i.project_id = pg_temp.fx('p_m') and r.decision = 'approved'),
  'its approved items stay approved; nothing is left open or done (decision 14)');

select pg_temp.clear();
select public.item_mark_done((pg_temp.item('p_w', 'Post 1')).id);
select throws_ok($$ select public.project_cancel(pg_temp.fx('p_w'), null) $$, 'P0001', 'REASON_REQUIRED', 'a cancel needs a reason');
select is(public.project_cancel(pg_temp.fx('p_w'), 'Client paused social'), 'cancelled'::public.project_state, 'the Owner cancels a project');
select is((select count(*)::integer from public.project_items where project_id = pg_temp.fx('p_w') and state in ('open', 'done')), 0,
  'every open and done item cancelled with it');
select is((select count(*)::integer from public.project_items
           where project_id = pg_temp.fx('p_w') and state = 'cancelled' and cancelled_reason = 'Client paused social'), 101,
  'with the project''s reason');
select is((pg_temp.last('admin', 'project_cancelled')).body, 'Sharma Weddings. Reason: Client paused social', 'the Admin is told, with the reason');
select is(pg_temp.n('admin', 'item_cancelled') + pg_temp.n('owner', 'item_cancelled'), 0::bigint, 'no row per item');
select throws_ok($$ select public.item_mark_done((pg_temp.item('p_w', 'Post 1')).id) $$, 'P0001', 'INVALID_STATE', 'a cancelled project is read-only');
select throws_ok($$ select public.cycle_start_next(pg_temp.fx('p_w')) $$, 'P0001', 'INVALID_STATE', 'and starts no cycle');
select throws_ok($$ select public.project_complete(pg_temp.fx('p_w')) $$, 'P0001', 'INVALID_STATE', 'nor completes');
select pg_temp.as_member('admin');
select is(public.project_reopen(pg_temp.fx('p_w'), 'Back on'), 'in_progress'::public.project_state,
  'the Admin reopens it (amendment C): in progress (an item was done)');
select is((select count(*)::integer from public.project_items where project_id = pg_temp.fx('p_w') and state = 'cancelled'), 101,
  'its cancelled items stay cancelled');
select is((pg_temp.last('owner', 'project_reopened')).title, 'Ravi Admin reopened Weekly posts', 'the Owner is told');
select pg_temp.as_member('owner');
select lives_ok($$ select public.project_cancel(pg_temp.fx('p_p'), 'Never started') $$, 'a project nobody worked on is cancelled');
select is((select case when exists (select 1 from public.project_item_stages s join public.project_items i on i.id = s.item_id
                                    where i.project_id = pg_temp.fx('p_p')) then 'ticked' else 'never' end), 'never',
  'nothing of it was ticked or done');
select is(public.project_reopen(pg_temp.fx('p_p'), 'Restart'), 'open'::public.project_state,
  'so a reopen returns it to open (decision 14)');
select pg_temp.as_member('gone_admin');
select throws_ok($$ select public.project_cancel(pg_temp.fx('p_p'), 'x') $$, 'P0001', 'UNAUTHENTICATED', 'a deactivated Admin cannot');
select pg_temp.as_anon();
select throws_ok($$ select public.project_complete(pg_temp.fx('p_p')) $$, '42501', null, 'anon cannot');

-- L. Every role on every function (7A review M1) -----------------------------------------------------
-- Another Admin is NOT_FOUND (the scope never confirms a row exists), Crew FORBIDDEN (no key), a
-- deactivated Admin UNAUTHENTICATED, whatever the row's state. The rows are client_a's (Ravi's),
-- resolved as the system so no caller's RLS empties an id.
select pg_temp.as_system();
insert into fx
select 'm_stage', pg_temp.stage('p_w', 'Draft')
union all select 'm_blueprint', (select id from public.project_item_blueprints where project_id = pg_temp.fx('p_w') and title = 'Post 1')
union all select 'm_cycle', (pg_temp.cycle_of('p_w', app.period_start('weekly', app.today_ist()))).id
union all select 'm_item', (pg_temp.item('p_w', 'Post 1')).id;
create temporary table calls (fn text primary key, sql text not null, other_admin text);
grant select on calls to authenticated;
insert into calls values
  ('project_create',            $c$select public.project_create(pg_temp.fx('client_a'), 'Matrix', 'weekly')$c$,          'NOT_FOUND'),
  ('project_update',            $c$select public.project_update(pg_temp.fx('p_w'), '{"name": "x"}')$c$,                   'NOT_FOUND'),
  ('project_complete',          $c$select public.project_complete(pg_temp.fx('p_w'))$c$,                                  'NOT_FOUND'),
  ('project_cancel',            $c$select public.project_cancel(pg_temp.fx('p_w'), 'x')$c$,                               'NOT_FOUND'),
  ('project_reopen',            $c$select public.project_reopen(pg_temp.fx('p_m'), 'x')$c$,                               'NOT_FOUND'),
  ('project_stage_add',         $c$select public.project_stage_add(pg_temp.fx('p_w'), 'x')$c$,                            'NOT_FOUND'),
  ('project_stage_update',      $c$select public.project_stage_update(pg_temp.fx('m_stage'), '{"name": "x"}')$c$,         'NOT_FOUND'),
  ('project_stage_archive',     $c$select public.project_stage_archive(pg_temp.fx('m_stage'))$c$,                         'NOT_FOUND'),
  ('project_blueprint_add',     $c$select public.project_blueprint_add(pg_temp.fx('p_w'), 'x')$c$,                        'NOT_FOUND'),
  ('project_blueprint_update',  $c$select public.project_blueprint_update(pg_temp.fx('m_blueprint'), '{"title": "x"}')$c$, 'NOT_FOUND'),
  ('project_blueprint_archive', $c$select public.project_blueprint_archive(pg_temp.fx('m_blueprint'))$c$,                 'NOT_FOUND'),
  ('item_add',                  $c$select public.item_add(pg_temp.fx('m_cycle'), 'x')$c$,                                 'NOT_FOUND'),
  ('item_update',               $c$select public.item_update(pg_temp.fx('m_item'), '{"title": "x"}')$c$,                  'NOT_FOUND'),
  ('item_cancel',               $c$select public.item_cancel(pg_temp.fx('m_item'), 'x')$c$,                               'NOT_FOUND'),
  ('item_mark_done',            $c$select public.item_mark_done(pg_temp.fx('m_item'))$c$,                                 'NOT_FOUND'),
  ('item_unmark_done',          $c$select public.item_unmark_done(pg_temp.fx('m_item'))$c$,                               'NOT_FOUND'),
  ('item_tick_stage',           $c$select public.item_tick_stage(pg_temp.fx('m_item'), pg_temp.fx('m_stage'))$c$,         'NOT_FOUND'),
  -- Another Admin's item_approve answers NOT_FOUND per id (section G), it raises nothing.
  ('item_approve',              $c$select public.item_approve(array[pg_temp.fx('m_item')])$c$,                            null),
  ('item_reject',               $c$select public.item_reject(pg_temp.fx('m_item'), 'x')$c$,                               'NOT_FOUND'),
  ('cycle_start_next',          $c$select public.cycle_start_next(pg_temp.fx('p_w'))$c$,                                  'NOT_FOUND'),
  ('cycle_carry_decide',        $c$select public.cycle_carry_decide(array[pg_temp.fx('pi1')], 'leave_pending')$c$,        'NOT_FOUND');
select is((select array_agg(fn order by fn) from calls),
  (select array_agg(p.proname::text order by p.proname::text) from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('project_create', 'project_update', 'project_complete', 'project_cancel',
       'project_reopen', 'project_stage_add', 'project_stage_update', 'project_stage_archive',
       'project_blueprint_add', 'project_blueprint_update', 'project_blueprint_archive', 'item_add',
       'item_update', 'item_cancel', 'item_mark_done', 'item_unmark_done', 'item_tick_stage',
       'item_approve', 'item_reject', 'cycle_start_next', 'cycle_carry_decide')),
  'the matrix covers each of the 21 client-work functions');
select pg_temp.as_member('admin2');
select is(pg_temp.code(c.sql), c.other_admin, c.fn || ': another Admin gets ' || c.other_admin)
from calls c where c.other_admin is not null order by c.fn;
select pg_temp.as_member('staff');
select is(pg_temp.code(c.sql), 'FORBIDDEN', c.fn || ': Crew get FORBIDDEN') from calls c order by c.fn;
select pg_temp.as_member('gone_admin');
select is(pg_temp.code(c.sql), 'UNAUTHENTICATED', c.fn || ': a deactivated Admin gets UNAUTHENTICATED') from calls c order by c.fn;

select * from finish();
rollback;
