-- 5B slice 7 (migration owner_digest; owner decisions 2026-10-03): the Owner's daily digest email.
-- (1) What it counts: attendance yesterday (present, on leave with half and comp days, absent with
-- the proposals still waiting, day not ended; up to 5 names by name, then "+N more"), tasks
-- (approved yesterday, overdue now, waiting for the Owner), the requests waiting (leave, expense
-- claims), and yesterday's emails held back by the daily limit by kind; IST day boundaries; no
-- amount anywhere. (2) digest_daily: one row a day for the active Owner only, never skipped, read
-- at once, no push. (3) Hidden in-app: the Owner never sees it (select, Alerts list, unread
-- count); service_role does. (4) email_claim: its own email, after escalations and before older
-- ordinary rows, capped as ordinary. (5) owner_digest_preview: the Owner only, writes nothing.
-- (6) The 08:00 IST pg_cron job.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

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
delete from public.notification_deliveries;
delete from public.notifications;
delete from public.push_subscriptions;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}', email_daily_cap_org = 90, email_daily_cap_per_member = 20;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000005501'),
  ('admin1', '00000000-0000-4000-8000-000000005502'),
  ('kiran',  '00000000-0000-4000-8000-000000005503'),
  ('lata',   '00000000-0000-4000-8000-000000005504'),
  ('mohan',  '00000000-0000-4000-8000-000000005505'),
  ('nisha',  '00000000-0000-4000-8000-000000005506'),
  ('omar',   '00000000-0000-4000-8000-000000005507'),
  ('gopal',  '00000000-0000-4000-8000-000000005508'),
  ('farah',  '00000000-0000-4000-8000-000000005509'),
  ('esha',   '00000000-0000-4000-8000-000000005510'),
  ('dev',    '00000000-0000-4000-8000-000000005511'),
  ('chitra', '00000000-0000-4000-8000-000000005512'),
  ('bala',   '00000000-0000-4000-8000-000000005513'),
  ('asha',   '00000000-0000-4000-8000-000000005514'),
  ('aaron',  '00000000-0000-4000-8000-000000005515'),
  ('filler', '00000000-0000-4000-8000-000000005516');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
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
-- The digest's run: 08:00 IST today; yesterday's IST day is [y_start, t_start).
create function pg_temp.t_start() returns timestamptz language sql stable as $$ select app.ist_day_start(app.today_ist()); $$;
create function pg_temp.run_at() returns timestamptz language sql stable as $$ select pg_temp.t_start() + interval '8 hours'; $$;
create function pg_temp.payload() returns jsonb language sql stable as $$
  select app.owner_digest_payload(pg_temp.fx('org'), pg_temp.run_at());
$$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('kiran', 'staff'), ('lata', 'staff'), ('mohan', 'staff'),
             ('nisha', 'staff'), ('omar', 'staff'), ('gopal', 'staff'), ('farah', 'staff'), ('esha', 'staff'),
             ('dev', 'staff'), ('chitra', 'staff'), ('bala', 'staff'), ('asha', 'staff'), ('aaron', 'staff'),
             ('filler', 'staff')) as v(k, r);
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('aaron');

-- 1. The kind ----------------------------------------------------------------------------------------------
select is((select (actionable, always_email, in_app)::text from public.notification_kinds where kind = 'owner_digest'),
  '(f,t,f)', 'owner_digest: not actionable, always emailed, not in-app');
select is((select count(*) from public.notification_kinds where not in_app), 2::bigint,
  'every other kind stays in-app (in_app defaults to true); 6.5 adds owner_digest_weekly, email-only too');

-- 2. What it counts ---------------------------------------------------------------------------------------
-- Attendance yesterday.
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, final_status,
                                    proposed_by_system, decided_at, started_at, end_not_recorded)
values
  -- present, approved, with no End day: present and day not ended
  (pg_temp.fx('kiran'), app.today_ist() - 1, 'approved', 'present', now(), 'present', false, now(), pg_temp.t_start() - interval '14 hours', true),
  -- present, still waiting for the Owner (its choice counts)
  (pg_temp.fx('lata'),  app.today_ist() - 1, 'pending_review', 'present', now(), null, false, null, pg_temp.t_start() - interval '14 hours', false),
  -- leave, half day, comp leave: on leave
  (pg_temp.fx('mohan'), app.today_ist() - 1, 'approved', null, null, 'leave', true, now(), null, false),
  (pg_temp.fx('nisha'), app.today_ist() - 1, 'approved', 'half_day', now(), 'half_day', false, now(), null, false),
  (pg_temp.fx('omar'),  app.today_ist() - 1, 'approved', null, null, 'comp_leave', true, now(), null, false),
  -- absent: a proposal still waiting, decided absences
  (pg_temp.fx('asha'),  app.today_ist() - 1, 'pending_review', null, null, 'absent', true, null, null, false),
  (pg_temp.fx('bala'),  app.today_ist() - 1, 'approved', null, null, 'absent', true, now(), null, false),
  (pg_temp.fx('chitra'), app.today_ist() - 1, 'corrected', null, null, 'absent', true, now(), null, false),
  (pg_temp.fx('dev'),   app.today_ist() - 1, 'pending_review', null, null, 'absent', true, null, null, false),
  (pg_temp.fx('esha'),  app.today_ist() - 1, 'pending_review', null, null, 'absent', true, null, null, false),
  (pg_temp.fx('farah'), app.today_ist() - 1, 'pending_review', null, null, 'absent', true, null, null, false),
  (pg_temp.fx('gopal'), app.today_ist() - 1, 'pending_review', null, null, 'absent', true, null, null, false),
  -- not counted: a deactivated member, another day, today
  (pg_temp.fx('aaron'), app.today_ist() - 1, 'pending_review', null, null, 'absent', true, null, null, false),
  (pg_temp.fx('kiran'), app.today_ist() - 2, 'pending_review', null, null, 'absent', true, null, null, false),
  (pg_temp.fx('lata'),  app.today_ist(),     'pending_review', null, null, 'absent', true, null, null, false);

select is((pg_temp.payload() #>> '{attendance,present}')::integer, 2, 'present: an approved day and one still waiting with its Present choice');
select is((pg_temp.payload() #>> '{attendance,on_leave}')::integer, 3, 'on leave: leave, half day and comp leave');
select is((pg_temp.payload() #>> '{attendance,absent}')::integer, 7,
  'absent: decided and still-proposed absences of active members, yesterday only');
select is(pg_temp.payload() #> '{attendance,absent_names}', '["Asha", "Bala", "Chitra", "Dev", "Esha"]'::jsonb,
  'the absent are named by name, at most 5');
select is((pg_temp.payload() #>> '{attendance,absent_more}')::integer, 2, 'and the rest are counted (+2 more)');
select is((pg_temp.payload() #> '{attendance}') - array['present', 'on_leave', 'absent', 'absent_names', 'absent_more'],
  '{"day_not_ended": 1, "day_not_ended_names": ["Kiran"], "day_not_ended_more": 0}'::jsonb,
  'day not ended: the count and the name');

-- Tasks.
create function pg_temp.task(k text, due timestamptz default now() + interval '3 days') returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member('owner');
  v_id := public.task_create(k, null, (select id from public.task_types where org_id = pg_temp.fx('org') and name = 'Normal'),
    null, 'medium', now() + interval '3 days', array[pg_temp.fx('kiran')], pg_temp.fx('kiran'), null);
  perform pg_temp.as_system();
  update public.tasks set due_at = due where id = v_id;
  insert into fx values (k, v_id);
  return v_id;
end;
$$;
select pg_temp.task('done_2359');
select pg_temp.task('done_0000');
select pg_temp.task('done_before');
select pg_temp.task('done_archived');
select pg_temp.task('late', pg_temp.run_at() - interval '1 hour');
select pg_temp.task('late_cancelled', pg_temp.run_at() - interval '1 hour');
select pg_temp.task('late_archived', pg_temp.run_at() - interval '1 hour');
select pg_temp.task('later');
select pg_temp.task('to_decide');
update public.tasks set state = 'completed', completed_at = pg_temp.t_start() - interval '1 minute' where id = pg_temp.fx('done_2359');
update public.tasks set state = 'completed', completed_at = pg_temp.t_start() where id = pg_temp.fx('done_0000');
update public.tasks set state = 'completed', completed_at = pg_temp.t_start() - interval '1 day 1 minute' where id = pg_temp.fx('done_before');
update public.tasks set state = 'completed', completed_at = pg_temp.t_start() - interval '2 hours', archived_at = now() where id = pg_temp.fx('done_archived');
update public.tasks set state = 'cancelled', cancelled_at = now(), cancelled_reason = 'Not needed' where id = pg_temp.fx('late_cancelled');
update public.tasks set archived_at = now() where id = pg_temp.fx('late_archived');
update public.tasks set state = 'admin_approved', admin_approved_at = now() where id = pg_temp.fx('to_decide');

select is((pg_temp.payload() #>> '{tasks,approved_yesterday}')::integer, 1,
  'approved yesterday: 23:59 IST yesterday counts; 00:00 today, the day before and an archived one do not');
select is((pg_temp.payload() #>> '{tasks,overdue}')::integer, 1,
  'overdue now: past the deadline and still open (a cancelled or archived one does not count)');
select is((pg_temp.payload() #>> '{tasks,waiting_for_owner}')::integer, 1,
  'waiting for the Owner: task_counts()''s to_decide for the Owner (admin approved)');

-- Requests waiting.
insert into public.leave_requests (member_id, type, start_date, end_date, state, source)
values (pg_temp.fx('kiran'), 'leave', app.today_ist() + 3, app.today_ist() + 3, 'submitted', 'form'),
       (pg_temp.fx('lata'),  'leave', app.today_ist(), app.today_ist(), 'submitted', 'attendance');
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at)
values (pg_temp.fx('mohan'), 'leave', app.today_ist() + 5, app.today_ist() + 5, 'approved', 'form', pg_temp.fx('owner'), now());
insert into public.expense_claims (member_id, expense_date, amount, category_id, note, state)
values (pg_temp.fx('kiran'), app.today_ist() - 1, 1234.56, (select id from public.list_items where list_key = 'expense_category' limit 1), 'Taxi', 'submitted'),
       (pg_temp.fx('lata'),  app.today_ist() - 1, 777.77,  (select id from public.list_items where list_key = 'expense_category' limit 1), 'Lunch', 'submitted');
insert into public.expense_claims (member_id, expense_date, amount, category_id, note, state, decided_by, decided_at)
values (pg_temp.fx('mohan'), app.today_ist() - 1, 999.99, (select id from public.list_items where list_key = 'expense_category' limit 1), 'Cab', 'approved', pg_temp.fx('owner'), now());

select is((pg_temp.payload() #>> '{requests,leave}')::integer, 1,
  'leave waiting: submitted, not the attendance prompt''s (countPendingRequests)');
select is((pg_temp.payload() #>> '{requests,expense_claims}')::integer, 2, 'expense claims waiting: submitted (countPendingClaims)');

-- Emails held back yesterday by the daily limit.
create function pg_temp.held(who text, kind text, at timestamptz, state text default 'skipped_cap') returns void language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.notifications (org_id, recipient_id, kind, title, created_at, read_at)
  values (pg_temp.fx('org'), pg_temp.fx(who), kind, 'Held ' || kind, at, at) returning id into v_id;
  insert into public.notification_deliveries (notification_id, channel, state, last_error, created_at)
  values (v_id, 'email', state, case when state = 'skipped_cap' then 'org_cap' end, at);
end;
$$;
select pg_temp.held('filler', 'reminder_overdue', pg_temp.t_start() - interval '1 minute');
select pg_temp.held('filler', 'reminder_overdue', pg_temp.t_start() - interval '12 hours');
select pg_temp.held('filler', 'task_assigned', pg_temp.t_start() - interval '20 hours');
select pg_temp.held('filler', 'reminder_overdue', pg_temp.t_start());
select pg_temp.held('filler', 'reminder_overdue', pg_temp.t_start() - interval '1 day 1 minute');
select pg_temp.held('filler', 'reminder_event', pg_temp.t_start() - interval '3 hours', 'sent');
select is(pg_temp.payload() -> 'held_back',
  jsonb_build_array(
    jsonb_build_object('kind', 'reminder_overdue', 'count', 2,
                       'description', (select description from public.notification_kinds where kind = 'reminder_overdue')),
    jsonb_build_object('kind', 'task_assigned', 'count', 1,
                       'description', (select description from public.notification_kinds where kind = 'task_assigned'))),
  'held back yesterday by kind: 23:59 IST counts, 00:00 today and the day before do not, a sent email is not held back');

-- No money anywhere: no amount-like key at any depth, and no claim's amount in the text.
select is((select count(*) from jsonb_path_query(pg_temp.payload(), 'strict $.** ? (@.type() == "object").keyvalue()') kv
           where kv ->> 'key' ~* '(amount|total|sum|price|cost|paid|rupee|inr|money|salary|revenue)'), 0::bigint,
  'no amount-like key anywhere in the payload');
select ok(position('1234' in pg_temp.payload()::text) = 0 and position('777' in pg_temp.payload()::text) = 0
          and position('999' in pg_temp.payload()::text) = 0,
  'no claim amount appears in the payload');
select is(app.owner_digest_text(pg_temp.payload()),
  E'Attendance yesterday\nPresent: 2\nOn leave: 3\nAbsent: 7 (Asha, Bala, Chitra, Dev, Esha +2 more)\nDay not ended: 1 (Kiran)\n\n'
  || E'Tasks\nApproved yesterday: 1\nOverdue now: 1\nWaiting for your approval: 1\n\n'
  || E'Requests waiting for you\nLeave requests: 1\nExpense claims: 2\n\n'
  || E'Emails held back yesterday by the daily limit\n'
  || (select description from public.notification_kinds where kind = 'reminder_overdue') || E': 2\n'
  || (select description from public.notification_kinds where kind = 'task_assigned') || ': 1',
  'the body: every line, in sections');

-- 3. digest_daily: one a day, the active Owner only, never skipped -------------------------------------------
select is(public.digest_daily(pg_temp.run_at()), 1, 'the 08:00 run writes the Owner''s digest');
select is(public.digest_daily(pg_temp.run_at() + interval '5 minutes'), 0, 'a second run the same IST day writes nothing');
select is((select count(*) from public.notifications where kind = 'owner_digest'), 1::bigint, 'one row');
select is((select count(*) from public.notifications where kind = 'owner_digest' and recipient_id <> pg_temp.fx('owner')), 0::bigint,
  'to the Owner only');
select is((select (title, link, read_at is not null)::text from public.notifications where kind = 'owner_digest'),
  ('Your morning summary · ' || to_char(app.today_ist(), 'Dy FMDD Mon'), '/today', true)::text,
  'the subject line as its title, read at once, linking to /today');
select is((select payload from public.notifications where kind = 'owner_digest'), pg_temp.payload(),
  'its payload is the counts at the run');
select is((select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where n.kind = 'owner_digest'), 0::bigint, 'no push delivery (nor any delivery before the dispatcher)');
select is(public.digest_daily(pg_temp.run_at() + interval '1 day'), 1, 'the next IST day writes the next one');

-- 4. Hidden in-app ----------------------------------------------------------------------------------------
select app.notify(array[pg_temp.fx('owner')], 'leave_requested', 'Kiran asked for leave', null, '/approvals', null, null, '{}', null);
select pg_temp.as_member('owner');
select is((select count(*) from public.notifications where kind = 'owner_digest'), 0::bigint,
  'the Owner never reads the digest row through the API (bell, Realtime)');
select is((select count(*) from public.notifications where read_at is null), 1::bigint,
  'the unread count holds the Owner''s other row only');
select is((select array_agg(kind) from public.notifications_inbox(false, 0, 20)), array['leave_requested'],
  'the Alerts list never shows it');
select pg_temp.as_system();
set local role service_role;
select is((select count(*) from public.notifications where kind = 'owner_digest'), 2::bigint, 'service_role reads it');
select pg_temp.as_system();

-- 5. The email: its own, after escalations, before older ordinary rows, capped as ordinary ------------------
create function pg_temp.reset_mail() returns void language sql as $$
  delete from public.notification_deliveries;
  delete from public.notifications;
$$;
create function pg_temp.note(who text, kind text, title text, level integer default 0, at timestamptz default now())
returns uuid language sql as $$
  insert into public.notifications (org_id, recipient_id, kind, title, escalation_level, created_at)
  values (pg_temp.fx('org'), pg_temp.fx(who), kind, title, level, at) returning id;
$$;
create function pg_temp.used(n integer, who text default 'filler') returns void language plpgsql as $$
declare
  v_id uuid;
begin
  for i in 1..n loop
    v_id := pg_temp.note(who, 'reminder_overdue', 'Earlier ' || i, 0, now() - interval '1 minute');
    insert into public.notification_deliveries (notification_id, channel, state, attempts, next_attempt_at, sent_at, created_at)
    values (v_id, 'email', 'sent', 1, now(), now(), now());
  end loop;
end;
$$;
create function pg_temp.digest_mail() returns text language sql stable as $$
  select d.state || coalesce(':' || d.last_error, '') from public.notification_deliveries d
  join public.notifications n on n.id = d.notification_id where n.kind = 'owner_digest' and d.channel = 'email';
$$;
create function pg_temp.mail(title text) returns text language sql stable as $$
  select d.state || coalesce(':' || d.last_error, '') from public.notification_deliveries d
  join public.notifications n on n.id = d.notification_id where n.title = $1 and d.channel = 'email';
$$;

select pg_temp.reset_mail();
select public.digest_daily(now());
select pg_temp.note('owner', 'reminder_overdue', 'Owner overdue A', 0, now() - interval '2 minutes');
select pg_temp.note('owner', 'reminder_before_due_last', 'Owner before due B', 0, now() - interval '2 minutes');
create temporary table claimed as select * from public.email_claim(now(), 20);
select is((select (batch_id is null, attempts, payload ->> 'date')::text from claimed where kind = 'owner_digest'),
  (true, 1, app.today_ist()::text)::text, 'the dispatcher claims the digest alone (no batch) with its payload');
select ok((select count(distinct batch_id) = 1 and bool_and(batch_id is not null) from claimed where kind <> 'owner_digest'),
  'the Owner''s always-emailed reminders of the same run are one batch, without the digest');

-- Escalations before the digest: one left before the reserve, the escalation takes it.
select pg_temp.reset_mail();
select pg_temp.used(79);
-- The digest a second older than the escalation, both at or before now(): a claim a second ahead of
-- now() falls on tomorrow's cap day in the last second before midnight IST.
select public.digest_daily(now() - interval '1 second');
select pg_temp.note('admin1', 'escalation_not_noted', 'Newer escalation', 1, now());
select count(*) from public.email_claim(now(), 20);
select is(pg_temp.mail('Newer escalation') || ' / ' || pg_temp.digest_mail(), 'queued / skipped_cap:org_cap',
  'an escalation goes before the digest; the digest is then over the ordinary limit (80 of 90)');

-- The digest before an older ordinary email: one left before the reserve, the digest takes it.
select pg_temp.reset_mail();
select pg_temp.used(79);
select pg_temp.note('kiran', 'reminder_overdue', 'Older ordinary', 0, now() - interval '30 seconds');
select public.digest_daily(now());
select count(*) from public.email_claim(now(), 20);
select is(pg_temp.digest_mail() || ' / ' || pg_temp.mail('Older ordinary'), 'queued / skipped_cap:org_cap',
  'the digest goes before an older ordinary email');

-- Taken into the run first: with a run limit of 1 and older ordinary rows queued, the digest goes.
select pg_temp.reset_mail();
select pg_temp.note('kiran', 'reminder_overdue', 'Older one', 0, now() - interval '30 seconds');
select pg_temp.note('lata', 'reminder_overdue', 'Older two', 0, now() - interval '20 seconds');
select public.digest_daily(now());
select is((select array_agg(kind) from public.email_claim(now(), 1)), array['owner_digest'],
  'a run of one takes the digest before older rows');

-- Capped as an ordinary email: the org's ordinary limit and the Owner's own cap.
select pg_temp.reset_mail();
select pg_temp.used(80);
select public.digest_daily(now());
select count(*) from public.email_claim(now(), 20);
select is(pg_temp.digest_mail(), 'skipped_cap:org_cap', 'at 80 of 90 the digest is held back like any ordinary email');
select pg_temp.reset_mail();
select pg_temp.used(20, 'owner');
select public.digest_daily(now());
select count(*) from public.email_claim(now(), 20);
select is(pg_temp.digest_mail(), 'skipped_cap:member_cap', 'and at the Owner''s 20 a day (the per-person cap)');

-- An organisation without an active Owner gets none.
select pg_temp.reset_mail();
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('owner');
select is(public.digest_daily(now()), 0, 'no active Owner: no digest');
update public.members set status = 'active', deactivated_at = null where id = pg_temp.fx('owner');

-- 6. The sample on the preview: the Owner only, writing nothing ------------------------------------------------
select pg_temp.reset_mail();
create temporary table before_preview as
  select (select count(*) from public.notifications) as n, (select count(*) from public.notification_deliveries) as d;
create temporary table expected_preview as select app.owner_digest_payload(pg_temp.fx('org'), now()) as p;
grant all on expected_preview to authenticated;
select pg_temp.as_member('owner');
select is(public.owner_digest_preview(), (select p from expected_preview),
  'the Owner reads the digest''s payload for now');
select pg_temp.as_system();
select is((select (count(*), (select count(*) from public.notification_deliveries))::text from public.notifications),
  (select (n, d)::text from before_preview), 'the preview writes no notification and no delivery');
select pg_temp.as_member('admin1');
select throws_ok($$select public.owner_digest_preview()$$, 'P0001', 'FORBIDDEN', 'an Admin is refused');
select pg_temp.as_member('kiran');
select throws_ok($$select public.owner_digest_preview()$$, 'P0001', 'FORBIDDEN', 'a Crew member is refused');
select pg_temp.as_anon();
select throws_ok($$select public.owner_digest_preview()$$, '42501', null, 'a signed-out caller is refused');
select pg_temp.as_system();

-- 7. Grants and the job -----------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.digest_daily(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.digest_daily(timestamptz)', 'execute')
          and not has_function_privilege('anon', 'public.digest_daily(timestamptz)', 'execute'),
  'digest_daily is service_role only');
select ok(not has_function_privilege('authenticated', 'app.owner_digest_payload(uuid, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.owner_digest_payload(uuid, timestamptz)', 'execute'),
  'the payload builder is never the API role''s');
select ok(has_function_privilege('authenticated', 'public.owner_digest_preview()', 'execute')
          and not has_function_privilege('anon', 'public.owner_digest_preview()', 'execute'),
  'the preview is callable by a signed-in member (and refuses all but the Owner)');
-- 6.5 (kickoff 6 decision 23) swapped the daily cron row for digest_weekly; the function stays as
-- history (everything above still holds), so no job calls it any more (pgTAP 64 has the schedule).
select is((select count(*) from cron.job where jobname = 'digest_daily' or command like '%digest_daily%'), 0::bigint,
  'the daily digest''s cron row is gone since 6.5 (digest_weekly took its place; the function is history)');

-- The all-zero day: one line.
delete from public.attendance_days;
delete from public.leave_requests;
delete from public.expense_claims;
delete from public.task_assignees;
delete from public.task_reminders;
delete from public.task_reminder_arms;
delete from public.tasks;
select pg_temp.reset_mail();
select is(app.owner_digest_text(pg_temp.payload()), 'Nothing needs you today.', 'every count zero: "Nothing needs you today."');
select is(public.digest_daily(pg_temp.run_at()), 1, 'and it is still written (never skipped)');

select * from finish();
rollback;
