-- 7A (7.2) The nightly cycle job, app.cycle_generate() (WORKFLOWS §8, kickoff 7 decision 2): the
-- current IST period's cycle for every recurring open or in-progress project of an Active client
-- that lacks one (generated_by schedule, the item list copied in), nothing for a Paused, Draft or
-- Inactive client, a completed project or a one-time one; idempotent; a cycle a manual start made
-- is kept; a client resumed mid-period is caught up; one combined cycle_generated row per Admin per
-- run, with no actor; the schedule. Dates are computed from app.today_ist() and the run's instant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

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
  ('owner',      '00000000-0000-4000-8000-000000006901'),
  ('admin',      '00000000-0000-4000-8000-000000006902'),
  ('admin2',     '00000000-0000-4000-8000-000000006903'),
  ('staff',      '00000000-0000-4000-8000-000000006904'),
  ('gone_admin', '00000000-0000-4000-8000-000000006905'),
  ('client_a',   '00000000-0000-4000-8000-0000000069a1'),
  ('client_b',   '00000000-0000-4000-8000-0000000069b1'),
  ('client_p',   '00000000-0000-4000-8000-0000000069c1'),
  ('client_x',   '00000000-0000-4000-8000-0000000069d1'),
  ('client_d',   '00000000-0000-4000-8000-0000000069e1');
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
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'),  pg_temp.fx('org'), 'Prishit Owner', 'owner@example.com',  'owner', 'active', now()),
  (pg_temp.fx('admin'),  pg_temp.fx('org'), 'Ravi Admin',    'admin@example.com',  'admin', 'active', now()),
  (pg_temp.fx('admin2'), pg_temp.fx('org'), 'Other Admin',   'admin2@example.com', 'admin', 'active', now());
-- Every client starts Paused, so the projects are created without a cycle; the test activates them.
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'paused', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery',     'paused', pg_temp.fx('admin2'), now()),
  (pg_temp.fx('client_p'), pg_temp.fx('org'), 'Paused Studio',   'paused', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_x'), pg_temp.fx('org'), 'Closing Co',      'paused', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_d'), pg_temp.fx('org'), 'Draft Diner',     'draft',  null,                 null);
delete from public.activity_log;

select pg_temp.as_member('owner');
insert into fx values
  ('pm1', public.project_create(pg_temp.fx('client_a'), 'Monthly reels', 'monthly', null, null, array['Edit'], array['Reel 1', 'Reel 2'])),
  ('pm2', public.project_create(pg_temp.fx('client_a'), 'Monthly blog', 'monthly', null, null, '{}', array['Post'])),
  ('pw',  public.project_create(pg_temp.fx('client_a'), 'Weekly stories', 'weekly', null, null, '{}', array['Story'])),
  ('pc',  public.project_create(pg_temp.fx('client_a'), 'Finished retainer', 'monthly', null, null, '{}', array['Old'])),
  ('po',  public.project_create(pg_temp.fx('client_a'), 'Launch film', 'one_time', null, app.today_ist() + 10, '{}', array['Film'])),
  ('pb',  public.project_create(pg_temp.fx('client_b'), 'Bakery menu', 'monthly', null, null, '{}', array['Menu'])),
  ('pp',  public.project_create(pg_temp.fx('client_p'), 'Paused retainer', 'monthly', null, null, '{}', array['Story'])),
  ('px',  public.project_create(pg_temp.fx('client_x'), 'Closed retainer', 'monthly', null, null, '{}', array['Video'])),
  ('pd',  public.project_create(pg_temp.fx('client_d'), 'Draft retainer', 'weekly', null, null, '{}', array['Item']));
select public.project_complete(pg_temp.fx('pc'));
select public.client_activate(pg_temp.fx('client_a'));
select public.client_activate(pg_temp.fx('client_b'));
select public.client_close(pg_temp.fx('client_x'), null);
select pg_temp.as_system();
select pg_temp.clear();

-- The schedule ----------------------------------------------------------------------------------------
select is((select schedule || ' ' || command from cron.job where jobname = 'cycle_generate'),
  '30 18 * * * select app.cycle_generate()', 'cycle_generate runs at 00:00 IST (18:30 UTC) every night');
select ok(not has_function_privilege('authenticated', 'app.cycle_generate(timestamptz)', 'execute')
          and has_function_privilege('service_role', 'app.cycle_generate(timestamptz)', 'execute'),
  'the job is service_role only');
select is((select count(*)::integer from public.project_cycles where project_id in
            (pg_temp.fx('pm1'), pg_temp.fx('pm2'), pg_temp.fx('pw'), pg_temp.fx('pb'))), 0,
  'the recurring projects of the resumed clients have no cycle yet');

-- The first run: the current periods ---------------------------------------------------------------
select is(app.cycle_generate(now()), 4, 'the run creates the four missing current cycles (catch-up and resumed clients)');
select is((select string_agg(p.name || '=' || c.generated_by || '/' || c.period_start::text || '/' || (c.created_by is null)::text, ', ' order by p.name)
           from public.project_cycles c join public.projects p on p.id = c.project_id
           where p.id in (pg_temp.fx('pm1'), pg_temp.fx('pm2'), pg_temp.fx('pw'), pg_temp.fx('pb'))),
  'Bakery menu=schedule/' || app.period_start('monthly', app.today_ist()) || '/true, '
  || 'Monthly blog=schedule/' || app.period_start('monthly', app.today_ist()) || '/true, '
  || 'Monthly reels=schedule/' || app.period_start('monthly', app.today_ist()) || '/true, '
  || 'Weekly stories=schedule/' || app.period_start('weekly', app.today_ist()) || '/true',
  'each the current IST period''s, generated by the schedule, no author');
select is((select array_agg(i.title order by i.position collate "C") from public.project_items i where i.project_id = pg_temp.fx('pm1')),
  array['Reel 1', 'Reel 2'], 'the item list copied in');
select is((select count(*)::integer from public.project_cycles where project_id in (pg_temp.fx('pp'), pg_temp.fx('px'), pg_temp.fx('pd'))), 0,
  'nothing for a Paused, an Inactive or a Draft client (decision 1)');
select is((select count(*)::integer from public.project_cycles where project_id = pg_temp.fx('pc')), 0, 'nor for a completed project');
select is((select count(*)::integer from public.project_cycles where project_id = pg_temp.fx('po')), 1,
  'a one-time project keeps its single cycle');
select is(pg_temp.n('admin', 'cycle_generated'), 1::bigint, 'one combined row for the Admin of three projects');
select is((pg_temp.last('admin', 'cycle_generated')).title, 'New cycles are ready for 3 projects',
  'naming the count (a month and a week: two labels)');
select is((pg_temp.last('admin', 'cycle_generated')).body,
  'Monthly blog (Sharma Weddings), Monthly reels (Sharma Weddings), Weekly stories (Sharma Weddings). Rename this period''s items where needed.',
  'listing the projects');
select is((pg_temp.last('admin', 'cycle_generated')).link, '/today', 'opening Today');
select ok((pg_temp.last('admin', 'cycle_generated')).actor_id is null, 'no actor (the job)');
select is((pg_temp.last('admin2', 'cycle_generated')).title,
  app.cycle_label('monthly', app.period_start('monthly', app.today_ist())) || ' is ready: Bakery menu (Blue Bakery)',
  'one project: its label and name');
select is((pg_temp.last('admin2', 'cycle_generated')).link,
  '/clients/' || pg_temp.fx('client_b') || '/projects/' || pg_temp.fx('pb'), 'opening it');
select is(pg_temp.n('owner') + pg_temp.n('admin2') + pg_temp.n('admin'), 2::bigint, 'the Owner is not told');

-- Idempotent --------------------------------------------------------------------------------------------
select is(app.cycle_generate(now()), 0, 'a second run creates nothing');
select is(pg_temp.total(), 2::bigint, 'and tells nobody again');
select is(app.cycle_generate(now() - interval '1 minute'), 0, 'an early re-run neither');

-- A manual start is kept; the next period comes on its night ---------------------------------------
select pg_temp.as_member('admin');
select public.cycle_start_next(pg_temp.fx('pw'));
select pg_temp.as_system();
select pg_temp.clear();
create temporary table nxt as
select app.period_next('weekly', app.period_start('weekly', app.today_ist())) as monday,
       app.period_next('monthly', app.period_start('monthly', app.today_ist())) as first;
select is(app.cycle_generate(((select monday from nxt)::timestamp + time '00:00') at time zone 'Asia/Kolkata'),
  case when (select monday from nxt) >= (select first from nxt) then 3 else 0 end,
  'next Monday''s run finds the week a manual start made, and makes the month only once it has begun');
select is((select count(*)::integer || ':' || min(generated_by) from public.project_cycles
           where project_id = pg_temp.fx('pw') and period_start = (select monday from nxt)), '1:manual',
  'the manual cycle is kept, never doubled');
select is(app.cycle_generate(((select first from nxt)::timestamp + time '00:00') at time zone 'Asia/Kolkata'),
  case when (select monday from nxt) >= (select first from nxt) then 0 else 3 end
  + case when app.period_start('weekly', (select first from nxt)) > (select monday from nxt) then 1 else 0 end,
  'the 1st''s run makes the three new months (and the week, when the 1st starts a later one)');
select is((select count(*)::integer from public.project_cycles where period_start = (select first from nxt)), 3,
  'every Active monthly project has next month''s cycle');
select is((select state::text from public.project_cycles where project_id = pg_temp.fx('pm2')
           and period_start = app.period_start('monthly', app.today_ist())), 'open',
  'the month before stays open while its items are open');

-- A client resumed mid-period is caught up ----------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.client_activate(pg_temp.fx('client_p'));
select pg_temp.as_system();
-- A project that fails is skipped in its own savepoint and made the next night.
create function public.test_fail_cycle() returns trigger language plpgsql as $f$
begin
  if new.project_id = (select id from fx where key = 'pp') then
    raise exception 'test failure';
  end if;
  return new;
end;
$f$;
create trigger test_fail_cycle before insert on public.project_cycles
  for each row execute function public.test_fail_cycle();
select lives_ok($$ select app.cycle_generate(now()) $$, 'a project whose cycle fails does not stop the run');
select is((select count(*)::integer from public.project_cycles where project_id = pg_temp.fx('pp')), 0,
  'it is skipped (logged as a warning)');
drop trigger test_fail_cycle on public.project_cycles;
select is(app.cycle_generate(now()), 1, 'the night after a client is resumed, its current period''s cycle is made');
select is((select count(*)::integer from public.project_cycles where project_id = pg_temp.fx('pp')
           and period_start = app.period_start('monthly', app.today_ist())), 1, 'for the current period only');
select is((pg_temp.last('admin', 'cycle_generated')).title,
  app.cycle_label('monthly', app.period_start('monthly', app.today_ist())) || ' is ready: Paused retainer (Paused Studio)',
  'and its Admin is told');

select * from finish();
rollback;
