-- v3.5 "Month close", U6 (migration v35_month_reminder; WORKFLOWS §7.3, decision 19, v3.5 Q8 and Q9): the
-- reminder. app.month_close_reminder, app.month_close_reminder_line, public.month_close_reminder() and the
-- weekly digest's one key and one line, at explicit instants (app.test_now and the digest's p_now).
--   0. the functions: who may execute, definer and search_path;
--   1. the words: the month only, the count, the year only when it is not today's, no amount;
--   2. from the 6th IST, not on the 5th (and the boundary second); only months from the first priced month on;
--      oldest first and the count; a closed month leaves it, the next comes up; nothing when all are closed;
--   3. who reads it: the Owner only (Admin, Crew, a freelancer, a deactivated member, no sign-in, anon refused);
--      another organization's Owner sees their own (nothing priced: none);
--   4. the weekly digest: the payload's month_close and the body's last "Now" line, Owner only; a week whose
--      only content is this line sends nothing (digest_weekly_zero unchanged); with anything else it sends,
--      and the body and payload hold no amount.
-- Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);


delete from public.month_snapshots;

delete from public.deliverable_templates;
delete from public.item_reviews;
delete from public.project_item_stage_list;
delete from public.project_item_stages;
delete from public.revenue_overrides;
delete from public.project_advances;
delete from public.item_billing;
delete from public.cycle_billing;
delete from public.project_billing;
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
create function pg_temp.keys(j jsonb) returns text[] language sql immutable as $$
  select array_agg(k order by k) from jsonb_object_keys(j) k;
$$;
delete from public.holidays;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000167901'),
  ('admin',    '00000000-0000-4000-8000-000000167902'),
  ('staff',    '00000000-0000-4000-8000-000000167903'),
  ('free',     '00000000-0000-4000-8000-000000167904'),
  ('gone',     '00000000-0000-4000-8000-000000167905'),
  ('org_b',    '00000000-0000-4000-8000-000000167910'),
  ('b_owner',  '00000000-0000-4000-8000-000000167911'),
  ('client',   '00000000-0000-4000-8000-0000001679c1');
insert into fx select 'org', id from public.organizations limit 1;
grant select, insert on fx to authenticated, anon, service_role;

-- The months, from the real IST date: this month (m0) and four before it.
create temporary table mo (key text primary key, d date not null);
insert into mo values ('m0', app.month_start(app.today_ist()));
insert into mo values ('m1', app.month_start((select d from mo where key = 'm0') - 1));
insert into mo values ('m2', app.month_start((select d from mo where key = 'm1') - 1));
insert into mo values ('m3', app.month_start((select d from mo where key = 'm2') - 1));
insert into mo values ('m4', app.month_start((select d from mo where key = 'm3') - 1));
grant select on mo to authenticated, anon, service_role;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;
create function pg_temp.mo(k text) returns date language sql stable as $$
  select d from mo where key = k;
$$;
-- An instant: day `n` (1-based) of this month at an IST time.
create function pg_temp.at(n int, t text) returns timestamptz language sql stable as $$
  select ((pg_temp.mo('m0') + (n - 1))::text || ' ' || t || '+05:30')::timestamptz;
$$;
create function pg_temp.now_at(n int, t text) returns void language sql as $$
  select set_config('app.test_now', pg_temp.at(n, t)::text, true);
$$;
-- The month's word as the reminder says it on day 6 of this month (the year only when it is not today's).
create function pg_temp.word(k text) returns text language sql stable as $$
  select to_char(pg_temp.mo(k), 'FMMonth')
    || case when extract(year from pg_temp.mo(k)) <> extract(year from pg_temp.mo('m0') + 5)
            then to_char(pg_temp.mo(k), ' YYYY') else '' end;
$$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.as_owner_inside(k text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
end;
$$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
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
create function pg_temp.err(sql text) returns text language plpgsql as $$
declare
  v_detail text;
begin
  execute sql;
  return 'ok';
exception
  when sqlstate 'P0001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return sqlerrm || coalesce(': ' || nullif(v_detail, ''), '');
  when insufficient_privilege then return 'NO_PRIVILEGE';
end;
$$;
-- The Owner's reminder now (as the Owner; the caller's role is restored by the next as_*).
create function pg_temp.reminder() returns jsonb language sql as $$
  select public.month_close_reminder();
$$;

-- People: org A (the seed's organization) and org B.
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Other org 167');
insert into auth.users (id, email)
select id, key || '-167@example.com' from fx where key in ('owner', 'admin', 'staff', 'free', 'gone', 'b_owner');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),   pg_temp.fx('org'),   'Test Owner',  'owner-167@example.com',   'owner', 'active',      'permanent', now() - interval '200 days', null),
  (pg_temp.fx('admin'),   pg_temp.fx('org'),   'Test Admin',  'admin-167@example.com',   'admin', 'active',      'permanent', now(), null),
  (pg_temp.fx('staff'),   pg_temp.fx('org'),   'Test Crew',   'staff-167@example.com',   'staff', 'active',      'permanent', now() - interval '200 days', null),
  (pg_temp.fx('free'),    pg_temp.fx('org'),   'Test Free',   null,                      'staff', 'active',      'freelance', now(), null),
  (pg_temp.fx('gone'),    pg_temp.fx('org'),   'Test Gone',   'gone-167@example.com',    'admin', 'deactivated', 'permanent', now() - interval '9 days', now()),
  (pg_temp.fx('b_owner'), pg_temp.fx('org_b'), 'Other Owner', 'b_owner-167@example.com', 'owner', 'active',      'permanent', now(), null);
select pg_temp.as_owner_inside('owner');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Client 167', 'active', pg_temp.fx('admin'), now());

-- Org A's money: a monthly retainer with no deliverables (so the digest has no client work to count), its
-- cycles of m1..m4; m3 priced at 7,777 and m1 at 8,888, m2 and m4 with no amount. So the first priced month
-- is m3: m4 is before it, m2 is after it (in the reminder though unpriced).
select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client'), 'Monthly 167', 'monthly', null, null,
  array['Stage 1'], array[]::text[]));
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('p'), 9000, true, null);
select pg_temp.as_system();
insert into fx select 'c' || k, (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  pg_temp.mo('m' || k), 'schedule', null, true)).id
from generate_series(1, 4) k;
select pg_temp.as_member('owner');
select public.billing_set_cycle_amount(pg_temp.fx('c3'), 7777);
select public.billing_set_cycle_amount(pg_temp.fx('c1'), 8888);
select pg_temp.as_system();

-- The digest's days: a saved (empty) report for each of the seven days before day 6, and the digest day.
insert into public.eod_reports (org_id, report_date, data)
select pg_temp.fx('org'), pg_temp.mo('m0') + 5 - k, '{}'::jsonb from generate_series(1, 7) k;
update public.org_settings set weekly_digest_day = extract(dow from pg_temp.mo('m0') + 5)::int
where org_id = pg_temp.fx('org');

-- ===========================================================================================================
-- 0. The functions
-- ===========================================================================================================
select has_function('public', 'month_close_reminder', array[]::text[], 'month_close_reminder() exists');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] and p.prorettype = 'jsonb'::regtype
           from pg_proc p where p.oid = 'public.month_close_reminder()'::regprocedure),
  'month_close_reminder: security definer, empty search_path, returns jsonb');
select ok(has_function_privilege('authenticated', 'public.month_close_reminder()', 'execute')
          and not has_function_privilege('anon', 'public.month_close_reminder()', 'execute'),
  'month_close_reminder: authenticated may call it, anon may not');
select ok(not has_function_privilege('authenticated', 'app.month_close_reminder(uuid, date)', 'execute')
          and not has_function_privilege('anon', 'app.month_close_reminder(uuid, date)', 'execute')
          and not has_function_privilege('authenticated', 'app.month_close_reminder_line(date, integer, date)', 'execute')
          and not has_function_privilege('anon', 'app.month_close_reminder_line(date, integer, date)', 'execute'),
  'the two helpers: never authenticated or anon');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('app.month_close_reminder(uuid, date)'::regprocedure,
                           'app.month_close_reminder_line(date, integer, date)'::regprocedure,
                           'app.digest_weekly_payload(uuid, timestamptz)'::regprocedure,
                           'app.digest_weekly_text(jsonb)'::regprocedure)),
  'the helpers and the re-created digest functions keep an empty search_path');
select ok(not has_function_privilege('authenticated', 'app.digest_weekly_payload(uuid, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'app.digest_weekly_text(jsonb)', 'execute'),
  'the re-created digest functions keep their grants (never authenticated)');

-- ===========================================================================================================
-- 1. The words
-- ===========================================================================================================
select is(app.month_close_reminder_line('2026-09-01', 0, '2026-10-06'), 'September isn''t closed yet',
  'one month: "September isn''t closed yet"');
select is(app.month_close_reminder_line('2026-09-01', 1, '2026-11-06'), 'September and 1 more month aren''t closed yet',
  'two months: "September and 1 more month aren''t closed yet"');
select is(app.month_close_reminder_line('2026-09-01', 3, '2027-01-06'), 'September 2026 and 3 more months aren''t closed yet',
  'another year: the year is named, and "months"');
select is(app.month_close_reminder_line('2026-12-01', 0, '2027-01-06'), 'December 2026 isn''t closed yet',
  'December in January: "December 2026 isn''t closed yet"');

-- ===========================================================================================================
-- 2. When and which months
-- ===========================================================================================================
select pg_temp.as_member('owner');
select pg_temp.now_at(5, '12:00:00');
select is(pg_temp.reminder(), jsonb_build_object('month', pg_temp.mo('m3'), 'more', 1),
  'the 5th: m3 (the first priced month) and m2; last month (m1) is not due yet');
select pg_temp.now_at(5, '23:59:59');
select is((pg_temp.reminder() ->> 'more')::int, 1, 'the 5th at 23:59:59 IST: still not last month');
select pg_temp.now_at(6, '00:00:00');
select is(pg_temp.reminder(), jsonb_build_object('month', pg_temp.mo('m3'), 'more', 2),
  'the 6th at 00:00 IST: last month joins (m3 and 2 more)');
select ok(pg_temp.reminder() ->> 'month' <> pg_temp.mo('m4')::text,
  'm4 (before the first priced month, a cycle with no amount) is never named');
select is(pg_temp.keys(pg_temp.reminder()), array['month', 'more'],
  'the answer holds the month and the count only');
select pg_temp.now_at(20, '09:00:00');
select is(pg_temp.reminder(), jsonb_build_object('month', pg_temp.mo('m3'), 'more', 2),
  'any later day of the month: the same');

-- Close the oldest: the next comes up.
select pg_temp.now_at(6, '10:00:00');
select is(public.month_close(pg_temp.mo('m3')), 1, 'the Owner closes m3');
select is(pg_temp.reminder(), jsonb_build_object('month', pg_temp.mo('m2'), 'more', 1),
  'm3 closed: m2 is the oldest, 1 more');
select pg_temp.now_at(5, '10:00:00');
select is(pg_temp.reminder(), jsonb_build_object('month', pg_temp.mo('m2'), 'more', 0),
  'on the 5th with m3 closed: m2 alone (last month not due yet)');

-- ===========================================================================================================
-- 3. Who reads it
-- ===========================================================================================================
select pg_temp.as_member('admin');
select is(pg_temp.err('select public.month_close_reminder()'), 'FORBIDDEN: Only the Owner sees which months are closed.', 'the client''s Admin is refused');
select pg_temp.as_member('staff');
select is(pg_temp.err('select public.month_close_reminder()'), 'FORBIDDEN: Only the Owner sees which months are closed.', 'Crew are refused');
select pg_temp.as_member('free');
select is(pg_temp.err('select public.month_close_reminder()'), 'FORBIDDEN: Only the Owner sees which months are closed.', 'a freelancer is refused');
select pg_temp.as_member('gone');
select is(pg_temp.err('select public.month_close_reminder()'), 'FORBIDDEN: Only the Owner sees which months are closed.', 'a deactivated member is refused');
select pg_temp.as_nobody();
select is(pg_temp.err('select public.month_close_reminder()'), 'FORBIDDEN: Only the Owner sees which months are closed.', 'no sign-in is refused');
select pg_temp.as_anon();
select is(pg_temp.err('select public.month_close_reminder()'), 'NO_PRIVILEGE', 'anon cannot call it');
select pg_temp.as_member('b_owner');
select is(pg_temp.reminder(), null::jsonb, 'another organization''s Owner: nothing priced there, no reminder (org A''s months never leak)');

-- ===========================================================================================================
-- 4. The weekly digest (day 6 is the digest day; m3 is closed, so m2 and m1 are open)
-- ===========================================================================================================
select pg_temp.as_system();
select set_config('app.test_now', '', true);
select is(app.digest_weekly_payload(pg_temp.fx('org'), pg_temp.at(6, '08:30:00')) -> 'month_close',
  jsonb_build_object('month', pg_temp.mo('m2'), 'more', 1), 'the payload''s month_close: m2 and 1 more');
select is(app.digest_weekly_payload(pg_temp.fx('org'), pg_temp.at(5, '08:30:00')) -> 'month_close',
  jsonb_build_object('month', pg_temp.mo('m2'), 'more', 0), 'the payload on the 5th: m2 alone');
select ok(app.digest_weekly_zero(app.digest_weekly_payload(pg_temp.fx('org'), pg_temp.at(6, '08:30:00'))),
  'a week with only the reminder still counts as nothing to say (digest_weekly_zero unchanged)');
select is(public.digest_weekly(pg_temp.at(6, '08:30:00')), 0, 'only the reminder: no digest is sent');
select is((select count(*) from public.notifications where kind = 'owner_digest_weekly'), 0::bigint,
  'and no digest row is written');

-- Something else to say (a holiday in the week ahead): it is sent, the reminder last under Now.
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), pg_temp.mo('m0') + 6, 'Holiday 167');
select is(public.digest_weekly(pg_temp.at(6, '08:30:00')), 1, 'with a holiday ahead: one digest is sent');
select is((select count(*) from public.notifications where kind = 'owner_digest_weekly'), 1::bigint, 'one digest row');
select is((select recipient_id from public.notifications where kind = 'owner_digest_weekly'), pg_temp.fx('owner'),
  'to the Owner');
select is((select payload -> 'month_close' from public.notifications where kind = 'owner_digest_weekly'),
  jsonb_build_object('month', pg_temp.mo('m2'), 'more', 1), 'the row''s payload carries the month and the count');
select ok((select position(E'Now\n' || pg_temp.word('m2') || ' and 1 more month aren''t closed yet' in body) > 0
           from public.notifications where kind = 'owner_digest_weekly'),
  'the body: "‹m2› and 1 more month aren''t closed yet", under Now');
select ok((select body ~ ('Holiday ' || '.*: Holiday 167') from public.notifications where kind = 'owner_digest_weekly'),
  'the body''s other lines are still there');
select ok((select body !~ '(7,?777|8,?888|9,?000|₹)' and payload::text !~ '(7777|8888|9000|₹)'
           from public.notifications where kind = 'owner_digest_weekly'),
  'no amount in the body or the payload');
select ok((select (regexp_match(body, '^(.*closed yet)$', 'n'))[1]
                  ~ '^[A-Z][a-z]+( [0-9]{4})?( and [0-9]+ more months?)? (isn''t|aren''t) closed yet$'
           from public.notifications where kind = 'owner_digest_weekly'),
  'the line holds no digit but the year and the count');
select is((select count(*) from public.notifications
           where recipient_id <> pg_temp.fx('owner') and (body like '%closed yet%' or payload ? 'month_close')),
  0::bigint, 'nobody but the Owner has the line or the key (Admins and Crew get no digest)');
select is(public.digest_weekly(pg_temp.at(6, '09:00:00')), 0, 'a re-fired tick that day sends no second digest');

-- Close the rest: the line is gone.
select pg_temp.as_member('owner');
select pg_temp.now_at(6, '11:00:00');
select public.month_close(pg_temp.mo('m2'));
select public.month_close(pg_temp.mo('m1'));
select is(pg_temp.reminder(), null::jsonb, 'every month closed: no reminder');
select pg_temp.as_system();
select is(app.digest_weekly_payload(pg_temp.fx('org'), pg_temp.at(6, '08:30:00')) -> 'month_close', 'null'::jsonb,
  'and the payload''s month_close is null');
select ok(position('closed yet' in app.digest_weekly_text(app.digest_weekly_payload(pg_temp.fx('org'), pg_temp.at(6, '08:30:00')))) = 0,
  'and the text has no reminder line');

select * from finish();
rollback;
