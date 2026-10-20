-- B7 (UX review 2026-10-21, v1.8 unit V0; owner decision 2026-10-21, option (a); migration
-- b7_revision_round_position): "+ Another revision round" goes right after the deliverable's last
-- revision stage, or right after its "Edit" stage when there is none; never at the end after
-- "Posted". With neither, v1.7.1's place (after the last stage) is kept until the owner decides.
-- Every path: after Edit, after the last revision stage, groups respected (the anchor's group, a later
-- group untouched), "Edit" matched ignoring case, neither, ticks kept, one history row, keys with no
-- room between them; and the permissions unchanged per role (Owner, the client's Admin, another Admin
-- NOT_FOUND, Crew FORBIDDEN, anon no privilege). app.position_between. Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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

-- A project whose default stages are the review's: Shoot → Edit → Posted → Script.
select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client_a'), 'Work', 'monthly', null, null,
  array['Shoot', 'Edit', 'Posted', 'Script'], array['Item A', 'Item B', 'Item C', 'Item D']));
insert into fx values ('a', pg_temp.item(pg_temp.fx('p'), 'Item A'));
insert into fx values ('b', pg_temp.item(pg_temp.fx('p'), 'Item B'));
insert into fx values ('c', pg_temp.item(pg_temp.fx('p'), 'Item C'));
insert into fx values ('d', pg_temp.item(pg_temp.fx('p'), 'Item D'));
insert into fx values ('q', public.project_create(pg_temp.fx('client_a'), 'Other', 'monthly', null, null,
  array['Shoot', 'EDIT', 'Posted'], array['Item E']));
insert into fx values ('e', pg_temp.item(pg_temp.fx('q'), 'Item E'));
insert into fx values ('r', public.project_create(pg_temp.fx('client_a'), 'Plain', 'monthly', null, null,
  array['Shoot', 'Posted'], array['Item F']));
insert into fx values ('f', pg_temp.item(pg_temp.fx('r'), 'Item F'));

-- 1. No revision stage: right after Edit; then right after the last revision stage ---------------------
select public.item_stage_tick(pg_temp.istage(pg_temp.fx('a'), 'Edit'));
select is(public.item_add_revision_round(pg_temp.fx('a')), 'Revision round 1', 'the first round''s name');
select is(pg_temp.gstages(pg_temp.fx('a')), 'Shoot,Edit✓,Revision round 1,Posted,Script',
  'no revision stage: right after "Edit", never after "Posted"; the tick kept');
select is(public.item_add_revision_round(pg_temp.fx('a')), 'Revision round 2', 'the next one numbers on');
select is(pg_temp.gstages(pg_temp.fx('a')), 'Shoot,Edit✓,Revision round 1,Revision round 2,Posted,Script',
  'right after the last revision stage');
select is((select count(*)::integer from public.activity_log l
           where l.entity = 'project_item_stage_list' and l.action = 'insert' and l.entity_id = pg_temp.fx('a')
             and (l.meta ->> 'revision_round')::boolean), 2,
  'each round is one history row, marked as a revision round');

-- 2. Groups: the anchor's group, a later group untouched ---------------------------------------------
select public.item_stage_group_add(pg_temp.fx('b'), 'Post', array['Edit', 'Posted']);
select is(public.item_add_revision_round(pg_temp.fx('b')), 'Revision round 1', 'a grouped deliverable');
select is(pg_temp.gstages(pg_temp.fx('b')), 'Shoot,Edit,Posted,Script,Post·Edit,Post·Revision round 1,Post·Posted',
  'after the last "Edit" as the list shows it, inside its group');
select public.item_stage_group_add(pg_temp.fx('c'), 'Review', array['Revision 1']);
select public.item_stage_group_add(pg_temp.fx('c'), 'Delivery', array['Deliver']);
select is(public.item_add_revision_round(pg_temp.fx('c')), 'Revision 2', 'its own naming: "Revision 1" -> "Revision 2"');
select is(pg_temp.gstages(pg_temp.fx('c')), 'Shoot,Edit,Posted,Script,Review·Revision 1,Review·Revision 2,Delivery·Deliver',
  'after the last revision stage, in its group, before a later group');

-- 3. "Edit" ignoring case; neither: v1.7.1's place, until the owner decides --------------------------
select is(public.item_add_revision_round(pg_temp.fx('e')), 'Revision round 1', '"EDIT" counts as Edit');
select is(pg_temp.gstages(pg_temp.fx('e')), 'Shoot,EDIT,Revision round 1,Posted', 'right after it');
select is(public.item_add_revision_round(pg_temp.fx('f')), 'Revision round 1', 'neither: still added');
select is(pg_temp.gstages(pg_temp.fx('f')), 'Shoot,Posted,Revision round 1',
  'neither a revision nor an Edit stage: after the last stage, as in v1.7.1 (owner question open)');

-- 4. Keys with no room between them: the group's positions renumbered, nothing else changed -----------
select pg_temp.as_system();
update public.project_item_stage_list set position = 'a1' where id = pg_temp.istage(pg_temp.fx('d'), 'Edit');
update public.project_item_stage_list set position = 'a10' where id = pg_temp.istage(pg_temp.fx('d'), 'Posted');
select is(app.position_between('a1', 'a10'), null, 'position_between: no key between a1 and a10');
select pg_temp.as_member('admin');
select is(public.item_add_revision_round(pg_temp.fx('d')), 'Revision round 1', 'added all the same');
select is(pg_temp.gstages(pg_temp.fx('d')), 'Shoot,Edit,Revision round 1,Posted,Script',
  'right after Edit once the group takes fresh keys');

-- 5. The helper ------------------------------------------------------------------------------------
select pg_temp.as_system();
select ok(app.position_between('a0', 'a1') collate "C" > 'a0' and app.position_between('a0', 'a1') collate "C" < 'a1',
  'position_between: strictly between two keys');
select ok(not has_function_privilege('authenticated', 'app.position_between(text, text)', 'execute'),
  'position_between is internal (authenticated cannot call it)');

-- 6. Permissions unchanged per role -----------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.item_add_revision_round(pg_temp.fx('e')), 'Revision round 2', 'the Owner adds one, after the last round');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_add_revision_round(pg_temp.fx('a')) $$), 'NOT_FOUND',
  'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_add_revision_round(pg_temp.fx('a')) $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.item_add_revision_round(pg_temp.fx('a')) $$, '42501', null, 'anon: no privilege');

select * from finish();
rollback;
