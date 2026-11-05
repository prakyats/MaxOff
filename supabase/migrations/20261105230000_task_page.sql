-- v2.0 X3 step 3, a task's page (2026-11-06; DATA-MODEL §1 "v2.0 X3"; the advisor's standing rule
-- on #89: a read-only, security-invoker fold equal to the reads it replaces): the page's ten reads
-- that are not shared with the task dialog's setup in one, so its first wave is six
-- (ARCHITECTURE §19).
--
-- public.task_page(p_task_id, p_comments, p_activity) → one jsonb object, each key exactly the rows
-- one API read returned (the same columns, filter and order; where that read's order could tie,
-- a column of the row breaks it):
--   task          getTask: the tasks row (every column), or null;
--   assignees     listAssignees: everyone ever on it, by assigned_at (then member_id);
--   stages        listStages: by position, created_at (then id);
--   comments      listComments' first page: the latest p_comments, newest first (created_at, id);
--   submissions   listSubmissions: newest version first;
--   reviews       listReviews: newest first (then id);
--   activity      listTaskActivity: activity_log of the task's entities (tasks, task_assignees,
--                 task_stages, task_warnings) about it, newest first (at, id), the latest p_activity;
--   last_read     getTaskRead: the caller's own last read of its comments, or null;
--   coordinators  listCurrentCoordinators: freelancer_coordinators (member_id, coordinator_id),
--                 by member_id (that read builds a map, so its order never showed);
--   freelancers   listOwnFreelancerIds: coordinated_freelancers with to_at null (member ids);
--   labels        listClientLabels: client_labels (every column), by name (then id).
-- Security invoker: every table's and view's own policy decides, as for the API reads (a task the
-- caller may not see is null, its children empty). No money, no Owner-only table, no client
-- record beyond the label. p_comments 1..201 and p_activity 1..200, else VALIDATION, so it can
-- never become an unbounded read. Stable, empty search_path, execute for authenticated only. A new
-- function: nothing existing changes (expand-only).

create function public.task_page(p_task_id uuid, p_comments integer, p_activity integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_task_id is null or p_comments is null or p_activity is null
     or p_comments not between 1 and 201 or p_activity not between 1 and 200 then
    perform app.fail('VALIDATION', 'A task, 1 to 201 comments and 1 to 200 history entries.');
  end if;
  return jsonb_build_object(
    'task', (select to_jsonb(t) from public.tasks t where t.id = p_task_id),
    'assignees', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.assigned_at, r.member_id)
      from (select a.member_id, a.is_primary, a.assigned_at, a.acknowledged_at, a.acknowledged_by, a.removed_at
            from public.task_assignees a where a.task_id = p_task_id) r), '[]'::jsonb),
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'position', r.position,
                                          'done_at', r.done_at, 'done_by', r.done_by, 'on_behalf_of', r.on_behalf_of)
                       order by r.position, r.created_at, r.id)
      from public.task_stages r where r.task_id = p_task_id), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc)
      from (select c.id, c.author_id, c.on_behalf_of, c.body, c.created_at
            from public.task_comments c where c.task_id = p_task_id
            order by c.created_at desc, c.id desc limit p_comments) r), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.version desc)
      from (select s.id, s.version, s.note, s.submitted_by, s.on_behalf_of, s.at
            from public.task_submissions s where s.task_id = p_task_id) r), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.at desc, r.id desc)
      from (select v.id, v.step, v.decision, v.reason, v.reviewer_id, v.at
            from public.task_reviews v where v.task_id = p_task_id) r), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.at desc, r.id desc)
      from (select l.id, l.actor_id, l.on_behalf_of_id, l.entity, l.entity_id, l.action, l.diff, l.meta, l.at
            from public.activity_log l
            where l.entity in ('tasks', 'task_assignees', 'task_stages', 'task_warnings')
              and l.entity_id = p_task_id
            order by l.at desc, l.id desc limit p_activity) r), '[]'::jsonb),
    'last_read', (select tr.last_read_at from public.task_reads tr where tr.task_id = p_task_id limit 1),
    'coordinators', coalesce((
      select jsonb_agg(jsonb_build_object('member_id', f.member_id, 'coordinator_id', f.coordinator_id)
                       order by f.member_id, f.coordinator_id)
      from public.freelancer_coordinators f), '[]'::jsonb),
    'freelancers', coalesce((
      select jsonb_agg(f.member_id order by f.member_id)
      from public.coordinated_freelancers f
      where f.to_at is null and f.member_id is not null), '[]'::jsonb),
    'labels', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.name, l.id)
      from public.client_labels l), '[]'::jsonb)
  );
end;
$$;

comment on function public.task_page(uuid, integer, integer) is
  'v2.0 X3: a task''s page''s reads in one: task (getTask), assignees, stages, comments (the latest '
  'p_comments, newest first), submissions, reviews, activity (the latest p_activity of the task''s '
  'history), last_read (the caller''s own), coordinators, freelancers (the caller''s current) and '
  'labels (client_labels), each exactly the rows, columns, filter and order of its API read. '
  'Security invoker: every table''s policy decides. p_comments 1..201, p_activity 1..200.';

revoke all on function public.task_page(uuid, integer, integer) from public, anon, service_role;
grant execute on function public.task_page(uuid, integer, integer) to authenticated;
