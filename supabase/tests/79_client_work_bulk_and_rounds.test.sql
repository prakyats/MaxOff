-- Phase 6b Release 2 (v1.7.1; ROADMAP 6b.16 (c)(d)(e); migration client_work_bulk_and_rounds; DATA-MODEL §5b
-- "Revision rounds, extras kept and bulk edits"): item_add_revision_round, cycle_keep_extras and the four bulk
-- edits (items_set_planned_date, items_shift_planned_dates, items_add_stage_groups, items_rename) for the
-- Owner, the client's Admin, another Admin (NOT_FOUND), Crew (FORBIDDEN) and anon (no privilege), and every
-- path: a done, closed or carried deliverable refused, an empty selection, a shift across months, the rename
-- preview against the apply, all or nothing, the answer asked once. Proved on TODAY-shape data: projects made
-- the old way (project_create with plain stages), ticks and history kept. Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(107);

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
delete from public.members;
delete from auth.identities;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000007901'),
  ('admin',    '00000000-0000-4000-8000-000000007902'),
  ('admin2',   '00000000-0000-4000-8000-000000007903'),
  ('staff',    '00000000-0000-4000-8000-000000007904'),
  ('client_a', '00000000-0000-4000-8000-0000000079a1'),
  ('client_b', '00000000-0000-4000-8000-0000000079b1');
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
create function pg_temp.code(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception when sqlstate 'P0001' then
  return sqlerrm;
end;
$$;
-- The item of a project with a title.
create function pg_temp.item(p uuid, t text) returns uuid language sql stable security definer as $$
  select i.id from public.project_items i where i.project_id = p and i.title = t order by i.created_at desc, i.id limit 1;
$$;
create function pg_temp.row(p uuid) returns public.project_items language sql stable security definer as $$
  select i from public.project_items i where i.id = p;
$$;
-- An item's active stages as the screens order them: "Group·Name" (no group: "Name"), "✓" when ticked.
create function pg_temp.gstages(p_item uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(
    coalesce(s.group_label || '·', '') || s.name || case when s.done_at is null then '' else '✓' end,
    ',' order by s.group_position collate "C" nulls first, s.position collate "C"), '')
  from public.project_item_stage_list s where s.item_id = p_item and s.archived_at is null;
$$;
create function pg_temp.istage(p_item uuid, n text) returns uuid language sql stable security definer as $$
  select s.id from public.project_item_stage_list s
  where s.item_id = p_item and s.name = n and s.archived_at is null limit 1;
$$;
create function pg_temp.lines(p uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(b.title, ',' order by b.position collate "C"), '')
  from public.project_item_blueprints b where b.project_id = p and b.archived_at is null;
$$;
create function pg_temp.cycle(p uuid) returns public.project_cycles language sql stable security definer as $$
  select c from public.project_cycles c where c.project_id = p order by c.period_start nulls first limit 1;
$$;
create function pg_temp.entries(p_entity text, p_action text, p_id uuid) returns integer language sql stable security definer as $$
  select count(*)::integer from public.activity_log a where a.entity = p_entity and a.action = p_action and a.entity_id = p_id;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org') and key not like 'client_%';
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'),  pg_temp.fx('org'), 'Test Owner',  'owner@example.com',  'owner', 'active', now()),
  (pg_temp.fx('admin'),  pg_temp.fx('org'), 'Test Admin',  'admin@example.com',  'admin', 'active', now()),
  (pg_temp.fx('admin2'), pg_temp.fx('org'), 'Other Admin', 'admin2@example.com', 'admin', 'active', now()),
  (pg_temp.fx('staff'),  pg_temp.fx('org'), 'Test Crew',   'staff@example.com',  'staff', 'active', now());
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A', 'active', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Client B', 'active', pg_temp.fx('admin2'), now());

-- ===========================================================================================================
-- 0. TODAY-shape data, made the old way: a monthly project with plain stages and an item list.
-- ===========================================================================================================
select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client_a'), 'Work', 'monthly', null, null,
  array['Stage 1', 'Stage 2'], array['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5']));
insert into fx values ('i1', pg_temp.item(pg_temp.fx('p'), 'Item 1'));
insert into fx values ('i2', pg_temp.item(pg_temp.fx('p'), 'Item 2'));
insert into fx values ('i3', pg_temp.item(pg_temp.fx('p'), 'Item 3'));
insert into fx values ('i4', pg_temp.item(pg_temp.fx('p'), 'Item 4'));
insert into fx values ('i5', pg_temp.item(pg_temp.fx('p'), 'Item 5'));
select public.item_stage_tick(pg_temp.istage(pg_temp.fx('i1'), 'Stage 1'));
select public.item_mark_done(pg_temp.fx('i4'));
select public.item_cancel(pg_temp.fx('i5'), 'Not needed');

-- ===========================================================================================================
-- 1. item_add_revision_round
-- ===========================================================================================================
select has_function('public', 'item_add_revision_round', array['uuid'], 'item_add_revision_round exists');
select is(public.item_add_revision_round(pg_temp.fx('i1')), 'Revision round 1',
  'no revision stage yet: "Revision round 1"');
select is(pg_temp.gstages(pg_temp.fx('i1')), 'Stage 1✓,Stage 2,Revision round 1',
  'appended after the last stage, in its group; the tick kept');
select is(public.item_add_revision_round(pg_temp.fx('i1')), 'Revision round 2', 'the next one numbers on');
select is((select (a.meta ->> 'revision_round')::boolean from public.activity_log a
           where a.entity = 'project_item_stage_list' and a.action = 'insert' and a.diff -> 'new' ->> 'name' = 'Revision round 2'),
  true, 'each round is one history row, marked as a revision round');

select public.item_stage_group_add(pg_temp.fx('i2'), 'Review', array['Draft', 'Revision 1', 'Revision 2']);
select public.item_stage_tick(pg_temp.istage(pg_temp.fx('i2'), 'Revision 1'));
select is(public.item_add_revision_round(pg_temp.fx('i2')), 'Revision 3',
  'the deliverable''s own naming: "Revision 2" -> "Revision 3"');
select is(pg_temp.gstages(pg_temp.fx('i2')), 'Stage 1,Stage 2,Review·Draft,Review·Revision 1✓,Review·Revision 2,Review·Revision 3',
  'in the group of its latest revision stage; ticks kept');

select public.item_stage_add(pg_temp.fx('i3'), 'Client revision', null);
select is(public.item_add_revision_round(pg_temp.fx('i3')), 'Client revision 2', 'an unnumbered one: its second round');

select is(pg_temp.code($$ select public.item_add_revision_round(pg_temp.fx('i4')) $$), 'INVALID_STATE',
  'a done deliverable: refused (reopen it first)');
select is(pg_temp.code($$ select public.item_add_revision_round(pg_temp.fx('i5')) $$), 'INVALID_STATE',
  'a closed deliverable: refused');

select pg_temp.as_member('owner');
select is(public.item_add_revision_round(pg_temp.fx('i3')), 'Client revision 3', 'the Owner adds one too');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_add_revision_round(pg_temp.fx('i1')) $$), 'NOT_FOUND',
  'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_add_revision_round(pg_temp.fx('i1')) $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.item_add_revision_round(pg_temp.fx('i1')) $$, '42501', null, 'anon: no privilege');
select pg_temp.as_system();
select is(pg_temp.gstages(pg_temp.fx('i1')), 'Stage 1✓,Stage 2,Revision round 1,Revision round 2',
  'the refused calls changed nothing');

-- ===========================================================================================================
-- 2. items_set_planned_date
-- ===========================================================================================================
select pg_temp.as_member('admin');
select has_function('public', 'items_set_planned_date', array['uuid[]', 'date'], 'items_set_planned_date exists');
select is(public.items_set_planned_date(array[pg_temp.fx('i1'), pg_temp.fx('i2')], '2026-10-25'), 2,
  'the client''s Admin plans two at once');
select is(array[(pg_temp.row(pg_temp.fx('i1'))).planned_date, (pg_temp.row(pg_temp.fx('i2'))).planned_date],
  array['2026-10-25'::date, '2026-10-25'::date], 'both planned for the date');
select is(public.items_set_planned_date(array[pg_temp.fx('i1'), pg_temp.fx('i2'), pg_temp.fx('i1')], '2026-10-25'), 0,
  'the same date again changes nothing (a duplicate id counts once)');
select is(pg_temp.entries('project_items', 'update', pg_temp.fx('i1')), 1, 'one history row per deliverable that changed');
select is((select (a.meta ->> 'bulk')::integer from public.activity_log a
           where a.entity = 'project_items' and a.action = 'update' and a.entity_id = pg_temp.fx('i2')),
  2, 'its meta says it was one of a bulk change of 2');
select is(pg_temp.code($$ select public.items_set_planned_date('{}'::uuid[], '2026-10-01') $$), 'VALIDATION',
  'an empty selection: VALIDATION');
select is(pg_temp.code($$ select public.items_set_planned_date(null, '2026-10-01') $$), 'VALIDATION',
  'no selection: VALIDATION');
select is(pg_temp.code($$ select public.items_set_planned_date(array[pg_temp.fx('i1'), pg_temp.fx('i4')], '2026-10-01') $$),
  'INVALID_STATE', 'a done deliverable in the selection: refused');
select is(pg_temp.code($$ select public.items_set_planned_date(array[pg_temp.fx('i1'), pg_temp.fx('i5')], '2026-10-01') $$),
  'INVALID_STATE', 'a closed one: refused');
select is((pg_temp.row(pg_temp.fx('i1'))).planned_date, '2026-10-25'::date, 'all or nothing: the open one is unchanged');
select is(public.items_set_planned_date(array[pg_temp.fx('i3')], null), 0, 'clearing a date that is not set: nothing');
select pg_temp.as_member('owner');
select is(public.items_set_planned_date(array[pg_temp.fx('i3')], '2026-10-30'), 1, 'the Owner plans one');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.items_set_planned_date(array[pg_temp.fx('i1')], '2026-10-01') $$), 'NOT_FOUND',
  'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.items_set_planned_date(array[pg_temp.fx('i1')], '2026-10-01') $$), 'FORBIDDEN',
  'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.items_set_planned_date(array[pg_temp.fx('i1')], '2026-10-01') $$, '42501', null,
  'anon: no privilege');

-- ===========================================================================================================
-- 3. items_shift_planned_dates
-- ===========================================================================================================
select pg_temp.as_member('admin');
select public.item_update(pg_temp.fx('i3'), '{"planned_date": ""}');
select has_function('public', 'items_shift_planned_dates', array['uuid[]', 'integer'], 'items_shift_planned_dates exists');
select is(public.items_shift_planned_dates(array[pg_temp.fx('i1'), pg_temp.fx('i2'), pg_temp.fx('i3')], 10), 2,
  'two moved; the one without a date is left as it is');
select is(array[(pg_temp.row(pg_temp.fx('i1'))).planned_date, (pg_temp.row(pg_temp.fx('i2'))).planned_date],
  array['2026-11-04'::date, '2026-11-04'::date], 'across the month''s end: 25 Oct + 10 = 4 Nov');
select is((pg_temp.row(pg_temp.fx('i3'))).planned_date, null::date, 'no date stays no date');
select is(public.items_shift_planned_dates(array[pg_temp.fx('i1')], -40), 1, 'earlier works too');
select is((pg_temp.row(pg_temp.fx('i1'))).planned_date, '2026-09-25'::date, 'back across the month: 4 Nov - 40 = 25 Sep');
select is((select (a.meta ->> 'shift_days')::integer from public.activity_log a
           where a.entity = 'project_items' and a.entity_id = pg_temp.fx('i1') order by a.id desc limit 1),
  -40, 'the history row carries the shift');
select is(pg_temp.code($$ select public.items_shift_planned_dates(array[pg_temp.fx('i1')], 0) $$), 'VALIDATION',
  'a shift of 0: VALIDATION');
select is(pg_temp.code($$ select public.items_shift_planned_dates(array[pg_temp.fx('i1')], 366) $$), 'VALIDATION',
  'more than a year: VALIDATION');
select is(pg_temp.code($$ select public.items_shift_planned_dates('{}'::uuid[], 1) $$), 'VALIDATION',
  'an empty selection: VALIDATION');
select is(pg_temp.code($$ select public.items_shift_planned_dates(array[pg_temp.fx('i2'), pg_temp.fx('i4')], 1) $$),
  'INVALID_STATE', 'a done one in the selection: refused');
select is((pg_temp.row(pg_temp.fx('i2'))).planned_date, '2026-11-04'::date, 'all or nothing');
select pg_temp.as_member('owner');
select is(public.items_shift_planned_dates(array[pg_temp.fx('i2')], 1), 1, 'the Owner moves one');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.items_shift_planned_dates(array[pg_temp.fx('i2')], 1) $$), 'NOT_FOUND',
  'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.items_shift_planned_dates(array[pg_temp.fx('i2')], 1) $$), 'FORBIDDEN',
  'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.items_shift_planned_dates(array[pg_temp.fx('i2')], 1) $$, '42501', null,
  'anon: no privilege');

-- ===========================================================================================================
-- 4. items_add_stage_groups
-- ===========================================================================================================
select pg_temp.as_member('admin');
select has_function('public', 'items_add_stage_groups', array['uuid[]', 'jsonb'], 'items_add_stage_groups exists');
select is(public.items_add_stage_groups(array[pg_temp.fx('i1'), pg_temp.fx('i3')],
  '[{"label": "Phase A", "stages": ["One", "Two"]}, {"label": "Phase B", "stages": ["Three"]}]'), 2,
  'two groups added to two deliverables in one call');
select is(pg_temp.gstages(pg_temp.fx('i1')),
  'Stage 1✓,Stage 2,Revision round 1,Revision round 2,Phase A·One,Phase A·Two,Phase B·Three',
  'after its last group, in order; the tick kept');
select is(pg_temp.gstages(pg_temp.fx('i3')),
  'Stage 1,Stage 2,Client revision,Client revision 2,Client revision 3,Phase A·One,Phase A·Two,Phase B·Three',
  'the same on the other');
select is((select count(*)::integer from public.activity_log a
           where a.entity = 'project_item_stage_list' and a.action = 'insert' and a.meta ->> 'group' = 'Phase A'), 4,
  'one history row per stage, each naming its group');
select is(pg_temp.code($$ select public.items_add_stage_groups(array[pg_temp.fx('i2'), pg_temp.fx('i1')],
  '[{"label": "phase a", "stages": ["X"]}]') $$), 'CONFLICT', 'a deliverable that has the group already: CONFLICT');
select is(pg_temp.gstages(pg_temp.fx('i2')), 'Stage 1,Stage 2,Review·Draft,Review·Revision 1✓,Review·Revision 2,Review·Revision 3',
  'all or nothing: the other one took nothing');
select is(pg_temp.code($$ select public.items_add_stage_groups(array[pg_temp.fx('i2')], '[{"label": null, "stages": ["X"]}]') $$),
  'VALIDATION', 'a group without a name: VALIDATION');
select is(pg_temp.code($$ select public.items_add_stage_groups(array[pg_temp.fx('i2')], '[]') $$), 'VALIDATION',
  'no group: VALIDATION');
select is(pg_temp.code($$ select public.items_add_stage_groups('{}'::uuid[], '[{"label": "G", "stages": ["X"]}]') $$),
  'VALIDATION', 'an empty selection: VALIDATION');
select is(pg_temp.code($$ select public.items_add_stage_groups(array[pg_temp.fx('i4')], '[{"label": "G", "stages": ["X"]}]') $$),
  'INVALID_STATE', 'a done deliverable: refused');
select pg_temp.as_member('owner');
select is(public.items_add_stage_groups(array[pg_temp.fx('i2')], '[{"label": "Phase C", "stages": ["Four"]}]'), 1,
  'the Owner adds one');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.items_add_stage_groups(array[pg_temp.fx('i2')], '[{"label": "G", "stages": ["X"]}]') $$),
  'NOT_FOUND', 'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.items_add_stage_groups(array[pg_temp.fx('i2')], '[{"label": "G", "stages": ["X"]}]') $$),
  'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.items_add_stage_groups(array[pg_temp.fx('i2')], '[{"label": "G", "stages": ["X"]}]') $$,
  '42501', null, 'anon: no privilege');

-- ===========================================================================================================
-- 5. items_rename: the preview, then the apply
-- ===========================================================================================================
select pg_temp.as_member('admin');
select has_function('public', 'items_rename', array['uuid[]', 'text', 'integer', 'boolean'], 'items_rename exists');
-- Release 2 review (2026-10-16): the helper locks in id order first, then answers in the order given,
-- both ways round (items_rename numbers them in that order).
select pg_temp.as_system();
select set_config('request.jwt.claim.sub', pg_temp.fx('admin')::text, true);
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx('admin'), 'role', 'authenticated')::text, true);
create temporary table sel_order as
  select array_agg(x.id order by x.id desc) as down, array_agg(x.id order by x.id) as up
  from (values (pg_temp.fx('i1')), (pg_temp.fx('i2')), (pg_temp.fx('i3'))) as x(id);
select is((select array_agg(u.id order by u.ordinality) from unnest(app.client_work_bulk_items((select down from sel_order))) with ordinality as u),
  (select down from sel_order), 'the selection comes back in the order given, against the id order');
select is((select array_agg(u.id order by u.ordinality) from unnest(app.client_work_bulk_items((select up from sel_order))) with ordinality as u),
  (select up from sel_order), 'and in the id order when given so');
select pg_temp.as_member('admin');
select is(public.items_rename(array[pg_temp.fx('i3'), pg_temp.fx('i1'), pg_temp.fx('i2')], ' Piece {n} ', 1, false),
  jsonb_build_array(
    jsonb_build_object('id', pg_temp.fx('i3'), 'from', 'Item 3', 'to', 'Piece 1'),
    jsonb_build_object('id', pg_temp.fx('i1'), 'from', 'Item 1', 'to', 'Piece 2'),
    jsonb_build_object('id', pg_temp.fx('i2'), 'from', 'Item 2', 'to', 'Piece 3')),
  'the preview numbers them in the order given');
select is(array[(pg_temp.row(pg_temp.fx('i1'))).title, (pg_temp.row(pg_temp.fx('i2'))).title, (pg_temp.row(pg_temp.fx('i3'))).title],
  array['Item 1', 'Item 2', 'Item 3'], 'the preview writes nothing');
select is(pg_temp.entries('project_items', 'update', pg_temp.fx('i3')) , 2, 'and adds no history');
select is(jsonb_array_length(public.items_rename(array[pg_temp.fx('i3'), pg_temp.fx('i1'), pg_temp.fx('i2')], 'Piece {n}', 5)), 3,
  'the apply renames them');
select is(array[(pg_temp.row(pg_temp.fx('i3'))).title, (pg_temp.row(pg_temp.fx('i1'))).title, (pg_temp.row(pg_temp.fx('i2'))).title],
  array['Piece 5', 'Piece 6', 'Piece 7'], 'from the start number, in the order given');
select is(pg_temp.entries('project_items', 'update', pg_temp.fx('i3')), 3, 'one history row each');
select is((public.items_rename(array[pg_temp.fx('i1')], '{title} final', 1, false) -> 0 ->> 'to'), 'Piece 6 final',
  '{title} is the current title');
select is(pg_temp.code($$ select public.items_rename(array[pg_temp.fx('i1'), pg_temp.fx('i2')], 'Same', 1, false) $$),
  'VALIDATION', 'two names alike (no {n}, no {title}): VALIDATION');
select is((public.items_rename(array[pg_temp.fx('i1')], 'Only', 1, false) -> 0 ->> 'to'), 'Only',
  'one deliverable may take a plain name');
select is(pg_temp.code($$ select public.items_rename(array[pg_temp.fx('i1')], '   ', 1, true) $$), 'VALIDATION',
  'no name: VALIDATION');
select is(pg_temp.code($$ select public.items_rename(array[pg_temp.fx('i1')], repeat('x', 201), 1, true) $$), 'VALIDATION',
  'over 200 characters: VALIDATION');
select is(pg_temp.code($$ select public.items_rename(array[pg_temp.fx('i1')], 'X {n}', -1, true) $$), 'VALIDATION',
  'a negative start: VALIDATION');
select is(pg_temp.code($$ select public.items_rename('{}'::uuid[], 'X {n}', 1, true) $$), 'VALIDATION',
  'an empty selection: VALIDATION');
select is(pg_temp.code($$ select public.items_rename(array[pg_temp.fx('i1'), pg_temp.fx('i5')], 'X {n}', 1, true) $$),
  'INVALID_STATE', 'a closed deliverable in the selection: refused');
select is((pg_temp.row(pg_temp.fx('i1'))).title, 'Piece 6', 'all or nothing');
select pg_temp.as_member('owner');
select is((public.items_rename(array[pg_temp.fx('i1')], 'Piece {n}', 1) -> 0 ->> 'to'), 'Piece 1', 'the Owner renames one');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.items_rename(array[pg_temp.fx('i1')], 'X {n}', 1, false) $$), 'NOT_FOUND',
  'another Admin: NOT_FOUND, even for a preview');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.items_rename(array[pg_temp.fx('i1')], 'X {n}', 1, false) $$), 'FORBIDDEN',
  'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.items_rename(array[pg_temp.fx('i1')], 'X {n}', 1, false) $$, '42501', null,
  'anon: no privilege');

-- ===========================================================================================================
-- 6. cycle_keep_extras
-- ===========================================================================================================
select pg_temp.as_member('admin');
insert into fx values ('q', public.project_create(pg_temp.fx('client_a'), 'Extras', 'monthly', null, null,
  array['Stage 1'], array['Line 1']));
insert into fx select 'qc', (pg_temp.cycle(pg_temp.fx('q'))).id;
insert into fx values ('x1', public.item_add(pg_temp.fx('qc'), 'Extra 1'));
select public.item_stage_group_add(pg_temp.fx('x1'), 'Phase A', array['One']);
select public.item_stage_tick(pg_temp.istage(pg_temp.fx('x1'), 'Stage 1'));
select public.item_add(pg_temp.fx('qc'), ' EXTRA 1 ');
select public.item_add(pg_temp.fx('qc'), 'Extra 2');
select public.item_add(pg_temp.fx('qc'), 'line 1');
select public.item_cancel(public.item_add(pg_temp.fx('qc'), 'Extra closed'), 'Not needed');
select pg_temp.as_system();
select is((select string_agg(e.title, ',') from app.cycle_extras(pg_temp.fx('qc')) e), 'Extra 1,Extra 2',
  'the extras: added in the cycle, not on the list (ignoring case), not closed, one per title');
create temporary table q_items as select jsonb_agg(to_jsonb(i) order by i.id) v from public.project_items i where i.project_id = pg_temp.fx('q');
create temporary table q_cycles_before as select count(*)::integer n from public.project_cycles c where c.project_id = pg_temp.fx('q');
grant select on q_items, q_cycles_before to authenticated;

select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.cycle_keep_extras(pg_temp.fx('qc'), true) $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.cycle_keep_extras(pg_temp.fx('qc'), true) $$), 'NOT_FOUND', 'another Admin: NOT_FOUND');
select pg_temp.as_anon();
select throws_ok($$ select public.cycle_keep_extras(pg_temp.fx('qc'), true) $$, '42501', null, 'anon: no privilege');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.cycle_keep_extras(pg_temp.fx('qc'), null) $$), 'VALIDATION', 'no answer: VALIDATION');
select has_function('public', 'cycle_keep_extras', array['uuid', 'boolean'], 'cycle_keep_extras exists');
select is(public.cycle_keep_extras(pg_temp.fx('qc'), true), 2, 'Yes: the client''s Admin keeps the two extras');
select is(pg_temp.lines(pg_temp.fx('q')), 'Line 1,Extra 1,Extra 2', 'they join the end of the deliverables list');
select is((select b.stage_groups from public.project_item_blueprints b where b.project_id = pg_temp.fx('q') and b.title = 'Extra 1'),
  '[{"label": null, "stages": ["Stage 1"]}, {"label": "Phase A", "stages": ["One"]}]'::jsonb,
  'each with its own stages in their groups (names only)');
select is((select b.stages from public.project_item_blueprints b where b.project_id = pg_temp.fx('q') and b.title = 'Extra 1'),
  array['Stage 1', 'One'], 'and the flattened copy');
select is((select jsonb_agg(to_jsonb(i) order by i.id) from public.project_items i where i.project_id = pg_temp.fx('q')),
  (select v from q_items), 'no deliverable changed (a tick included)');
select is((select count(*)::integer from public.project_cycles c where c.project_id = pg_temp.fx('q')), (select n from q_cycles_before),
  'no cycle made or changed but the answer');
select is(array[(pg_temp.cycle(pg_temp.fx('q'))).extras_kept::text, ((pg_temp.cycle(pg_temp.fx('q'))).extras_decided_by)::text],
  array['2', pg_temp.fx('admin')::text], 'the cycle records the answer and who gave it');
select is((select (a.meta ->> 'count')::integer from public.activity_log a
           where a.entity = 'project_cycles' and a.action = 'extras_kept' and a.entity_id = pg_temp.fx('q')), 2,
  'one history row on the project: extras_kept, with the count');
select is(app.client_work_activity_shown('project_cycles', 'extras_kept', '{}'), true, 'which the history describes');
select is((select count(*)::integer from public.activity_log a
           where a.entity = 'project_item_blueprints' and a.action = 'insert' and a.meta ? 'kept_from_item_id'), 2,
  'and one per line added');
select is(pg_temp.code($$ select public.cycle_keep_extras(pg_temp.fx('qc'), false) $$), 'INVALID_STATE',
  'asked once: a second answer is refused');

-- No: the Owner answers for another project; the list stays as it is.
insert into fx values ('r', public.project_create(pg_temp.fx('client_a'), 'Extras no', 'monthly', null, null,
  array['Stage 1'], array['Line 1']));
insert into fx select 'rc', (pg_temp.cycle(pg_temp.fx('r'))).id;
select public.item_add(pg_temp.fx('rc'), 'Extra 1');
select pg_temp.as_member('owner');
select is(public.cycle_keep_extras(pg_temp.fx('rc'), false), 0, 'No (the Owner): nothing added');
select is(pg_temp.lines(pg_temp.fx('r')), 'Line 1', 'the list is as it was');
select is((pg_temp.cycle(pg_temp.fx('r'))).extras_kept, 0, 'the answer is recorded');
select is(pg_temp.entries('project_cycles', 'extras_not_kept', pg_temp.fx('r')), 1, 'one history row: extras_not_kept');

select pg_temp.as_member('admin');
insert into fx values ('o', public.project_create(pg_temp.fx('client_a'), 'Once', 'one_time', null, app.today_ist() + 30,
  array['Stage 1'], array['Item']));
select is(pg_temp.code(format($$ select public.cycle_keep_extras(%L, true) $$, (pg_temp.cycle(pg_temp.fx('o'))).id)),
  'VALIDATION', 'a one-time project has no list: VALIDATION');
select is(pg_temp.code($$ select public.cycle_keep_extras('00000000-0000-4000-8000-0000000079ff', true) $$), 'NOT_FOUND',
  'an unknown cycle: NOT_FOUND');

select * from finish();
rollback;
