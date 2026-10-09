-- Amendment D (owner 2026-10-09; migration client_work_item_stages): stages per item (D1, D2), done =
-- approved and the send-back / reopen (D3), and the project page's activity reads. Every role on the
-- new table and on each new function path: the Owner (any client), the client's Admin (their own),
-- another Admin (NOT_FOUND / nothing read), Crew (FORBIDDEN / nothing read), a deactivated Admin
-- (UNAUTHENTICATED), anon (no privilege).
begin;
create extension if not exists pgtap with schema extensions;
select plan(133);

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
  ('owner',      '00000000-0000-4000-8000-000000007301'),
  ('admin',      '00000000-0000-4000-8000-000000007302'),
  ('admin2',     '00000000-0000-4000-8000-000000007303'),
  ('staff',      '00000000-0000-4000-8000-000000007304'),
  ('gone_admin', '00000000-0000-4000-8000-000000007305'),
  ('client_a',   '00000000-0000-4000-8000-0000000073a1'),
  ('client_b',   '00000000-0000-4000-8000-0000000073b1'),
  ('client_d',   '00000000-0000-4000-8000-0000000073d1');
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

-- Projects: a one-time film with default stages, a monthly retainer with an item list, a project with
-- no stages (D1), another Admin's, and the Owner's own (no Admin).
select pg_temp.as_member('admin');
insert into fx values ('p_f', public.project_create(pg_temp.fx('client_a'), 'Brand film', 'one_time', null, app.today_ist() + 10,
  array['Script', 'Shoot', 'Edit'], array['Film', 'Teaser']));
insert into fx values ('p_m', public.project_create(pg_temp.fx('client_a'), 'Monthly reels', 'monthly', null, null,
  array['Script', 'Edit'], array['Reel 1', 'Reel 2']));
insert into fx values ('p_n', public.project_create(pg_temp.fx('client_a'), 'Quick fixes', 'one_time', null, app.today_ist() + 3,
  '{}'::text[], array['Fix 1']));
select pg_temp.as_member('admin2');
insert into fx values ('p_b', public.project_create(pg_temp.fx('client_b'), 'Menu reel', 'one_time', null, app.today_ist() + 10,
  array['Shoot'], array['Menu']));
select pg_temp.as_member('owner');
insert into fx values ('p_d', public.project_create(pg_temp.fx('client_d'), 'Own film', 'one_time', null, app.today_ist() + 10,
  array['Edit'], array['Own cut']));
select pg_temp.clear();

-- 1. The table ---------------------------------------------------------------------------------------------
select pg_temp.as_system();
select has_table('public', 'project_item_stage_list', 'project_item_stage_list exists (D2)');
select has_column('public', 'project_item_blueprints', 'stages', 'project_item_blueprints.stages (D2)');
select ok((select relrowsecurity from pg_class where oid = 'public.project_item_stage_list'::regclass), 'RLS is on');
select ok(not has_table_privilege('anon', 'public.project_item_stage_list', 'select, insert, update, delete'),
  'anon has no privilege on it');
select ok(has_table_privilege('authenticated', 'public.project_item_stage_list', 'select')
          and not has_table_privilege('authenticated', 'public.project_item_stage_list', 'insert, update, delete, truncate'),
  'the API role reads it and never writes (every write is a function)');
select is((select count(*)::integer from information_schema.columns
           where table_schema = 'public' and table_name = 'project_item_stage_list'
             and (column_name ~ '(amount|value|price|fee|billing|revenue)' or data_type in ('numeric', 'money'))),
  0, 'no amount on it (ADR-0007)');

-- 2. New items start with the defaults (D2); none is fine (D1) ---------------------------------------------
select is(pg_temp.stages('Film'), 'Script,Shoot,Edit', 'a one-time project''s items start with its default stages');
select is(pg_temp.stages('Reel 1'), 'Script,Edit', 'a recurring project''s first cycle''s items too, from their line');
select is((select stages from public.project_item_blueprints where project_id = pg_temp.fx('p_m') and title = 'Reel 2'),
  array['Script', 'Edit'], 'each item-list line carries the default stages');
select is(pg_temp.stages('Fix 1'), '', 'a project with no stages gives items none (D1)');
select is((select count(*)::integer from public.activity_log
           where entity = 'project_item_stage_list' and entity_id = pg_temp.item('Film') and action = 'initial'), 3,
  'a new item''s stages are audited ''initial''');

-- 3. Row-level security per role ---------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is((select count(*)::integer from public.project_item_stage_list), 12, 'the Owner reads every client''s item stages');
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.project_item_stage_list), 10, 'the client''s Admin reads their clients'' only');
select pg_temp.as_member('admin2');
select is((select count(*)::integer from public.project_item_stage_list), 1, 'another Admin reads only theirs');
select is((select count(*)::integer from public.project_item_stage_list where item_id = pg_temp.item('Film')), 0,
  'and nothing of the first Admin''s');
select pg_temp.as_member('staff');
select is((select count(*)::integer from public.project_item_stage_list), 0, 'Crew read nothing');
select pg_temp.as_member('gone_admin');
select is((select count(*)::integer from public.project_item_stage_list), 0, 'a deactivated Admin reads nothing');
select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.project_item_stage_list $$, '42501', null, 'anon reads nothing');
select pg_temp.as_member('admin');
select throws_ok($$ insert into public.project_item_stage_list (org_id, project_id, item_id, name, position)
  values (pg_temp.fx('org'), pg_temp.fx('p_f'), pg_temp.item('Film'), 'X', 'z0') $$, '42501', null,
  'the client''s Admin cannot write it directly');
select throws_ok($$ update public.project_item_stage_list set name = 'X' $$, '42501', null, 'nor update it');

-- 4. item_stage_add / update / archive (projects.manage) ---------------------------------------------------
select ok(public.item_stage_add(pg_temp.item('Film'), 'Colour') is not null, 'the client''s Admin adds a stage to one item');
select is(pg_temp.stages('Film'), 'Script,Shoot,Edit,Colour', 'at the end of its own list');
select is(pg_temp.stages('Teaser'), 'Script,Shoot,Edit', 'the project''s other items are untouched');
select is((select count(*)::integer from public.project_stages where project_id = pg_temp.fx('p_f')), 3, 'nor its defaults');
select throws_ok($$ select public.item_stage_add(pg_temp.item('Film'), ' colour ') $$, 'P0001', 'CONFLICT',
  'an item never has two active stages of one name (case-insensitive)');
select throws_ok($$ select public.item_stage_add(pg_temp.item('Film'), '  ') $$, 'P0001', 'VALIDATION', 'a stage needs a name');
select lives_ok($$ select public.item_stage_add(pg_temp.item('Fix 1'), 'Stage ' || g) from generate_series(1, 12) g $$,
  'an item takes up to 12 stages');
select throws_ok($$ select public.item_stage_add(pg_temp.item('Fix 1'), 'Stage 13') $$, 'P0001', 'VALIDATION', 'never 13');
select is(public.item_stage_update(pg_temp.stage('Film', 'Colour'), '{"name": "Grade"}'), array['name'], 'renamed');
select throws_ok($$ select public.item_stage_update(pg_temp.stage('Film', 'Grade'), '{"name": "edit"}') $$, 'P0001', 'CONFLICT',
  'never to a name the item has');
select is(public.item_stage_update(pg_temp.stage('Film', 'Grade'), '{"position": "0"}'), array['position'], 'moved');
select is(pg_temp.stages('Film'), 'Grade,Script,Shoot,Edit', 'to the front');
select throws_ok($$ select public.item_stage_update(pg_temp.stage('Film', 'Grade'), '{"done_at": "2026-01-01"}') $$, 'P0001', 'VALIDATION',
  'only the name and the place change');
select pg_temp.as_member('owner');
select lives_ok($$ select public.item_stage_add(pg_temp.item('Menu'), 'Post') $$, 'the Owner adds a stage on any client''s item');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_stage_add(pg_temp.item('Film'), 'Y') $$), 'NOT_FOUND', 'another Admin: NOT_FOUND (add)');
select is(pg_temp.code($$ select public.item_stage_update(pg_temp.stage('Film', 'Grade'), '{"name": "Y"}') $$), 'NOT_FOUND', '(update)');
select is(pg_temp.code($$ select public.item_stage_archive(pg_temp.stage('Film', 'Grade')) $$), 'NOT_FOUND', '(archive)');
select is(pg_temp.code($$ select public.item_stage_tick(pg_temp.stage('Film', 'Grade')) $$), 'NOT_FOUND', '(tick)');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_stage_add(pg_temp.item('Film'), 'Y') $$), 'FORBIDDEN', 'Crew: FORBIDDEN (add)');
select is(pg_temp.code($$ select public.item_stage_update(pg_temp.stage('Film', 'Grade'), '{"name": "Y"}') $$), 'FORBIDDEN', '(update)');
select is(pg_temp.code($$ select public.item_stage_archive(pg_temp.stage('Film', 'Grade')) $$), 'FORBIDDEN', '(archive)');
select is(pg_temp.code($$ select public.item_stage_tick(pg_temp.stage('Film', 'Grade')) $$), 'FORBIDDEN', '(tick)');
select pg_temp.as_member('gone_admin');
select is(pg_temp.code($$ select public.item_stage_add(pg_temp.item('Film'), 'Y') $$), 'UNAUTHENTICATED', 'a deactivated Admin (add)');
select is(pg_temp.code($$ select public.item_stage_tick(pg_temp.stage('Film', 'Grade')) $$), 'UNAUTHENTICATED', '(tick)');

-- 5. item_stage_tick (items.tick) --------------------------------------------------------------------------
select pg_temp.as_member('admin');
select is((select state::text from public.projects where id = pg_temp.fx('p_f')), 'open', 'the film is still open');
select is(public.item_stage_tick(pg_temp.stage('Film', 'Script')), true, 'the Admin ticks one of the item''s stages');
select is((select state::text from public.projects where id = pg_temp.fx('p_f')), 'in_progress', 'the project moves to in progress');
select is(public.item_stage_tick(pg_temp.stage('Film', 'Script')), false, 'ticking twice changes nothing');
select is(public.item_stage_tick(pg_temp.stage('Film', 'Shoot')), true, 'another');
select is(public.item_stage_tick(pg_temp.stage('Film', 'Shoot'), false), true, 'unticked');
select is(public.item_stage_tick(pg_temp.stage('Film', 'Shoot'), false), false, 'unticking twice changes nothing');
select is(pg_temp.stages('Film'), 'Grade,Script✓,Shoot,Edit', 'the ticks are on the item''s own rows');
select is((select array_agg(action order by id) from public.activity_log
           where entity = 'project_item_stage_list' and entity_id = pg_temp.item('Film') and action in ('ticked', 'unticked')),
  array['ticked', 'ticked', 'unticked'], 'audited ticked / unticked');
select is((select string_agg(meta ->> 'name', ',' order by id) from public.activity_log
           where entity = 'project_item_stage_list' and entity_id = pg_temp.item('Film') and action in ('ticked', 'unticked', 'update')),
  'Colour,Grade,Script,Shoot,Shoot', 'each entry names its stage in meta (rename, move, ticks; client_work_item_stage_meta)');
select is(public.item_stage_tick(pg_temp.stage('Film', 'Grade')), true, 'a stage about to be removed, ticked');
insert into fx select 'grade', pg_temp.stage('Film', 'Grade');
select lives_ok($$ select public.item_stage_archive(pg_temp.fx('grade')) $$, 'removed from the item');
select is((select (archived_at is not null)::text || ':' || (done_at is not null)::text
           from public.project_item_stage_list where id = pg_temp.fx('grade')), 'true:true',
  'archived, its tick kept (D2)');
select is((select count(*)::integer from public.activity_log
           where entity = 'project_item_stage_list' and entity_id = pg_temp.item('Film') and action = 'archived'), 1, 'audited ''archived''');
select throws_ok($$ select public.item_stage_tick(pg_temp.fx('grade')) $$, 'P0001', 'INVALID_STATE', 'a removed stage takes no tick');
select throws_ok($$ select public.item_stage_archive(pg_temp.fx('grade')) $$, 'P0001', 'INVALID_STATE', 'nor a second removal');
select is(pg_temp.n('owner') + pg_temp.n('admin'), 0::bigint, 'stage edits and ticks notify nobody');

-- 6. Done = approved (D3) -----------------------------------------------------------------------------------
select is(public.item_mark_done(pg_temp.item('Teaser')), 'approved'::public.item_state, 'Mark done approves in one step');
select is((select (done_by = pg_temp.fx('admin'))::text || ':' || (approved_by = pg_temp.fx('admin'))::text || ':'
                  || (approved_at = done_at)::text from public.project_items where id = pg_temp.item('Teaser')),
  'true:true:true', 'done_* and approved_* stamped together, by the Admin (it counts at once)');
select is((select count(*)::integer from public.item_reviews where item_id = pg_temp.item('Teaser')), 0,
  'no separate review row: the done is the approval');
select is((select meta ->> 'approved' from public.activity_log
           where entity = 'project_items' and entity_id = pg_temp.item('Teaser') and action = 'done'), 'true', 'audited ''done'', approved');
select is(pg_temp.n('owner') + pg_temp.n('admin'), 0::bigint, 'and nobody is told');
select throws_ok($$ select public.item_stage_tick(pg_temp.stage('Teaser', 'Script')) $$, 'P0001', 'INVALID_STATE',
  'a done item''s ticks are locked (decision 7)');
select throws_ok($$ select public.item_stage_add(pg_temp.item('Teaser'), 'More') $$, 'P0001', 'INVALID_STATE', 'and its stages');
select is(public.item_update(pg_temp.item('Teaser'), '{"title": "Teaser cut"}'), array['title'],
  'its title is still corrected (Q5)');
select is(public.item_mark_done(pg_temp.item('Fix 1')), 'approved'::public.item_state, 'an item with no stages is simply done (D1)');
select pg_temp.as_member('owner');
select is(public.item_mark_done(pg_temp.item('Menu')), 'approved'::public.item_state, 'the Owner marks done on any client');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_mark_done(pg_temp.item('Film')) $$), 'NOT_FOUND', 'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_mark_done(pg_temp.item('Film')) $$), 'FORBIDDEN', 'Crew: FORBIDDEN');

-- 7. Send back (the Owner) and reopen (the client's Admin) --------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('owner');
select throws_ok($$ select public.item_reopen(pg_temp.item('Teaser cut'), ' ') $$, 'P0001', 'REASON_REQUIRED', 'a send-back needs a reason');
select throws_ok($$ select public.item_reopen(pg_temp.item('Film'), 'x') $$, 'P0001', 'INVALID_STATE', 'only a done item');
select is(public.item_reopen(pg_temp.item('Teaser cut'), 'Wrong music'), 'open'::public.item_state, 'the Owner sends a done item back: open');
select is((select (done_at is null and approved_at is null and approved_by is null)::text || ':' || (reopened_at is not null)::text
           from public.project_items where id = pg_temp.item('Teaser cut')), 'true:true',
  'it no longer counts (done_* and approved_* cleared) and reopened_at is stamped (Q8)');
select is((select reason || ':' || decision::text from public.item_reviews where item_id = pg_temp.item('Teaser cut')),
  'Wrong music:rejected', 'an item_reviews row with the reason');
select is((select action || ':' || (meta ->> 'reason') from public.activity_log
           where entity = 'project_items' and entity_id = pg_temp.item('Teaser cut') order by id desc limit 1),
  'sent_back:Wrong music', 'audited ''sent_back'' with the reason');
select is((pg_temp.last('admin', 'item_rejected')).title, 'Sent back: Teaser cut', 'the client''s Admin is told');
select is((pg_temp.last('admin', 'item_rejected')).body, 'Brand film · Sharma Weddings. Prishit Owner: Wrong music', 'with the reason');
select is((select actionable from public.notification_kinds where kind = 'item_rejected'), true, '(actionable: the email fallback)');
select is(pg_temp.n('owner'), 0::bigint, 'never the actor');
select pg_temp.clear();
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.item('Teaser cut'));
select is(public.item_reopen(pg_temp.item('Teaser cut'), 'Client asked for a change'), 'open'::public.item_state,
  'the client''s Admin reopens a done item of their client');
select is((select action from public.activity_log
           where entity = 'project_items' and entity_id = pg_temp.item('Teaser cut') order by id desc limit 1),
  'reopened', 'audited ''reopened''');
select is((pg_temp.last('owner', 'item_reopened')).title, 'Ravi Admin reopened Teaser cut', 'the Owner is told');
select is((pg_temp.last('owner', 'item_reopened')).body, 'Brand film · Sharma Weddings. Reason: Client asked for a change', 'with the reason');
select is((select (not actionable and not always_email)::text from public.notification_kinds where kind = 'item_reopened'), 'true',
  'for information: in-app and push, never email');
select is(pg_temp.n('admin'), 0::bigint, 'never the actor');
select is(public.item_stage_tick(pg_temp.stage('Teaser cut', 'Shoot')), true, 'open again, its stages take ticks');
select pg_temp.as_member('owner');
select pg_temp.clear();
select public.item_mark_done(pg_temp.item('Own cut'));
select lives_ok($$ select public.item_reopen(pg_temp.item('Own cut'), 'Redo') $$, 'the Owner sends back on his own client (no Admin)');
select is((select count(*)::integer from public.notifications), 0::bigint::integer, 'and nobody is told');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_reopen(pg_temp.item('Fix 1'), 'x') $$), 'NOT_FOUND', 'another Admin: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_reopen(pg_temp.item('Fix 1'), 'x') $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_member('gone_admin');
select is(pg_temp.code($$ select public.item_reopen(pg_temp.item('Fix 1'), 'x') $$), 'UNAUTHENTICATED', 'a deactivated Admin: UNAUTHENTICATED');

-- 8. The item list's stages, new cycles and carry (D2) --------------------------------------------------------
select pg_temp.as_member('admin');
insert into fx select 'bp2', id from public.project_item_blueprints where project_id = pg_temp.fx('p_m') and title = 'Reel 2';
select is(public.project_blueprint_update(pg_temp.fx('bp2'), '{"stages": ["Shoot", "Post"]}'), array['stages'],
  'a line''s own stages are set');
select throws_ok($$ select public.project_blueprint_update(pg_temp.fx('bp2'), '{"stages": "Shoot"}') $$, 'P0001', 'VALIDATION',
  'as a list of names');
select throws_ok($$ select public.project_blueprint_update(pg_temp.fx('bp2'),
  jsonb_build_object('stages', (select jsonb_agg('S' || g) from generate_series(1, 13) g))) $$, 'P0001', 'VALIDATION', 'at most 12');
select is(pg_temp.stages('Reel 2'), 'Script,Edit', 'the current cycle''s item keeps its stages');
select lives_ok($$ select public.project_stage_add(pg_temp.fx('p_m'), 'Caption') $$, 'a default stage added to the project');
select is(pg_temp.stages('Reel 1'), 'Script,Edit', 'existing items never change with the defaults');
select ok(public.project_blueprint_add(pg_temp.fx('p_m'), 'Reel 3') is not null, 'a new line');
select is((select stages from public.project_item_blueprints where project_id = pg_temp.fx('p_m') and title = 'Reel 3'),
  array['Script', 'Edit', 'Caption'], 'starts with the defaults as they are now');
select ok(public.item_add((select cycle_id from public.project_items where id = pg_temp.item('Reel 1')), 'Extra reel') is not null,
  'an item added to the current cycle');
select is(pg_temp.stages('Extra reel'), 'Script,Edit,Caption', 'starts with the defaults too');
select pg_temp.as_system();
select app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p_m')),
  (app.period_start('monthly', app.today_ist()) - interval '1 month')::date, 'schedule', null);
select is((select coalesce(string_agg(s.name, ',' order by s.position collate "C"), '') from public.project_item_stage_list s
           join public.project_items i on i.id = s.item_id join public.project_cycles c on c.id = i.cycle_id
           where i.project_id = pg_temp.fx('p_m') and i.title = 'Reel 2'
             and c.period_start = (app.period_start('monthly', app.today_ist()) - interval '1 month')::date),
  'Shoot,Post', 'a new cycle copies each line''s own stages');
insert into fx select 'old_r2', i.id from public.project_items i join public.project_cycles c on c.id = i.cycle_id
where i.project_id = pg_temp.fx('p_m') and i.title = 'Reel 2'
  and c.period_start = (app.period_start('monthly', app.today_ist()) - interval '1 month')::date;
select pg_temp.as_member('admin');
select public.item_stage_tick((select id from public.project_item_stage_list where item_id = pg_temp.fx('old_r2') and name = 'Shoot'));
select public.item_stage_archive((select id from public.project_item_stage_list where item_id = pg_temp.fx('old_r2') and name = 'Post'));
select public.item_stage_add(pg_temp.fx('old_r2'), 'Voice');
insert into fx select 'carried', ((public.cycle_carry_decide(array[pg_temp.fx('old_r2')], 'carry_forward')) -> 0 ->> 'new_item_id')::uuid;
select is((select string_agg(s.name || case when s.done_at is null then '' else '✓' end, ',' order by s.position collate "C")
           from public.project_item_stage_list s where s.item_id = pg_temp.fx('carried')),
  'Shoot✓,Voice', 'a carried item takes its active stages with their ticks, never a removed one');
select is((select (s.done_at = o.done_at and s.done_by = o.done_by)::text from public.project_item_stage_list s
           join public.project_item_stage_list o on o.item_id = pg_temp.fx('old_r2') and o.name = s.name
           where s.item_id = pg_temp.fx('carried') and s.name = 'Shoot'), 'true', 'the tick''s original time and person');
-- A reopened item of an ended cycle joins the carry list (decision 11).
select pg_temp.as_system();
insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id)
select org_id, project_id, cycle_id, 'Late reel', 'z9', cycle_id from public.project_items where id = pg_temp.fx('old_r2');
select pg_temp.as_member('admin');
select public.item_mark_done(i.id) from public.project_items i
where i.cycle_id = (select cycle_id from public.project_items where id = pg_temp.fx('old_r2')) and i.state = 'open'
  and i.title <> 'Late reel';
select public.item_mark_done(pg_temp.item('Late reel'));
select is((select c.state::text from public.project_cycles c join public.project_items i on i.cycle_id = c.id
           where i.id = pg_temp.item('Late reel')), 'settled', 'done, the ended cycle settles');
select public.item_reopen(pg_temp.item('Late reel'), 'Not finished');
select is((select c.state::text || ':' || i.state::text from public.project_cycles c join public.project_items i on i.cycle_id = c.id
           where i.id = pg_temp.item('Late reel')), 'open:open', 'reopened: open again, its cycle too, back in the carry decision');

-- 9. project_reopen reads the items' own ticks (decision 14) ------------------------------------------------
select pg_temp.as_member('owner');
select lives_ok($$ select public.project_cancel(pg_temp.fx('p_b'), 'Paused') $$, 'a project whose only work was ticks and a done item');
select pg_temp.as_member('admin2');
select is(public.project_reopen(pg_temp.fx('p_b'), 'Back'), 'in_progress'::public.project_state,
  'reopens in progress (something was done)');
select pg_temp.as_member('admin');
select lives_ok($$ select public.project_cancel(pg_temp.fx('p_n'), 'Dropped') $$, 'a project cancelled');
select throws_ok($$ select public.item_reopen(pg_temp.item('Fix 1'), 'x') $$, 'P0001', 'INVALID_STATE',
  'a cancelled project is read-only: no send-back there before a reopen (decision 14)');

-- 10. The activity panel's reads ---------------------------------------------------------------------------
select pg_temp.as_member('admin');
select ok((select count(*) from public.project_activity(pg_temp.fx('p_f'))) between 1 and 20, 'the Admin reads a page of the project''s history');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f')) a where a.action = 'initial'), 0,
  'an item''s starting stages are not lines');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'), 'items') a where a.entity <> 'project_items'), 0,
  'Items: item entries only');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'), 'stages') a
           where a.entity not in ('project_stages', 'project_item_stage_list', 'project_item_stages')), 0, 'Stages: stage entries only');
select ok((select count(*) from public.project_activity(pg_temp.fx('p_f'), 'stages')) > 0, 'and there are some');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'), 'project') a
           where a.entity not in ('projects', 'project_cycles', 'project_item_blueprints')), 0, 'Project: the project''s own');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'), 'all', pg_temp.item('Film')) a
           where a.entity_id <> pg_temp.item('Film')), 0, 'one item''s history only');
create temporary table page1 as select * from public.project_activity(pg_temp.fx('p_f'), 'all', null, null, null, 3);
select is((select count(*)::integer from page1), 3, 'a page of 3');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'), 'all', null,
             (select at from page1 order by at, id limit 1), (select id from page1 order by at, id limit 1), 100) a
           where a.id in (select id from page1)), 0, 'the next page starts after the cursor: no entry twice');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'), 'all', null, null, null, 100) a
           where a.action = 'update' and not (a.diff -> 'new') ?| array['title', 'notes', 'planned_date', 'custom_fields', 'position',
             'name', 'description', 'delivery_date', 'stages']), 0, 'no update of internal keys only');
select throws_ok($$ select * from public.project_activity(pg_temp.fx('p_f'), 'tasks') $$, 'P0001', 'VALIDATION', 'an unknown kind is refused');
select throws_ok($$ select * from public.project_activity(pg_temp.fx('p_f'), 'all', null, now(), null) $$, 'P0001', 'VALIDATION',
  'half a cursor is refused');
select is((select count(*)::integer from public.item_last_changes(array[pg_temp.item('Film'), pg_temp.item('Teaser cut')])), 2,
  'the latest entry of each item');
select is((select action from public.item_last_changes(array[pg_temp.item('Teaser cut')])), 'ticked', 'the newest one');
select pg_temp.as_member('owner');
select ok((select count(*) from public.project_activity(pg_temp.fx('p_f'))) > 0, 'the Owner reads it');
select pg_temp.as_member('admin2');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'))), 0, 'another Admin reads nothing');
select is((select count(*)::integer from public.item_last_changes(array[pg_temp.item('Film')])), 0, 'nor an item''s last change');
select pg_temp.as_member('staff');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('p_f'))), 0, 'Crew read nothing');
select pg_temp.as_anon();
select throws_ok($$ select * from public.project_activity(pg_temp.fx('p_f')) $$, '42501', null, 'anon cannot call it');

select * from finish();
rollback;
