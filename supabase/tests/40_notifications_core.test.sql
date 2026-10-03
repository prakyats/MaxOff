-- 5.1 (unit 5A, step 1; migration notifications_core): the notification tables and their RLS per
-- role (allowed and denied), org_settings' kickoff-5 columns, app.notify() on every path (dedupe,
-- the actor dropped, a deactivated person skipped, a freelancer's row to their coordinator, an
-- unknown kind, the queued push delivery, execute denied to the API role), the mark-read helpers
-- per role, push_subscriptions own rows, and every retrofitted producer: the right people get
-- exactly one row each and the actor none (WORKFLOWS §9, "Settled at kickoff 5", 5A decisions
-- 15-25), with the special cases: an Owner rejection to the assignees only, a removed assignee told
-- without the task, a new approver while submitted, the comment recipient set, a request with a
-- client that has no Admin, a converted request linking the request, "take today as leave", a
-- holiday releasing comp leave, a deactivated coordinator, the combined hand-over, no amount in
-- an expense row, the 23:59 job's one row, the 20:30 reminder once per day.
begin;
create extension if not exists pgtap with schema extensions;
select plan(217);

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

-- Web Push keys in the shape the browser hands over (5A review M1: the upsert checks them strictly).
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

-- 1. Structure and grants --------------------------------------------------------------------------
select has_table('public', 'notification_kinds', 'notification_kinds exists');
select has_table('public', 'notifications', 'notifications exists');
select has_table('public', 'notification_deliveries', 'notification_deliveries exists');
select has_table('public', 'push_subscriptions', 'push_subscriptions exists');
select col_default_is('public', 'org_settings', 'quiet_hours_start', '22:00:00'::time, 'quiet_hours_start defaults to 22:00');
select col_default_is('public', 'org_settings', 'quiet_hours_end', '07:00:00'::time, 'quiet_hours_end defaults to 07:00');
select col_default_is('public', 'org_settings', 'email_daily_cap_org', '90', 'email_daily_cap_org defaults to 90');
select throws_ok($$ update public.org_settings set email_daily_cap_org = 0 $$, '23514', null, 'email_daily_cap_org must be positive');
select ok(has_column_privilege('authenticated', 'public.org_settings', 'email_daily_cap_org', 'update')
          and has_column_privilege('authenticated', 'public.org_settings', 'quiet_hours_start', 'update')
          and has_column_privilege('authenticated', 'public.org_settings', 'quiet_hours_end', 'update'),
  'the three kickoff-5 settings are in the API UPDATE grant');
select ok(not has_table_privilege('anon', 'public.notifications', 'select')
          and not has_table_privilege('anon', 'public.notification_deliveries', 'select')
          and not has_table_privilege('anon', 'public.push_subscriptions', 'select')
          and not has_table_privilege('anon', 'public.notification_kinds', 'select'),
  'anon has nothing on the four tables');
select ok(has_table_privilege('authenticated', 'public.notifications', 'select')
          and not has_table_privilege('authenticated', 'public.notifications', 'insert')
          and not has_table_privilege('authenticated', 'public.notifications', 'delete')
          and has_column_privilege('authenticated', 'public.notifications', 'read_at', 'update')
          and not has_column_privilege('authenticated', 'public.notifications', 'title', 'update')
          and not has_column_privilege('authenticated', 'public.notifications', 'recipient_id', 'update'),
  'notifications: the API reads and updates read_at, nothing else');
select ok(not has_table_privilege('authenticated', 'public.notification_deliveries', 'select')
          and not has_table_privilege('authenticated', 'public.notification_deliveries', 'insert')
          and not has_table_privilege('authenticated', 'public.notification_deliveries', 'update')
          and has_table_privilege('service_role', 'public.notification_deliveries', 'update'),
  'notification_deliveries: no API access; the dispatcher (service_role) owns it');
select ok(has_table_privilege('authenticated', 'public.push_subscriptions', 'select')
          and has_table_privilege('authenticated', 'public.push_subscriptions', 'delete')
          and not has_column_privilege('authenticated', 'public.push_subscriptions', 'endpoint', 'insert')
          and not has_column_privilege('authenticated', 'public.push_subscriptions', 'label', 'update')
          and not has_column_privilege('authenticated', 'public.push_subscriptions', 'failure_count', 'update')
          and not has_column_privilege('authenticated', 'public.push_subscriptions', 'disabled_at', 'update')
          and not has_column_privilege('authenticated', 'public.push_subscriptions', 'last_success_at', 'insert'),
  'push_subscriptions: the API reads and deletes its own rows; every insert and update goes through push_subscription_upsert (5A review M2)');
select ok(not has_function_privilege('authenticated', 'app.notify(uuid[], text, text, text, text, text, uuid, jsonb, uuid, integer)', 'execute')
          and not has_function_privilege('anon', 'app.notify(uuid[], text, text, text, text, text, uuid, jsonb, uuid, integer)', 'execute')
          and has_function_privilege('service_role', 'app.notify(uuid[], text, text, text, text, text, uuid, jsonb, uuid, integer)', 'execute'),
  'app.notify: service_role only, never the API role');
select ok(has_function_privilege('authenticated', 'public.notifications_mark_read(text, uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.notifications_mark_all_read()', 'execute')
          and not has_function_privilege('anon', 'public.notifications_mark_all_read()', 'execute'),
  'the mark-read helpers are the API''s');
select is((select count(*) from public.notification_kinds), 39::bigint, '29 kinds are seeded, plus approvals_moved (5A decision 27), 5.3''s eight reminders and escalations and 5B''s owner_digest');
select is((select array_agg(kind order by kind) from public.notification_kinds where actionable),
  array['attendance_decided', 'comp_leave_granted', 'comp_leave_revoked', 'expense_decided', 'extra_work_decided',
        'leave_decided', 'task_assigned', 'task_changes_requested'],
  'the actionable kinds (email fallback, kickoff 5 decision 6): assigned, changes requested and the decisions');
select is((select array_agg(kind order by kind) from public.notification_kinds where always_email),
  array['escalation_not_noted', 'escalation_overdue', 'owner_digest', 'reminder_before_due_last', 'reminder_event', 'reminder_overdue'],
  'always emailed (5B decision 12): only 5.3''s last before-due, overdue and event reminders, the escalations and the Owner digest; no 5.1 kind (task assigned is fallback only)');
select ok(not (select actionable or always_email from public.notification_kinds where kind = 'task_comment'),
  'a comment is never email (5A decision 15)');
select is((select schedule from cron.job where jobname = 'reminders_tick'), '*/5 * * * *',
  'the 20:30 reminder runs inside reminders_tick, every 5 minutes all day (5.1 review S1; 5.3 folded its own job in)');

-- 2. app.notify() ---------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
insert into fx values ('asha', public.member_add_freelancer('Asha', null, null, pg_temp.fx('old')));
select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('coord'), 'handover');
select pg_temp.as_system();
select pg_temp.clear();

select throws_ok($$ select app.notify(array[pg_temp.fx('staff1')], 'not_a_kind', 'x') $$,
  'P0001', 'VALIDATION', 'an unknown kind is refused');
select throws_ok($$ select app.notify(array[pg_temp.fx('staff1')], 'task_changed', '  ') $$,
  'P0001', 'VALIDATION', 'a title is required');
select is(app.notify(array[pg_temp.fx('staff1'), pg_temp.fx('staff1'), pg_temp.fx('staff2'), pg_temp.fx('gone'),
                           pg_temp.fx('asha'), null, '00000000-0000-4000-8000-000000000e99'],
                     'task_changed', 'Hello', 'Body', '/tasks', 'tasks', pg_temp.fx('client_a'), '{"a": 1}',
                     pg_temp.fx('staff2')),
  2, 'returns the rows written: staff1 once, the actor (staff2) never, the deactivated person skipped, the unknown id skipped, Asha''s to her coordinator');
select is(pg_temp.n('staff1'), 1::bigint, 'staff1 got one row');
select is(pg_temp.n('staff2'), 0::bigint, 'the actor got none');
select is(pg_temp.n('gone'), 0::bigint, 'a deactivated person got none');
select is(pg_temp.n('asha'), 0::bigint, 'a freelancer never holds a row');
select is((pg_temp.last('coord', 'task_changed')).title, 'Hello · for Asha', 'the coordinator''s row is worded for the freelancer');
select is((pg_temp.last('coord', 'task_changed')).payload, jsonb_build_object('a', 1, 'for_member_id', pg_temp.fx('asha')),
  'payload.for_member_id names the freelancer');
select is((pg_temp.last('staff1', 'task_changed')).title, 'Hello', 'a direct row keeps the title');
select is((select (x.body, x.link, x.entity, x.entity_id, x.actor_id, x.org_id, x.escalation_level, x.read_at is null)
           from public.notifications x where x.recipient_id = pg_temp.fx('staff1'))::text,
  ('Body', '/tasks', 'tasks', pg_temp.fx('client_a'), pg_temp.fx('staff2'), pg_temp.fx('org'), 0, true)::text,
  'the row carries body, link, entity, the actor, the org and starts unread');
select is((select count(*) from public.notification_deliveries d
           join public.notifications x on x.id = d.notification_id
           where d.channel = 'push' and d.state = 'queued' and d.attempts = 0), 2::bigint,
  'one queued push delivery per row; email is the dispatcher''s');
select is(app.notify(array[pg_temp.fx('asha')], 'task_changed', 'Hi', null, null, null, null, '{}', pg_temp.fx('coord')),
  0, 'a freelancer''s row is dropped when the coordinator is the actor');
select is(app.notify(array[pg_temp.fx('asha'), pg_temp.fx('coord')], 'task_changed', 'Hi', null, null, null, null, '{}', pg_temp.fx('owner')),
  1, 'the coordinator named twice (as themselves and through the freelancer) gets one row');
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('coord');
select is(app.notify(array[pg_temp.fx('asha')], 'task_changed', 'Hi', null, null, null, null, '{}', pg_temp.fx('owner')),
  0, 'a freelancer whose current coordinator is deactivated reaches nobody (never the freelancer)');
update public.members set status = 'active', deactivated_at = null where id = pg_temp.fx('coord');
select is(app.notify('{}', 'task_changed', 'Hi'), 0, 'no recipients, no rows');
select is(app.notify(null, 'task_changed', 'Hi'), 0, 'null recipients, no rows');
select throws_ok($$ insert into public.notifications (org_id, recipient_id, kind, title, entity)
    values (pg_temp.fx('org'), pg_temp.fx('staff1'), 'task_changed', 'x', 'tasks') $$,
  '23514', null, 'entity and entity_id come together');
select throws_ok($$ insert into public.notifications (org_id, recipient_id, kind, title, link)
    values (pg_temp.fx('org'), pg_temp.fx('staff1'), 'task_changed', 'x', 'https://evil.example') $$,
  '23514', null, 'a link is an app route');

-- 3. RLS: the recipient only; read_at is the one API write --------------------------------------------
select pg_temp.clear();
select app.notify(array[pg_temp.fx('staff1'), pg_temp.fx('owner')], 'task_changed', 'Two people', null, '/tasks', 'tasks', pg_temp.fx('client_a'), '{}', null);
select app.notify(array[pg_temp.fx('staff1')], 'task_changed', 'Only staff1', null, '/tasks', 'tasks', pg_temp.fx('client_b'), '{}', null);
select pg_temp.as_member('staff1');
select is((select count(*) from public.notifications), 2::bigint, 'staff1 reads their own two rows');
select is((select count(*) from public.notification_kinds), 39::bigint, 'and the kinds (29 + approvals_moved + 5.3''s eight + owner_digest)');
select pg_temp.as_member('owner');
select is((select count(*) from public.notifications), 1::bigint, 'the Owner reads their own row only, never another member''s');
select pg_temp.as_member('admin1');
select is((select count(*) from public.notifications), 0::bigint, 'an Admin with no rows reads nothing');
select throws_ok($$ select * from public.notification_deliveries $$, '42501', null, 'nobody reads deliveries through the API');
select throws_ok($$ insert into public.notifications (org_id, recipient_id, kind, title)
    values (pg_temp.fx('org'), pg_temp.fx('admin1'), 'task_changed', 'x') $$, '42501', null, 'no API insert');
select throws_ok($$ delete from public.notifications $$, '42501', null, 'no API delete');
select pg_temp.as_member('staff1');
select throws_ok($$ update public.notifications set title = 'Mine' $$, '42501', null, 'the title cannot be changed');
select is(pg_temp.rows($$ update public.notifications set read_at = now() where title = 'Only staff1' $$), 1::bigint,
  'staff1 marks a row read through the column grant');
select is(pg_temp.rows($$ update public.notifications set read_at = now() $$), 2::bigint,
  'and only their own rows are reachable');
select pg_temp.as_system();
select is((select count(*) from public.notifications where read_at is null), 1::bigint, 'the Owner''s row stayed unread');
select pg_temp.as_member('staff1');
select is(pg_temp.rows($$ update public.notifications set read_at = null $$), 2::bigint,
  'a row can be marked unread again by its recipient');
-- The helpers.
select is(public.notifications_mark_read('tasks', pg_temp.fx('client_a')), 1, 'notifications_mark_read marks the caller''s rows about that record');
select is(public.notifications_mark_read('tasks', pg_temp.fx('client_a')), 0, 'and nothing twice');
select throws_ok($$ select public.notifications_mark_read('tasks', null) $$, 'P0001', 'VALIDATION', 'it needs the record');
select pg_temp.as_member('owner');
select is(public.notifications_mark_read('tasks', pg_temp.fx('client_a')), 1, 'the Owner marks their own row about it, not staff1''s');
select pg_temp.as_member('staff1');
select is(public.notifications_mark_all_read(), 1, 'mark all read: the one row still unread');
select pg_temp.as_system();
select is((select count(*) from public.notifications where read_at is null), 0::bigint, 'every row is read now');
select pg_temp.as_nobody();
select throws_ok($$ select public.notifications_mark_all_read() $$, 'P0001', 'UNAUTHENTICATED', 'no member, no mark');
select throws_ok($$ select public.notifications_mark_read('tasks', pg_temp.fx('client_a')) $$, 'P0001', 'UNAUTHENTICATED', 'nor by record');
select pg_temp.as_member('staff1');
select throws_ok(format($$ update public.notifications set recipient_id = %L $$, pg_temp.fx('owner')), '42501', null,
  'a row cannot be handed to someone else');

-- 4. push_subscriptions: own rows ---------------------------------------------------------------------
select pg_temp.as_member('staff1');
-- 5A review M2 (20261001053934): INSERT and UPDATE are revoked from the API role; a member
-- writes their rows only through push_subscription_upsert (pgTAP 47 has the per-role proof).
select lives_ok($$ select public.push_subscription_upsert('https://push.example/s1', pg_temp.p256('k'), pg_temp.auth16('a'), 'android', true, 'Phone') $$,
  'staff1 subscribes their own device (through the RPC)');
select throws_ok(format($$ insert into public.push_subscriptions (member_id, endpoint, p256dh, auth)
    values (%L, 'https://push.example/x', 'k', 'a') $$, pg_temp.fx('staff2')),
  '42501', null, 'never for someone else: a direct insert is refused outright (5A review M2)');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth, failure_count)
    values ('https://push.example/s2', 'k', 'a', 3) $$, '42501', null, 'the result columns are not the member''s to write');
select is((select count(*) from public.push_subscriptions), 1::bigint, 'staff1 sees their row');
select pg_temp.as_member('owner');
select is((select count(*) from public.push_subscriptions), 0::bigint, 'the Owner never sees another member''s endpoint');
select pg_temp.as_member('admin1');
select is((select count(*) from public.push_subscriptions), 0::bigint, 'nor an Admin');
select lives_ok($$ select public.push_subscription_upsert('https://push.example/a1', pg_temp.p256('k'), pg_temp.auth16('a'), 'desktop') $$,
  'an Admin subscribes too');
select pg_temp.as_member('staff1');
select throws_ok($$ update public.push_subscriptions set label = 'My phone', last_seen_at = now() $$, '42501', null,
  'a direct update is refused too: the upsert is the only write (5A review M2)');
select throws_ok($$ update public.push_subscriptions set failure_count = 1 $$, '42501', null, 'never the failure count');
select is(pg_temp.rows($$ delete from public.push_subscriptions $$), 1::bigint,
  '"Sign out of this device" deletes the row (and only theirs)');
select pg_temp.as_system();
select is((select count(*) from public.push_subscriptions), 1::bigint, 'admin1''s row stayed');

-- 5. Tasks ---------------------------------------------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('owner');
insert into fx values ('t1', pg_temp.mk('Wedding reel', array['staff1', 'staff2', 'asha'], 'staff1', 'admin1', 'client_a'));
select pg_temp.as_system();
select is(pg_temp.total(), 3::bigint, 'task_create: one row per assignee (Asha''s to her coordinator), the creator none');
select is(pg_temp.n('staff1', 'task_assigned') + pg_temp.n('staff2', 'task_assigned') + pg_temp.n('coord', 'task_assigned'), 3::bigint,
  'the three task_assigned rows');
select is(pg_temp.n('admin1'), 0::bigint, 'the approving Admin is not told of the creation (no §9 row)');
select is((select (x.title, x.link, x.entity, x.entity_id, x.actor_id) from public.notifications x where x.recipient_id = pg_temp.fx('staff1'))::text,
  ('New task: Wedding reel', '/tasks/' || pg_temp.fx('t1'), 'tasks', pg_temp.fx('t1'), pg_temp.fx('owner'))::text,
  'the row links the task and names the actor');
select is((pg_temp.last('coord', 'task_assigned')).title, 'New task: Wedding reel · for Asha', 'the coordinator''s is worded for Asha');

-- Changed by the approving Admin: staff2 removed, the deadline moved.
select pg_temp.clear();
select pg_temp.as_member('admin1');
select public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object(
  'assignee_ids', jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('asha')),
  'due_at', pg_temp.due() + interval '1 day', 'priority', 'high'));
select pg_temp.as_system();
select is(pg_temp.n('staff2', 'task_unassigned'), 1::bigint, 'the removed assignee is told');
select is(pg_temp.n('staff2'), 1::bigint, 'and nothing else');
select ok((pg_temp.last('staff2', 'task_unassigned')).title not like '%Wedding%'
          and coalesce((pg_temp.last('staff2', 'task_unassigned')).body, '') not like '%Wedding%'
          and (pg_temp.last('staff2', 'task_unassigned')).link is null
          and (pg_temp.last('staff2', 'task_unassigned')).entity is null,
  'without the task named or linked (5A decision 25)');
select is(pg_temp.n('staff1', 'task_changed'), 1::bigint, 'the assignee who stays gets "Task changed"');
select is((pg_temp.last('staff1', 'task_changed')).body, 'Changed: deadline (now ' || app.notify_when(pg_temp.due() + interval '1 day') || '), priority',
  'naming the fields');
select is(pg_temp.n('coord', 'task_changed'), 1::bigint, 'and so does Asha''s coordinator');
select is(pg_temp.n('admin1'), 0::bigint, 'the actor (the approver) gets nothing');
select is(pg_temp.total(), 3::bigint, 'three rows in all');

-- A person added later is assigned; a title-only change tells the assignees.
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object(
  'assignee_ids', jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('asha'), pg_temp.fx('staff2'))));
select pg_temp.as_system();
select is(pg_temp.n('staff2', 'task_assigned'), 1::bigint, 'a re-added person is assigned again');
select is(pg_temp.total(), 1::bigint, 'and nobody else is told of a people-only change');

-- Comments (5A decision 15).
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into public.task_comments (task_id, body) values (pg_temp.fx('t1'), 'First cut is up');
select pg_temp.as_system();
select is(pg_temp.n('owner', 'task_comment') + pg_temp.n('admin1', 'task_comment') + pg_temp.n('staff2', 'task_comment') + pg_temp.n('coord', 'task_comment'), 4::bigint,
  'a comment reaches the creator, the approving Admin, the other assignees and the freelancer''s coordinator');
select is(pg_temp.n('staff1'), 0::bigint, 'never the author');
select is(pg_temp.total(), 4::bigint, 'four rows');
select is((pg_temp.last('owner', 'task_comment')).body, 'Staff1: First cut is up', 'the body names the author');
select is((pg_temp.last('owner', 'task_comment')).actor_id, pg_temp.fx('staff1'), 'the author is the actor');
select pg_temp.clear();
select pg_temp.as_member('coord');
insert into public.task_comments (task_id, body, on_behalf_of) values (pg_temp.fx('t1'), 'Asha says ok', pg_temp.fx('asha'));
select pg_temp.as_system();
select is(pg_temp.n('coord'), 0::bigint, 'a comment for Asha: the coordinator who wrote it gets nothing');
select is((pg_temp.last('staff1', 'task_comment')).body, 'Asha (via Coord): Asha says ok', 'the body names the freelancer and the coordinator');
select is(pg_temp.total(), 4::bigint, 'the rest are told: creator, approver, staff1, staff2');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object('assignee_ids', jsonb_build_array(pg_temp.fx('staff1'))));
select pg_temp.clear();
select pg_temp.as_member('admin1');
insert into public.task_comments (task_id, body) values (pg_temp.fx('t1'), 'Looks good');
select pg_temp.as_system();
select is(pg_temp.n('coord', 'task_comment'), 0::bigint,
  'an earlier commenter who can no longer see the task (the coordinator, for Asha and as themselves) is not told (5.1 review M1)');
select is(pg_temp.n('staff2'), 0::bigint, 'a removed assignee who never commented is not');
select is(pg_temp.n('admin1'), 0::bigint, 'the author none');
select is(pg_temp.total(), 2::bigint, 'creator and staff1: the people who can still open it');
select pg_temp.as_member('owner');
select public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object('assignee_ids', jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('asha'))));

-- Done → the approving Admin; changes requested → the assignees only; approvals → the Owner.
select pg_temp.clear();
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('t1'));
select pg_temp.as_system();
select is(pg_temp.n('admin1', 'task_submitted'), 1::bigint, 'Done reaches the approving Admin');
select is(pg_temp.total(), 1::bigint, 'and only them (not the Owner)');
select is((pg_temp.last('admin1', 'task_submitted')).body, 'Staff1 marked it Done', 'naming who');
select pg_temp.clear();
select pg_temp.as_member('admin1');
select public.task_review(pg_temp.fx('t1'), 'rejected', 'Fix the colour grade');
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_changes_requested') + pg_temp.n('coord', 'task_changes_requested'), 2::bigint,
  'changes requested reaches the assignees');
select is((pg_temp.last('staff1', 'task_changes_requested')).body, 'Fix the colour grade', 'with the reason');
select is(pg_temp.total(), 2::bigint, 'nobody else (not the creator)');
select pg_temp.clear();
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('t1'));
select pg_temp.as_member('admin1');
select public.task_review(pg_temp.fx('t1'), 'approved');
select pg_temp.as_system();
select is(pg_temp.n('owner', 'task_admin_approved'), 1::bigint, 'an Admin approval reaches the Owner');
select is(pg_temp.total(), 2::bigint, 'the Done row and the approval row');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.task_review(pg_temp.fx('t1'), 'rejected', 'Wrong aspect ratio');
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_changes_requested') + pg_temp.n('coord', 'task_changes_requested'), 2::bigint,
  'an Owner rejection reaches the assignees');
select is(pg_temp.n('admin1'), 0::bigint, 'and not the approving Admin (kickoff 5 decision 2)');
select is(pg_temp.total(), 2::bigint, 'two rows');
select pg_temp.clear();
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('t1'));
select pg_temp.as_member('admin1');
select public.task_review(pg_temp.fx('t1'), 'approved');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.task_review(pg_temp.fx('t1'), 'approved');
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_completed') + pg_temp.n('coord', 'task_completed'), 2::bigint, 'completion reaches the assignees');
select is(pg_temp.n('owner'), 0::bigint, 'the creator is the actor here: nothing');
select is(pg_temp.total(), 2::bigint, 'two rows');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.task_reopen(pg_temp.fx('t1'), 'Client changed their mind');
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_reopened') + pg_temp.n('coord', 'task_reopened'), 2::bigint, 'a reopen reaches the assignees');
select is((pg_temp.last('staff1', 'task_reopened')).body, 'Client changed their mind', 'with the reason');
select pg_temp.clear();
select pg_temp.as_member('admin1');
select public.task_cancel(pg_temp.fx('t1'), 'Shoot cancelled');
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_cancelled') + pg_temp.n('coord', 'task_cancelled') + pg_temp.n('owner', 'task_cancelled'), 3::bigint,
  'a cancellation by the approver reaches the assignees and the creator');
select is(pg_temp.n('admin1'), 0::bigint, 'the actor none');

-- A task an Admin creates and completes with themselves as creator: one row per person.
select pg_temp.clear();
select pg_temp.as_member('admin1');
insert into fx values ('t2', pg_temp.mk('Bakery post', array['staff1'], 'staff1', 'admin1', 'client_a'));
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('t2'));
select pg_temp.as_system();
select is(pg_temp.n('admin1', 'task_submitted'), 1::bigint, 'Done reaches the Admin who is creator and approver, once');
-- The new approver while submitted (kickoff 5 decision 2).
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.task_set_approver(pg_temp.fx('t2'), pg_temp.fx('admin2'));
select pg_temp.as_system();
select is(pg_temp.n('admin2', 'task_submitted'), 1::bigint, 'a new approving Admin gets the submitted notification');
select is((pg_temp.last('admin2', 'task_submitted')).body, 'Waiting for your review (the Owner made you its approver).', 'worded for the change');
select is(pg_temp.total(), 1::bigint, 'nobody else');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.task_set_approver(pg_temp.fx('t2'), null);
select pg_temp.as_system();
select is(pg_temp.total(), 0::bigint, 'removing the approver (the task goes to the Owner, the actor) tells nobody');
-- No Admin step: Done reaches the Owner.
select pg_temp.clear();
select pg_temp.as_member('owner');
insert into fx values ('t3', pg_temp.mk('Direct', array['staff2'], 'staff2'));
select pg_temp.clear();
select pg_temp.as_member('staff2');
select public.task_submit_done(pg_temp.fx('t3'));
select pg_temp.as_system();
select is(pg_temp.n('owner', 'task_submitted'), 1::bigint, 'with no Admin step, Done reaches the Owner');
select is(pg_temp.total(), 1::bigint, 'only');

-- 6. Task requests ------------------------------------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into fx values ('r1', public.task_request_create('Anniversary post', 'For the Sharmas', pg_temp.fx('client_a')));
select pg_temp.as_system();
select is(pg_temp.n('owner', 'task_request_created') + pg_temp.n('admin1', 'task_request_created'), 2::bigint,
  'a suggestion with a client reaches the Owner and the client''s Admin');
select is(pg_temp.total(), 2::bigint, 'and nobody else');
select is((select (x.title, x.body, x.link, x.entity, x.entity_id) from public.notifications x where x.recipient_id = pg_temp.fx('admin1'))::text,
  ('Suggested task: Anniversary post', 'Staff1 suggested it for Sharma Weddings.', '/tasks/requests', 'task_requests', pg_temp.fx('r1'))::text,
  'the row links the requests list');
select pg_temp.clear();
-- staff1 sees client_c (no Admin) as a label through a task of theirs.
update public.tasks set client_id = pg_temp.fx('client_c') where id = pg_temp.fx('t2');
select pg_temp.as_member('staff1');
insert into fx values ('r2', public.task_request_create('Cafe menu', null, pg_temp.fx('client_c')));
select pg_temp.as_system();
select is(pg_temp.n('owner', 'task_request_created'), 1::bigint, 'a client with no Admin: the Owner only (5A decision 20)');
select is(pg_temp.total(), 1::bigint, 'one row');
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into fx values ('r3', public.task_request_create('Team offsite'));
select pg_temp.as_system();
select is(pg_temp.n('owner', 'task_request_created') + pg_temp.n('admin1', 'task_request_created') + pg_temp.n('admin2', 'task_request_created'), 3::bigint,
  'no client: the Owner and every Admin');
select is(pg_temp.total(), 3::bigint, 'three rows');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.task_request_convert(pg_temp.fx('r1'), 'Anniversary post', null, pg_temp.type_id('Normal'), pg_temp.fx('client_a'), 'medium',
  pg_temp.due(), array[pg_temp.fx('staff2')], pg_temp.fx('staff2'), pg_temp.fx('admin1'));
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_request_converted'), 1::bigint, 'the requester is told their suggestion became a task');
select is(((pg_temp.last('staff1', 'task_request_converted')).link, (pg_temp.last('staff1', 'task_request_converted')).entity_id)::text,
  ('/tasks/requests', pg_temp.fx('r1'))::text, 'linking the request, never the task (decision 25)');
select is(pg_temp.n('staff2', 'task_assigned'), 1::bigint, 'and the new assignee is assigned');
select is(pg_temp.total(), 2::bigint, 'two rows');
select pg_temp.clear();
select pg_temp.as_member('admin2');
select public.task_request_decline(pg_temp.fx('r3'), 'Not this quarter');
select pg_temp.as_system();
select is((pg_temp.last('staff1', 'task_request_declined')).body, 'Not this quarter', 'a decline tells the requester why');
select is(pg_temp.total(), 1::bigint, 'and nobody else');
select pg_temp.clear();
select pg_temp.as_member('staff1');
select public.task_request_withdraw(pg_temp.fx('r2'));
select pg_temp.as_system();
select is(pg_temp.total(), 0::bigint, 'a withdrawal tells nobody');

-- 7. Leave and attendance ------------------------------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into fx values ('l1', public.leave_submit('leave', pg_temp.today() + 10, pg_temp.today() + 11, 'Family wedding'));
select pg_temp.as_system();
select is(pg_temp.n('owner', 'leave_requested'), 1::bigint, 'a leave request reaches the Owner');
select is(pg_temp.total(), 1::bigint, 'only');
select is((select (x.title, x.body, x.link, x.entity_id) from public.notifications x where x.recipient_id = pg_temp.fx('owner'))::text,
  ('Staff1 requested leave', app.notify_date(pg_temp.today() + 10) || ' to ' || app.notify_date(pg_temp.today() + 11) || ' · Family wedding',
   '/approvals', pg_temp.fx('l1'))::text,
  'the dates and the reason, linking Approvals');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.leave_decide(pg_temp.fx('l1'), 'approve');
select pg_temp.as_system();
select is((pg_temp.last('staff1', 'leave_decided')).title, 'Leave approved', 'the member is told of the approval');
select is((pg_temp.last('staff1', 'leave_decided')).link, '/leave', 'linking their Leave tab');
select is(pg_temp.total(), 1::bigint, 'one row');
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into fx values ('l1c', public.leave_request_change(pg_temp.fx('l1'), cancel => true));
select pg_temp.as_system();
select is((pg_temp.last('owner', 'leave_requested')).title, 'Staff1 asked to cancel their leave', 'a cancellation request reaches the Owner');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.leave_decide(pg_temp.fx('l1c'), 'approve');
select pg_temp.as_system();
select is((pg_temp.last('staff1', 'leave_decided')).title, 'Leave cancelled, as you asked', 'an approved cancellation tells the member');
select is(pg_temp.total(), 1::bigint, 'once');
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into fx values ('l2', public.leave_submit('leave', pg_temp.today() + 20, pg_temp.today() + 20));
select pg_temp.as_member('owner');
select public.leave_decide(pg_temp.fx('l2'), 'reject', 'Shoot that day');
select pg_temp.as_system();
select is((pg_temp.last('staff1', 'leave_decided')).body, app.notify_date(pg_temp.today() + 20) || ' · Shoot that day', 'a rejection carries the reason');
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into fx values ('l3', public.leave_submit('leave', pg_temp.today() + 30, pg_temp.today() + 31));
select pg_temp.as_member('owner');
select public.leave_decide(pg_temp.fx('l3'), 'approve');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.leave_owner_edit(pg_temp.fx('l3'), 'leave', pg_temp.today() + 30, pg_temp.today() + 30, 'Half the span');
select pg_temp.as_system();
select is((pg_temp.last('staff1', 'leave_decided')).title, 'Leave changed by the Owner', 'an Owner edit tells the member');
select is((pg_temp.last('staff1', 'leave_decided')).body, 'Now leave, ' || app.notify_date(pg_temp.today() + 30) || ' · Half the span', 'with the new dates');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.leave_owner_cancel((select r.id from public.leave_requests r where r.supersedes_id = pg_temp.fx('l3')), 'Needed on set');
select pg_temp.as_system();
select is((pg_temp.last('staff1', 'leave_decided')).title, 'Leave cancelled by the Owner', 'an Owner cancellation tells the member');
select is(pg_temp.total(), 1::bigint, 'once');

-- "Take today as leave" (5A decision 19) and the attendance decision.
select pg_temp.clear();
select pg_temp.as_member('staff2');
select public.attendance_choose_leave_today('half_day', 'Doctor');
select pg_temp.as_system();
select is((pg_temp.last('owner', 'leave_requested')).title, 'Staff2 requested a half day', '"Take today as leave" reaches the Owner like a leave request');
select is((pg_temp.last('owner', 'leave_requested')).body, app.notify_date(pg_temp.today()) || ' · Doctor', 'with today and the reason');
select is(pg_temp.total(), 1::bigint, 'one row');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.attendance_decide((select d.id from public.attendance_days d where d.member_id = pg_temp.fx('staff2') and d.work_date = pg_temp.today()), 'approve');
select pg_temp.as_system();
select is((pg_temp.last('staff2', 'attendance_decided')).title, app.notify_date(pg_temp.today()) || ': approved as Half day', 'the member is told of the decision');
select is((pg_temp.last('staff2', 'attendance_decided')).link, '/leave/attendance', 'linking their Attendance tab');
select is(pg_temp.total(), 1::bigint, 'once');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.attendance_decide((select d.id from public.attendance_days d where d.member_id = pg_temp.fx('staff2') and d.work_date = pg_temp.today()), 'correct', 'present', 'Came in after all');
select pg_temp.as_system();
select is((pg_temp.last('staff2', 'attendance_decided')).title, app.notify_date(pg_temp.today()) || ': corrected to Present', 'and of a correction');
select is((pg_temp.last('staff2', 'attendance_decided')).body, 'Came in after all', 'with the reason');

-- 8. Comp leave, extra work, the holiday release ---------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('owner');
insert into fx values ('c1', public.comp_leave_grant(pg_temp.fx('staff1'), 1.0, 'For the Sunday shoot'));
select pg_temp.as_system();
select is((pg_temp.last('staff1', 'comp_leave_granted')).title, 'Comp leave granted: 1 day · use by ' || app.notify_date(app.ist_month_end(pg_temp.today())),
  'a standalone grant tells the member, with the days (their own row: decision 24)');
select is((pg_temp.last('staff1', 'comp_leave_granted')).body, 'For the Sunday shoot', 'and the note');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.comp_leave_grant(pg_temp.fx('staff1'), 0.5, null, '00000000-0000-4000-8000-0000000000aa');
select public.comp_leave_grant(pg_temp.fx('staff1'), 0.5, null, '00000000-0000-4000-8000-0000000000aa');
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'comp_leave_granted'), 1::bigint, 'a retried grant (same key) tells once');
select pg_temp.clear();
select pg_temp.as_member('staff1');
-- Today: a credit expires at the end of its IST month, and the file must pass on the last day too.
insert into fx values ('cl', public.leave_submit_comp(pg_temp.today()));
select pg_temp.as_system();
select is((pg_temp.last('owner', 'leave_requested')).title, 'Staff1 requested comp leave', 'a comp leave request reaches the Owner');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.leave_decide(pg_temp.fx('cl'), 'approve');
select pg_temp.as_system();
select is((pg_temp.last('staff1', 'leave_decided')).title, 'Comp leave approved', 'and its approval the member');
select pg_temp.clear();
select pg_temp.as_member('owner');
insert into public.holidays (date, name) values (pg_temp.today(), 'Founders Day');
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'leave_decided'), 1::bigint, 'a holiday on the comp leave day tells the person (5A decision 16)');
select is((pg_temp.last('staff1', 'leave_decided')).body,
  'Your comp leave on ' || app.notify_date(pg_temp.today()) || ' was cancelled because it''s now a holiday; the credit is back.',
  'with the decision-16 wording');
select is(pg_temp.total(), 1::bigint, 'one row');
delete from public.holidays;
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.comp_leave_revoke((select c.id from public.comp_leave_credits c where c.member_id = pg_temp.fx('staff1') and c.days = 0.5), 'Granted by mistake');
select pg_temp.as_system();
select is(((pg_temp.last('staff1', 'comp_leave_revoked')).title, (pg_temp.last('staff1', 'comp_leave_revoked')).body)::text,
  ('Comp leave revoked: ½ day', 'Granted by mistake')::text, 'a revoke tells the member why');
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into fx values ('n1', public.extra_work_note_submit('overtime', pg_temp.today() - 1, 'Colour grade for the reel', 90));
select pg_temp.as_system();
select is((pg_temp.last('owner', 'extra_work_submitted')).title, 'Staff1 added an overtime note', 'an overtime note reaches the Owner');
-- The payload's ids are random uuids that may hold "90": the check looks past them (as e260128).
select ok((pg_temp.last('owner', 'extra_work_submitted')).body not like '%90%'
          and ((pg_temp.last('owner', 'extra_work_submitted')).payload - 'note_id' - 'member_id')::text not like '%90%'
          and (pg_temp.last('owner', 'extra_work_submitted')).payload ? 'note_id',
  'the minutes never appear (decision 24)');
select is(pg_temp.total(), 1::bigint, 'one row');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.extra_work_note_decide(pg_temp.fx('n1'), 'grant', 1.0, false, 'Well done');
select pg_temp.as_system();
select is((pg_temp.last('staff1', 'extra_work_decided')).title, 'Comp leave granted: 1 day · use by ' || app.notify_date(app.ist_month_end(pg_temp.today())),
  'a grant on a note tells the member');
select is((pg_temp.last('staff1', 'extra_work_decided')).link, '/leave/extra-work', 'linking their Extra work tab');
select is(pg_temp.n('staff1'), 1::bigint, 'one row (the credit itself adds none)');
select pg_temp.clear();
select pg_temp.as_member('staff2');
insert into fx values ('n2', public.extra_work_note_submit('overtime', pg_temp.today() - 1, 'Late edit'));
select pg_temp.as_member('owner');
select public.extra_work_note_decide(pg_temp.fx('n2'), 'no_comp_leave');
select pg_temp.as_system();
select is((pg_temp.last('staff2', 'extra_work_decided')).title, 'Your extra work note was reviewed', 'a review with no comp leave is neutral');

-- 9. Expense claims: never an amount ----------------------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into fx values ('x1', public.expense_claim_submit(pg_temp.today(), 123.45,
  (select li.id from public.list_items li where li.list_key = 'expense_category' and li.name = 'Travel' and li.org_id = pg_temp.fx('org')),
  'Cab to the venue'));
select pg_temp.as_system();
select is((pg_temp.last('owner', 'expense_submitted')).title, 'Staff1 added an expense claim', 'a claim reaches the Owner');
select is((pg_temp.last('owner', 'expense_submitted')).body, 'Travel · ' || app.notify_date(pg_temp.today()), 'the category and the date');
select ok((select x.title || coalesce(x.body, '') || coalesce(x.link, '') || x.payload::text from public.notifications x
           where x.recipient_id = pg_temp.fx('owner')) !~ '123[.,]45|amount|₹',
  'no amount anywhere in the row (invariant 2)');
select is(pg_temp.total(), 1::bigint, 'one row');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.expense_claim_decide(pg_temp.fx('x1'), 'approve');
select pg_temp.as_system();
select is((pg_temp.last('staff1', 'expense_decided')).title, 'Expense claim approved', 'the member is told of the approval');
select ok((select x.title || coalesce(x.body, '') || x.payload::text from public.notifications x where x.recipient_id = pg_temp.fx('staff1')) !~ '123[.,]45|amount|₹',
  'without the amount');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.expense_claim_mark_paid(pg_temp.fx('x1'));
select pg_temp.as_system();
select is(((pg_temp.last('staff1', 'expense_decided')).title, (pg_temp.last('staff1', 'expense_decided')).body, (pg_temp.last('staff1', 'expense_decided')).link)::text,
  ('Expense claim paid', app.notify_date(pg_temp.today()) || ' · paid on ' || app.notify_date(pg_temp.today()), '/leave/expenses')::text,
  'and of the payment, linking their Expenses tab');
select pg_temp.clear();
select pg_temp.as_member('staff2');
insert into fx values ('x2', public.expense_claim_submit(pg_temp.today(), 40,
  (select li.id from public.list_items li where li.list_key = 'expense_category' and li.name = 'Travel' and li.org_id = pg_temp.fx('org')),
  'Auto'));
select pg_temp.as_member('owner');
select public.expense_claim_decide(pg_temp.fx('x2'), 'reject', 'No receipt');
select pg_temp.as_system();
select is(((pg_temp.last('staff2', 'expense_decided')).title, (pg_temp.last('staff2', 'expense_decided')).body)::text,
  ('Expense claim rejected', app.notify_date(pg_temp.today()) || ' · No receipt')::text, 'a rejection carries the reason');

-- 10. Team: coordinators --------------------------------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('owner');
insert into fx values ('bina', public.member_add_freelancer('Bina', null, null, pg_temp.fx('coord')));
select pg_temp.as_system();
select is(((pg_temp.last('coord', 'coordinator_assigned')).title, (pg_temp.last('coord', 'coordinator_assigned')).link)::text,
  ('You now coordinate Bina', null)::text, 'a new freelancer tells the coordinator (no People link for Staff)');
select is(pg_temp.total(), 1::bigint, 'one row');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.member_set_coordinator(pg_temp.fx('bina'), pg_temp.fx('admin1'), 'Workload');
select pg_temp.as_system();
select is(((pg_temp.last('admin1', 'coordinator_assigned')).title, (pg_temp.last('admin1', 'coordinator_assigned')).link)::text,
  ('You now coordinate Bina', '/people/' || pg_temp.fx('bina'))::text, 'the new coordinator is told (an Admin gets the People link)');
select is((pg_temp.last('coord', 'coordinator_removed')).title, 'Bina now has another coordinator', 'the previous coordinator is told');
select ok((pg_temp.last('coord', 'coordinator_removed')).link is null
          and coalesce((pg_temp.last('coord', 'coordinator_removed')).body, '') not like '%Workload%',
  'without a link or the reason (Kickoff 4 decision 20)');
select is(pg_temp.total(), 2::bigint, 'two rows; the actor none');
-- A deactivated coordinator (5A decision 17): Bina is deactivated first (an active freelancer blocks).
select pg_temp.clear();
select pg_temp.as_member('admin1');
select public.push_subscription_upsert('https://push.example/adm1', pg_temp.p256('k'), pg_temp.auth16('a'));
select pg_temp.as_member('owner');
select public.member_deactivate(pg_temp.fx('bina'), 'Contract ended');
select pg_temp.as_system();
select is(pg_temp.total(), 0::bigint, 'deactivating a freelancer tells nobody');
-- A coordinator set on the deactivated freelancer, to prepare her return (4A review M2).
select pg_temp.as_member('owner');
select public.member_set_coordinator(pg_temp.fx('bina'), pg_temp.fx('admin1'), 'For her return');
select pg_temp.clear();
-- admin1 runs Sharma Weddings: moved first (as the system), since a client's Admin cannot leave.
update public.clients set admin_id = pg_temp.fx('admin2') where id = pg_temp.fx('client_a');
select pg_temp.as_member('owner');
select public.member_deactivate(pg_temp.fx('admin1'), 'Left the company');
select pg_temp.as_system();
-- 5.1 review (L2): past the CONFLICT check the closed rows belong to deactivated freelancers, who
-- need no coordinator, so the decision-17 row is not written for them (its wording and the
-- no-actor form are checked on the function's text below; 41_ covers the paths).
select is(pg_temp.n('owner', 'coordinator_missing'), 0::bigint,
  'a deactivated coordinator of a deactivated freelancer: no "choose one" to-do for the Owner (5.1 review L2)');
select is((select count(*) from public.member_coordinators mc where mc.member_id = pg_temp.fx('bina') and mc.to_at is null), 0::bigint,
  'the row is closed with the leaver all the same (4A review M2)');
select ok((select p.prosrc from pg_proc p where p.oid = 'public.member_deactivate(uuid, text)'::regprocedure)
          like '%has no coordinator: choose one%',
  'the decision-17 wording is there for an active freelancer');
select is(pg_temp.total(), 0::bigint, 'no row');
select is((select count(*) from public.push_subscriptions s where s.member_id = pg_temp.fx('admin1')
           and s.disabled_reason = 'deactivated' and s.disabled_at is not null), 2::bigint,
  'their push subscriptions (both devices) are disabled');

-- 11. Clients: the Admin, and the combined hand-over ----------------------------------------------------
-- admin1 comes back (as the seed path would) to be a live previous Admin.
update public.members set status = 'active', deactivated_at = null where id = pg_temp.fx('admin1');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.client_assign_admin(pg_temp.fx('client_a'), pg_temp.fx('admin1'));
select pg_temp.as_system();
select is(((pg_temp.last('admin1', 'client_admin_assigned')).title, (pg_temp.last('admin1', 'client_admin_assigned')).link)::text,
  ('You now run Sharma Weddings', '/clients/' || pg_temp.fx('client_a'))::text, 'the new Admin is told, linking the client');
select is((pg_temp.last('admin2', 'client_admin_removed')).title, 'A client was handed to another Admin', 'the previous Admin is told');
select ok((pg_temp.last('admin2', 'client_admin_removed')).link is null
          and coalesce((pg_temp.last('admin2', 'client_admin_removed')).body, '') not like '%Sharma%'
          and (pg_temp.last('admin2', 'client_admin_removed')).entity is null,
  'without the client named or linked (decision 25)');
select is(pg_temp.total(), 2::bigint, 'two rows; the Owner (the actor) none');
select pg_temp.clear();
update public.clients set admin_id = pg_temp.fx('admin1') where id = pg_temp.fx('client_c');
select pg_temp.as_member('owner');
select public.client_hand_over(pg_temp.fx('admin1'), jsonb_build_array(
  jsonb_build_object('client_id', pg_temp.fx('client_a'), 'admin_id', pg_temp.fx('admin2')),
  jsonb_build_object('client_id', pg_temp.fx('client_c'), 'admin_id', pg_temp.fx('admin2'))));
select pg_temp.as_system();
select is(pg_temp.n('admin2', 'client_admin_assigned'), 1::bigint, 'a hand-over of two clients: one combined row for the new Admin (5A decision 18)');
select is(((pg_temp.last('admin2', 'client_admin_assigned')).title, (pg_temp.last('admin2', 'client_admin_assigned')).body, (pg_temp.last('admin2', 'client_admin_assigned')).link)::text,
  ('You now run 2 clients', 'No Admin Cafe, Sharma Weddings · handed to you by Owner.', '/clients')::text, 'listing the clients');
select is(pg_temp.n('admin1', 'client_admin_removed'), 1::bigint, 'and one row for the previous Admin');
select is((pg_temp.last('admin1', 'client_admin_removed')).title, '2 clients were handed to other Admins', 'counting, not naming');
select is(pg_temp.total(), 2::bigint, 'two rows in all, not one per client');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.client_hand_over(pg_temp.fx('admin2'), jsonb_build_array(
  jsonb_build_object('client_id', pg_temp.fx('client_a'), 'admin_id', pg_temp.fx('admin1'))));
select pg_temp.as_system();
select is((pg_temp.last('admin1', 'client_admin_assigned')).title, 'You now run Sharma Weddings', 'a hand-over of one client reads like a plain assignment');
select is(pg_temp.total(), 2::bigint, 'and tells the two Admins once each');

-- 12. The jobs --------------------------------------------------------------------------------------------
select pg_temp.clear();
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.comp_leave_credit_uses;
delete from public.leave_requests;
-- Nobody has a day for the job's dates: everyone with attendance is proposed absent, once per run.
select ok((select count(*) from app.absent_check() where outcome = 'proposed_absent') >= 5, 'the 23:59 job proposed absences');
select is(pg_temp.n('owner', 'absent_proposed'), 1::bigint, 'the Owner got one row for the run');
select is(pg_temp.total(), 1::bigint, 'and nobody else anything');
select ok((pg_temp.last('owner', 'absent_proposed')).title like '% people proposed absent'
          and (pg_temp.last('owner', 'absent_proposed')).body like '%Staff1 (%'
          and (pg_temp.last('owner', 'absent_proposed')).link = '/approvals'
          and (pg_temp.last('owner', 'absent_proposed')).actor_id is null,
  'listing the people and dates, linking Approvals, no actor');
select is((select count(*) from app.absent_check()), 0::bigint, 'a second run writes nothing');
select is(pg_temp.n('owner', 'absent_proposed'), 1::bigint, 'and tells nothing');
-- The 20:30 reminder: once per person and day, from the org''s time on.
select pg_temp.clear();
insert into public.attendance_days (member_id, work_date, started_at, is_day_off)
values (pg_temp.fx('staff1'), pg_temp.today(), app.ist_day_start(pg_temp.today()) + interval '9 hours 30 minutes', false);
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '19 hours'), 0, 'before logout_reminder_time nothing is sent');
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '20 hours 30 minutes'), 1, 'at 20:30 the person with an open day is reminded');
select is(((pg_temp.last('staff1', 'end_day_reminder')).title, (pg_temp.last('staff1', 'end_day_reminder')).body, (pg_temp.last('staff1', 'end_day_reminder')).link)::text,
  ('You haven''t ended your day', 'Started at 09:30. If you''re done, end it; if you''re working late, carry on.', '/my-day')::text,
  'with the 3b.1 wording, linking My Day');
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '20 hours 35 minutes'), 0, 'the next run five minutes later sends nothing again');
select is(pg_temp.total(), 1::bigint, 'one row for the day');

select * from finish();
rollback;
