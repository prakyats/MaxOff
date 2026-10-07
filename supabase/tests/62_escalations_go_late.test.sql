-- Escalations go late, reminders don't (migration escalations_go_late; owner 2026-10-06). When the job misses a
-- window, an escalation is sent on the next run if its condition still holds (the 24 h overdue escalation: the
-- task still open and overdue on the same deadline; the not-noted ones: still not noted); a before-due, Due
-- now, overdue or event reminder whose moment passed over an hour ago is skipped, never sent late.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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
  ('owner',  '00000000-0000-4000-8000-000000006201'),
  ('admin1', '00000000-0000-4000-8000-000000006202'),
  ('staff1', '00000000-0000-4000-8000-000000006203'),
  ('staff2', '00000000-0000-4000-8000-000000006204');
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
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.at(t interval) returns timestamptz language sql stable as $$
  select app.ist_day_start(app.today_ist()) + t;
$$;
create function pg_temp.mk(k text, due timestamptz, assignees text[], approver text default null) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member('owner');
  v_id := public.task_create(k, null, (select id from public.task_types where org_id = pg_temp.fx('org') and name = 'Normal'),
    null, 'medium', due, array(select pg_temp.fx(a) from unnest(assignees) a), pg_temp.fx(assignees[1]),
    case when approver is null then null else pg_temp.fx(approver) end);
  perform pg_temp.as_system();
  insert into fx values (k, v_id);
  return v_id;
end;
$$;
-- A task as it was before 5.3: not armed, no reminders, assigned `ago`.
create function pg_temp.legacy(k text, ago interval) returns void language sql as $$
  delete from public.task_reminders where task_id = pg_temp.fx(k);
  delete from public.task_reminder_arms where task_id = pg_temp.fx(k);
  update public.task_assignees set assigned_at = now() - ago where task_id = pg_temp.fx(k);
$$;
create function pg_temp.n(who text, kind text, task text default null) returns bigint language sql stable as $$
  select count(*) from public.notifications x
  where x.recipient_id = pg_temp.fx(who) and x.kind = $2 and ($3 is null or x.entity_id = pg_temp.fx($3));
$$;
create function pg_temp.open(k text) returns text language sql stable as $$
  select coalesce(string_agg(r.kind, ' ' order by r.fire_at, r.kind), '')
  from public.task_reminders r where r.task_id = pg_temp.fx(k) and r.member_id is null and r.sent_at is null and r.cancelled_at is null;
$$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('staff1', 'staff'), ('staff2', 'staff')) as v(k, r);
update public.task_types set default_reminders = '[]' where org_id = pg_temp.fx('org');
update public.org_settings set default_task_reminders = '[]', logout_reminder_time = '20:30', quiet_hours_start = '22:00',
  quiet_hours_end = '07:00', ack_repeat_hours = 2, ack_escalate_hours = 4, ack_escalate_owner_hours = 8, overdue_escalate_hours = 24
where org_id = pg_temp.fx('org');

-- Deadline rows written by hand as a missed job would have left them: due over an hour ago, unsent.
create function pg_temp.row_at(k text, kind text, fire timestamptz, deadline timestamptz default null) returns void language sql as $$
  insert into public.task_reminders (org_id, task_id, kind, deadline, fire_at, offset_minutes, last_before_due)
  values (pg_temp.fx('org'), pg_temp.fx(k), kind,
          coalesce(deadline, (select due_at from public.tasks where id = pg_temp.fx(k))), fire,
          case when kind = 'before_due' then 1440 end, false);
$$;
create function pg_temp.overdue_by(k text, ago interval) returns void language sql as $$
  update public.tasks set due_at = now() - ago where id = pg_temp.fx(k);
  delete from public.task_reminders where task_id = pg_temp.fx(k);
$$;

-- 1. The 24 h overdue escalation goes late while it still holds ----------------------------------------------
select pg_temp.mk('late', now() + interval '3 days', array['staff1'], 'admin1');
select pg_temp.overdue_by('late', interval '30 hours');
select pg_temp.row_at('late', 'overdue_escalation', now() - interval '6 hours');
select pg_temp.row_at('late', 'overdue', now() - interval '29 hours');
select pg_temp.mk('done', now() + interval '3 days', array['staff1'], 'admin1');
select pg_temp.overdue_by('done', interval '30 hours');
select pg_temp.row_at('done', 'overdue_escalation', now() - interval '6 hours');
update public.tasks set state = 'completed', completed_at = now() where id = pg_temp.fx('done');
select pg_temp.mk('moved', now() + interval '3 days', array['staff1'], 'admin1');
select pg_temp.overdue_by('moved', interval '30 hours');
select pg_temp.row_at('moved', 'overdue_escalation', now() - interval '6 hours', now() - interval '40 hours');

-- 2. Reminders whose moment passed are skipped ---------------------------------------------------------------
select pg_temp.mk('ahead', now() + interval '3 days', array['staff2']);
delete from public.task_reminders where task_id = pg_temp.fx('ahead');
select pg_temp.row_at('ahead', 'before_due', now() - interval '2 hours');
select pg_temp.row_at('ahead', 'due', now() - interval '90 minutes');
select pg_temp.row_at('ahead', 'event', now() - interval '3 hours');

-- 3. The not-noted escalations: the job missed hours, the condition still holds for one, not the other --------
select pg_temp.mk('unnoted', now() + interval '3 days', array['staff1'], 'admin1');
select pg_temp.mk('noted', now() + interval '3 days', array['staff2'], 'admin1');
update public.task_assignees set assigned_at = now() - interval '10 hours' where task_id in (pg_temp.fx('unnoted'), pg_temp.fx('noted'));
update public.task_reminder_arms set armed_at = now() - interval '10 hours' where task_id in (pg_temp.fx('unnoted'), pg_temp.fx('noted'));
select pg_temp.as_member('staff2');
select public.task_acknowledge(pg_temp.fx('noted'));
select pg_temp.as_system();
delete from public.notifications;

select lives_ok($$ select app.reminders_tick(now()) $$, 'the first run after the missed window');
select is(pg_temp.n('admin1', 'escalation_overdue', 'late'), 1::bigint,
  'a 24 h overdue escalation 6 h late: sent, the task still open and overdue');
select is(pg_temp.n('owner', 'escalation_overdue', 'late'), 1::bigint, 'to the Owner too');
select is(pg_temp.n('staff1', 'reminder_overdue', 'late'), 0::bigint, 'the overdue reminder whose moment passed: skipped');
select is((select count(*) from public.task_reminders where task_id = pg_temp.fx('late') and kind = 'overdue' and cancelled_at is not null),
  1::bigint, '(recorded as skipped)');
select is(pg_temp.n('admin1', 'escalation_overdue', 'done'), 0::bigint, 'a completed task: no late escalation');
select is(pg_temp.n('admin1', 'escalation_overdue', 'moved'), 0::bigint, 'a moved deadline: no late escalation');
select is(pg_temp.n('staff2', 'reminder_before_due', 'ahead') + pg_temp.n('staff2', 'reminder_before_due_last', 'ahead'), 0::bigint,
  'a before-due reminder 2 h late: skipped');
select is(pg_temp.n('staff2', 'reminder_due_now', 'ahead'), 0::bigint, 'a Due now 90 min late: skipped');
select is(pg_temp.n('staff2', 'reminder_event', 'ahead'), 0::bigint, 'an event reminder 3 h late: skipped');
select is(pg_temp.n('admin1', 'escalation_not_noted', 'unnoted'), 1::bigint,
  'a not-noted escalation the job missed by hours: sent, still not noted');
select is(pg_temp.n('owner', 'escalation_not_noted', 'unnoted'), 1::bigint, 'the Owner''s 8 h one too');
select is(pg_temp.n('admin1', 'escalation_not_noted', 'noted') + pg_temp.n('owner', 'escalation_not_noted', 'noted'), 0::bigint,
  'noted meanwhile: no escalation');
select is((select count(*) from public.task_reminders where task_id = pg_temp.fx('ahead') and sent_at is null and cancelled_at is null),
  0::bigint, 'nothing late is left waiting');

select * from finish();
rollback;
