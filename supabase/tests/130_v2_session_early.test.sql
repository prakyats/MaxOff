-- v2.0 X3 (2026-11-05, migration session_early; DATA-MODEL §1 "v2.0 X3"; ARCHITECTURE §19 "Six
-- connections"): public.session_early() is the shell's three first-byte reads in one. Who may call
-- it (authenticated only; anon and service_role refused), that it runs as the caller (security
-- invoker), and that each key equals the read it replaces, for the Owner, an Admin and a Crew
-- member: member = the members row as the app reads it (under RLS), own_day = attendance_own_today()
-- (null for the Owner, refused FORBIDDEN), push = push_status_own(). A freelancer's own day is
-- refused; a deactivated or invited member gets no own day and no push. Each refusal is the code
-- attendance_own_today() itself raises for that caller.
-- Own data only: the answer is always the caller's, whatever is asked. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',      '10000000-0000-4000-8000-000000000001'),
  ('admin',      '10000000-0000-4000-8000-000000000002'),
  ('staff',      '10000000-0000-4000-8000-000000000003'),
  ('freelancer', '00000000-0000-4000-8000-000000013001'),
  ('gone',       '00000000-0000-4000-8000-000000013002'),
  ('invited',    '00000000-0000-4000-8000-000000013003');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon;

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

-- Fixtures ------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  (pg_temp.fx('gone'), 'gone-13002@example.com'),
  (pg_temp.fx('invited'), 'invited-13003@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('freelancer'), pg_temp.fx('org'), 'Free Person',    null,                           'staff', 'active',      'freelance', now() - interval '30 days', null),
  (pg_temp.fx('gone'),       pg_temp.fx('org'), 'Gone Person',    'gone-13002@example.com',       'staff', 'deactivated', 'permanent', now() - interval '30 days', now()),
  (pg_temp.fx('invited'),    pg_temp.fx('org'), 'Invited Person', 'invited-13003@example.com',    'staff', 'invited',     'permanent', null,                       null);
-- A job title on the Admin, so the member key's embed is checked with a value.
update public.members set job_title_id = (
  select id from public.list_items where list_key = 'job_title' and org_id = pg_temp.fx('org') limit 1)
where id = pg_temp.fx('admin');
-- An active device for Crew, so the push key carries an endpoint.
insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, platform, is_standalone)
values (pg_temp.fx('staff'), 'https://push.example/13001', 'p', 'a', 'android', true);

-- The member row as the app reads it (getSessionState's MEMBER_ROW), computed as the caller.
create function pg_temp.member_as_read() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', m.id, 'email', m.email, 'full_name', m.full_name, 'role', m.role, 'status', m.status,
    'avatar_file_id', m.avatar_file_id,
    'job_title', (select jsonb_build_object('name', li.name) from public.list_items li where li.id = m.job_title_id))
  from public.members m where m.id = auth.uid()
  union all select 'null'::jsonb
  limit 1;
$$;
-- What attendance_own_today() refuses with for the caller (its app.fail code), or null.
create function pg_temp.own_day_refusal() returns text language plpgsql as $$
begin
  perform public.attendance_own_today();
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- 1. Who may call it ----------------------------------------------------------------------------------
select has_function('public', 'session_early', array[]::text[], 'session_early() exists');
select is((select prosecdef from pg_proc where oid = 'public.session_early()'::regprocedure), false,
  'it runs as the caller (security invoker): RLS decides the member row');
select ok(has_function_privilege('authenticated', 'public.session_early()', 'execute'), 'authenticated may call it');
select ok(not has_function_privilege('anon', 'public.session_early()', 'execute'), 'anon may not');
select ok(not has_function_privilege('service_role', 'public.session_early()', 'execute'), 'service_role may not');

-- 2. The Owner: the member row and push, no own day (FORBIDDEN, as attendance_own_today refuses him)
select pg_temp.as_member('owner');
select is(public.session_early()->'member', pg_temp.member_as_read(), 'Owner: member equals the row as read');
select is(public.session_early()->'member'->>'id', pg_temp.fx('owner')::text, 'Owner: his own row');
select is(public.session_early()->'own_day', 'null'::jsonb, 'Owner: no own day');
select is(public.session_early()->>'own_day_refused', 'FORBIDDEN', 'Owner: refused FORBIDDEN');
select is(public.session_early()->>'own_day_refused', pg_temp.own_day_refusal(), '... the code attendance_own_today itself refuses him with');
select is(public.session_early()->'push', (select to_jsonb(p) from public.push_status_own() p), 'Owner: push equals push_status_own()');

-- 3. An Admin -----------------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select is(public.session_early()->'member', pg_temp.member_as_read(), 'Admin: member equals the row as read');
select isnt(public.session_early()->'member'->'job_title', 'null'::jsonb, 'Admin: the job title embed is carried');
select is(public.session_early()->'own_day', (select to_jsonb(t) from public.attendance_own_today() t), 'Admin: own_day equals attendance_own_today()');
select is(public.session_early()->'own_day_refused', 'null'::jsonb, 'Admin: nothing refused');
select is(public.session_early()->'push', (select to_jsonb(p) from public.push_status_own() p), 'Admin: push equals push_status_own()');

-- 4. Crew ---------------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(public.session_early()->'member', pg_temp.member_as_read(), 'Crew: member equals the row as read');
select is(public.session_early()->'own_day', (select to_jsonb(t) from public.attendance_own_today() t), 'Crew: own_day equals attendance_own_today()');
select is(public.session_early()->'own_day'->>'work_date', app.today_ist()::text, 'Crew: today (IST)');
select is(public.session_early()->'push', (select to_jsonb(p) from public.push_status_own() p), 'Crew: push equals push_status_own()');
select is(public.session_early()->'push'->'endpoints', '["https://push.example/13001"]'::jsonb, 'Crew: their active endpoint');

-- 5. A freelancer: no own day (FORBIDDEN, ADR-0013 §5), the rest answered ----------------------------
select pg_temp.as_member('freelancer');
select is(public.session_early()->'member', pg_temp.member_as_read(), 'freelancer: member exactly as RLS reads it');
select is(public.session_early()->'own_day', 'null'::jsonb, 'freelancer: no own day');
select is(public.session_early()->>'own_day_refused', pg_temp.own_day_refusal(), 'freelancer: refused with the code attendance_own_today raises');

-- 6. Not active: no own day (UNAUTHENTICATED), no push ------------------------------------------------
select pg_temp.as_member('gone');
select is(public.session_early()->'member', pg_temp.member_as_read(), 'deactivated: member exactly as RLS reads it');
select is(public.session_early()->>'own_day_refused', pg_temp.own_day_refusal(), 'deactivated: refused with the code attendance_own_today raises');
select is(public.session_early()->'push', 'null'::jsonb, 'deactivated: no push (push_status_own gives no row)');
select pg_temp.as_member('invited');
select is(public.session_early()->'member', pg_temp.member_as_read(), 'invited: member exactly as RLS reads it');
select is(public.session_early()->>'own_day_refused', pg_temp.own_day_refusal(), 'invited: refused with the code attendance_own_today raises');

-- 7. Own data only ------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select ok(
  public.session_early() ?& array['member', 'own_day', 'own_day_refused', 'push'],
  'the four first keys stay (v2.0 X3 step 3 adds own_hours, 131): member, own_day, own_day_refused, push');
select pg_temp.as_system();
select is(public.session_early()->'member', 'null'::jsonb, 'no session: no member row');

select * from finish();
rollback;
