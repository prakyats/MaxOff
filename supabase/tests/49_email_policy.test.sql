-- 5B decision 12 (owner, 2026-10-01; migration task_assigned_fallback_only): the email policy
-- among the 5.1 kinds. Task assigned is no longer always emailed: push and in-app, and email only
-- as the fallback for a member with no working push. Fallback only: changes requested, the
-- leave / attendance / extra-work decisions, comp leave granted or taken back, an expense decided.
-- Never email: everything else (comments, task changed, suggestions, approvals, the end-day
-- reminder, information rows). The always-emailed kinds of decision 12 arrive with 5.3 / 5.4.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000000f11'),
  ('staff1', '00000000-0000-4000-8000-000000000f12'),
  ('staff2', '00000000-0000-4000-8000-000000000f13');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('staff1', 'staff'), ('staff2', 'staff')) as v(k, r);

-- A row as app.notify() writes it; its id.
create function pg_temp.note(k text, kind text, title text) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform app.notify(array[pg_temp.fx(k)], kind, title, null, '/tasks', null, null, '{}', null, 0);
  select n.id into v_id from public.notifications n
  where n.recipient_id = pg_temp.fx(k) and n.kind = $2 and n.title = $3 order by n.created_at desc limit 1;
  update public.notifications set created_at = now() - interval '1 hour' where id = v_id;
  return v_id;
end;
$$;
create function pg_temp.mail(n uuid) returns text language sql stable as $$
  select coalesce((select d.state from public.notification_deliveries d
                   where d.notification_id = n and d.channel = 'email'), 'none');
$$;

-- 1. The flags --------------------------------------------------------------------------------------------
select is((select always_email from public.notification_kinds where kind = 'task_assigned'), false,
  'task assigned is no longer always emailed');
select is((select actionable from public.notification_kinds where kind = 'task_assigned'), true,
  'task assigned stays an email fallback for a member with no working push');
select is((select array_agg(kind order by kind) from public.notification_kinds where actionable),
  array['attendance_decided', 'comp_leave_granted', 'comp_leave_revoked', 'expense_decided', 'extra_work_decided',
        'leave_decided', 'task_assigned', 'task_changes_requested'],
  'fallback only: assigned, changes requested, the leave / attendance / extra-work decisions, comp leave, an expense decided');
select is((select count(*) from public.notification_kinds where always_email and kind not like 'reminder\_%' and kind not like 'escalation\_%' and kind <> 'owner_digest'), 0::bigint,
  'no 5.1 kind is always emailed (5.3''s reminders and escalations are 51''s, the Owner digest 55''s)');
select is((select array_agg(kind order by kind) from public.notification_kinds
           where kind in ('task_comment', 'task_changed', 'task_request_created', 'task_submitted',
                          'leave_requested', 'end_day_reminder', 'task_completed',
                          'reminder_before_due', 'reminder_due_now', 'reminder_not_noted')
             and not actionable and not always_email),
  array['end_day_reminder', 'leave_requested', 'reminder_before_due', 'reminder_due_now', 'reminder_not_noted',
        'task_changed', 'task_comment', 'task_completed', 'task_request_created', 'task_submitted'],
  'push and in-app only: comments, task changed, suggestions, approvals, the end-day reminder, the earlier reminders (2 days before, Due now), the not-noted repeats, information rows');

-- 2. What email_claim queues ------------------------------------------------------------------------------
-- staff1 has a working push device; staff2 has none.
insert into public.push_subscriptions (member_id, endpoint, p256dh, auth)
values (pg_temp.fx('staff1'), 'https://push.example/policy', 'k', 'a');
insert into fx values ('assigned_push', pg_temp.note('staff1', 'task_assigned', 'Assigned, has push'));
insert into fx values ('assigned_none', pg_temp.note('staff2', 'task_assigned', 'Assigned, no push'));
insert into fx values ('comment_none', pg_temp.note('staff2', 'task_comment', 'A comment'));
select is((select count(*) from public.email_claim(now(), 50)), 1::bigint, 'one email is handed out');
select is(pg_temp.mail(pg_temp.fx('assigned_push')), 'none', 'task assigned to someone with push: no email');
select is(pg_temp.mail(pg_temp.fx('assigned_none')), 'queued', 'task assigned to someone with no push: the fallback email');
select is(pg_temp.mail(pg_temp.fx('comment_none')), 'none', 'a comment: never, push or not');

select * from finish();
rollback;
