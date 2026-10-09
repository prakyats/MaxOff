-- 5A push item 4 and step 3 (migrations push_upsert_same_keys and email_dispatch):
-- 1. push_subscription_upsert takes over another member's ACTIVE endpoint only with its keys;
-- 2. email_claim's queueing rule: always_email kinds always; actionable kinds only with no working
--    push; comments, task changed and information rows never; recent rows of active members only;
-- 3. the two daily ceilings (skipped_cap): per person and org-wide, an escalation bypassing the
--    per-person one only, retries never re-counted, not_configured never counted;
-- 4. email_record: sent, retry with the push backoff, failed; service_role only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);


-- 7A: client work rows reference clients and members, and the presets the organization (a
-- Playwright run leaves some behind).
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
delete from public.notifications;
delete from public.push_subscriptions;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}';

-- The always-emailed kind this file exercises the mechanism with. task_assigned played that part
-- until 5B decision 12 made it fallback only (pgTAP 49 tests the policy itself); a kind of its own,
-- rolled back with the rest, keeps these tests about the queueing rule and the ceilings.
insert into public.notification_kinds (kind, actionable, always_email, description)
values ('test_always', true, true, 'pgTAP 45: an always-emailed kind');

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',       '00000000-0000-4000-8000-000000000e01'),
  ('admin1',      '00000000-0000-4000-8000-000000000e02'),
  ('admin2',      '00000000-0000-4000-8000-000000000e03'),
  ('staff1',      '00000000-0000-4000-8000-000000000e04'),
  ('staff2',      '00000000-0000-4000-8000-000000000e05'),
  ('coord',       '00000000-0000-4000-8000-000000000e06'),
  ('old',         '00000000-0000-4000-8000-000000000e07'),
  ('gone',        '00000000-0000-4000-8000-000000000e08'),
  ('client_a',    '00000000-0000-4000-8000-000000000e11'),
  ('client_b',    '00000000-0000-4000-8000-000000000e12'),
  ('client_c',    '00000000-0000-4000-8000-000000000e13');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;

-- Web Push keys in the shape the browser hands over (5A review M1: the upsert checks them strictly):
-- p256dh 65 bytes starting 0x04, auth 16 bytes, base64url without padding; one per tag.
create function pg_temp.p256(tag text) returns text language sql immutable as $k$
  select rtrim(translate(replace(encode('\x04'::bytea || sha256(convert_to(tag, 'utf8'))
    || sha256(convert_to(tag || '.', 'utf8')), 'base64'), E'\n', ''), '+/', '-_'), '=') $k$;
create function pg_temp.auth16(tag text) returns text language sql immutable as $k$
  select rtrim(translate(encode(substring(sha256(convert_to(tag, 'utf8')) from 1 for 16), 'base64'), '+/', '-_'), '=') $k$;
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

create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000e99', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000e99', 'role', 'authenticated')::text, true);
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

create function pg_temp.today() returns date language sql stable as $$ select app.today_ist() $$;

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

-- The rows a person holds of a kind (read as the system: RLS is tested on its own below).
-- $2, not the parameter's name: in a SQL function a column wins over a same-named parameter,
-- so "x.kind = kind" compared the column with itself and counted every row (5.1 review).
create function pg_temp.n(k text, kind text default null) returns bigint language sql stable as $$
  select count(*) from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and ($2 is null or x.kind = $2);
$$;
create function pg_temp.last(k text, kind text) returns public.notifications language sql stable as $$
  select x.* from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and x.kind = kind order by x.created_at desc, x.id desc limit 1;
$$;
create function pg_temp.total() returns bigint language sql stable as $$ select count(*) from public.notifications $$;
-- Clears the rows as the system (whatever role the test was in), so a scenario starts clean.
create function pg_temp.clear() returns void language plpgsql as $$
begin
  perform pg_temp.as_system();
  delete from public.notifications;
end;
$$;

create function pg_temp.mk(title text, assignees text[], primary_key text, approver text default null, client text default null)
returns uuid language plpgsql as $$
declare
  v_ids uuid[] := array(select pg_temp.fx(k) from unnest(assignees) k);
begin
  return public.task_create(title, null, pg_temp.type_id('Normal'),
    case when client is null then null else pg_temp.fx(client) end, 'medium', pg_temp.due(),
    v_ids, pg_temp.fx(primary_key), case when approver is null then null else pg_temp.fx(approver) end);
end;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org', 'client_a', 'client_b', 'client_c');

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'),
             ('coord', 'staff'), ('old', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('gone'), pg_temp.fx('org'), 'Gone Staff', 'gone@example.com', 'staff', 'deactivated', now() - interval '30 days', now());

insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery', 'active', pg_temp.fx('admin2'), now()),
  (pg_temp.fx('client_c'), pg_temp.fx('org'), 'No Admin Cafe', 'active', null, now());

select pg_temp.as_member('owner');
insert into fx values ('asha', public.member_add_freelancer('Asha', null, null, pg_temp.fx('coord')));
insert into fx values ('bina', public.member_add_freelancer('Bina', null, null, pg_temp.fx('admin1')));
select pg_temp.as_system();
select pg_temp.clear();

-- A row for a person through app.notify (as the system): the kind decides the email.
create function pg_temp.note(k text, kind text, title text default 'T', escalation integer default 0) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  perform app.notify(array[pg_temp.fx(k)], kind, title, null, '/tasks', null, null, '{}', null, escalation);
  select n.id into v_id from public.notifications n
  where n.recipient_id = pg_temp.fx(k) and n.kind = $2 and n.title = $3 order by n.created_at desc, n.id desc limit 1;
  -- Rows of one transaction share now(): spaced out (in the past) so the claim's oldest-first
  -- order is the order they were written in.
  update public.notifications set created_at = now() - interval '1 hour' + (select count(*) from public.notifications) * interval '1 second'
  where id = v_id;
  return v_id;
end;
$$;
-- The email delivery of a notification: state, attempts, last_error.
create function pg_temp.mail(n uuid) returns text language sql stable as $$
  select coalesce((select d.state || ',' || d.attempts || ',' || coalesce(d.last_error, '-')
                   from public.notification_deliveries d where d.notification_id = n and d.channel = 'email'), 'none');
$$;
-- One claim at now(); returns how many emails it hands out.
create function pg_temp.claim(lim integer default 50) returns bigint language sql as $$
  select count(*) from public.email_claim(now(), lim);
$$;
create function pg_temp.sub(k text, endpoint text) returns void language sql as $$
  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth) values (pg_temp.fx(k), endpoint, 'k', 'a');
$$;

-- 1. Endpoint take-over --------------------------------------------------------------------------------
select pg_temp.as_member('staff1');
insert into fx values ('t1', public.push_subscription_upsert('https://push.example/t1', pg_temp.p256('kA'), pg_temp.auth16('aA'), 'android'));
select pg_temp.as_member('staff2');
select throws_ok($$ select public.push_subscription_upsert('https://push.example/t1', pg_temp.p256('kX'), pg_temp.auth16('aX'), 'android') $$,
  'P0001', 'FORBIDDEN', 'another member''s active endpoint with other keys: refused');
select throws_ok($$ select public.push_subscription_upsert('https://push.example/t1', pg_temp.p256('kA'), pg_temp.auth16('aX'), 'android') $$,
  'P0001', 'FORBIDDEN', '(the auth secret must match too)');
select pg_temp.as_system();
select is((select (member_id, p256dh, auth)::text from public.push_subscriptions where id = pg_temp.fx('t1')),
  (pg_temp.fx('staff1'), pg_temp.p256('kA'), pg_temp.auth16('aA'))::text, 'and the row is untouched');
select pg_temp.as_member('staff2');
select is(public.push_subscription_upsert('https://push.example/t1', pg_temp.p256('kA'), pg_temp.auth16('aA'), 'android', false, 'Shared'), pg_temp.fx('t1'),
  'with the same keys (the same browser) it is taken over');
select pg_temp.as_member('staff2');
select is(public.push_subscription_upsert('https://push.example/t1', pg_temp.p256('kB'), pg_temp.auth16('aB'), 'android'), pg_temp.fx('t1'),
  'one''s own row takes new keys');
select pg_temp.as_system();
update public.push_subscriptions set disabled_at = now(), disabled_reason = 'gone' where id = pg_temp.fx('t1');
select pg_temp.as_member('staff1');
select is(public.push_subscription_upsert('https://push.example/t1', pg_temp.p256('kC'), pg_temp.auth16('aC'), 'android'), pg_temp.fx('t1'),
  'a disabled row is reused by anyone, with their keys');
select pg_temp.as_system();
delete from public.push_subscriptions;

-- 2. Grants -------------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.email_claim(timestamptz, integer)', 'execute')
          and not has_function_privilege('anon', 'public.email_claim(timestamptz, integer)', 'execute')
          and has_function_privilege('service_role', 'public.email_claim(timestamptz, integer)', 'execute'),
  'email_claim: service_role only');
select ok(not has_function_privilege('authenticated', 'public.email_record(uuid, text, text, timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.email_record(uuid, text, text, timestamptz)', 'execute'),
  'email_record: service_role only');
select pg_temp.as_member('owner');
select throws_ok($$ select * from public.email_claim() $$, '42501', null, 'the Owner cannot call the claim from the API');
select pg_temp.as_system();

-- 3. Which rows get an email ---------------------------------------------------------------------------
-- staff1 has a working push device; staff2 has none; admin1 has only a gone one.
select pg_temp.sub('staff1', 'https://push.example/s1');
select pg_temp.sub('admin1', 'https://push.example/a1');
update public.push_subscriptions set disabled_at = now(), disabled_reason = 'gone' where endpoint = 'https://push.example/a1';
insert into fx values ('q_assigned_push', pg_temp.note('staff1', 'test_always', 'Assigned, has push'));
insert into fx values ('q_changes_push', pg_temp.note('staff1', 'task_changes_requested', 'Changes, has push'));
insert into fx values ('q_changes_none', pg_temp.note('staff2', 'task_changes_requested', 'Changes, no push'));
insert into fx values ('q_leave_gone', pg_temp.note('admin1', 'leave_decided', 'Leave, device gone'));
insert into fx values ('q_comment', pg_temp.note('staff2', 'task_comment', 'Comment'));
insert into fx values ('q_changed', pg_temp.note('staff2', 'task_changed', 'Changed'));
insert into fx values ('q_info', pg_temp.note('staff2', 'task_completed', 'Info'));
-- An actionable row whose push already went out: no email even if the device is gone since.
insert into fx values ('q_pushed', pg_temp.note('staff2', 'attendance_decided', 'Pushed already'));
update public.notification_deliveries set state = 'sent', sent_at = now()
where notification_id = pg_temp.fx('q_pushed') and channel = 'push';
-- An old row (a cron down for over a day) and a deactivated person's row.
insert into fx values ('q_old', pg_temp.note('staff2', 'test_always', 'Old'));
update public.notifications set created_at = now() - interval '25 hours' where id = pg_temp.fx('q_old');
insert into fx values ('q_gone', pg_temp.note('old', 'test_always', 'Deactivated later'));
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('old');

select is(pg_temp.claim(), 3::bigint, 'one claim hands out three emails');
select is(pg_temp.mail(pg_temp.fx('q_assigned_push')), 'queued,1,-', 'an always_email kind: emailed even with push');
select is(pg_temp.mail(pg_temp.fx('q_changes_none')), 'queued,1,-', 'an actionable kind with no push device: emailed');
select is(pg_temp.mail(pg_temp.fx('q_leave_gone')), 'queued,1,-', 'an actionable kind whose only device is gone: emailed');
select is(pg_temp.mail(pg_temp.fx('q_changes_push')), 'none', 'an actionable kind with a working device: no email');
select is(pg_temp.mail(pg_temp.fx('q_comment')), 'none', 'a comment: never (decision 15)');
select is(pg_temp.mail(pg_temp.fx('q_changed')), 'none', 'task changed: never');
select is(pg_temp.mail(pg_temp.fx('q_info')), 'none', 'an information row: never');
select is(pg_temp.mail(pg_temp.fx('q_pushed')), 'none', 'an actionable row whose push was sent: no email');
select is(pg_temp.mail(pg_temp.fx('q_old')), 'none', 'a row older than 24 hours: no email');
select is(pg_temp.mail(pg_temp.fx('q_gone')), 'none', 'a person no longer active: no email');
select is(pg_temp.claim(), 0::bigint, 'a second claim at once hands out nothing (the three are leased)');
select is((select array_agg(c.email order by c.email) from public.email_claim(now() + interval '6 minutes', 50) c),
  array['admin1@example.com', 'staff1@example.com', 'staff2@example.com'],
  'an expired lease is claimed again, with the address');
select is((select title from public.email_claim(now() + interval '12 minutes', 50) c where c.notification_id = pg_temp.fx('q_changes_none')),
  'Changes, no push', 'the claim carries the row''s own title');

-- 4. email_record: sent, retry with backoff, failed ------------------------------------------------------
create function pg_temp.did(n text) returns uuid language sql stable as $$
  select d.id from public.notification_deliveries d where d.notification_id = pg_temp.fx(n) and d.channel = 'email';
$$;
select is(public.email_record(pg_temp.did('q_assigned_push'), 'sent', null, now()), 1, 'sent');
select is(pg_temp.mail(pg_temp.fx('q_assigned_push')), 'sent,3,-', '(sent, after three leases)');
select is(public.email_record(pg_temp.did('q_assigned_push'), 'retry', 'x', now()), 0, 'a row no longer queued does not move');
update public.notification_deliveries set attempts = 1 where id = pg_temp.did('q_changes_none');
select is(public.email_record(pg_temp.did('q_changes_none'), 'retry', 'resend 503', now()), 1, 'a retry');
select is((select (state, next_attempt_at - now(), last_error)::text from public.notification_deliveries where id = pg_temp.did('q_changes_none')),
  ('queued', interval '1 minute', 'resend 503')::text, 'queued again after 1 minute (the push backoff)');
update public.notification_deliveries set attempts = 5 where id = pg_temp.did('q_changes_none');
select is(public.email_record(pg_temp.did('q_changes_none'), 'retry', 'resend 503', now()), 1, 'the fifth retry');
select is(pg_temp.mail(pg_temp.fx('q_changes_none')), 'failed,5,resend 503', 'fails for good');
select is(public.email_record(pg_temp.did('q_leave_gone'), 'failed', 'resend_422', now()), 1, 'a 4xx');
select is(pg_temp.mail(pg_temp.fx('q_leave_gone')), 'failed,3,resend_422', 'is failed at once');
select throws_ok($$ select public.email_record(gen_random_uuid(), 'bounced') $$, 'P0001', 'VALIDATION', 'an unknown outcome is refused');

-- 5. The ceilings -----------------------------------------------------------------------------------------
-- Start clean: per person 2, org-wide 13 (since 5.3: ordinary emails stop 10 short of it, at 3; the
-- last 10 are kept for escalations), for this section. One claim per row here, so each is its own
-- email (a person's always-emailed rows of one run are one batch: pgTAP 52).
delete from public.notifications;
delete from public.push_subscriptions;
update public.org_settings set email_daily_cap_per_member = 2, email_daily_cap_org = 13;
insert into fx values ('c1', pg_temp.note('staff2', 'test_always', 'C1'));
select is(pg_temp.claim(), 1::bigint, 'the first of staff2''s goes out');
insert into fx values ('c2', pg_temp.note('staff2', 'test_always', 'C2'));
select is(pg_temp.claim(), 1::bigint, 'the second too');
insert into fx values ('c3', pg_temp.note('staff2', 'test_always', 'C3'));
select is(pg_temp.claim(), 0::bigint, 'the third does not');
insert into fx values ('c4', pg_temp.note('staff2', 'test_always', 'C4 escalation', 1));
select is(pg_temp.claim(), 1::bigint, 'an escalation does');
select is(pg_temp.mail(pg_temp.fx('c1')) || ' ' || pg_temp.mail(pg_temp.fx('c2')), 'queued,1,- queued,1,-', 'the first two');
select is(pg_temp.mail(pg_temp.fx('c3')), 'skipped_cap,0,member_cap', 'the third is over the per-person cap: skipped_cap');
select is(pg_temp.mail(pg_temp.fx('c4')), 'queued,1,-', 'an escalation bypasses the per-person cap');
select is((select count(*) from public.notifications where id = pg_temp.fx('c3')), 1::bigint, 'the skipped row itself stays');
select is((select state from public.notification_deliveries where notification_id = pg_temp.fx('c3') and channel = 'push'),
  'queued', 'and its push is untouched');
-- The org has used 3 today: ordinary emails stop, an escalation still goes (5.3's reserve).
insert into fx values ('c5', pg_temp.note('staff1', 'test_always', 'C5'));
select is(pg_temp.claim(), 0::bigint, 'at the ordinary ceiling nothing ordinary goes out');
insert into fx values ('c6', pg_temp.note('admin1', 'test_always', 'C6 escalation', 2));
select is(pg_temp.mail(pg_temp.fx('c5')), 'skipped_cap,0,org_cap', 'another person''s row: skipped_cap (org_cap)');
select is(pg_temp.claim(), 1::bigint, 'an escalation uses the reserve kept for it');
-- A retry is never re-counted or re-capped.
select is(public.email_record(pg_temp.did('c1'), 'retry', 'resend 429', now() - interval '2 minutes'), 1, '(c1 is retried)');
select is((select count(*) from public.email_claim(now(), 50) c where c.notification_id = pg_temp.fx('c1')), 1::bigint,
  'a due retry goes out past the full ceilings');
select is(pg_temp.mail(pg_temp.fx('c1')), 'queued,2,resend 429', '(its second attempt)');
-- not_configured rows never count: with the key missing nothing was sent.
update public.notification_deliveries set state = 'failed', last_error = 'not_configured'
where channel = 'email' and notification_id in (pg_temp.fx('c1'), pg_temp.fx('c2'), pg_temp.fx('c4'));
insert into fx values ('c7', pg_temp.note('staff1', 'test_always', 'C7'));
select is(pg_temp.claim(), 1::bigint, 'rows that failed not_configured do not use the ceilings');
select is(pg_temp.mail(pg_temp.fx('c7')), 'queued,1,-', '(C7 goes out)');
-- Yesterday's emails (IST) do not count today.
update public.notification_deliveries set created_at = app.ist_day_start(app.today_ist()) - interval '1 minute'
where channel = 'email';
insert into fx values ('c8', pg_temp.note('staff2', 'test_always', 'C8'));
insert into fx values ('c9', pg_temp.note('staff2', 'test_always', 'C9'));
select is(pg_temp.claim(), 2::bigint, 'the ceilings count by IST day: yesterday''s do not count');
select is(pg_temp.mail(pg_temp.fx('c8')) || ' ' || pg_temp.mail(pg_temp.fx('c9')), 'queued,1,- queued,1,-', '(both of staff2''s go out, as one email)');
-- A per-person cap of 0 means none for that person; an escalation still goes, and a batch that
-- holds one is treated as one.
update public.org_settings set email_daily_cap_per_member = 0, email_daily_cap_org = 90;
insert into fx values ('d1', pg_temp.note('admin2', 'test_always', 'D1'));
select is(pg_temp.claim(), 0::bigint, 'a per-person cap of 0');
insert into fx values ('d2', pg_temp.note('admin2', 'test_always', 'D2 escalation', 1));
insert into fx values ('d3', pg_temp.note('admin2', 'test_always', 'D3'));
select is(pg_temp.claim(), 2::bigint, 'skips the person''s mail but not an escalation, nor what is batched with it');
select is(pg_temp.mail(pg_temp.fx('d1')) || ' ' || pg_temp.mail(pg_temp.fx('d2')) || ' ' || pg_temp.mail(pg_temp.fx('d3')),
  'skipped_cap,0,member_cap queued,1,- queued,1,-', 'D1 skipped; D2 and D3 one email');

select * from finish();
rollback;
