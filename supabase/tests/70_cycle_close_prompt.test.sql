-- 7A (7.2) The unfinished-items prompt, app.cycle_close_prompt() (WORKFLOWS §8 / §9; issue #56 Q2,
-- owner 2026-10-08): the client's Admin only (never the Owner), one items_to_decide row per Admin per
-- run, listing the ended cycles with undecided open items once (prompted_at) and the items left
-- pending again; done, carried and closed items never counted; current cycles never; idempotent; the
-- schedule. Dates are computed from app.today_ist().
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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
  ('owner',      '00000000-0000-4000-8000-000000007001'),
  ('admin',      '00000000-0000-4000-8000-000000007002'),
  ('admin2',     '00000000-0000-4000-8000-000000007003'),
  ('staff',      '00000000-0000-4000-8000-000000007004'),
  ('gone_admin', '00000000-0000-4000-8000-000000007005'),
  ('client_a',   '00000000-0000-4000-8000-0000000070a1'),
  ('client_b',   '00000000-0000-4000-8000-0000000070b1'),
  ('client_p',   '00000000-0000-4000-8000-0000000070c1'),
  ('client_x',   '00000000-0000-4000-8000-0000000070d1'),
  ('client_d',   '00000000-0000-4000-8000-0000000070e1');
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
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery',     'active', pg_temp.fx('admin2'), now());
delete from public.activity_log;

select pg_temp.as_member('owner');
insert into fx values
  ('pm', public.project_create(pg_temp.fx('client_a'), 'Monthly reels', 'monthly', null, null, '{}', array['Reel 1', 'Reel 2'])),
  ('pw', public.project_create(pg_temp.fx('client_a'), 'Weekly stories', 'weekly', null, null, '{}', array['Story'])),
  ('pb', public.project_create(pg_temp.fx('client_b'), 'Bakery menu', 'monthly', null, null, '{}', array['Menu']));
select pg_temp.as_system();
create temporary table d as
select (app.period_start('monthly', app.today_ist()) - interval '1 month')::date as last_month,
       (app.period_start('monthly', app.today_ist()) - interval '2 month')::date as two_months,
       app.period_start('weekly', app.today_ist()) - 14 as two_weeks;
grant select on d to authenticated;
select app.cycle_create(pg_temp.project('pm'), (select last_month from d), 'schedule', null);
select app.cycle_create(pg_temp.project('pw'), (select two_weeks from d), 'schedule', null);
select app.cycle_create(pg_temp.project('pb'), (select last_month from d), 'schedule', null);
insert into fx select 'pm_old', id from public.project_cycles where project_id = pg_temp.fx('pm') and period_start = (select last_month from d);
insert into fx select 'pw_old', id from public.project_cycles where project_id = pg_temp.fx('pw') and period_start = (select two_weeks from d);
insert into fx select 'pb_old', id from public.project_cycles where project_id = pg_temp.fx('pb') and period_start = (select last_month from d);
select pg_temp.as_member('admin');
select public.item_mark_done((select id from public.project_items where cycle_id = pg_temp.fx('pm_old') and title = 'Reel 2'));
select pg_temp.as_system();
select pg_temp.clear();
delete from public.activity_log;

-- The schedule and the rule -------------------------------------------------------------------------
select is((select schedule || ' ' || command from cron.job where jobname = 'cycle_close_prompt'),
  '35 18 * * * select app.cycle_close_prompt()', 'cycle_close_prompt runs at 00:05 IST (18:35 UTC), after cycle_generate');
select ok(not has_function_privilege('authenticated', 'app.cycle_close_prompt(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'app.cycle_close_prompt_recipient(public.clients)', 'execute'),
  'the job and its recipient rule are service_role only');
select is(app.cycle_close_prompt_recipient((select c from public.clients c where c.id = pg_temp.fx('client_a'))), pg_temp.fx('admin'),
  'the recipient is the client''s Admin (issue #56 Q2)');
select ok((select actionable and not always_email and in_app from public.notification_kinds where kind = 'items_to_decide'),
  'items_to_decide is actionable: the email fallback, never always');

-- The first run ------------------------------------------------------------------------------------------
select is(app.cycle_close_prompt(now()), 2, 'one prompt per Admin with ended cycles to decide');
select is(pg_temp.n('owner'), 0::bigint, 'the Owner gets no prompt (issue #56 Q2)');
select is(pg_temp.n('admin', 'items_to_decide'), 1::bigint, 'one row for the Admin of two projects');
select is((pg_temp.last('admin', 'items_to_decide')).title, '2 unfinished items to decide',
  'the open items only: the done one waits for approval (decision 11)');
select is((pg_temp.last('admin', 'items_to_decide')).body,
  'Monthly reels (Sharma Weddings) · ' || app.cycle_label('monthly', (select last_month from d)) || ': 1; '
  || 'Weekly stories (Sharma Weddings) · ' || app.cycle_label('weekly', (select two_weeks from d)) || ': 1.',
  'listing each project and cycle with its count');
select is((pg_temp.last('admin', 'items_to_decide')).link, '/today', 'several projects: Today (Needs you)');
select ok((pg_temp.last('admin', 'items_to_decide')).actor_id is null, 'no actor (the job)');
select is((pg_temp.last('admin2', 'items_to_decide')).title, '1 unfinished item to decide', 'the other Admin, their own client only');
select is((pg_temp.last('admin2', 'items_to_decide')).link,
  '/clients/' || pg_temp.fx('client_b') || '/projects/' || pg_temp.fx('pb'), 'one project: its page');
select is((select count(*)::integer from public.project_cycles where prompted_at is not null), 3,
  'the three ended cycles are marked prompted');
select is((select count(*)::integer from public.project_cycles where prompted_at is null
           and period_start in (app.period_start('monthly', app.today_ist()), app.period_start('weekly', app.today_ist()))), 3,
  'the current cycles are never prompted');
select is((select count(*)::integer from public.activity_log where entity = 'project_cycles' and action = 'prompted'), 3,
  'audited ''prompted''');

-- Idempotent; pending items listed again; decided items gone ---------------------------------------------
select is(app.cycle_close_prompt(now()), 0, 'a re-run announces nothing new');
select pg_temp.as_member('admin');
select public.cycle_carry_decide(array(select id from public.project_items where cycle_id = pg_temp.fx('pw_old')), 'leave_pending');
select public.cycle_carry_decide(array(select id from public.project_items where cycle_id = pg_temp.fx('pm_old') and state = 'open'), 'carry_forward');
select pg_temp.as_system();
select is(app.cycle_close_prompt(now()), 0, 'decisions alone prompt nobody');
select pg_temp.clear();
-- A further cycle ends (made here two months back, as if a missed one): the next prompt lists it and,
-- again, the pending item.
select app.cycle_create(pg_temp.project('pm'), (select two_months from d), 'schedule', null);
select is(app.cycle_close_prompt(now()), 1, 'a newly ended cycle prompts its Admin');
select is((pg_temp.last('admin', 'items_to_decide')).title, '3 unfinished items to decide',
  'its two items and the one left pending; the carried item no longer counts');
select ok((pg_temp.last('admin', 'items_to_decide')).body like '%Weekly stories (Sharma Weddings)%: 1%'
          and (pg_temp.last('admin', 'items_to_decide')).body like '%. 1 left pending, listed again.',
  'the pending item is listed again');
select is(pg_temp.n('admin2'), 0::bigint, 'the other Admin, with nothing new, is not prompted again');
select is(app.cycle_close_prompt(now()), 0, 'and the run after that is quiet');
select pg_temp.as_member('owner');
select public.project_cancel(pg_temp.fx('pb'), 'Stopped');
select pg_temp.as_system();
select is((select count(*)::integer from public.project_items i join public.project_cycles c on c.id = i.cycle_id
           where c.project_id = pg_temp.fx('pb') and i.state = 'open'), 0, 'a cancelled project has nothing left to decide');

select * from finish();
rollback;
