-- v1.9 W3 follow-up (owner 2026-10-22, issue #89; migration decision_emails_owner_answer; WORKFLOWS §9
-- "Decision emails"): good news is never emailed, not even as the fallback for someone with no working
-- push: a standalone comp leave grant (comp_leave_grant end to end), comp leave granted from an extra
-- work note, an expense claim marked paid. A declined extra work note, a revoked grant and a rejected
-- claim keep the fallback. Nobody here has push; the dispatcher's queue is the proof.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

delete from public.approval_reminder_sends;
delete from public.early_leave_requests;
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
delete from public.holidays;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '00000000-0000-4000-8000-000000012201'),
  ('staff1', '00000000-0000-4000-8000-000000012202');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
grant execute on function pg_temp.fx(text) to authenticated;
create function pg_temp.emailed(kind text, entity uuid) returns bigint language sql stable as $$
  select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
  where d.channel = 'email' and n.kind = $1 and n.entity_id = $2;
$$;

insert into auth.users (id, email) select id, key || '-122@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '-122@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('staff1', 'staff')) as v(k, r);

-- A standalone comp leave grant, end to end.
select set_config('request.jwt.claim.sub', pg_temp.fx('owner')::text, true);
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx('owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select public.comp_leave_grant(pg_temp.fx('staff1'), 1.0, 'Covered the weekend') $$,
  'the Owner grants comp leave');
reset role;
select is((select n.no_email from public.notifications n where n.kind = 'comp_leave_granted' and n.recipient_id = pg_temp.fx('staff1')),
  true, 'a standalone comp leave grant is never emailed');

-- The other kinds, through app.notify itself (the payload carries the decision).
select app.notify(array[pg_temp.fx('staff1')], 'extra_work_decided', 'Comp leave granted: 1 day', null, '/leave/extra-work',
  'extra_work_notes', '00000000-0000-4000-8000-000000012211', '{"decision": "grant"}'::jsonb, pg_temp.fx('owner'));
select app.notify(array[pg_temp.fx('staff1')], 'extra_work_decided', 'Your extra work note was reviewed', null, '/leave/extra-work',
  'extra_work_notes', '00000000-0000-4000-8000-000000012212', '{"decision": "no_comp_leave"}'::jsonb, pg_temp.fx('owner'));
select app.notify(array[pg_temp.fx('staff1')], 'expense_decided', 'Expense claim paid', null, '/leave/expenses',
  'expense_claims', '00000000-0000-4000-8000-000000012213', '{"decision": "paid"}'::jsonb, pg_temp.fx('owner'));
select app.notify(array[pg_temp.fx('staff1')], 'expense_decided', 'Expense claim rejected', null, '/leave/expenses',
  'expense_claims', '00000000-0000-4000-8000-000000012214', '{"decision": "reject"}'::jsonb, pg_temp.fx('owner'));
select app.notify(array[pg_temp.fx('staff1')], 'comp_leave_revoked', 'Comp leave taken back', null, '/leave',
  'comp_leave_credits', '00000000-0000-4000-8000-000000012215', '{}'::jsonb, pg_temp.fx('owner'));

select is((select n.no_email from public.notifications n where n.entity_id = '00000000-0000-4000-8000-000000012211'),
  true, 'comp leave granted from an extra work note is never emailed');
select is((select n.no_email from public.notifications n where n.entity_id = '00000000-0000-4000-8000-000000012212'),
  false, 'a declined extra work note keeps the fallback');
select is((select n.no_email from public.notifications n where n.entity_id = '00000000-0000-4000-8000-000000012213'),
  true, 'an expense claim marked paid is never emailed');
select is((select n.no_email from public.notifications n where n.entity_id = '00000000-0000-4000-8000-000000012214'),
  false, 'a rejected expense claim keeps the fallback');
select is((select n.no_email from public.notifications n where n.entity_id = '00000000-0000-4000-8000-000000012215'),
  false, 'a revoked grant keeps the fallback');

select lives_ok($$ select count(*) from public.email_claim(now(), 100) $$, 'the email run claims the fallbacks');
select is((select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where d.channel = 'email' and n.kind = 'comp_leave_granted'), 0::bigint, 'no email for the grant');
select is(pg_temp.emailed('extra_work_decided', '00000000-0000-4000-8000-000000012211')
          + pg_temp.emailed('expense_decided', '00000000-0000-4000-8000-000000012213'), 0::bigint,
  'no email for comp leave from a note or a paid claim');
select is(pg_temp.emailed('extra_work_decided', '00000000-0000-4000-8000-000000012212')
          + pg_temp.emailed('expense_decided', '00000000-0000-4000-8000-000000012214')
          + pg_temp.emailed('comp_leave_revoked', '00000000-0000-4000-8000-000000012215'), 3::bigint,
  'the declined note, the rejected claim and the revoked grant are emailed as the fallback');
select is((select count(*) from public.notifications n where n.recipient_id = pg_temp.fx('staff1')), 6::bigint,
  'every row is still in-app (and pushed when there is push)');

select * from finish();
rollback;
