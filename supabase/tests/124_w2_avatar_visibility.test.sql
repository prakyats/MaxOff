-- v1.9 W2 (ROADMAP 6b.3; owner 2026-10-08, kickoff 6b decision 5; migration w2_avatar_visibility;
-- PERMISSIONS §3 "Profile photos"): every active member may see every member's profile photo.
-- app.file_visible() and the files RLS for each role: the Owner, an Admin, another Admin, Crew
-- (their own and another Crew member's photo, and its preview), allowed; a deactivated member, a
-- sign-in on a freelancer's id, anon and a member of another organisation, denied. And proof that
-- nothing else is widened: a replaced (archived) photo, a loose upload, an expense receipt and a
-- client logo the viewer could not read before stay unreadable.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

delete from public.deliverable_templates;
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

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',       '00000000-0000-4000-8000-000000012401'),
  ('admin',       '00000000-0000-4000-8000-000000012402'),
  ('admin2',      '00000000-0000-4000-8000-000000012403'),
  ('staff',       '00000000-0000-4000-8000-000000012404'),
  ('staff2',      '00000000-0000-4000-8000-000000012405'),
  ('gone',        '00000000-0000-4000-8000-000000012406'),
  ('free',        '00000000-0000-4000-8000-000000012407'),
  ('other_staff', '00000000-0000-4000-8000-000000012408'),
  ('org2',        '00000000-0000-4000-8000-0000000124f0'),
  ('client_b',    '00000000-0000-4000-8000-0000000124b1'),
  ('av_old',      '00000000-0000-4000-8000-0000000124e1'),
  ('av2',         '00000000-0000-4000-8000-0000000124e2'),
  ('av2_prev',    '00000000-0000-4000-8000-0000000124e3'),
  ('av_gone',     '00000000-0000-4000-8000-0000000124e4'),
  ('av_other',    '00000000-0000-4000-8000-0000000124e5'),
  ('loose',       '00000000-0000-4000-8000-0000000124e6'),
  ('receipt',     '00000000-0000-4000-8000-0000000124e7'),
  ('clogo',       '00000000-0000-4000-8000-0000000124e8'),
  ('av_staff',    '00000000-0000-4000-8000-0000000124e9');
insert into fx select 'org', id from public.organizations where id <> '00000000-0000-4000-8000-0000000124f0' limit 1;
grant select on fx to authenticated, anon, service_role;

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

-- What the storage actions do for a member: file_begin and file_complete on the service client.
create function pg_temp.upload(k text, who text, fname text, original text default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform public.file_begin(pg_temp.fx(k), pg_temp.fx(who), fname, 'image/jpeg', 2000,
    case when original is null then null else pg_temp.fx(original) end);
  perform public.file_complete(pg_temp.fx(k), pg_temp.fx(who), 2000);
  perform pg_temp.as_member(who);
end;
$$;

create function pg_temp.sees(k text) returns bigint language sql stable as $$
  select count(*) from public.files where id = pg_temp.fx(k);
$$;

-- People: one organisation with every role, a member to deactivate and a freelancer; a second
-- organisation with one Crew member.
-- The organisation-1 members first (the client's insert guard needs its Admin), then the client;
-- the second organisation and its member come after every other fixture row (below), because
-- with two organisations an audit row that carries no org column cannot resolve its organisation.
insert into public.members (id, org_id, full_name, email, phone, role, status, joined_at) values
  (pg_temp.fx('owner'),       pg_temp.fx('org'),  'Test Owner',  'owner@example.com',  '9000000001', 'owner', 'active', now()),
  (pg_temp.fx('admin'),       pg_temp.fx('org'),  'Test Admin',  'admin@example.com',  null,         'admin', 'active', now()),
  (pg_temp.fx('admin2'),      pg_temp.fx('org'),  'Other Admin', 'admin2@example.com', null,         'admin', 'active', now()),
  (pg_temp.fx('staff'),       pg_temp.fx('org'),  'Test Crew',   'staff@example.com',  null,         'staff', 'active', now()),
  (pg_temp.fx('staff2'),      pg_temp.fx('org'),  'Other Crew',  'staff2@example.com', null,         'staff', 'active', now()),
  (pg_temp.fx('gone'),        pg_temp.fx('org'),  'Gone Crew',   'gone@example.com',   null,         'staff', 'active', now());
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at) values
  (pg_temp.fx('free'), pg_temp.fx('org'), 'Free Lancer', null, 'staff', 'active', 'freelance', now());
insert into public.clients (id, org_id, name, admin_id) values
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Client B', pg_temp.fx('admin2'));

-- Files: staff2's first photo, replaced by a second one with its preview; Crew's own photo; the
-- photo of a member about to be deactivated; another organisation's photo; staff2's loose upload
-- and expense receipt; admin2's client logo.
select pg_temp.upload('av_old', 'staff2', 'old.jpg');
update public.members set avatar_file_id = pg_temp.fx('av_old') where id = pg_temp.fx('staff2');
select pg_temp.upload('av2', 'staff2', 'me.jpg');
select pg_temp.upload('av2_prev', 'staff2', 'me-preview.jpg', 'av2');
update public.members set avatar_file_id = pg_temp.fx('av2') where id = pg_temp.fx('staff2');
select pg_temp.upload('loose', 'staff2', 'loose.jpg');
select pg_temp.upload('receipt', 'staff2', 'receipt.jpg');
select pg_temp.upload('av_staff', 'staff', 'crew.jpg');
update public.members set avatar_file_id = pg_temp.fx('av_staff') where id = pg_temp.fx('staff');
select pg_temp.upload('av_gone', 'gone', 'gone.jpg');
update public.members set avatar_file_id = pg_temp.fx('av_gone') where id = pg_temp.fx('gone');
select pg_temp.upload('clogo', 'admin2', 'client.jpg');
update public.client_brand set logo_file_id = pg_temp.fx('clogo') where client_id = pg_temp.fx('client_b');
select pg_temp.as_system();
insert into public.expense_claims (member_id, expense_date, amount, category_id, note, receipt_file_id)
select pg_temp.fx('staff2'), app.today_ist(), 900, li.id, 'Taxi', pg_temp.fx('receipt')
from public.list_items li
where li.org_id = pg_temp.fx('org') and li.list_key = 'expense_category' and li.name = 'Travel';
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('gone');
-- The second organisation last: from here an audit row with no org column cannot resolve one.
insert into public.organizations (id, name) values (pg_temp.fx('org2'), 'Other Org');
insert into public.members (id, org_id, full_name, email, phone, role, status, joined_at) values
  (pg_temp.fx('other_staff'), pg_temp.fx('org2'), 'Far Crew',    'far@example.com',    null,         'staff', 'active', now());
select pg_temp.upload('av_other', 'other_staff', 'far.jpg');
update public.members set avatar_file_id = pg_temp.fx('av_other') where id = pg_temp.fx('other_staff');
select pg_temp.as_system();

-- Setup as expected ------------------------------------------------------------------------------
select results_eq(
  $$ select id, archived_at is not null from public.files where id in (pg_temp.fx('av_old'), pg_temp.fx('av2')) order by name $$,
  $$ values (pg_temp.fx('av2'), false), (pg_temp.fx('av_old'), true) $$,
  'staff2''s first photo is archived by the replacement; the second is live');
select is((select avatar_file_id from public.members where id = pg_temp.fx('staff2')), pg_temp.fx('av2'),
  'staff2''s avatar is the second photo');

-- Allowed: every active member, any role --------------------------------------------------------
select pg_temp.as_member('owner');
select ok(app.file_visible(pg_temp.fx('av2')), 'the Owner sees a Crew member''s photo');
select is(pg_temp.sees('av2'), 1::bigint, 'and reads its row under RLS');

select pg_temp.as_member('admin');
select ok(app.file_visible(pg_temp.fx('av2')), 'an Admin sees a Crew member''s photo');
select is(pg_temp.sees('av_staff'), 1::bigint, 'and another Crew member''s');

select pg_temp.as_member('admin2');
select is(pg_temp.sees('av2'), 1::bigint, 'another Admin reads it too');

select pg_temp.as_member('staff');
select is(pg_temp.sees('av_staff'), 1::bigint, 'Crew read their own photo');
select ok(app.file_visible(pg_temp.fx('av2')), 'Crew see another Crew member''s photo (6b.3)');
select is(pg_temp.sees('av2'), 1::bigint, 'and read its row under RLS (what /api/files/<id> does)');
select is(pg_temp.sees('av2_prev'), 1::bigint, 'and its preview, which follows the original');
select is(
  (select id from public.files where preview_of = pg_temp.fx('av2') and status = 'ready'),
  pg_temp.fx('av2_prev'), 'the route''s preview lookup answers for Crew');
select ok(app.file_visible(pg_temp.fx('av_gone')),
  'a deactivated member''s current photo stays visible (every member''s photo, beside their name in history)');
select ok((select count(*) from public.activity_log where entity = 'files' and entity_id = pg_temp.fx('av2')) > 0,
  'Crew read the photo''s activity (the policy follows app.file_visible)');

select pg_temp.as_member('staff2');
select is(pg_temp.sees('av_staff'), 1::bigint, 'the other Crew member reads Crew''s photo the same way');

-- Denied: not an active member of this organisation ---------------------------------------------
select pg_temp.as_member('gone');
select ok(not app.file_visible(pg_temp.fx('av2')), 'a deactivated member sees no photo');
select is((select count(*) from public.files), 0::bigint, 'and reads no file row at all, not even their own');

select pg_temp.as_member('free');
select ok(not app.file_visible(pg_temp.fx('av2')), 'a sign-in on a freelancer''s id sees no photo (S-S3)');
select is((select count(*) from public.files), 0::bigint, 'and reads no file row');

select pg_temp.as_member('other_staff');
select ok(not app.file_visible(pg_temp.fx('av2')), 'a member of another organisation sees no photo of this one');
select is(pg_temp.sees('av2'), 0::bigint, 'and reads no row of it');
select is(pg_temp.sees('av_other'), 1::bigint, 'while reading their own organisation''s');
select pg_temp.as_member('staff');
select is(pg_temp.sees('av_other'), 0::bigint, 'and Crew here never read the other organisation''s photo');

select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.files $$, '42501', null, 'anon has no privilege on files');
select throws_ok($$ select app.file_visible(pg_temp.fx('av2')) $$, '42501', null,
  'anon cannot call app.file_visible');

-- Nothing else is widened -----------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(pg_temp.sees('av_old'), 0::bigint,
  'a replaced (archived) photo is no longer anyone''s avatar: Crew do not read it');
select ok(not app.file_visible(pg_temp.fx('loose')), 'Crew do not see another member''s loose upload');
select ok(not app.file_visible(pg_temp.fx('receipt')), 'nor another member''s expense receipt (ADR-0007)');
select ok(not app.file_visible(pg_temp.fx('clogo')), 'nor a client logo of a client they have no label for');
select pg_temp.as_member('admin');
select ok(not app.file_visible(pg_temp.fx('receipt')), 'an Admin still never sees a receipt (invariant 2)');
select ok(not app.file_visible(pg_temp.fx('loose')), 'nor a loose upload');
select ok(not app.file_visible(pg_temp.fx('av_old')), 'nor a replaced photo');
select ok(not app.file_visible(pg_temp.fx('clogo')), 'nor another Admin''s client logo');
select pg_temp.as_member('owner');
select ok(app.file_visible(pg_temp.fx('receipt')), 'the Owner still sees a receipt (expenses.decide, unchanged)');
select pg_temp.as_member('staff2');
select ok(app.file_visible(pg_temp.fx('av_old')), 'the uploader still sees their own replaced photo');

select * from finish();
rollback;
