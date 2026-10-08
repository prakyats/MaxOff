-- 5B decision 10: the Alerts list's entries (notifications_inbox). The caller's own rows only,
-- newest first; consecutive rows about the same record (each with a link) on the same IST day are
-- one entry with a count, its kinds and its unread ids; a row with nothing to open, another record
-- or a new IST day starts a new entry; "Unread" forms runs among unread rows only; paged over
-- entries. Every role reads only their own; a signed-out caller is refused.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
delete from public.notifications;
delete from public.push_subscriptions;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '00000000-0000-4000-8000-000000000f01'),
  ('admin', '00000000-0000-4000-8000-000000000f02'),
  ('staff', '00000000-0000-4000-8000-000000000f03');
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

-- An instant at an IST clock time, `days` before today.
create function pg_temp.ist(t time, days integer default 0) returns timestamptz language sql stable as $$
  select ((app.today_ist() - days) + t) at time zone 'Asia/Kolkata';
$$;

create function pg_temp.note(k text, who text, kind text, task uuid, has_link boolean, at timestamptz, read boolean)
returns void language sql as $$
  insert into fx values (k, gen_random_uuid());
  insert into public.notifications (id, org_id, recipient_id, kind, title, link, entity, entity_id, created_at, read_at)
  values (pg_temp.fx(k), pg_temp.fx('org'), pg_temp.fx(who), kind, 'Note ' || k,
          case when has_link then '/tasks/' || task else null end, 'tasks', task, at,
          case when read then at else null end);
$$;

-- Entries as the caller sees them, by fixture key.
create function pg_temp.keys(p_unread boolean, p_offset integer default 0, p_limit integer default 20)
returns text[] language sql as $$
  select array_agg(f.key order by i.ord)
  from public.notifications_inbox(p_unread, p_offset, p_limit) with ordinality as i(id, kind, title, body, link, created_at, run_size, run_kinds, run_unread, total, ord)
  join fx f on f.id = i.id;
$$;

create function pg_temp.entry(k text, p_unread boolean default false)
returns table (run_size integer, run_kinds text[], run_unread text[], total bigint) language sql as $$
  select i.run_size, i.run_kinds,
         (select array_agg(f.key order by u.ord) from unnest(i.run_unread) with ordinality as u(id, ord)
          join fx f on f.id = u.id),
         i.total
  from public.notifications_inbox(p_unread, 0, 50) i
  where i.id = pg_temp.fx(k);
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('staff', 'staff')) as v(k, r);

insert into fx values ('t1', gen_random_uuid()), ('t2', gen_random_uuid());
-- The Crew member's rows, newest first: f, e, d, c, b, a, h (today), then g (yesterday).
select pg_temp.note('g', 'staff', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('23:50', 1), false);
select pg_temp.note('h', 'staff', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('00:05'), false);
select pg_temp.note('a', 'staff', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('00:10'), true);
select pg_temp.note('b', 'staff', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('00:15'), false);
select pg_temp.note('c', 'staff', 'task_changed', pg_temp.fx('t1'), true, pg_temp.ist('00:20'), false);
select pg_temp.note('d', 'staff', 'task_assigned', pg_temp.fx('t2'), true, pg_temp.ist('00:25'), false);
select pg_temp.note('e', 'staff', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('00:30'), false);
-- About the same task, but nothing to open (decision 25): never part of a run.
select pg_temp.note('f', 'staff', 'task_comment', pg_temp.fx('t1'), false, pg_temp.ist('00:35'), false);
select pg_temp.note('x', 'staff', 'task_comment', pg_temp.fx('t1'), false, pg_temp.ist('00:40'), false);
-- The Admin's own row about the same task.
select pg_temp.note('y', 'admin', 'task_comment', pg_temp.fx('t1'), true, pg_temp.ist('00:45'), false);

-- 1. All ---------------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(pg_temp.keys(false), array['x', 'f', 'e', 'd', 'c', 'g'],
  'newest first; c, b, a and h (one task, one IST day, consecutive) are one entry headed by the newest');
select is((select run_size from pg_temp.entry('c')), 4, 'the entry counts its four rows');
select is((select run_kinds from pg_temp.entry('c')), array['task_changed', 'task_comment'], 'and names their kinds');
select is((select run_unread from pg_temp.entry('c')), array['c', 'b', 'h'], 'and the unread ones, newest first (a was read)');
select is((select run_size from pg_temp.entry('g')), 1, 'yesterday''s row about the same task starts its own entry');
select is((select run_size from pg_temp.entry('e')), 1, 'a row about the same task after another task''s starts a new entry');
select is((select run_size from pg_temp.entry('f')) + (select run_size from pg_temp.entry('x')), 2,
  'rows with nothing to open are never collapsed, even about the same task');
select is((select total from pg_temp.entry('c')), 6::bigint, 'the total counts entries, for the pager');

-- 2. Unread ------------------------------------------------------------------------------------------
select is(pg_temp.keys(true), array['x', 'f', 'e', 'd', 'c', 'g'], 'Unread: the same entries (each holds an unread row)');
select is((select run_size from pg_temp.entry('c', true)), 3, 'Unread: the read row a is left out of the run');

-- 3. Pages are made of entries ------------------------------------------------------------------------
select is(pg_temp.keys(false, 4, 1), array['c'], 'the fifth entry is the whole run');
select is(pg_temp.keys(false, 0, 0), array['x'], 'a limit under 1 reads one entry');
select is((select count(*) from public.notifications_inbox(false, 0, 1000)), 6::bigint, 'a limit over 50 is cut to 50 (6 here)');

-- 4. Only one's own ----------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select is(pg_temp.keys(false), array['y'], 'an Admin reads only their own entry');
select pg_temp.as_member('owner');
select is((select count(*) from public.notifications_inbox(false, 0, 20)), 0::bigint, 'the Owner reads nobody else''s');
select pg_temp.as_anon();
select throws_ok($q$select * from public.notifications_inbox(false, 0, 20)$q$, '42501', null,
  'a signed-out caller is refused');

select * from finish();
rollback;
