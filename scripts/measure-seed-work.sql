-- scripts/measure-seed-work.sql: a year of TASKS and CLIENT WORK volume on the LOCAL database, on top
-- of scripts/measure-seed.sql (run that first), for EXPLAINing the v3.0 report functions
-- (report_people, report_task_delays, report_stage_durations, report_client_work). Never for
-- staging or production, never loaded by `pnpm db:reset`.
--
-- What it adds, beside the measure seed's 22 people and 40 clients:
--   * ~8,000 tasks over the last 365 IST days (about 30 a working day), primary owners and a second
--     assignee among the measure people, ~80 % completed (with one or two hand-ins, a send-back on
--     one in five, the Owner's approval), the rest open, some past their deadline with a late reason.
--   * For every active measure client, two monthly projects with twelve March-style cycles each
--     (one per month of the last year), ten deliverables per cycle (four stages each: Shoot, Edit,
--     Colour, Review), the past ones done, the current month's partly open.
-- Written with triggers off (session_replication_role = replica): the transition guards and the
-- audit trigger are not what is measured. The report functions never read activity_log.
--
-- How to run (after measure-seed.sql, from the repo root):
--   docker exec -i supabase_db_maxoff psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/measure-seed-work.sql

\set ON_ERROR_STOP on
begin;

do $$
begin
  if not exists (select 1 from auth.users
                 where id = '10000000-0000-4000-8000-000000000001' and email = 'owner@maxoff.local') then
    raise exception 'measure-seed-work: owner@maxoff.local (seed.sql) is missing: not the local database. Nothing written.';
  end if;
  if exists (select 1 from public.members where email not ilike '%@maxoff.local') then
    raise exception 'measure-seed-work: a member without an @maxoff.local email exists: not the local database.';
  end if;
  if inet_server_addr() is not null and not (inet_server_addr() << '127.0.0.0/8'::inet
     or inet_server_addr() << '10.0.0.0/8'::inet or inet_server_addr() << '172.16.0.0/12'::inet
     or inet_server_addr() << '192.168.0.0/16'::inet or inet_server_addr() = '::1'::inet) then
    raise exception 'measure-seed-work: connected to a non-local address (%). Nothing written.', inet_server_addr();
  end if;
  if not exists (select 1 from public.members where id = '30000000-0000-4000-8000-000000000001') then
    raise exception 'measure-seed-work: run scripts/measure-seed.sql first.';
  end if;
  if exists (select 1 from public.tasks where id = '3000000a-0000-4000-8000-000000000001') then
    raise exception 'measure-seed-work: already loaded.';
  end if;
end;
$$;

set local session_replication_role = replica;

create temporary table mpeople as
  select id, row_number() over (order by id) as n from public.members
  where id::text like '30000000-0000-4000-8000-%';

-- Tasks -------------------------------------------------------------------------------------------
create temporary table mtasks as
with days as (
  select d::date as day, row_number() over (order by d) as dn
  from generate_series(app.today_ist() - 364, app.today_ist(), interval '1 day') d
  where extract(isodow from d) < 7
),
made as (
  select ('3000000a-0000-4000-8000-' || lpad(to_hex((dn * 30 + k)::int), 12, '0'))::uuid as id,
    day, dn * 30 + k as key,
    ('x' || substr(md5('t' || (dn * 30 + k)), 1, 8))::bit(32)::int as h
  from days, generate_series(0, 29) k
)
select m.id, m.day, m.key,
  (select p.id from mpeople p where p.n = 1 + abs(m.h) % 22) as owner_id,
  (select p.id from mpeople p where p.n = 1 + abs(m.h / 7) % 22) as second_id,
  app.ist_day_start(m.day) + interval '18 hours' + make_interval(days => abs(m.h) % 6) as due_at,
  case when m.day < app.today_ist() - 10 or abs(m.h) % 5 <> 0 then 'completed' else 'todo' end::public.task_state as state,
  abs(m.h) % 5 = 1 as sent_back,
  abs(m.h) % 4 = 0 as late
from made m;

insert into public.tasks (id, org_id, title, task_type_id, primary_owner_id, created_by, due_at, state, completed_at,
  late_reason, created_at)
select t.id, (select id from public.organizations limit 1), 'Measure task ' || t.key,
  (select id from public.task_types where archived_at is null order by position limit 1),
  t.owner_id, '10000000-0000-4000-8000-000000000001', t.due_at, t.state,
  case when t.state = 'completed' then t.due_at + case when t.late then interval '2 days' else interval '0' end
    + interval '4 hours' end,
  case when t.late then 'Waited for the client''s files' end,
  app.ist_day_start(t.day) + interval '10 hours'
from mtasks t;

insert into public.task_assignees (task_id, member_id, is_primary, assigned_at, acknowledged_at, acknowledged_by)
select t.id, t.owner_id, true, app.ist_day_start(t.day) + interval '10 hours',
  app.ist_day_start(t.day) + interval '11 hours', t.owner_id from mtasks t
union all
select t.id, t.second_id, false, app.ist_day_start(t.day) + interval '10 hours',
  app.ist_day_start(t.day) + interval '13 hours', t.second_id from mtasks t where t.second_id <> t.owner_id;

insert into public.task_submissions (task_id, submitted_by, at, version)
select t.id, t.owner_id, t.due_at - interval '6 hours' + case when t.late then interval '2 days' else interval '0' end, 1
from mtasks t where t.state = 'completed'
union all
select t.id, t.owner_id, t.due_at + case when t.late then interval '2 days' else interval '0' end, 2
from mtasks t where t.state = 'completed' and t.sent_back;

insert into public.task_reviews (task_id, step, decision, reviewer_id, at, reason)
select t.id, 'owner', 'rejected'::public.review_decision, '10000000-0000-4000-8000-000000000001'::uuid,
  t.due_at - interval '3 hours' + case when t.late then interval '2 days' else interval '0' end, 'Changes'
from mtasks t where t.state = 'completed' and t.sent_back
union all
select t.id, 'owner', 'approved'::public.review_decision, '10000000-0000-4000-8000-000000000001'::uuid,
  t.due_at + interval '4 hours' + case when t.late then interval '2 days' else interval '0' end, null
from mtasks t where t.state = 'completed';

-- Client work --------------------------------------------------------------------------------------
create temporary table mprojects as
select ('3000000b-0000-4000-8000-' || lpad(to_hex((row_number() over (order by c.id, k))::int), 12, '0'))::uuid as id,
  c.id as client_id, c.name || ' retainer ' || k as name
from public.clients c, generate_series(1, 2) k
where c.id::text like '30000001-0000-4000-8000-%' and c.state = 'active';

insert into public.projects (id, org_id, client_id, name, recurrence, state, created_by, created_at)
select p.id, (select id from public.organizations limit 1), p.client_id, p.name, 'monthly', 'in_progress',
  '10000000-0000-4000-8000-000000000001', now() - interval '1 year'
from mprojects p;

create temporary table mcycles as
select gen_random_uuid() as id, p.id as project_id,
  (date_trunc('month', app.today_ist()) - make_interval(months => m))::date as period_start, m
from mprojects p, generate_series(0, 11) m;

insert into public.project_cycles (id, org_id, project_id, period_start, period_end, label, state, generated_by)
select c.id, (select id from public.organizations limit 1), c.project_id, c.period_start,
  (c.period_start + interval '1 month - 1 day')::date, to_char(c.period_start, 'Mon YYYY'),
  case when c.m = 0 then 'open' else 'settled' end::public.cycle_state, 'schedule'
from mcycles c;

create temporary table mitems as
select gen_random_uuid() as id, c.id as cycle_id, c.project_id, c.period_start, c.m, k,
  (c.period_start + (k * 3 - 1))::date as planned_date,
  ('x' || substr(md5(c.id::text || k), 1, 8))::bit(32)::int as h
from mcycles c, generate_series(1, 10) k;

insert into public.project_items (id, org_id, project_id, cycle_id, origin_cycle_id, title, position, planned_date,
  state, done_at, done_by, approved_at, approved_by, created_at)
select i.id, (select id from public.organizations limit 1), i.project_id, i.cycle_id, i.cycle_id, 'Reel ' || i.k,
  lpad(i.k::text, 2, '0'), i.planned_date,
  case when i.m > 0 or i.planned_date + 2 < app.today_ist() then 'approved' else 'open' end::public.item_state,
  case when i.m > 0 or i.planned_date + 2 < app.today_ist()
    then app.ist_day_start(i.planned_date) + make_interval(hours => 12 + abs(i.h) % 72) end,
  case when i.m > 0 or i.planned_date + 2 < app.today_ist() then '10000000-0000-4000-8000-000000000002'::uuid end,
  case when i.m > 0 or i.planned_date + 2 < app.today_ist()
    then app.ist_day_start(i.planned_date) + make_interval(hours => 12 + abs(i.h) % 72) end,
  case when i.m > 0 or i.planned_date + 2 < app.today_ist() then '10000000-0000-4000-8000-000000000002'::uuid end,
  app.ist_day_start(i.period_start)
from mitems i;

insert into public.project_item_stage_list (org_id, project_id, item_id, name, position, done_at, done_by)
select (select id from public.organizations limit 1), i.project_id, i.id, s.name, s.pos,
  case when i.m > 0 or i.planned_date + 2 < app.today_ist() or s.n <= 2
    then app.ist_day_start(i.period_start) + make_interval(hours => s.n * (12 + abs(i.h) % 48)) end,
  case when i.m > 0 or i.planned_date + 2 < app.today_ist() or s.n <= 2
    then '10000000-0000-4000-8000-000000000002'::uuid end
from mitems i,
  (values (1, 'Shoot', 'a'), (2, 'Edit', 'b'), (3, 'Colour', 'c'), (4, 'Review', 'd')) as s(n, name, pos);

select 'tasks' as what, count(*) from public.tasks where id::text like '3000000a-%'
union all select 'items', count(*) from public.project_items i join mprojects p on p.id = i.project_id
union all select 'stages', count(*) from public.project_item_stage_list s join mprojects p on p.id = s.project_id
union all select 'activity_log', count(*) from public.activity_log;

commit;
\echo measure-seed-work: committed.
