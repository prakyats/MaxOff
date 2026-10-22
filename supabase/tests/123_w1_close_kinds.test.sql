-- v1.9 W1-db (ROADMAP 6b.4 (3), (4); OPEN 4 and the owner's answers of 2026-10-22; migration w1_close_kinds;
-- DATA-MODEL §5b "Close kinds and Also add"): the close kind taken by item_cancel and by cycle_carry_decide's
-- close, item_set_close_kind (the Owner only: set, change and clear, on any closed deliverable, a completed
-- or cancelled project's included) and project_blueprint_add_to_cycle (the line and the deliverable in one
-- transaction), for the Owner, the client's Admin, another Admin (NOT_FOUND), Crew (FORBIDDEN) and anon (no
-- privilege), and every path. Old callers without the new argument keep working. Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(105);

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
  ('owner',    '00000000-0000-4000-8000-000000123901'),
  ('admin',    '00000000-0000-4000-8000-000000123902'),
  ('admin2',   '00000000-0000-4000-8000-000000123903'),
  ('staff',    '00000000-0000-4000-8000-000000123904'),
  ('client_a', '00000000-0000-4000-8000-0000001239a1'),
  ('client_b', '00000000-0000-4000-8000-0000001239b1');
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
create function pg_temp.row(p uuid) returns public.project_items language sql stable security definer as $$
  select i from public.project_items i where i.id = p;
$$;
-- The deliverable of a cycle with a title.
create function pg_temp.citem(c uuid, t text) returns uuid language sql stable security definer as $$
  select i.id from public.project_items i where i.cycle_id = c and i.title = t order by i.position collate "C" limit 1;
$$;
-- A deliverable's active stages in order: "Group·Name" (no group: "Name").
create function pg_temp.gstages(p_item uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(coalesce(s.group_label || '·', '') || s.name, ','
    order by s.group_position collate "C" nulls first, s.position collate "C"), '')
  from public.project_item_stage_list s where s.item_id = p_item and s.archived_at is null;
$$;
create function pg_temp.lines(p uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(b.title, ',' order by b.position collate "C"), '')
  from public.project_item_blueprints b where b.project_id = p and b.archived_at is null;
$$;
create function pg_temp.items_in(c uuid) returns integer language sql stable security definer as $$
  select count(*)::integer from public.project_items i where i.cycle_id = c;
$$;
create function pg_temp.current_cycle(p uuid) returns uuid language sql stable security definer as $$
  select c.id from public.project_cycles c
  where c.project_id = p and c.period_start = app.period_start('monthly', app.today_ist());
$$;
create function pg_temp.entries(p_entity text, p_action text, p_id uuid) returns integer language sql stable security definer as $$
  select count(*)::integer from public.activity_log a where a.entity = p_entity and a.action = p_action and a.entity_id = p_id;
$$;
create function pg_temp.notes(k text, p_kind text, p_like text) returns integer language sql stable security definer as $$
  select count(*)::integer from public.notifications n
  where n.recipient_id = pg_temp.fx(k) and n.kind = p_kind and n.body like p_like;
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
-- 0. Signatures, grants, the column
-- ===========================================================================================================
select has_column('public', 'project_items', 'close_kind', 'project_items.close_kind exists');
select col_is_null('public', 'project_items', 'close_kind', 'and is nullable (older closes stay null)');
select has_function('public', 'item_cancel', array['uuid', 'text', 'text'], 'item_cancel takes the kind');
select hasnt_function('public', 'item_cancel', array['uuid', 'text'], 'the old two-argument item_cancel is gone');
select has_function('public', 'cycle_carry_decide', array['uuid[]', 'carry_decision', 'text', 'text'],
  'cycle_carry_decide takes the kind');
select hasnt_function('public', 'cycle_carry_decide', array['uuid[]', 'carry_decision', 'text'],
  'the old three-argument cycle_carry_decide is gone');
select has_function('public', 'item_set_close_kind', array['uuid', 'text'], 'item_set_close_kind exists');
select has_function('public', 'project_blueprint_add_to_cycle', array['uuid', 'text', 'uuid'],
  'project_blueprint_add_to_cycle exists');
select ok((select bool_and(has_function_privilege('authenticated', p.oid, 'execute')
                           and not has_function_privilege('anon', p.oid, 'execute')
                           and p.prosecdef and p.proconfig @> array['search_path=""'])
           from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('item_cancel', 'cycle_carry_decide', 'item_set_close_kind', 'project_blueprint_add_to_cycle')),
  'the four: authenticated, never anon; SECURITY DEFINER with an empty search_path');
select ok(not has_table_privilege('authenticated', 'public.project_items', 'update'),
  'the API role still has no UPDATE on project_items');

-- ===========================================================================================================
-- 1. Data made the old way: a monthly project with an item list, its current cycle and last month's
-- ===========================================================================================================
select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client_a'), 'Work', 'monthly', null, null,
  array['Stage 1', 'Stage 2'], array['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5']));
select pg_temp.as_system();
insert into fx values ('cur', pg_temp.current_cycle(pg_temp.fx('p')));
insert into fx select 'past', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  app.period_start('monthly', app.period_start('monthly', app.today_ist()) - 1), 'schedule', pg_temp.fx('owner'), true)).id;
insert into fx values ('i1', pg_temp.citem(pg_temp.fx('cur'), 'Item 1'));
insert into fx values ('i2', pg_temp.citem(pg_temp.fx('cur'), 'Item 2'));
insert into fx values ('i3', pg_temp.citem(pg_temp.fx('cur'), 'Item 3'));
insert into fx values ('i4', pg_temp.citem(pg_temp.fx('cur'), 'Item 4'));
insert into fx values ('q1', pg_temp.citem(pg_temp.fx('past'), 'Item 1'));
insert into fx values ('q2', pg_temp.citem(pg_temp.fx('past'), 'Item 2'));
insert into fx values ('q3', pg_temp.citem(pg_temp.fx('past'), 'Item 3'));
insert into fx values ('q4', pg_temp.citem(pg_temp.fx('past'), 'Item 4'));
delete from public.notifications;

-- ===========================================================================================================
-- 2. item_cancel: the deliverable sheet's Close
-- ===========================================================================================================
select pg_temp.as_member('admin');
select is(public.item_cancel(pg_temp.fx('i1'), 'Client dropped it', 'not_needed'), 'cancelled'::public.item_state,
  'the client''s Admin closes with "Not needed this month"');
select is((pg_temp.row(pg_temp.fx('i1'))).close_kind, 'not_needed', 'the kind is stored on the deliverable');
select is((select a.meta ->> 'close_kind' from public.activity_log a
           where a.entity = 'project_items' and a.action = 'cancelled' and a.entity_id = pg_temp.fx('i1')),
  'not_needed', 'audited ''cancelled'' with the kind in meta');
select is(pg_temp.notes('owner', 'item_cancelled', '%Not needed this month. Reason: Client dropped it'), 1,
  'the Owner''s notice names the kind');
select is(public.item_cancel(pg_temp.fx('i2'), 'Missed the date'), 'cancelled'::public.item_state,
  'an old call without the kind still works');
select is((pg_temp.row(pg_temp.fx('i2'))).close_kind, null, 'and leaves the kind null');
select is(pg_temp.notes('owner', 'item_cancelled', 'Work · Client A. Reason: Missed the date'), 1,
  'its notice reads as before');
select is(pg_temp.code($$ select public.item_cancel(pg_temp.fx('i3'), 'x', 'lost') $$), 'VALIDATION',
  'an unknown kind: VALIDATION');
select is((pg_temp.row(pg_temp.fx('i3'))).state, 'open'::public.item_state, 'and nothing closed');
select is(pg_temp.code($$ select public.item_cancel(pg_temp.fx('i3'), '  ', 'not_delivered') $$), 'REASON_REQUIRED',
  'a kind still needs a reason');
select pg_temp.as_member('owner');
select is(public.item_cancel(pg_temp.fx('i3'), 'We missed it', 'not_delivered'), 'cancelled'::public.item_state,
  'the Owner closes with "Not delivered"');
select is((pg_temp.row(pg_temp.fx('i3'))).close_kind, 'not_delivered', 'stored');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_cancel(pg_temp.fx('i4'), 'x', 'not_needed') $$), 'NOT_FOUND',
  'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_cancel(pg_temp.fx('i4'), 'x', 'not_needed') $$), 'FORBIDDEN',
  'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.item_cancel(pg_temp.fx('i4'), 'x', 'not_needed') $$, '42501', null, 'anon: no privilege');
select pg_temp.as_system();
select is((pg_temp.row(pg_temp.fx('i4'))).state, 'open'::public.item_state, 'the refused calls closed nothing');
select throws_ok($$ update public.project_items set close_kind = 'not_needed' where id = pg_temp.fx('i4') $$,
  '23514', null, 'the check: a kind only on a closed deliverable');
select throws_ok($$ update public.project_items set close_kind = 'maybe' where id = pg_temp.fx('i1') $$,
  '23514', null, 'the check: only the two kinds');

-- ===========================================================================================================
-- 3. cycle_carry_decide: the carry screen's Close
-- ===========================================================================================================
select pg_temp.as_member('owner');
select is(public.cycle_carry_decide(array[pg_temp.fx('q1')], 'close', 'Not delivered on time', 'not_delivered') -> 0 ->> 'state',
  'cancelled', 'the Owner closes an ended cycle''s deliverable with "Not delivered"');
select is((pg_temp.row(pg_temp.fx('q1'))).close_kind, 'not_delivered', 'stored');
select is((pg_temp.row(pg_temp.fx('q1'))).carry_decision, 'close'::public.carry_decision, 'as a carry decision');
select is((select a.meta ->> 'close_kind' from public.activity_log a
           where a.entity = 'project_items' and a.action = 'closed' and a.entity_id = pg_temp.fx('q1')),
  'not_delivered', 'audited ''closed'' with the kind in meta');
select is(pg_temp.notes('admin', 'carry_decided', '%Not delivered. Reason: Not delivered on time'), 1,
  'the client''s Admin is told, the kind named');
select pg_temp.as_member('admin');
select is(public.cycle_carry_decide(array[pg_temp.fx('q2')], 'close', 'Scope changed', 'not_needed') -> 0 ->> 'state',
  'cancelled', 'the client''s Admin closes with "Not needed"');
select is((pg_temp.row(pg_temp.fx('q2'))).close_kind, 'not_needed', 'stored');
select is(public.cycle_carry_decide(array[pg_temp.fx('q3')], 'close', 'Old way') -> 0 ->> 'state',
  'cancelled', 'an old call without the kind still closes');
select is((pg_temp.row(pg_temp.fx('q3'))).close_kind, null, 'with no kind');
select is(pg_temp.code($$ select public.cycle_carry_decide(array[pg_temp.fx('q4')], 'leave_pending', null, 'not_needed') $$),
  'VALIDATION', 'a kind with leave pending: VALIDATION');
select is(pg_temp.code($$ select public.cycle_carry_decide(array[pg_temp.fx('q4')], 'carry_forward', null, 'not_delivered') $$),
  'VALIDATION', 'a kind with carry forward: VALIDATION');
select is(pg_temp.code($$ select public.cycle_carry_decide(array[pg_temp.fx('q4')], 'close', 'x', 'lost') $$),
  'VALIDATION', 'an unknown kind: VALIDATION');
select is(public.cycle_carry_decide(array[pg_temp.fx('q4')], 'leave_pending') -> 0 ->> 'state', 'open',
  'leave pending without a kind works as before');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.cycle_carry_decide(array[pg_temp.fx('q4')], 'close', 'x', 'not_needed') $$),
  'NOT_FOUND', 'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.cycle_carry_decide(array[pg_temp.fx('q4')], 'close', 'x', 'not_needed') $$),
  'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.cycle_carry_decide(array[pg_temp.fx('q4')], 'close', 'x', 'not_needed') $$,
  '42501', null, 'anon: no privilege');
select pg_temp.as_system();
select is((pg_temp.row(pg_temp.fx('q4'))).state, 'open'::public.item_state, 'the refused calls closed nothing');

-- ===========================================================================================================
-- 4. item_set_close_kind: the Owner only; set, change, clear; any project state
-- ===========================================================================================================
select pg_temp.as_member('owner');
select is(public.item_set_close_kind(pg_temp.fx('i2'), 'not_delivered'), true,
  'the Owner sets the kind on an older close (no kind)');
select is((pg_temp.row(pg_temp.fx('i2'))).close_kind, 'not_delivered', 'stored');
select is(pg_temp.entries('project_items', 'close_kind_set', pg_temp.fx('i2')), 1, 'audited ''close_kind_set''');
select is(public.item_set_close_kind(pg_temp.fx('i2'), 'not_delivered'), false, 'the same kind again: nothing');
select is(pg_temp.entries('project_items', 'close_kind_set', pg_temp.fx('i2')), 1, 'and no second history row');
select is(public.item_set_close_kind(pg_temp.fx('i2'), 'not_needed'), true, 'the Owner changes it');
select is((select a.meta ->> 'from' from public.activity_log a where a.entity = 'project_items'
           and a.action = 'close_kind_set' and a.entity_id = pg_temp.fx('i2') order by a.id desc limit 1),
  'not_delivered', 'the history keeps the earlier kind');
select is(public.item_set_close_kind(pg_temp.fx('i2'), null), true, 'the Owner clears it');
select is((pg_temp.row(pg_temp.fx('i2'))).close_kind, null, 'cleared');
select is(pg_temp.entries('project_items', 'close_kind_cleared', pg_temp.fx('i2')), 1, 'audited ''close_kind_cleared''');
select is(public.item_set_close_kind(pg_temp.fx('i2'), null), false, 'clearing what is clear: nothing');
select is((pg_temp.row(pg_temp.fx('i2'))).cancelled_reason, 'Missed the date', 'the close itself is untouched');
select is(public.item_set_close_kind(pg_temp.fx('q3'), 'not_needed'), true, 'a carry-screen close too');
select is(pg_temp.code($$ select public.item_set_close_kind(pg_temp.fx('i4'), 'not_needed') $$), 'INVALID_STATE',
  'an open deliverable: INVALID_STATE');
select is(pg_temp.code($$ select public.item_set_close_kind(pg_temp.fx('i2'), 'lost') $$), 'VALIDATION',
  'an unknown kind: VALIDATION');
select is(pg_temp.code($$ select public.item_set_close_kind('00000000-0000-4000-8000-0000001239ff', 'not_needed') $$),
  'NOT_FOUND', 'an unknown deliverable: NOT_FOUND');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.item_set_close_kind(pg_temp.fx('i1'), 'not_delivered') $$), 'FORBIDDEN',
  'the client''s Admin, on their own client: FORBIDDEN');
select is(pg_temp.code($$ select public.item_set_close_kind(pg_temp.fx('i1'), null) $$), 'FORBIDDEN',
  'and cannot clear it either');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_set_close_kind(pg_temp.fx('i1'), 'not_delivered') $$), 'FORBIDDEN',
  'another Admin: FORBIDDEN');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_set_close_kind(pg_temp.fx('i1'), 'not_delivered') $$), 'FORBIDDEN',
  'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.item_set_close_kind(pg_temp.fx('i1'), 'not_delivered') $$, '42501', null,
  'anon: no privilege');
select pg_temp.as_system();
select is((pg_temp.row(pg_temp.fx('i1'))).close_kind, 'not_needed', 'the refused calls changed nothing');
select is((select count(*)::integer from public.notifications where kind not in ('item_cancelled', 'carry_decided')), 0,
  'setting or clearing a kind tells nobody');

-- A cancelled project (its open deliverables closed by project_cancel, no kind) and a completed one.
select pg_temp.as_member('admin');
insert into fx values ('pc', public.project_create(pg_temp.fx('client_a'), 'Stopped', 'monthly', null, null,
  array['Stage 1'], array['Line A']));
select pg_temp.as_system();
insert into fx values ('pc_i', pg_temp.citem(pg_temp.current_cycle(pg_temp.fx('pc')), 'Line A'));
select pg_temp.as_member('owner');
select public.project_cancel(pg_temp.fx('pc'), 'Client stopped');
select is((pg_temp.row(pg_temp.fx('pc_i'))).close_kind, null, 'project_cancel leaves the kind null');
select is(public.item_set_close_kind(pg_temp.fx('pc_i'), 'not_needed'), true,
  'the Owner sets the kind in a cancelled project');
select is(public.item_set_close_kind(pg_temp.fx('pc_i'), null), true, 'and clears it there');
select is((select state::text from public.projects where id = pg_temp.fx('pc')), 'cancelled', 'the project stays cancelled');

select pg_temp.as_member('admin');
insert into fx values ('po', public.project_create(pg_temp.fx('client_a'), 'Done once', 'one_time', null,
  app.today_ist() + 7, array['Stage 1'], array['Thing']));
select pg_temp.as_system();
insert into fx values ('po_c', (select c.id from public.project_cycles c where c.project_id = pg_temp.fx('po')));
insert into fx values ('po_i', pg_temp.citem(pg_temp.fx('po_c'), 'Thing'));
select pg_temp.as_member('admin');
select is(public.item_cancel(pg_temp.fx('po_i'), 'Not wanted', 'not_needed'), 'cancelled'::public.item_state,
  'a one-time project''s deliverable closed with a kind');
select is(pg_temp.notes('owner', 'item_cancelled', '%. Not needed. Reason: Not wanted'), 1,
  'a one-time project''s notice says "Not needed" (no period)');
select public.project_complete(pg_temp.fx('po'));
select pg_temp.as_member('owner');
select is(public.item_set_close_kind(pg_temp.fx('po_i'), 'not_delivered'), true,
  'the Owner changes the kind in a completed project');
select is((pg_temp.row(pg_temp.fx('po_i'))).close_kind, 'not_delivered', 'stored');
select is(public.item_set_close_kind(pg_temp.fx('po_i'), null), true, 'and clears it there');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.item_set_close_kind(pg_temp.fx('po_i'), 'not_needed') $$), 'FORBIDDEN',
  'the Admin cannot, in a completed project either');
select pg_temp.as_system();
select is((select state::text from public.projects where id = pg_temp.fx('po')), 'completed', 'the project stays completed');

-- ===========================================================================================================
-- 5. project_blueprint_add_to_cycle: "Also add ‹title› to ‹period›?"
-- ===========================================================================================================
select pg_temp.as_member('admin');
insert into fx select 'add', (public.project_blueprint_add_to_cycle(pg_temp.fx('p'), ' Extra reel ', pg_temp.fx('cur'))
  ->> 'item_id')::uuid;
select is(pg_temp.lines(pg_temp.fx('p')), 'Item 1,Item 2,Item 3,Item 4,Item 5,Extra reel',
  'the client''s Admin: the line joins the deliverables list');
select is((pg_temp.row(pg_temp.fx('add'))).cycle_id, pg_temp.fx('cur'), 'and the deliverable joins the running cycle');
select is((pg_temp.row(pg_temp.fx('add'))).title, 'Extra reel', 'with the line''s title');
select is((pg_temp.row(pg_temp.fx('add'))).state, 'open'::public.item_state, 'open');
select is(pg_temp.gstages(pg_temp.fx('add')), 'Stage 1,Stage 2', 'with the line''s stages');
select is((select max(i.position collate "C") from public.project_items i where i.cycle_id = pg_temp.fx('cur')),
  (pg_temp.row(pg_temp.fx('add'))).position, 'at the end of the cycle');
select is(pg_temp.entries('project_items', 'insert', pg_temp.fx('add')), 1, 'the deliverable audited ''insert''');
select is((select count(*)::integer from public.activity_log a where a.entity = 'project_item_blueprints'
           and a.action = 'insert' and a.diff -> 'new' ->> 'title' = 'Extra reel'), 1, 'the line audited ''insert''');
select pg_temp.as_member('owner');
select is(jsonb_typeof(public.project_blueprint_add_to_cycle(pg_temp.fx('p'), 'Owner line', pg_temp.fx('cur')) -> 'blueprint_id'),
  'string', 'the Owner too: it returns the line''s id');
select pg_temp.as_system();
select is(pg_temp.items_in(pg_temp.fx('cur')), 7, 'the running cycle holds both new deliverables');

-- Refusals leave neither row.
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.project_blueprint_add_to_cycle(pg_temp.fx('p'), 'Late', pg_temp.fx('past')) $$),
  'INVALID_STATE', 'an ended cycle: INVALID_STATE');
select pg_temp.as_system();
insert into fx select 'next', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  app.period_next('monthly', app.period_start('monthly', app.today_ist())), 'manual', pg_temp.fx('owner'), true)).id;
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.project_blueprint_add_to_cycle(pg_temp.fx('p'), 'Early', pg_temp.fx('next')) $$),
  'INVALID_STATE', 'a future cycle: INVALID_STATE');
select is(pg_temp.code($$ select public.project_blueprint_add_to_cycle(pg_temp.fx('p'), 'Other', pg_temp.fx('po_c')) $$),
  'NOT_FOUND', 'another project''s cycle: NOT_FOUND');
select is(pg_temp.code($$ select public.project_blueprint_add_to_cycle(pg_temp.fx('p'), '   ', pg_temp.fx('cur')) $$),
  'VALIDATION', 'an empty title: VALIDATION');
select is(pg_temp.code($$ select public.project_blueprint_add_to_cycle(pg_temp.fx('po'), 'One', pg_temp.fx('po_c')) $$),
  'INVALID_STATE', 'a completed project: INVALID_STATE (read-only)');
select pg_temp.as_system();
update public.project_cycles set item_list_copied = false where id = pg_temp.fx('cur');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.project_blueprint_add_to_cycle(pg_temp.fx('p'), 'Waiting', pg_temp.fx('cur')) $$),
  'INVALID_STATE', 'a cycle still waiting for its list: INVALID_STATE');
select pg_temp.as_system();
update public.project_cycles set item_list_copied = true where id = pg_temp.fx('cur');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.project_blueprint_add_to_cycle(pg_temp.fx('p'), 'Theirs', pg_temp.fx('cur')) $$),
  'NOT_FOUND', 'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.project_blueprint_add_to_cycle(pg_temp.fx('p'), 'Crew', pg_temp.fx('cur')) $$),
  'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.project_blueprint_add_to_cycle(pg_temp.fx('p'), 'Anon', pg_temp.fx('cur')) $$,
  '42501', null, 'anon: no privilege');
select pg_temp.as_system();
select is(pg_temp.lines(pg_temp.fx('p')), 'Item 1,Item 2,Item 3,Item 4,Item 5,Extra reel,Owner line',
  'no refused call left a line');
select is(pg_temp.items_in(pg_temp.fx('cur')), 7, 'nor a deliverable in the running cycle');

-- The full cycle (100 live): the line is not added either.
insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
select pg_temp.fx('org'), pg_temp.fx('p'), pg_temp.fx('cur'), 'Filler ' || g, 'z' || lpad(g::text, 3, '0'),
       pg_temp.fx('cur'), pg_temp.fx('owner')
from generate_series(1, 100 - app.cycle_live_items(pg_temp.fx('cur'))) g;
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.project_blueprint_add_to_cycle(pg_temp.fx('p'), 'Too many', pg_temp.fx('cur')) $$),
  'VALIDATION', 'a cycle with 100 live deliverables: VALIDATION');
select pg_temp.as_system();
select is(pg_temp.lines(pg_temp.fx('p')), 'Item 1,Item 2,Item 3,Item 4,Item 5,Extra reel,Owner line',
  'and the line was not added (one transaction)');

-- ===========================================================================================================
-- 6. The history describes the new actions
-- ===========================================================================================================
select ok(app.client_work_activity_shown('project_items', 'close_kind_set', '{}'), 'close_kind_set is described');
select ok(app.client_work_activity_shown('project_items', 'close_kind_cleared', '{}'), 'close_kind_cleared too');
select ok(app.client_work_activity_shown('project_items', 'cancelled', '{}')
          and app.client_work_activity_shown('project_items', 'closed', '{}'), 'the closes still are');

select * from finish();
rollback;
