-- 4C review fixes (migration phase4c_review_fixes) and Kickoff 4 decisions (23) and (24):
-- (S1)  a template's field defaults are checked in the database (32 KB, a real task field of the
--       organization, company-wide or the template's type, a value of its type; an unchanged key
--       passes); its reminders took no API write before 5.3, whose editor granted them back
--       (a valid list written, an invalid one refused);
-- (S2)  the gaps of 37: who reads a request's history (denied: another Staff member, an Admin
--       outside the label), convert NOT_FOUND on another Admin's client, the UNAUTHENTICATED paths
--       of every request function, task_type_move refused for Staff;
-- (S8a) an Admin suggests with their own clients only (Staff unchanged);
-- (23)  an Admin never converts or declines their own suggestion, may withdraw it; the Owner
--       decides an Admin's; an Admin decides a Staff member's;
-- (L1)  the last active task type is never archived, by any writer.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

-- Fixtures as 37. Rolled back at the end.
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
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000000b01'),
  ('admin1',   '00000000-0000-4000-8000-000000000b02'),
  ('admin2',   '00000000-0000-4000-8000-000000000b03'),
  ('staff1',   '00000000-0000-4000-8000-000000000b04'),
  ('staff2',   '00000000-0000-4000-8000-000000000b05'),
  ('client_a', '00000000-0000-4000-8000-000000000b11'),
  ('client_b', '00000000-0000-4000-8000-000000000b12');
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

-- Signed in, with no member row (a removed account): the UNAUTHENTICATED paths.
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000b99', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000b99', 'role', 'authenticated')::text, true);
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

create function pg_temp.type_id(n text) returns uuid language sql stable as $$
  select tt.id from public.task_types tt where tt.org_id = pg_temp.fx('org') and tt.name = n;
$$;

create function pg_temp.due() returns timestamptz language sql stable as $$
  select app.ist_day_start(app.today_ist() + 1) + interval '18 hours';
$$;

create function pg_temp.request(k text) returns public.task_requests language sql stable as $$
  select r.* from public.task_requests r where r.id = pg_temp.fx(k);
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

-- How many history entries about a request the caller reads (RLS decides).
create function pg_temp.history(k text) returns bigint language sql stable as $$
  select count(*) from public.activity_log a where a.entity = 'task_requests' and a.entity_id = pg_temp.fx(k);
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not like 'client%' and key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'),
             ('staff2', 'staff')) as v(k, r);

insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery', 'active', pg_temp.fx('admin2'), now());

-- The task fields a default may name: one for every task, one for meetings, one archived later.
select pg_temp.as_member('owner');
insert into public.field_definitions (entity, key, label, type, position) values
  ('task', 'format', 'Format', 'text', 'a0'),
  ('task', 'old_code', 'Old code', 'text', 'a2');
insert into public.field_definitions (entity, key, label, type, position, task_type_id)
values ('task', 'attendees', 'Attendees', 'number', 'a1', pg_temp.type_id('Meeting'));

-- 1. (S1) Template field defaults and reminders -------------------------------------------------------
select pg_temp.as_member('admin1');
select lives_ok($$ with t as (
    insert into public.task_templates (name, task_type_id, field_defaults)
    values ('Reel', pg_temp.type_id('Normal'), '{"format": "9:16", "old_code": "R1"}')
    returning id) insert into fx select 'tpl', id from t $$,
  'a default for a real task field is kept');
select throws_ok($$ insert into public.task_templates (name, task_type_id, field_defaults)
    values ('Ghost', pg_temp.type_id('Normal'), '{"ghost": "x"}') $$,
  'P0001', 'VALIDATION', 'a key that names no task field is refused');
select throws_ok($$ insert into public.task_templates (name, task_type_id, field_defaults)
    values ('Wrong type', pg_temp.type_id('Normal'), '{"format": 5}') $$,
  'P0001', 'VALIDATION', 'a value of the wrong type is refused');
select throws_ok($$ insert into public.task_templates (name, task_type_id, field_defaults)
    values ('Not a meeting', pg_temp.type_id('Normal'), '{"attendees": 3}') $$,
  'P0001', 'VALIDATION', 'another type''s field is refused');
select lives_ok($$ insert into public.task_templates (name, task_type_id, field_defaults)
    values ('Standup', pg_temp.type_id('Meeting'), '{"attendees": 3}') $$,
  'the template''s own type''s field is kept');
select throws_ok(format($$ insert into public.task_templates (name, task_type_id, field_defaults)
    values ('Huge', pg_temp.type_id('Normal'), %L::jsonb) $$, jsonb_build_object('format', repeat('x', 40000))),
  'P0001', 'VALIDATION', 'more than 32 KB of defaults is refused');
select throws_ok(format($$ update public.task_templates set field_defaults = '{"format": "9:16", "old_code": "R1", "ghost": 1}' where id = %L $$, pg_temp.fx('tpl')),
  'P0001', 'VALIDATION', 'an edit that adds an unknown key is refused');
select pg_temp.as_system();
update public.field_definitions set archived_at = now() where key = 'old_code';
select pg_temp.as_member('admin1');
select lives_ok(format($$ update public.task_templates set name = 'Reel (short)' where id = %L $$, pg_temp.fx('tpl')),
  'a default the write leaves as it was passes (its field was archived since)');
select throws_ok(format($$ update public.task_templates set field_defaults = '{"format": "9:16", "old_code": "R2"}' where id = %L $$, pg_temp.fx('tpl')),
  'P0001', 'VALIDATION', 'but a changed value for an archived field is refused');
-- 5.3's editor granted the column back (migration reminder_editor_grants): a valid list is
-- written, an invalid one refused by task_templates_reminder_rules_valid.
select lives_ok($$ insert into public.task_templates (name, task_type_id, reminder_rules)
    values ('Reminders', pg_temp.type_id('Normal'), '[{"before": 1, "unit": "days"}]') $$,
  'since 5.3 a template takes a valid reminder list on insert');
select throws_ok(format($$ update public.task_templates set reminder_rules = '[{"offset": 60}]' where id = %L $$, pg_temp.fx('tpl')),
  '23514', null, 'and refuses an invalid one on update');
select pg_temp.as_member('owner');
select throws_ok(format($$ update public.task_templates set field_defaults = '{"format": 9}' where id = %L $$, pg_temp.fx('tpl')),
  'P0001', 'VALIDATION', 'the Owner''s edits are checked too');

-- 2. (S8a) An Admin suggests with their own clients ---------------------------------------------------
-- admin1 is on a task labelled with admin2's client, so they see that label.
select pg_temp.as_member('owner');
insert into fx values ('t_b', public.task_create('Bakery shoot', null, pg_temp.type_id('Normal'), pg_temp.fx('client_b'), 'medium',
  pg_temp.due(), array[pg_temp.fx('admin1')], pg_temp.fx('admin1'), pg_temp.fx('admin2')));
insert into fx values ('t_a', public.task_create('Wedding reel', null, pg_temp.type_id('Normal'), pg_temp.fx('client_a'), 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1')));
select pg_temp.as_member('admin1');
select ok(pg_temp.fx('client_b') in (select app.labelled_client_ids()), 'admin1 sees admin2''s client as a label on their task');
select throws_ok(format($$ select public.task_request_create('For the bakery', null, %L::uuid) $$, pg_temp.fx('client_b')),
  'P0001', 'FORBIDDEN', 'an Admin never suggests with another Admin''s client (decision 2, 4C review S8a)');
select lives_ok(format($$ insert into fx values ('r_adm', public.task_request_create('Retainer plan', null, %L::uuid)) $$, pg_temp.fx('client_a')),
  'an Admin suggests with their own client');
select lives_ok($$ insert into fx values ('r_adm2', public.task_request_create('Team offsite')) $$,
  'or with none');
select pg_temp.as_member('staff1');
select lives_ok(format($$ insert into fx values ('r_a', public.task_request_create('Anniversary post', null, %L::uuid)) $$, pg_temp.fx('client_a')),
  'Staff still suggest with a label they see');
select lives_ok(format($$ insert into fx values ('r_a2', public.task_request_create('Album cover', null, %L::uuid)) $$, pg_temp.fx('client_a')),
  'another');
select lives_ok($$ insert into fx values ('r_plain', public.task_request_create('Tidy the drive')) $$, 'and one with no client');
select pg_temp.as_member('staff2');
select lives_ok($$ insert into fx values ('r_s2', public.task_request_create('New intro')) $$, 'another Staff member suggests one');

-- 3. (23) An Admin never decides their own suggestion -------------------------------------------------
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_request_convert(%L, 'Retainer plan', null, %L::uuid, %L::uuid, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.fx('r_adm'), pg_temp.type_id('Normal'), pg_temp.fx('client_a'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'FORBIDDEN', 'an Admin never converts their own suggestion (decision 23)');
select throws_ok(format($$ select public.task_request_decline(%L, 'Not now') $$, pg_temp.fx('r_adm')),
  'P0001', 'FORBIDDEN', 'nor declines it');
select is((pg_temp.request('r_adm')).state, 'pending'::public.request_state, 'it still waits, for the Owner');
select lives_ok(format($$ insert into fx values ('t_conv', public.task_request_convert(%L, 'Anniversary post', null, %L::uuid, %L::uuid, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid)) $$,
  pg_temp.fx('r_a'), pg_temp.type_id('Normal'), pg_temp.fx('client_a'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'an Admin converts a Staff member''s suggestion');
select is(public.task_request_decline(pg_temp.fx('r_plain'), 'We did this last week'), 'declined'::public.request_state,
  'and declines one');
select is(public.task_request_withdraw(pg_temp.fx('r_adm2')), 'withdrawn'::public.request_state,
  'an Admin withdraws their own');
select pg_temp.as_member('owner');
select is(public.task_request_decline(pg_temp.fx('r_adm'), 'Next quarter'), 'declined'::public.request_state,
  'the Owner decides an Admin''s suggestion');
select is((pg_temp.request('r_adm')).decided_by, pg_temp.fx('owner'), 'named as the decider');

-- 4. (S2) Who reads a request's history ---------------------------------------------------------------
select pg_temp.as_member('staff1');
select ok(pg_temp.history('r_plain') >= 2, 'the requester reads their suggestion''s history (requested, declined)');
select pg_temp.as_member('staff2');
select is(pg_temp.history('r_plain'), 0::bigint, 'another Staff member reads none of it');
select is((select count(*) from public.activity_log a where a.entity_id = pg_temp.fx('r_plain') and a.action = 'declined'),
  0::bigint, 'not the declined entry');
select is((select count(*) from public.activity_log a where a.meta ->> 'reason' = 'We did this last week'),
  0::bigint, 'nor its reason');
select pg_temp.as_member('admin2');
select is(pg_temp.history('r_a'), 0::bigint,
  'an Admin reads no entry of a request labelled with another Admin''s client');
select is(pg_temp.history('r_adm'), 0::bigint, 'nor of another Admin''s suggestion with their own client');
select pg_temp.as_member('admin1');
select ok(pg_temp.history('r_a') >= 2, 'the client''s Admin reads it (requested, converted)');

-- 5. (S2) Convert on another Admin's client, the UNAUTHENTICATED paths, task_type_move for Staff ------
select pg_temp.as_member('admin2');
select throws_ok(format($$ select public.task_request_convert(%L, 'Album cover', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.fx('r_a2'), pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'NOT_FOUND', 'an Admin never converts a request labelled with another Admin''s client');
select pg_temp.as_member('staff1');
select is((pg_temp.request('r_a2')).state, 'pending'::public.request_state, 'it stays pending');

select pg_temp.as_nobody();
select throws_ok($$ select public.task_request_create('Nobody') $$, 'P0001', 'UNAUTHENTICATED',
  'no member row: no suggestion');
select throws_ok(format($$ select public.task_request_withdraw(%L) $$, pg_temp.fx('r_s2')), 'P0001', 'UNAUTHENTICATED',
  'nor a withdrawal');
select throws_ok(format($$ select public.task_request_decline(%L, 'no') $$, pg_temp.fx('r_s2')), 'P0001', 'UNAUTHENTICATED',
  'nor a decline');
select throws_ok(format($$ select public.task_request_convert(%L, 'x', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.fx('r_s2'), pg_temp.type_id('Normal'), pg_temp.fx('staff2'), pg_temp.fx('staff2')),
  'P0001', 'UNAUTHENTICATED', 'nor a conversion');
select throws_ok(format($$ select public.task_type_move(%L, 'up') $$, pg_temp.type_id('Meeting')), 'P0001', 'UNAUTHENTICATED',
  'nor a task type move');
select pg_temp.as_system();
select is((pg_temp.request('r_s2')).state, 'pending'::public.request_state, 'nothing changed');

select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_type_move(%L, 'up') $$, pg_temp.type_id('Meeting')), 'P0001', 'FORBIDDEN',
  'Staff never reorder the task types (decision 15)');

-- 6. (L1) The last active task type ------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ update public.task_types set archived_at = now() where archived_at is null $$,
  'P0001', 'INVALID_STATE', 'archiving every type at once is refused');
select is((select count(*) from public.task_types where archived_at is null), 7::bigint, 'and nothing was archived');
select lives_ok($$ update public.task_types set archived_at = now() where archived_at is null and name <> 'Normal' $$,
  'the Owner archives all but one');
select throws_ok(format($$ update public.task_types set archived_at = now() where id = %L $$, pg_temp.type_id('Normal')),
  'P0001', 'INVALID_STATE', 'the last active type is never archived (4C review L1)');
select pg_temp.as_system();
select throws_ok(format($$ update public.task_types set archived_at = now() where id = %L $$, pg_temp.type_id('Normal')),
  'P0001', 'INVALID_STATE', 'by any writer');
select pg_temp.as_member('owner');
select lives_ok(format($$ update public.task_types set archived_at = null where id = %L $$, pg_temp.type_id('Meeting')),
  'restoring one');
select lives_ok(format($$ update public.task_types set archived_at = now() where id = %L $$, pg_temp.type_id('Normal')),
  'makes the other free to archive');
select pg_temp.as_member('admin1');
select is(pg_temp.rows(format('update public.task_types set archived_at = null where id = %L', pg_temp.type_id('Normal'))), 0::bigint,
  'an Admin restores nothing (RLS: settings.manage)');

-- The moves still swap (L2 took a lock, not a rule).
select pg_temp.as_member('owner');
select lives_ok(format($$ update public.task_types set archived_at = null where id = %L $$, pg_temp.type_id('Normal')),
  'the Owner restores Normal');
select is(public.task_type_move(pg_temp.type_id('Meeting'), 'up'), pg_temp.type_id('Normal'),
  'a move still swaps with the neighbour (4C review L2: one move at a time, rows locked in id order)');
select is(public.task_type_move(pg_temp.type_id('Meeting'), 'down'), pg_temp.type_id('Normal'),
  'and the opposite move swaps back');

select pg_temp.as_system();
select * from finish();
rollback;
