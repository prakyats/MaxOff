-- v7.0 §C security hardening (migration v70_security_hardening; docs/reviews/v2.0/final-review-security.md
-- L2, L3): the folds name the row they mean instead of relying on RLS alone. Each table's select
-- policy is widened here, inside this test's transaction, the way a later migration might widen it:
-- task_page's last_read stays the caller's own, own_week's thresholds and working_day_rule's weekly
-- days stay the caller's organisation's. And app.task_request_visible points at its security-definer
-- copy. Neutral names only; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') and kind = 'normal' order by position limit 1;
grant select, insert on fx to authenticated;

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

-- A task, read by the Crew member only.
select pg_temp.as_member('owner');
insert into fx values ('task', public.task_create('Own row task 144', 'Brief', pg_temp.fx('type'),
  null, 'medium', now() + interval '5 days', array[pg_temp.fx('staff')], pg_temp.fx('staff')));
select pg_temp.as_system();
insert into public.task_reads (task_id, member_id, last_read_at)
  values (pg_temp.fx('task'), pg_temp.fx('staff'), now() - interval '1 hour');

-- Another organisation with its own, different settings.
insert into public.organizations (id, name) values ('20000000-0000-4000-8000-000000000144', 'Other org 144');
insert into public.org_settings (org_id, ack_escalate_hours, ack_escalate_owner_hours, weekly_off_days)
  values ('20000000-0000-4000-8000-000000000144', 97, 98, '{0,1,2,3,4,5}')
  on conflict (org_id) do update set ack_escalate_hours = 97, ack_escalate_owner_hours = 98,
    weekly_off_days = '{0,1,2,3,4,5}';

-- The widening a later policy might bring: everyone reads every row of both tables.
create policy v70_widened_reads on public.task_reads for select to authenticated using (true);
create policy v70_widened_settings on public.org_settings for select to authenticated using (true);

select pg_temp.as_member('owner');
select ok((select count(*) from public.task_reads where task_id = pg_temp.fx('task')) = 1,
  'the widened policy shows the Owner the Crew member''s read');
select is(public.task_page(pg_temp.fx('task'), 50, 50) -> 'last_read', 'null'::jsonb,
  'task_page''s last_read is the Owner''s own (none), never the Crew member''s');

select pg_temp.as_member('staff');
select isnt(public.task_page(pg_temp.fx('task'), 50, 50) -> 'last_read', 'null'::jsonb,
  'the Crew member still gets their own last_read');

select pg_temp.as_member('admin');
select ok((select count(*) from public.org_settings) >= 2, 'the widened policy shows two organisations'' settings');
select is(
  (select jsonb_build_object('h', w -> 'ack_escalate_hours', 'o', w -> 'ack_escalate_owner_hours')
     from public.own_week(current_date, current_date + 6) w),
  (select jsonb_build_object('h', to_jsonb(s.ack_escalate_hours), 'o', to_jsonb(s.ack_escalate_owner_hours))
     from public.org_settings s where s.org_id = pg_temp.fx('org')),
  'own_week''s thresholds are the caller''s organisation''s');
select is(
  public.working_day_rule(current_date, current_date + 6) -> 'weekly_off_days',
  (select to_jsonb(s.weekly_off_days) from public.org_settings s where s.org_id = pg_temp.fx('org')),
  'working_day_rule''s weekly days are the caller''s organisation''s');

select pg_temp.as_system();
select matches(obj_description('app.task_request_visible(uuid, uuid)'::regprocedure, 'pg_proc'),
  'requests_to_decide_count', 'task_request_visible points at its security-definer copy (L3)');

select * from finish();
rollback;
