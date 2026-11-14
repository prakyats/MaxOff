-- v2.0 X3 step 3, a task's page (2026-11-06, migration task_page; DATA-MODEL §1 "v2.0 X3"):
-- public.task_page(task_id, comments, activity) is the page's ten unshared reads in one. Who may
-- call it (authenticated only), security invoker, the limits refused outside their range, and for
-- the Owner, an Admin, the Crew member on the task and a Crew member not on it, every key equal to
-- the API read it replaces (the same columns, filter and order, RLS deciding): a task the caller
-- may not see is null with every child empty, never more than RLS gives. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') and kind = 'normal' order by position limit 1;
insert into fx select 'outsider', m.id from public.members m
  where m.role = 'staff' and m.status = 'active' and m.engagement = 'permanent' and m.id <> '10000000-0000-4000-8000-000000000003'
  order by m.id limit 1;
grant select, insert on fx to authenticated;
grant select on fx to anon;

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
-- The API reads, as the caller (the same columns, filter and order; the same tie-breaks).
create function pg_temp.api(key text, p uuid) returns jsonb language plpgsql stable as $$
declare v jsonb;
begin
  case key
    when 'task' then select to_jsonb(t) into v from public.tasks t where t.id = p;
    when 'assignees' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.assigned_at, r.member_id), '[]') into v
      from (select member_id, is_primary, assigned_at, acknowledged_at, acknowledged_by, removed_at
            from public.task_assignees where task_id = p) r;
    when 'stages' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.position, r.created_at, r.id) , '[]') into v
      from (select id, name, position, done_at, done_by, on_behalf_of, created_at from public.task_stages where task_id = p) r;
      select coalesce(jsonb_agg(e - 'created_at'), '[]') into v from jsonb_array_elements(v) e;
    when 'comments' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc), '[]') into v
      from (select id, author_id, on_behalf_of, body, created_at from public.task_comments where task_id = p
            order by created_at desc, id desc limit 51) r;
    when 'submissions' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.version desc), '[]') into v
      from (select id, version, note, submitted_by, on_behalf_of, at from public.task_submissions where task_id = p) r;
    when 'reviews' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.at desc, r.id desc), '[]') into v
      from (select id, step, decision, reason, reviewer_id, at from public.task_reviews where task_id = p) r;
    when 'activity' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.at desc, r.id desc), '[]') into v
      from (select id, actor_id, on_behalf_of_id, entity, entity_id, action, diff, meta, at from public.activity_log
            where entity in ('tasks', 'task_assignees', 'task_stages', 'task_warnings') and entity_id = p
            order by at desc, id desc limit 50) r;
    when 'last_read' then select to_jsonb(tr.last_read_at) into v from public.task_reads tr where tr.task_id = p;
    when 'coordinators' then
      select coalesce(jsonb_agg(jsonb_build_object('member_id', member_id, 'coordinator_id', coordinator_id)
                                order by member_id, coordinator_id), '[]') into v from public.freelancer_coordinators;
    when 'freelancers' then
      select coalesce(jsonb_agg(member_id order by member_id), '[]') into v
      from public.coordinated_freelancers where to_at is null and member_id is not null;
    when 'labels' then
      select coalesce(jsonb_agg(to_jsonb(l) order by l.name, l.id), '[]') into v from public.client_labels l;
  end case;
  return coalesce(v, 'null'::jsonb);
end;
$$;
create function pg_temp.all_equal(p uuid) returns boolean language sql stable as $$
  select bool_and(coalesce(public.task_page(p, 51, 50)->k, 'null'::jsonb) = pg_temp.api(k, p))
  from unnest(array['task', 'assignees', 'stages', 'comments', 'submissions', 'reviews', 'activity', 'last_read',
                    'coordinators', 'freelancers', 'labels']) k;
$$;
create function pg_temp.differing(p uuid) returns text language sql stable as $$
  select coalesce(string_agg(k, ', '), 'none')
  from unnest(array['task', 'assignees', 'stages', 'comments', 'submissions', 'reviews', 'activity', 'last_read',
                    'coordinators', 'freelancers', 'labels']) k
  where coalesce(public.task_page(p, 51, 50)->k, 'null'::jsonb) <> pg_temp.api(k, p);
$$;

-- Fixtures: the Owner's task for Crew, with stages, a comment from each, Crew's read and history.
select pg_temp.as_member('owner');
insert into fx values ('task', public.task_create('Page task 137', 'Brief', pg_temp.fx('type'),
  null, 'medium', now() + interval '5 days', array[pg_temp.fx('staff')], pg_temp.fx('staff')));
select pg_temp.as_system();
insert into public.task_stages (task_id, name, position) values
  (pg_temp.fx('task'), 'Cut', 'a0'), (pg_temp.fx('task'), 'Grade', 'a1');
insert into public.task_comments (task_id, author_id, body, created_at) values
  (pg_temp.fx('task'), pg_temp.fx('owner'), 'First note 137', now() - interval '2 minutes'),
  (pg_temp.fx('task'), pg_temp.fx('staff'), 'Reply 137', now() - interval '1 minute');
insert into public.task_reads (task_id, member_id, last_read_at) values (pg_temp.fx('task'), pg_temp.fx('staff'), now());
create temporary table d as select pg_temp.fx('task') as task;
grant select on d to authenticated;

-- 1. Who may call it, and its limits ----------------------------------------------------------------
select has_function('public', 'task_page', array['uuid', 'integer', 'integer'], 'task_page(uuid, integer, integer) exists');
select is((select prosecdef from pg_proc where oid = 'public.task_page(uuid, integer, integer)'::regprocedure), false,
  'it runs as the caller (security invoker): every policy decides');
select ok(has_function_privilege('authenticated', 'public.task_page(uuid, integer, integer)', 'execute'), 'authenticated may call it');
select ok(not has_function_privilege('anon', 'public.task_page(uuid, integer, integer)', 'execute'), 'anon may not');
select ok(not has_function_privilege('service_role', 'public.task_page(uuid, integer, integer)', 'execute'), 'service_role may not');
select pg_temp.as_member('owner');
select throws_ok($$ select public.task_page((select task from d), 0, 50) $$, 'P0001', null, 'no comments asked: refused');
select throws_ok($$ select public.task_page((select task from d), 51, 201) $$, 'P0001', null, 'over 200 history entries: refused');
select throws_ok($$ select public.task_page(null, 51, 50) $$, 'P0001', null, 'no task: refused');

-- 2. The Owner: every key equal to its read --------------------------------------------------------
select is(pg_temp.differing((select task from d)), 'none', 'Owner: every key equals its API read');
select is(public.task_page((select task from d), 51, 50)->'task'->>'title', 'Page task 137', 'Owner: the task');
select is(jsonb_array_length(public.task_page((select task from d), 51, 50)->'stages'), 2, 'Owner: its two stages, in order');
select is(public.task_page((select task from d), 51, 50)->'stages'->0->>'name', 'Cut', '... Cut first');
select is(public.task_page((select task from d), 51, 50)->'comments'->0->>'body', 'Reply 137', 'Owner: the newest comment first');
select ok(jsonb_array_length(public.task_page((select task from d), 51, 50)->'activity') > 0, 'Owner: its history');
select is(public.task_page((select task from d), 51, 50)->'last_read', 'null'::jsonb, 'Owner: no read of his own (never Crew''s)');
select is(jsonb_array_length(public.task_page((select task from d), 1, 50)->'comments'), 1, 'one comment asked: one');
select is(jsonb_array_length(public.task_page((select task from d), 51, 1)->'activity'), 1, 'one history entry asked: one');

-- 3. An Admin ----------------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select is(pg_temp.differing((select task from d)), 'none', 'Admin: every key equals its API read');

-- 4. Crew on the task --------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(pg_temp.differing((select task from d)), 'none', 'Crew on the task: every key equals its API read');
select isnt(public.task_page((select task from d), 51, 50)->'last_read', 'null'::jsonb, 'Crew: their own last read');
select is(public.task_page((select task from d), 51, 50)->'coordinators', pg_temp.api('coordinators', (select task from d)),
  'Crew: the coordinators exactly as the view shows them');

-- 5. Crew not on it: the task is null, every child empty, never more than RLS gives ----------------
select pg_temp.as_member('outsider');
select ok(pg_temp.all_equal((select task from d)), 'Crew not on it: every key equals its API read');
select is(public.task_page((select task from d), 51, 50)->'task', 'null'::jsonb, 'Crew not on it: no task');
select ok(jsonb_array_length(public.task_page((select task from d), 51, 50)->'comments') = 0
          and jsonb_array_length(public.task_page((select task from d), 51, 50)->'stages') = 0
          and jsonb_array_length(public.task_page((select task from d), 51, 50)->'assignees') = 0,
  'Crew not on it: no comments, stages or assignees');

-- 6. An unknown task ---------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.task_page('00000000-0000-4000-8000-000000013799', 51, 50)->'task', 'null'::jsonb, 'an unknown task: null');
select ok(public.task_page((select task from d), 51, 50) ?& array['task', 'assignees', 'stages', 'comments', 'submissions',
  'reviews', 'activity', 'last_read', 'coordinators', 'freelancers', 'labels'], 'the eleven keys');

select * from finish();
rollback;
