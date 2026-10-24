-- V5a (v1.8; owner decision 2026-10-21; migration v5_revision_round_before_posted): the B7 fallback.
-- A deliverable with neither a revision stage nor an "Edit" stage gets "+ Another revision round" just
-- before its "Posted", "Published" or "Delivered" stage (ignoring case; the first of those as the list
-- shows it), in that stage's group; with none of those, after the last stage. Every path: before
-- Posted, before Published, before Delivered, case, several go-out stages, inside a group, keys with no
-- room, neither (after the last), the existing paths unchanged (after Edit, after the last revision
-- stage, even with a Posted stage), one history row, and every role (Owner, the client's Admin, another
-- Admin NOT_FOUND, Crew FORBIDDEN, anon no privilege). Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

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

select pg_temp.as_member('admin');
-- p1: Shoot → Posted → Script; p2: Shoot → Published; p3: Shoot → Delivered; p4: Shoot → POSTED;
-- p5: Shoot → Delivered → Posted; p6: Shoot → Script; p7: Shoot → Edit → Posted; p8: Revision 1 → Posted.
insert into fx values ('p1', public.project_create(pg_temp.fx('client_a'), 'One', 'monthly', null, null,
  array['Shoot', 'Posted', 'Script'], array['Item 1', 'Item 1b', 'Item 1c']));
insert into fx values ('i1', pg_temp.item(pg_temp.fx('p1'), 'Item 1'));
insert into fx values ('i1b', pg_temp.item(pg_temp.fx('p1'), 'Item 1b'));
insert into fx values ('i1c', pg_temp.item(pg_temp.fx('p1'), 'Item 1c'));
insert into fx values ('p2', public.project_create(pg_temp.fx('client_a'), 'Two', 'monthly', null, null,
  array['Shoot', 'Published'], array['Item 2']));
insert into fx values ('i2', pg_temp.item(pg_temp.fx('p2'), 'Item 2'));
insert into fx values ('p3', public.project_create(pg_temp.fx('client_a'), 'Three', 'monthly', null, null,
  array['Shoot', 'Delivered'], array['Item 3']));
insert into fx values ('i3', pg_temp.item(pg_temp.fx('p3'), 'Item 3'));
insert into fx values ('p4', public.project_create(pg_temp.fx('client_a'), 'Four', 'monthly', null, null,
  array['Shoot', 'POSTED'], array['Item 4']));
insert into fx values ('i4', pg_temp.item(pg_temp.fx('p4'), 'Item 4'));
insert into fx values ('p5', public.project_create(pg_temp.fx('client_a'), 'Five', 'monthly', null, null,
  array['Shoot', 'Delivered', 'Posted'], array['Item 5']));
insert into fx values ('i5', pg_temp.item(pg_temp.fx('p5'), 'Item 5'));
insert into fx values ('p6', public.project_create(pg_temp.fx('client_a'), 'Six', 'monthly', null, null,
  array['Shoot', 'Script'], array['Item 6']));
insert into fx values ('i6', pg_temp.item(pg_temp.fx('p6'), 'Item 6'));
insert into fx values ('p7', public.project_create(pg_temp.fx('client_a'), 'Seven', 'monthly', null, null,
  array['Shoot', 'Edit', 'Posted'], array['Item 7']));
insert into fx values ('i7', pg_temp.item(pg_temp.fx('p7'), 'Item 7'));
insert into fx values ('p9', public.project_create(pg_temp.fx('client_a'), 'Nine', 'monthly', null, null,
  array['Shoot', 'Script'], array['Item 9', 'Item 9b']));
insert into fx values ('i9', pg_temp.item(pg_temp.fx('p9'), 'Item 9'));
insert into fx values ('i9b', pg_temp.item(pg_temp.fx('p9'), 'Item 9b'));
insert into fx values ('p8', public.project_create(pg_temp.fx('client_a'), 'Eight', 'monthly', null, null,
  array['Revision 1', 'Posted'], array['Item 8']));
insert into fx values ('i8', pg_temp.item(pg_temp.fx('p8'), 'Item 8'));

-- 1. Before the go-out stage ---------------------------------------------------------------------
select public.item_stage_tick(pg_temp.istage(pg_temp.fx('i1'), 'Shoot'));
select is(public.item_add_revision_round(pg_temp.fx('i1')), 'Revision round 1', 'neither: still named as before');
select is(pg_temp.gstages(pg_temp.fx('i1')), 'Shoot✓,Revision round 1,Posted,Script',
  'neither a revision nor an Edit stage: just before "Posted", the tick kept');
select is(public.item_add_revision_round(pg_temp.fx('i1')), 'Revision round 2', 'a second round numbers on');
select is(pg_temp.gstages(pg_temp.fx('i1')), 'Shoot✓,Revision round 1,Revision round 2,Posted,Script',
  'then after the last revision stage (the existing path)');
select is(public.item_add_revision_round(pg_temp.fx('i2')), 'Revision round 1', 'Published');
select is(pg_temp.gstages(pg_temp.fx('i2')), 'Shoot,Revision round 1,Published', 'just before "Published"');
select is(public.item_add_revision_round(pg_temp.fx('i3')), 'Revision round 1', 'Delivered');
select is(pg_temp.gstages(pg_temp.fx('i3')), 'Shoot,Revision round 1,Delivered', 'just before "Delivered"');
select is(public.item_add_revision_round(pg_temp.fx('i4')), 'Revision round 1', 'POSTED');
select is(pg_temp.gstages(pg_temp.fx('i4')), 'Shoot,Revision round 1,POSTED', 'ignoring case');
select is(public.item_add_revision_round(pg_temp.fx('i5')), 'Revision round 1', 'two go-out stages');
select is(pg_temp.gstages(pg_temp.fx('i5')), 'Shoot,Revision round 1,Delivered,Posted',
  'before the first of them as the list shows it');

-- 2. Inside a group; keys with no room -------------------------------------------------------------
select public.item_stage_group_add(pg_temp.fx('i9'), 'Publish', array['Review', 'Posted', 'Report']);
select is(public.item_add_revision_round(pg_temp.fx('i9')), 'Revision round 1', 'a grouped deliverable');
select is(pg_temp.gstages(pg_temp.fx('i9')),
  'Shoot,Script,Publish·Review,Publish·Revision round 1,Publish·Posted,Publish·Report',
  'just before "Posted", inside its group');
select pg_temp.as_system();
update public.project_item_stage_list set position = 'a1' where id = pg_temp.istage(pg_temp.fx('i1c'), 'Shoot');
update public.project_item_stage_list set position = 'a10' where id = pg_temp.istage(pg_temp.fx('i1c'), 'Posted');
update public.project_item_stage_list set position = 'a2' where id = pg_temp.istage(pg_temp.fx('i1c'), 'Script');
select pg_temp.as_member('admin');
select is(public.item_add_revision_round(pg_temp.fx('i1c')), 'Revision round 1', 'no room between the keys: added all the same');
select is(pg_temp.gstages(pg_temp.fx('i1c')), 'Shoot,Revision round 1,Posted,Script',
  'just before "Posted" once the group takes fresh keys');

-- 3. Neither a go-out stage: after the last; the existing paths unchanged -----------------------------
select is(public.item_add_revision_round(pg_temp.fx('i6')), 'Revision round 1', 'no go-out stage either');
select is(pg_temp.gstages(pg_temp.fx('i6')), 'Shoot,Script,Revision round 1', 'after the last stage, as before');
select is(public.item_add_revision_round(pg_temp.fx('i7')), 'Revision round 1', 'with an Edit stage');
select is(pg_temp.gstages(pg_temp.fx('i7')), 'Shoot,Edit,Revision round 1,Posted', 'after "Edit", unchanged');
select is(public.item_add_revision_round(pg_temp.fx('i8')), 'Revision 2', 'with a revision stage');
select is(pg_temp.gstages(pg_temp.fx('i8')), 'Revision 1,Revision 2,Posted', 'after the last revision stage, unchanged');
select is((select count(*)::integer from public.activity_log l
           where l.entity = 'project_item_stage_list' and l.action = 'insert' and l.entity_id = pg_temp.fx('i2')
             and (l.meta ->> 'revision_round')::boolean), 1,
  'one history row, marked as a revision round');

-- 4. Every role -----------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.item_add_revision_round(pg_temp.fx('i3')), 'Revision round 2', 'the Owner adds one');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_add_revision_round(pg_temp.fx('i2')) $$), 'NOT_FOUND',
  'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_add_revision_round(pg_temp.fx('i2')) $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.item_add_revision_round(pg_temp.fx('i2')) $$, '42501', null, 'anon: no privilege');
select pg_temp.as_system();
select ok(not has_function_privilege('anon', 'public.item_add_revision_round(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.item_add_revision_round(uuid)', 'execute'),
  'grants unchanged: authenticated yes, anon no');

select * from finish();
rollback;
