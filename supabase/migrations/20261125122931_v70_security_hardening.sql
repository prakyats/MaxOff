-- v7.0 "Reliable anywhere" (§C security hardening; docs/reviews/v2.0/final-review-security.md L2, L3).
-- Expand-only: three `create or replace` with the same signatures, security, grants and keys, and
-- one comment. Nothing is dropped, renamed or rewritten; every answer is the same as before for
-- every role today.
--
-- L2: the v2.0 folds relied on RLS alone for "own row". Correct today (task_reads_select_own shows
-- the caller's rows only, org_settings_select the caller's organisation only), but a `limit 1` with
-- no filter would quietly return another member's row if a later policy widened either table,
-- where the old `.maybeSingle()` read failed loudly. Each now names the row it means:
--   task_page's last_read    -> and tr.member_id = auth.uid()
--   own_week's thresholds    -> where s.org_id = the caller's organisation
--   working_day_rule's days  -> where s.org_id = the caller's organisation
-- (own_week's leave key already filtered on the member.)

create or replace function public.task_page(p_task_id uuid, p_comments integer, p_activity integer)
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
    'last_read', (select tr.last_read_at from public.task_reads tr
                   where tr.task_id = p_task_id and tr.member_id = (select auth.uid()) limit 1),
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

create or replace function public.own_week(from_date date, to_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_hours integer;
  v_owner_hours integer;
begin
  if from_date is null or to_date is null or to_date < from_date or to_date - from_date > 61 then
    perform app.fail('VALIDATION', 'The window runs from_date to to_date, at most 62 days.');
  end if;
  -- v2.0 X3 (/tasks): the organisation's thresholds, read once (getSettings' row, under RLS).
  select s.ack_escalate_hours, s.ack_escalate_owner_hours into v_hours, v_owner_hours
  from public.org_settings s
  where s.org_id = (select c.org_id from app.current_member() c)
  limit 1;
  return jsonb_build_object(
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'date', h.date, 'name', h.name) order by h.date, h.id)
      from public.holidays h
      where h.date between from_date and to_date), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'title', t.title,
               'state', t.state,
               'event_date', t.event_date,
               'event_start_at', t.event_start_at,
               'event_end_at', t.event_end_at,
               'location', t.location,
               'client_id', t.client_id,
               'task_type_id', t.task_type_id,
               'primary_owner_id', t.primary_owner_id,
               'assignee_ids', coalesce((
                 select jsonb_agg(a.member_id order by a.member_id)
                 from public.task_assignees a
                 where a.task_id = t.id and a.removed_at is null), '[]'::jsonb))
             order by t.event_date, t.event_start_at nulls first, t.id)
      from public.tasks t
      where t.event_date between from_date and to_date and t.state <> 'cancelled'), '[]'::jsonb),
    -- v2.0 X3: the caller's own approved leave touching the window (listApprovedLeaveBetween).
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('type', l.type, 'start_date', l.start_date, 'end_date', l.end_date)
                       order by l.start_date, l.id)
      from public.leave_requests l
      where l.member_id = auth.uid() and l.state = 'approved'
        and l.start_date <= to_date and l.end_date >= from_date), '[]'::jsonb),
    -- v2.0 X3: the freelancers the caller coordinates now (listOwnFreelancerIds), under the same
    -- view and RLS; not windowed.
    'freelancers', coalesce((
      select jsonb_agg(f.member_id order by f.member_id)
      from public.coordinated_freelancers f
      where f.to_at is null and f.member_id is not null), '[]'::jsonb),
    -- v2.0 X3 (/tasks): the pending task requests the caller may decide, never their own
    -- (countRequestsToDecide; app.requests_to_decide_count, above), and the organisation's two
    -- "not noted" escalation thresholds (getSettings' org_settings row, under RLS; null when none
    -- is visible). Not windowed.
    'requests_to_decide', (select app.requests_to_decide_count()),
    'ack_escalate_hours', v_hours,
    'ack_escalate_owner_hours', v_owner_hours
  );
end;
$$;

create or replace function public.working_day_rule(from_date date, to_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if from_date is null or to_date is null or to_date < from_date or to_date - from_date > 61 then
    perform app.fail('VALIDATION', 'The window runs from_date to to_date, at most 62 days.');
  end if;
  return jsonb_build_object(
    'weekly_off_days', (select to_jsonb(s.weekly_off_days) from public.org_settings s
                         where s.org_id = (select c.org_id from app.current_member() c) limit 1),
    'holidays', coalesce((
      select jsonb_agg(h.date order by h.date)
      from public.holidays h
      where h.date between from_date and to_date), '[]'::jsonb)
  );
end;
$$;

-- L3: app.requests_to_decide_count() (security definer) re-implements app.task_request_visible's
-- decider branch; only pgTAP 135's equality test holds them equal. The pointer now runs both ways.
comment on function app.task_request_visible(uuid, uuid) is
  'Who may see a task request (the task_requests_select policy). app.requests_to_decide_count() '
  're-implements its decider branch as a security-definer count (migrations own_week_tasks_counts, '
  'requests_to_decide_admin_rule): change both together; pgTAP 135 holds them equal and must stay.';
