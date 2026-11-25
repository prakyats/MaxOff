-- v7.0 (unit 4's first-wave check on every route, CI 45625411243): two lists read their table twice
-- before the page's first answer, one read for the open rows and one for the latest finished ones,
-- which put /tasks/all and /tasks/requests at seven reads (ARCHITECTURE §19 "Six connections").
-- Each pair becomes one read: a function that returns both halves as rows of the table itself, so
-- PostgREST embeds the same columns (`rpc(...).select(...)`).
--
-- **Security invoker:** the caller's RLS decides every row, exactly as the two reads did; the
-- functions add no row and see no column the table's own policies do not give. The finished half is
-- capped at 1000 (PostgREST's answer size). The callers re-sort, so no order is promised here.
--
-- Expand-only: two new functions, no table, policy or grant change; the running Worker keeps its
-- two reads until the release that calls these.

create function public.tasks_list_all(finished_limit integer)
returns setof public.tasks
language sql
stable
security invoker
set search_path = ''
as $$
  select t.* from public.tasks t
  where t.state not in ('completed', 'cancelled')
  union all
  (select t.* from public.tasks t
   where t.state in ('completed', 'cancelled')
   order by t.updated_at desc
   limit greatest(least(coalesce(finished_limit, 0), 1000), 0));
$$;

comment on function public.tasks_list_all(integer) is
  'v7.0: the full task list in one read (/tasks/all): every open task and the latest finished_limit '
  'completed or cancelled ones (at most 1000), as tasks rows for PostgREST embedding. Security '
  'invoker: RLS decides the rows. Unordered; the caller sorts.';

revoke all on function public.tasks_list_all(integer) from public, anon;
grant execute on function public.tasks_list_all(integer) to authenticated, service_role;

create function public.task_requests_list(decided_limit integer)
returns setof public.task_requests
language sql
stable
security invoker
set search_path = ''
as $$
  select r.* from public.task_requests r
  where r.state = 'pending'
  union all
  (select r.* from public.task_requests r
   where r.state <> 'pending'
   order by r.updated_at desc
   limit greatest(least(coalesce(decided_limit, 0), 1000), 0));
$$;

comment on function public.task_requests_list(integer) is
  'v7.0: Suggested tasks in one read (/tasks/requests): every pending request and the latest '
  'decided_limit decided ones (at most 1000), as task_requests rows for PostgREST embedding. '
  'Security invoker: RLS decides the rows. Unordered; the caller sorts.';

revoke all on function public.task_requests_list(integer) from public, anon;
grant execute on function public.task_requests_list(integer) to authenticated, service_role;
