-- V3 (v1.8; the long-stage-list fix (D), owner 2026-10-17; migration v3_item_stages_group):
-- "Group stages" splits a deliverable's ungrouped stages into named groups at the starts the Admin
-- chose; never automatic, a grouped deliverable left as it is. Every path: the split (order, ticks,
-- one history row a stage, the other deliverable untouched), each refusal (already grouped, first
-- start, order, duplicate or empty names, one group, mismatched lists, another deliverable's stage,
-- nothing changed), and per role (Owner, the client's Admin, another Admin NOT_FOUND, Crew
-- FORBIDDEN, anon no privilege). Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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
  ('owner',    '00000000-0000-4000-8000-000000008401'),
  ('admin',    '00000000-0000-4000-8000-000000008402'),
  ('admin2',   '00000000-0000-4000-8000-000000008403'),
  ('staff',    '00000000-0000-4000-8000-000000008404'),
  ('client_a', '00000000-0000-4000-8000-0000000084a1'),
  ('client_b', '00000000-0000-4000-8000-0000000084b1');
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

-- A deliverable with twelve long-named stages, all in one list (the production shape, 2026-10-17).
select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client_a'), 'Long', 'monthly', null, null,
  array['Concept note', 'Moodboard', 'Script draft', 'Script sent for internal approval round 1',
        'Shoot planning', 'Location recce', 'Shoot', 'Rough cut', 'Sent for internal approval round 1',
        'Final edit', 'Client approval', 'Posted'],
  array['Reel 1', 'Reel 2']));
insert into fx values ('a', pg_temp.item(pg_temp.fx('p'), 'Reel 1'));
insert into fx values ('b', pg_temp.item(pg_temp.fx('p'), 'Reel 2'));
select public.item_stage_tick(pg_temp.istage(pg_temp.fx('a'), 'Moodboard'));

-- 1. The path: three groups where the Admin chose, ticks and order kept, one history row a stage ----
select is(public.item_stages_group(pg_temp.fx('a'), array['Concept', 'Shoot', 'Post'],
  array[pg_temp.istage(pg_temp.fx('a'), 'Concept note'), pg_temp.istage(pg_temp.fx('a'), 'Shoot planning'),
        pg_temp.istage(pg_temp.fx('a'), 'Rough cut')]), 12, 'every stage placed');
select is(pg_temp.gstages(pg_temp.fx('a')),
  'Concept·Concept note,Concept·Moodboard✓,Concept·Script draft,Concept·Script sent for internal approval round 1,'
  || 'Shoot·Shoot planning,Shoot·Location recce,Shoot·Shoot,Post·Rough cut,Post·Sent for internal approval round 1,'
  || 'Post·Final edit,Post·Client approval,Post·Posted',
  'split at the chosen starts, the order and the tick kept');
select is((select count(*)::integer from public.activity_log l
           where l.entity = 'project_item_stage_list' and l.action = 'update'
             and l.meta ->> 'stage_id' in (select s.id::text from public.project_item_stage_list s where s.item_id = pg_temp.fx('a'))),
  12, 'one audited update per stage');
select is(pg_temp.gstages(pg_temp.fx('b')),
  'Concept note,Moodboard,Script draft,Script sent for internal approval round 1,Shoot planning,Location recce,'
  || 'Shoot,Rough cut,Sent for internal approval round 1,Final edit,Client approval,Posted',
  'the other deliverable is untouched (never automatic)');

-- 2. Refusals -------------------------------------------------------------------------------------
select is(pg_temp.code($$ select public.item_stages_group(pg_temp.fx('a'), array['A', 'B'],
  array[pg_temp.istage(pg_temp.fx('a'), 'Concept note'), pg_temp.istage(pg_temp.fx('a'), 'Shoot')]) $$),
  'CONFLICT', 'already in groups: left as it is');
select is(pg_temp.code($$ select public.item_stages_group(pg_temp.fx('b'), array['A', 'B'],
  array[pg_temp.istage(pg_temp.fx('b'), 'Moodboard'), pg_temp.istage(pg_temp.fx('b'), 'Shoot')]) $$),
  'VALIDATION', 'the first group starts at the first stage');
select is(pg_temp.code($$ select public.item_stages_group(pg_temp.fx('b'), array['A', 'B', 'C'],
  array[pg_temp.istage(pg_temp.fx('b'), 'Concept note'), pg_temp.istage(pg_temp.fx('b'), 'Shoot'),
        pg_temp.istage(pg_temp.fx('b'), 'Moodboard')]) $$),
  'VALIDATION', 'the starts follow the stages'' order');
select is(pg_temp.code($$ select public.item_stages_group(pg_temp.fx('b'), array['Edit', 'edit'],
  array[pg_temp.istage(pg_temp.fx('b'), 'Concept note'), pg_temp.istage(pg_temp.fx('b'), 'Shoot')]) $$),
  'CONFLICT', 'two groups with one name (ignoring case)');
select is(pg_temp.code($$ select public.item_stages_group(pg_temp.fx('b'), array['A', '  '],
  array[pg_temp.istage(pg_temp.fx('b'), 'Concept note'), pg_temp.istage(pg_temp.fx('b'), 'Shoot')]) $$),
  'VALIDATION', 'every group is named');
select is(pg_temp.code($$ select public.item_stages_group(pg_temp.fx('b'), array['A'],
  array[pg_temp.istage(pg_temp.fx('b'), 'Concept note')]) $$),
  'VALIDATION', 'at least two groups');
select is(pg_temp.code($$ select public.item_stages_group(pg_temp.fx('b'), array['A', 'B'],
  array[pg_temp.istage(pg_temp.fx('b'), 'Concept note')]) $$),
  'VALIDATION', 'a start for every name');
select is(pg_temp.code($$ select public.item_stages_group(pg_temp.fx('b'), array['A', 'B'],
  array[pg_temp.istage(pg_temp.fx('b'), 'Concept note'), pg_temp.istage(pg_temp.fx('a'), 'Shoot')]) $$),
  'VALIDATION', 'a start on another deliverable''s stage');
select is(pg_temp.gstages(pg_temp.fx('b')),
  'Concept note,Moodboard,Script draft,Script sent for internal approval round 1,Shoot planning,Location recce,'
  || 'Shoot,Rough cut,Sent for internal approval round 1,Final edit,Client approval,Posted',
  'a refusal changes nothing');

-- 3. Per role ---------------------------------------------------------------------------------------
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_stages_group(pg_temp.fx('b'), array['A', 'B'],
  array[pg_temp.istage(pg_temp.fx('b'), 'Concept note'), pg_temp.istage(pg_temp.fx('b'), 'Shoot')]) $$),
  'NOT_FOUND', 'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_stages_group(pg_temp.fx('b'), array['A', 'B'],
  array[pg_temp.istage(pg_temp.fx('b'), 'Concept note'), pg_temp.istage(pg_temp.fx('b'), 'Shoot')]) $$),
  'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.item_stages_group(pg_temp.fx('b'), array['A', 'B'], array[]::uuid[]) $$,
  '42501', null, 'anon: no privilege');
select pg_temp.as_member('owner');
select is(public.item_stages_group(pg_temp.fx('b'), array['Before', 'After'],
  array[pg_temp.istage(pg_temp.fx('b'), 'Concept note'), pg_temp.istage(pg_temp.fx('b'), 'Shoot')]), 12,
  'the Owner groups one too');

select * from finish();
rollback;
