-- v2.0 X3 step 3 (2026-11-05, migration attendance_board_today; DATA-MODEL §1 "v2.0 X3";
-- advisor-approved on #89, option A): public.attendance_board_today() is the Owner's Today board's
-- two attendance reads in one. Who may call it (authenticated only), security invoker, and per
-- role: the Owner's people and hours equal attendance_today_detail() and attendance_hours_today()
-- (the same rows in the same order); an Admin and Crew get null for both and refused equal to the
-- code those functions raise for them; a deactivated member is refused too. The two old functions
-- are unchanged. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('gone',  '00000000-0000-4000-8000-000000013301');
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
-- The code a function refuses the caller with (its app.fail code), or null.
create function pg_temp.refusal(fn text) returns text language plpgsql as $$
begin
  execute format('select 1 from public.%I()', fn);
  return null;
exception when others then
  return sqlerrm;
end;
$$;

insert into auth.users (id, email) values (pg_temp.fx('gone'), 'gone-13301@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('gone'), pg_temp.fx('org'), 'Gone Person', 'gone-13301@example.com', 'staff', 'deactivated', 'permanent',
   now() - interval '30 days', now());

-- 1. Who may call it ------------------------------------------------------------------------------
select has_function('public', 'attendance_board_today', array[]::text[], 'attendance_board_today() exists');
select is((select prosecdef from pg_proc where oid = 'public.attendance_board_today()'::regprocedure), false,
  'it runs as the caller (security invoker)');
select ok(has_function_privilege('authenticated', 'public.attendance_board_today()', 'execute'), 'authenticated may call it');
select ok(not has_function_privilege('anon', 'public.attendance_board_today()', 'execute'), 'anon may not');

-- 2. The Owner: both parts, equal to the two reads, in their order --------------------------------
select pg_temp.as_member('owner');
select is(public.attendance_board_today()->'people',
  (select coalesce(jsonb_agg(to_jsonb(p) - 'ordinality' order by p.ordinality), '[]'::jsonb)
   from public.attendance_today_detail() with ordinality as p),
  'Owner: people equals attendance_today_detail()');
select is(public.attendance_board_today()->'hours',
  (select coalesce(jsonb_agg(to_jsonb(h) - 'ordinality' order by h.ordinality), '[]'::jsonb)
   from public.attendance_hours_today() with ordinality as h),
  'Owner: hours equals attendance_hours_today()');
select ok(jsonb_array_length(public.attendance_board_today()->'people') > 0, 'Owner: the people are there');
select is(public.attendance_board_today()->'refused', 'null'::jsonb, 'Owner: nothing refused');

-- 3. An Admin, Crew, a deactivated member: refused as the reads refuse them ----------------------
select pg_temp.as_member('admin');
select is(public.attendance_board_today()->>'refused', pg_temp.refusal('attendance_today_detail'),
  'Admin: refused with the code attendance_today_detail raises');
select is(public.attendance_board_today()->>'refused', pg_temp.refusal('attendance_hours_today'),
  '... and attendance_hours_today');
select ok(public.attendance_board_today()->'people' = 'null'::jsonb
          and public.attendance_board_today()->'hours' = 'null'::jsonb, 'Admin: neither part');
select pg_temp.as_member('staff');
select is(public.attendance_board_today()->>'refused', pg_temp.refusal('attendance_today_detail'),
  'Crew: refused with the code the reads raise');
select ok(public.attendance_board_today()->'people' = 'null'::jsonb, 'Crew: no people');
select pg_temp.as_member('gone');
select is(public.attendance_board_today()->>'refused', pg_temp.refusal('attendance_today_detail'),
  'deactivated: refused with the code the reads raise');

select * from finish();
rollback;
