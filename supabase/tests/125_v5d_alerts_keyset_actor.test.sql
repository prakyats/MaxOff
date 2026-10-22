-- v1.8 V5b-D (migration v5_alerts_keyset_actor): Alerts as one continuous list.
-- notifications_inbox_page() makes the same entries as notifications_inbox (same-record runs on one
-- IST day), read in keyset pages: "Show older" passes the newest row of the last entry shown and
-- gets the entries after it, never one twice and never one skipped, a run never split; the Unread
-- filter keeps the cursor's run whole even once its newest row is read. Each entry carries its
-- newest row's actor, with the name and photo the caller's directory shows (member_directory):
-- the Owner and Admins read every actor's, Crew only the people on their visible tasks; a job's
-- entry has none. Every role reads only their own entries; a signed-out caller is refused.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '00000000-0000-4000-8000-000000012501'),
  ('admin', '00000000-0000-4000-8000-000000012502'),
  ('staff', '00000000-0000-4000-8000-000000012503'),
  ('admin2', '00000000-0000-4000-8000-000000012504'),
  ('photo', '00000000-0000-4000-8000-0000000125e1');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;

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

-- An instant at an IST clock time, `days` before today.
create function pg_temp.ist(t time, days integer default 0) returns timestamptz language sql stable as $$
  select ((app.today_ist() - days) + t) at time zone 'Asia/Kolkata';
$$;

create function pg_temp.note(k text, who text, kind text, task uuid, has_link boolean, at timestamptz,
                             read boolean, actor text default null)
returns void language sql as $$
  insert into fx values (k, gen_random_uuid());
  insert into public.notifications (id, org_id, recipient_id, actor_id, kind, title, link, entity, entity_id, created_at, read_at)
  values (pg_temp.fx(k), pg_temp.fx('org'), pg_temp.fx(who),
          case when actor is null then null else pg_temp.fx(actor) end, kind, 'Note ' || k,
          case when has_link then '/tasks/' || task else null end, 'tasks', task, at,
          case when read then at else null end);
$$;

-- One page as the caller sees it, by fixture key; `after` is the key of the last entry shown.
create function pg_temp.page(p_unread boolean, after text default null, p_limit integer default 20)
returns text[] language sql as $$
  select coalesce(array_agg(f.key order by i.ord), '{}')
  from public.notifications_inbox_page(
         p_unread,
         (select n.created_at from public.notifications n where n.id = pg_temp.fx(after)),
         pg_temp.fx(after),
         p_limit) with ordinality as i(id, kind, title, body, link, created_at, run_size, run_kinds,
                                        run_unread, actor_id, actor_name, actor_avatar_file_id, ord)
  join fx f on f.id = i.id;
$$;

create function pg_temp.entry(k text)
returns table (run_size integer, actor_id uuid, actor_name text, actor_avatar_file_id uuid)
language sql as $$
  select i.run_size, i.actor_id, i.actor_name, i.actor_avatar_file_id
  from public.notifications_inbox_page(false, null, null, 50) i
  where i.id = pg_temp.fx(k);
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key in ('owner', 'admin', 'staff', 'admin2');
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('staff', 'staff'), ('admin2', 'admin')) as v(k, r);

-- The Admin's photo, as the storage actions make it.
set local role service_role;
select public.file_begin(pg_temp.fx('photo'), pg_temp.fx('admin'), 'me.jpg', 'image/jpeg', 2000, null);
select public.file_complete(pg_temp.fx('photo'), pg_temp.fx('admin'), 2000);
select pg_temp.as_member('admin');
update public.members set avatar_file_id = pg_temp.fx('photo') where id = pg_temp.fx('admin');
select pg_temp.as_system();

-- A task the Crew member is on, created by the Admin: the Admin is in Crew's directory, the other
-- Admin is not.
insert into fx values ('t1', gen_random_uuid()), ('t2', gen_random_uuid());
insert into public.tasks (id, org_id, title, task_type_id, created_by, primary_owner_id, due_at)
select pg_temp.fx('t1'), pg_temp.fx('org'), 'Edit', tt.id, pg_temp.fx('admin'), pg_temp.fx('staff'), now() + interval '2 days'
from public.task_types tt where tt.org_id = pg_temp.fx('org') and tt.archived_at is null order by tt.position limit 1;
insert into public.task_assignees (task_id, member_id, is_primary)
values (pg_temp.fx('t1'), pg_temp.fx('staff'), true);

-- The Crew member's rows, newest first: x, f, e, d, c, b, a, h (today), then g (yesterday): the
-- entries x, f, e, d, c (c+b+a+h), g, as notifications_inbox makes them.
select pg_temp.note('g', 'staff', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('23:50', 1), false);
select pg_temp.note('h', 'staff', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('00:05'), false);
select pg_temp.note('a', 'staff', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('00:10'), true);
select pg_temp.note('b', 'staff', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('00:15'), false);
select pg_temp.note('c', 'staff', 'task_changed', pg_temp.fx('t1'), true, pg_temp.ist('00:20'), false, 'admin');
select pg_temp.note('d', 'staff', 'task_assigned', pg_temp.fx('t2'), true, pg_temp.ist('00:25'), false, 'admin2');
select pg_temp.note('e', 'staff', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('00:30'), false, 'admin');
select pg_temp.note('f', 'staff', 'task_comment', pg_temp.fx('t1'), false, pg_temp.ist('00:35'), false);
select pg_temp.note('x', 'staff', 'task_comment', pg_temp.fx('t1'), false, pg_temp.ist('00:40'), false);
-- The Admin's and the Owner's own rows.
select pg_temp.note('y', 'admin', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('00:45'), false, 'admin2');
select pg_temp.note('z', 'owner', 'task_comment', pg_temp.fx('t2'), false, pg_temp.ist('00:50'), false, 'staff');

-- 1. Pages: the same entries, in keyset order ------------------------------------------------------
select pg_temp.as_member('staff');
select is(pg_temp.page(false), array['x', 'f', 'e', 'd', 'c', 'g'],
  'one page holds the entries notifications_inbox makes, newest first');
select is(pg_temp.page(false), (select array_agg(f.key order by i.ord)
  from public.notifications_inbox(false, 0, 20) with ordinality as i(id, kind, title, body, link, created_at, run_size, run_kinds, run_unread, total, ord)
  join fx f on f.id = i.id), 'exactly the entries of notifications_inbox');
select is(pg_temp.page(false, null, 3), array['x', 'f', 'e'], 'a page of three');
select is(pg_temp.page(false, 'e', 3), array['d', 'c', 'g'], 'Show older: the three after the last one shown');
select is(pg_temp.page(false, 'g', 3), '{}'::text[], 'and nothing after the last');
select is((select run_size from pg_temp.entry('c')), 4, 'the run c, b, a, h is one entry');
select is(pg_temp.page(false, 'c', 20), array['g'],
  'after a run, its older rows (b, a, h) are never shown again: a run never splits across pages');

-- An email-only kind (the Owner's digest, in_app false) is never an entry (the notifications RLS).
select pg_temp.as_system();
insert into public.notifications (org_id, recipient_id, kind, title, created_at)
values (pg_temp.fx('org'), pg_temp.fx('staff'), 'owner_digest', 'Morning summary', pg_temp.ist('00:42'));
select pg_temp.as_member('staff');
select is(pg_temp.page(false, null, 3), array['x', 'f', 'e'], 'an email-only row is never an entry');

-- 2. New alerts never shift a page ----------------------------------------------------------------
select pg_temp.as_system();
select pg_temp.note('n', 'staff', 'task_comment', pg_temp.fx('t2'), false, now(), false);
select pg_temp.as_member('staff');
select is(pg_temp.page(false, 'e', 3), array['d', 'c', 'g'],
  'a newer alert arriving does not move the older page (keyset, not offset)');
select is((pg_temp.page(false, null, 1))[1], 'n', 'and it heads the first page');

-- 3. Unread -----------------------------------------------------------------------------------------
select is(pg_temp.page(true, 'e', 20), array['d', 'c', 'g'], 'Unread: the same entries after the cursor');
update public.notifications set read_at = now() where id = pg_temp.fx('c');
select is(pg_temp.page(true, 'c', 20), array['g'],
  'Unread after c, read since: c''s run is still recognised, its unread rows b and h are not shown again');
select is(pg_temp.page(true, 'e', 20), array['d', 'b', 'g'],
  'while a fresh read of Unread draws the run from its newest unread row');

-- 4. The actor, from the caller's directory ---------------------------------------------------------
select is((select actor_id from pg_temp.entry('e')), pg_temp.fx('admin'), 'the entry names its actor');
select is((select actor_name from pg_temp.entry('e')), 'Admin', 'with their name');
select is((select actor_avatar_file_id from pg_temp.entry('e')), pg_temp.fx('photo'),
  'and their photo, in the same read');
select is((select actor_id from pg_temp.entry('c')), pg_temp.fx('admin'), 'a run carries its newest row''s actor');
select ok((select actor_id is null and actor_name is null and actor_avatar_file_id is null from pg_temp.entry('x')),
  'a job''s alert has no actor');
select ok((select actor_id = pg_temp.fx('admin2') and actor_name is null and actor_avatar_file_id is null
           from pg_temp.entry('d')),
  'Crew never read the name or photo of someone outside their directory (no task in common)');

select pg_temp.as_member('admin');
select is((select actor_name from public.notifications_inbox_page(false, null, null, 20)), 'Admin2',
  'an Admin (team.view) reads every actor''s name');
select pg_temp.as_member('owner');
select ok((select actor_name = 'Staff' from public.notifications_inbox_page(false, null, null, 20)),
  'the Owner too');

-- 5. Only one's own ----------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select is((select count(*) from public.notifications_inbox_page(false, null, null, 20)), 1::bigint,
  'an Admin reads only their own entry');
select is((select count(*) from public.notifications_inbox_page(false, (select now()), pg_temp.fx('e'), 20)), 1::bigint,
  'another member''s cursor reveals nothing of theirs');
select is((select count(*) from public.notifications_inbox_page(false, null, null, 1000)), 1::bigint,
  'a limit over 51 is cut (1 here)');
select pg_temp.as_anon();
select throws_ok($q$select * from public.notifications_inbox_page(false, null, null, 20)$q$, '42501', null,
  'a signed-out caller is refused');

select * from finish();
rollback;
