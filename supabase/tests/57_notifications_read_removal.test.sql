-- 5B decision 11 (migration notifications_read_removal; owner 2026-10-01): read notifications older
-- than 90 days are removed with their deliveries; unread ones stay, however old; a read one newer
-- than 90 days stays. A dry run (the default) only counts. Service_role only. **Not scheduled**
-- until the owner's explicit OK: no cron job calls it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

delete from public.notifications;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('admin', '00000000-0000-4000-8000-000000005701'),
  ('staff', '00000000-0000-4000-8000-000000005702');
insert into fx select 'org', id from public.organizations limit 1;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;

insert into auth.users (id, email) select id, key || '-57@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k) || ' 57', k || '-57@example.com', k::public.member_role, 'active',
       now() - interval '200 days'
from unnest(array['admin', 'staff']) k;

-- n(key, recipient, age, read?)
create temporary table nx (key text primary key, id uuid not null default gen_random_uuid());
create function pg_temp.n(k text, who text, age interval, is_read boolean) returns void language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into nx (key, id) values (k, v_id);
  insert into public.notifications (id, org_id, recipient_id, kind, title, created_at, read_at)
  values (v_id, pg_temp.fx('org'), pg_temp.fx(who), 'task_comment', k, now() - age,
          case when is_read then now() - age + interval '1 hour' end);
  insert into public.notification_deliveries (notification_id, channel, state, created_at)
  values (v_id, 'push', 'sent', now() - age);
end;
$$;
create function pg_temp.exists_n(k text) returns boolean language sql stable as $$
  select exists (select 1 from public.notifications where id = (select id from nx where key = k));
$$;
create function pg_temp.deliveries(k text) returns bigint language sql stable as $$
  select count(*) from public.notification_deliveries where notification_id = (select id from nx where key = k);
$$;

select pg_temp.n('old_read', 'staff', interval '120 days', true);
select pg_temp.n('old_read_admin', 'admin', interval '91 days', true);
select pg_temp.n('old_unread', 'staff', interval '300 days', false);
select pg_temp.n('recent_read', 'staff', interval '89 days', true);
select pg_temp.n('new_unread', 'admin', interval '1 day', false);
-- Exactly at the boundary: 90 days old is not "older than 90 days".
insert into nx (key, id) values ('edge', gen_random_uuid());
insert into public.notifications (id, org_id, recipient_id, kind, title, created_at, read_at)
values ((select id from nx where key = 'edge'), pg_temp.fx('org'), pg_temp.fx('staff'), 'task_comment', 'edge',
        now() - interval '90 days', now() - interval '89 days');

-- Who may call it.
select ok(not has_function_privilege('authenticated', 'public.notifications_remove_read(timestamptz, boolean)', 'execute'),
  'a member cannot call it');
select ok(not has_function_privilege('anon', 'public.notifications_remove_read(timestamptz, boolean)', 'execute'),
  'anon cannot call it');
select ok(has_function_privilege('service_role', 'public.notifications_remove_read(timestamptz, boolean)', 'execute'),
  'service_role can');

-- Not scheduled.
select is((select count(*) from cron.job where command ilike '%notifications_remove_read%'), 0::bigint,
  'no cron job calls it: scheduling waits for the owner''s explicit OK');

-- The dry run (the default) counts and removes nothing.
select results_eq($$ select notifications, deliveries from public.notifications_remove_read(now()) $$,
  $$ values (2, 2) $$, 'a dry run counts 2 notifications and 2 deliveries (read, older than 90 days)');
select ok(pg_temp.exists_n('old_read') and pg_temp.exists_n('old_read_admin'), 'and removes nothing');

-- The real run.
select results_eq($$ select notifications, deliveries from public.notifications_remove_read(now(), false) $$,
  $$ values (2, 2) $$, 'the run removes the same 2 and their 2 deliveries');
select ok(not pg_temp.exists_n('old_read'), 'a read notification 120 days old is removed');
select ok(not pg_temp.exists_n('old_read_admin'), 'an Admin''s too: the rule is the same for everyone');
select is(pg_temp.deliveries('old_read'), 0::bigint, 'its deliveries went with it');
select ok(pg_temp.exists_n('old_unread'), 'an unread notification stays, however old');
select ok(pg_temp.exists_n('recent_read') and pg_temp.exists_n('edge'),
  'a read one 89 days old stays, and one exactly 90 days old');
select ok(pg_temp.exists_n('new_unread'), 'a new unread one stays');
select results_eq($$ select notifications, deliveries from public.notifications_remove_read(now(), false) $$,
  $$ values (0, 0) $$, 'a second run removes nothing');

select * from finish();
rollback;
