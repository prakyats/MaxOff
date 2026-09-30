-- 5.1 review fixes (unit 5A step 2, part A; the architecture review of step 1). Expand-only
-- (ARCHITECTURE §18): a new per-member visibility helper, and CREATE OR REPLACE of six functions
-- with the same signatures and the fixes below, nothing else changed.
--
-- M1  A comment reaches only people who can still see the task: earlier commenters (and the
--     freelancers they wrote for) who lost access get nothing (5A decision 25 read for comments:
--     a nameless comment row has nothing to act on). app.task_visible_to(task, member) is
--     app.task_visible's rule set judged for a named member (ADR-0013 coordinators included).
-- S1  The 20:30 reminder fires only when the IST time is within [logout_reminder_time, +5 min):
--     pg_cron runs it every 5 minutes all day, so a time outside the old 17:30-00:25 IST window
--     is honoured and a time before the window no longer fires at the window's first run.
--     Still once per person and day (the notifications row is the record).
-- S2  A null reason is never concatenated into a body (leave_owner_cancel, leave_decide's
--     rejection): both require a reason, so the null never occurred, but the `case when` form
--     is the one every other body uses, and a future change to the reason rule cannot null the body.
-- L1  task_request_convert: a requester who is on the new task got task_assigned and
--     task_request_converted; now only the task_assigned row.
-- L2  member_deactivate: coordinator_missing is written only for an active freelancer (past the
--     CONFLICT check, the rows it closes belong to deactivated freelancers, who need no coordinator).
-- S5  push_subscriptions is not audited: the reason is on the table comment.

-- M1. app.task_visible_to(task, member): app.task_visible's rules for a named member -------------
create or replace function app.task_visible_to(p_task_id uuid, p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.members m on m.id = p_member_id and m.org_id = t.org_id and m.status = 'active'
    where t.id = p_task_id
      and (m.role = 'owner'
           or t.created_by = m.id
           or t.approving_admin_id = m.id
           or exists (select 1 from public.task_assignees a
                      where a.task_id = t.id and a.removed_at is null
                        and (a.member_id = m.id or app.coordinator_of(a.member_id) = m.id))
           or (t.client_id is not null
               and exists (select 1 from public.role_permissions rp
                           where rp.role = m.role and rp.permission = 'clients.edit_assigned')
               and exists (select 1 from public.clients c
                           where c.id = t.client_id and c.admin_id = m.id))));
$$;
comment on function app.task_visible_to(uuid, uuid) is
  '5.1 review (M1), service_role only: may this member see this task? The same rules as '
  'app.task_visible (PERMISSIONS §2, ADR-0013 §6) judged for a named active member instead of '
  'the caller: the Owner every task; the creator, the approving Admin, an active assignee, the '
  'current coordinator of an active freelancer assignee, and an Admin whose client the task is '
  'labelled with. A removed assignee, a former coordinator and a deactivated person see nothing. '
  'Used to keep a comment''s recipients to the people who can still open it.';
revoke all on function app.task_visible_to(uuid, uuid) from public, authenticated;
grant execute on function app.task_visible_to(uuid, uuid) to service_role;

-- M1. The comment trigger: only people who can still see the task ------------------------------
create or replace function app.task_comments_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_people uuid[];
  v_who text;
begin
  select t.* into v_task from public.tasks t where t.id = new.task_id;
  v_people := array(
    select p from unnest(app.task_people(v_task.id, true)) p
    union
    select v_task.approving_admin_id where v_task.approving_admin_id is not null
    union
    select c.author_id from public.task_comments c where c.task_id = v_task.id and c.id <> new.id
    union
    select c.on_behalf_of from public.task_comments c
    where c.task_id = v_task.id and c.id <> new.id and c.on_behalf_of is not null);
  v_who := case when new.on_behalf_of is null then app.member_name(new.author_id)
                else app.member_name(new.on_behalf_of) || ' (via ' || app.member_name(new.author_id) || ')' end;
  -- 5.1 review (M1): only people who can still see the task (5A decision 25 read for comments: a
  -- comment row with the task unnamed has nothing to act on, so a person who lost access gets none).
  perform app.notify(
    array(select p from unnest(v_people) p
          where p <> new.author_id and p is distinct from new.on_behalf_of
            and app.task_visible_to(v_task.id, p)),
    'task_comment', 'Comment on ' || v_task.title,
    v_who || ': ' || left(new.body, 280),
    '/tasks/' || v_task.id, 'tasks', v_task.id,
    jsonb_build_object('task_id', v_task.id, 'comment_id', new.id), new.author_id);
  return null;
end;
$$;
comment on function app.task_comments_notify() is
  '5.1 (5A decision 15): AFTER INSERT on task_comments: notifies the task''s assignees, creator, '
  'approving Admin and earlier commenters, never the author (task_comment; a freelancer''s row to '
  'their coordinator), through app.notify(). 5.1 review (M1): only those who can still see the '
  'task (app.task_visible_to); a person who lost access gets nothing for a comment.';

-- S2. leave_decide: the rejection's reason through the case-when form ----------------------------
create or replace function public.leave_decide(request_id uuid, decision text, reason text default null)
returns table(state public.leave_state, kept_dates date[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_member uuid;
  v_req public.leave_requests;
  v_orig public.leave_requests;
  v_clash public.leave_requests;
  v_kept date[];
  v_what text;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('approve', 'reject') then
    perform app.fail('VALIDATION', 'The decision is approve or reject.');
  end if;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the rows.
  select r.member_id into v_member
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = leave_decide.request_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select r.* into v_req from public.leave_requests r where r.id = leave_decide.request_id for update;
  if v_req.source = 'attendance' then
    perform app.fail('INVALID_STATE', 'Decide this one from the attendance day: it was made at the gate.');
  end if;
  if v_req.state <> 'submitted' then
    perform app.fail('INVALID_STATE', 'This request has already been decided.');
  end if;
  v_what := case v_req.type when 'comp_leave' then 'Comp leave' when 'half_day' then 'Half day' else 'Leave' end;

  if decision = 'reject' then
    if v_reason is null then
      perform app.fail('REASON_REQUIRED', 'A rejection needs a reason.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'rejected', 'meta', jsonb_build_object('reason', v_reason))::text, true);
    update public.leave_requests r
    set state = 'rejected', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where r.id = v_req.id;
    -- 3b.2: a rejected comp leave request gives its credit back.
    perform app.comp_credit_settle(v_req.id, 'released');
    -- WORKFLOWS §9 "Leave decided": the member (5.1).
    perform app.notify_leave_member(v_req,
      case when v_req.requests_cancellation then 'Cancellation not approved'
           when v_req.supersedes_id is not null then 'Change not approved'
           else v_what || ' rejected' end,
      app.notify_span(v_req.start_date, v_req.end_date)
        || case when v_reason is null then '' else ' · ' || v_reason end);
    return query select 'rejected'::public.leave_state, '{}'::date[];
    return;
  end if;

  if v_req.supersedes_id is not null then
    select r.* into v_orig from public.leave_requests r where r.id = v_req.supersedes_id for update;
  end if;

  if v_req.requests_cancellation then
    if v_orig.state <> 'approved' then
      perform app.fail('INVALID_STATE', 'The leave this cancellation refers to is no longer approved.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'cancelled', 'meta', jsonb_build_object('by_request', v_req.id, 'reason', v_reason))::text, true);
    update public.leave_requests r
    set state = 'cancelled', decided_by = v_caller, decided_at = now(),
        decision_reason = coalesce(v_reason, 'cancellation approved')
    where r.id = v_orig.id;
    perform app.attendance_release_leave(v_orig, null, null);
    -- 3b.2: a cancelled comp leave gives its credit back (expired by now, or not).
    perform app.comp_credit_settle(v_orig.id, 'released');

    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'cancelled', 'meta', jsonb_build_object('reason', v_reason))::text, true);
    update public.leave_requests r
    set state = 'cancelled', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where r.id = v_req.id;
    perform app.notify_leave_member(v_req, v_what || ' cancelled, as you asked',
      app.notify_span(v_req.start_date, v_req.end_date)
        || case when v_reason is null then '' else ' · ' || v_reason end);
    return query select 'cancelled'::public.leave_state, '{}'::date[];
    return;
  end if;

  if v_orig.id is not null and v_orig.state = 'approved' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'superseded', 'meta', jsonb_build_object('by', v_req.id))::text, true);
    update public.leave_requests r set state = 'superseded' where r.id = v_orig.id;
    perform app.attendance_release_leave(v_orig, v_req.start_date, v_req.end_date);
    -- 3b.2: a superseded comp leave gives its credit back.
    perform app.comp_credit_settle(v_orig.id, 'released');
  end if;
  -- The later decision wins over a gate leave (WORKFLOWS §1, 2.2).
  perform app.leave_supersede_gate(v_req.member_id, v_req.start_date, v_req.end_date, v_req.id);
  -- Approved form or owner leave that already covers these dates (a race at submit time, or an
  -- Owner correction since): the Owner cancels or edits that one first. Submitted overlaps are
  -- not checked here; "the leave wins" supersedes a gate request, and the Owner rejects the rest.
  v_clash := app.leave_clash(v_req.member_id, v_req.start_date, v_req.end_date, v_req.id, true);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', format('Approved leave (%s) already covers these dates. Cancel or edit it first.',
                                        app.leave_clash_label(v_clash)));
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.leave_requests r
  set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
  where r.id = v_req.id
  returning r.* into v_req;
  -- 3b.2: an approved comp leave uses its credit (oldest first, reserved at submit).
  perform app.comp_credit_settle(v_req.id, 'used');
  v_kept := app.attendance_apply_leave(v_req);
  perform app.notify_leave_member(v_req,
    case when v_orig.id is not null then v_what || ' change approved' else v_what || ' approved' end,
    app.notify_span(v_req.start_date, v_req.end_date)
      || case when v_reason is null then '' else ' · ' || v_reason end);
  return query select 'approved'::public.leave_state, v_kept;
end;
$$;


-- S2. leave_owner_cancel: the same ---------------------------------------------------------------
create or replace function public.leave_owner_cancel(request_id uuid, reason text default null)
returns public.leave_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_member uuid;
  v_orig public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the row.
  select r.member_id into v_member
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = request_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select r.* into v_orig from public.leave_requests r where r.id = request_id for update;
  if v_orig.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be cancelled.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Cancelling approved leave needs a reason.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'cancelled', 'meta', jsonb_build_object('by_owner', true, 'reason', v_reason))::text, true);
  update public.leave_requests
  set state = 'cancelled', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
  where id = v_orig.id;
  perform app.attendance_release_leave(v_orig, null, null);
  -- 3b.2: a cancelled comp leave gives its credit back.
  perform app.comp_credit_settle(v_orig.id, 'released');
  -- WORKFLOWS §9 "Leave decided": the member (5.1).
  perform app.notify_leave_member(v_orig,
    case v_orig.type when 'comp_leave' then 'Comp leave' when 'half_day' then 'Half day' else 'Leave' end
      || ' cancelled by the Owner',
    app.notify_span(v_orig.start_date, v_orig.end_date)
      || case when v_reason is null then '' else ' · ' || v_reason end);
  return 'cancelled';
end;
$$;


-- L1. task_request_convert: a requester on the new task gets the task_assigned row only ------------
create or replace function public.task_request_convert(
  request_id uuid, title text, description text, task_type_id uuid, client_id uuid, priority public.priority,
  due_at timestamptz, assignee_ids uuid[], primary_owner_id uuid, approving_admin_id uuid default null,
  event_date date default null, event_start_at timestamptz default null, event_end_at timestamptz default null,
  location text default null, purpose text default null, stages text[] default '{}',
  custom_fields jsonb default '{}', reminder_rules jsonb default null, template_id uuid default null,
  warnings jsonb default '[]')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.task_requests;
  v_task_id uuid;
begin
  if (select m.id from app.current_member() m) is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('task_requests.decide') then
    perform app.fail('FORBIDDEN', 'You cannot decide suggested tasks.');
  end if;
  v_request := app.task_request_lock(task_request_convert.request_id);
  -- Kickoff 4 decision 23: an Admin never decides their own suggestion (it goes to the Owner).
  if v_request.requested_by = auth.uid() and not app.is_owner() then
    perform app.fail('FORBIDDEN', 'Your own suggestion goes to the Owner: you can withdraw it.');
  end if;
  if v_request.state <> 'pending' then
    perform app.fail('INVALID_STATE', 'This suggestion was already decided.');
  end if;

  -- The task is the decider's own, with every rule of task_create (the route, the label, the people).
  v_task_id := public.task_create(
    task_request_convert.title, task_request_convert.description, task_request_convert.task_type_id,
    task_request_convert.client_id, task_request_convert.priority, task_request_convert.due_at,
    task_request_convert.assignee_ids, task_request_convert.primary_owner_id,
    task_request_convert.approving_admin_id, task_request_convert.event_date,
    task_request_convert.event_start_at, task_request_convert.event_end_at,
    task_request_convert.location, task_request_convert.purpose, task_request_convert.stages,
    task_request_convert.custom_fields, task_request_convert.reminder_rules,
    task_request_convert.template_id, task_request_convert.warnings);

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'converted', 'meta', jsonb_build_object('task_id', v_task_id))::text, true);
  update public.task_requests
  set state = 'converted', task_id = v_task_id, decided_by = auth.uid(), decided_at = now()
  where id = v_request.id;
  -- WORKFLOWS §9 (Kickoff 4 decision 24, from Kickoff 5 decision 9): the requester is told it
  -- became a task; the row links the request, never the task (5A decision 25: the requester may
  -- not be on it); task_create told the assignees (5.1).
  -- 5.1 review (L1): a requester who is on the new task was told by task_assigned already.
  if not (v_request.requested_by = any (app.task_people(v_task_id))) then
    perform app.notify(array[v_request.requested_by], 'task_request_converted',
      'Suggestion accepted: ' || v_request.title, 'It is now a task.',
      '/tasks/requests', 'task_requests', v_request.id,
      jsonb_build_object('request_id', v_request.id));
  end if;
  return v_task_id;
end;
$$;
comment on function public.task_request_convert(uuid, text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) is
  'task_requests.decide (and task_create''s own checks: tasks.create, the route, the label, the '
  'people) on a pending request the caller sees, never an Admin''s own (Kickoff 4 decision 23): '
  'creates the task and marks the request converted (task_id) in one transaction. Returns the task '
  'id. Audit actions: task_create''s, then converted (meta.task_id). 5.1: notifies the requester '
  '(task_request_converted, linking the request, never the task: 5A decision 25) through '
  'app.notify(); task_create notifies the assignees, and a requester who is one of them gets '
  'only that row (5.1 review L1).';

-- 8c. Leave and attendance -----------------------------------------------------------------------
-- The Owner's rows link Approvals; a member's rows link their own Leave / Attendance tabs.

-- L2. member_deactivate: coordinator_missing for an active freelancer only ---------------------------
create or replace function public.member_deactivate(member_id uuid, reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_target public.members;
  v_reason text := nullif(btrim(coalesce(reason, '')), '');
  v_count int;
  v_row record;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;

  select m.* into v_target
  from public.members m
  where m.id = member_id and m.org_id = v_org
  for update;
  if v_target.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_target.id = v_caller then
    perform app.fail('FORBIDDEN', 'You cannot deactivate yourself.');
  end if;
  if v_target.role = 'owner' then
    perform app.fail('FORBIDDEN', 'The Owner cannot be deactivated.');
  end if;
  if v_target.status = 'deactivated' then
    perform app.fail('INVALID_STATE', 'This person is already deactivated.');
  end if;
  -- 4A (WORKFLOWS §1b): no freelancer is left without a coordinator.
  select count(*) into v_count
  from public.member_coordinators mc
  join public.members f on f.id = mc.member_id and f.status = 'active'
  where mc.coordinator_id = v_target.id and mc.to_at is null;
  if v_count > 0 then
    perform app.fail('CONFLICT', format(
      'Move %s''s %s to another coordinator first.', v_target.full_name,
      case when v_count = 1 then '1 freelancer' else v_count || ' freelancers' end));
  end if;

  if v_target.engagement = 'freelance' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'coordinator_closed', 'meta', jsonb_build_object('reason', 'deactivated'))::text, true);
    update public.member_coordinators mc set to_at = now()
    where mc.member_id = v_target.id and mc.to_at is null;
  end if;
  -- 4A review (M2): past the CONFLICT above, a current row still pointing at this person belongs to
  -- a deactivated freelancer (a coordinator set to prepare a reactivation). It is closed with them,
  -- so nobody is ever reactivated behind a coordinator who has left (ADR-0013 §2); the
  -- reactivation asks for a coordinator again. One row per statement: the audit override labels
  -- only the first row a statement writes. `to_at is null` again in the update, so a change that
  -- closed the row meanwhile is never overwritten (history is never rewritten).
  for v_row in
    select mc.id, mc.member_id as freelancer_id, f.status as freelancer_status
    from public.member_coordinators mc
    join public.members f on f.id = mc.member_id
    where mc.coordinator_id = v_target.id and mc.to_at is null
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'coordinator_closed',
      'meta', jsonb_build_object('reason', 'coordinator_deactivated', 'coordinator_id', v_target.id))::text, true);
    update public.member_coordinators set to_at = now() where id = v_row.id and to_at is null;
    -- 5A decision 17 (5.1): the Owner, once per affected freelancer. Only the Owner manages the
    -- team, so the Owner is this transition's actor: the row is written with no actor (the one
    -- place the "never the actor" rule yields), because the decision names the Owner and the row
    -- is a to-do ("choose one") that would otherwise never exist.
    -- 5.1 review (L2): a deactivated freelancer needs no coordinator, so no to-do for them.
    if v_row.freelancer_status = 'active' then
      perform app.notify(array[app.org_owner_id(v_org)], 'coordinator_missing',
        app.member_name(v_row.freelancer_id) || ' has no coordinator: choose one',
        format('%s was deactivated.', v_target.full_name),
        '/people/' || v_row.freelancer_id, 'members', v_row.freelancer_id,
        jsonb_build_object('freelancer_id', v_row.freelancer_id, 'coordinator_id', v_target.id), null);
    end if;
  end loop;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'deactivated',
    'meta', jsonb_build_object('reason', v_reason, 'from_status', v_target.status)
  )::text, true);
  update public.members set status = 'deactivated', deactivated_at = now() where id = member_id;

  -- Access ends now, not when the JWT expires: no refresh token of theirs survives (ADR-0012).
  -- A freelancer has neither (no auth user): the deletes find nothing.
  delete from auth.refresh_tokens where user_id = member_id::text;
  delete from auth.sessions where user_id = member_id;
  -- 5.1 (WORKFLOWS §9a): their push subscriptions end with them; the rows stay as history.
  update public.push_subscriptions
  set disabled_at = now(), disabled_reason = 'deactivated'
  where push_subscriptions.member_id = member_deactivate.member_id and disabled_at is null;

  return 'deactivated';
end;
$$;

-- 8g. Clients -----------------------------------------------------------------------------------------

-- S1. The 20:30 reminder: within [logout_reminder_time, +5 min), every 5 minutes all day -----------
create or replace function app.end_day_reminder(p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_n integer := 0;
begin
  -- The org's own time (org_settings.logout_reminder_time, default 20:30 IST). pg_cron runs this
  -- every 5 minutes all day; a run sends only when the IST time is within [time, time + 5 min),
  -- so the reminder goes out at its time and never at the first run of some later window
  -- (5.1 review S1). Each day is reminded once per person (the notifications row is the record).
  for v_row in
    select d.member_id, d.day_id, d.started_at, m.org_id, m.role
    from app.end_day_reminder_due(p_at) d
    join public.members m on m.id = d.member_id
    join public.org_settings s on s.org_id = m.org_id
    where (p_at at time zone 'Asia/Kolkata')::time >= s.logout_reminder_time
      and (p_at at time zone 'Asia/Kolkata')::time < s.logout_reminder_time + interval '5 minutes'
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = d.member_id and n.kind = 'end_day_reminder'
          and n.entity = 'attendance_days' and n.entity_id = d.day_id)
    order by d.member_id
  loop
    v_n := v_n + app.notify(array[v_row.member_id], 'end_day_reminder',
      'You haven''t ended your day',
      format('Started at %s. If you''re done, end it; if you''re working late, carry on.',
             to_char(v_row.started_at at time zone 'Asia/Kolkata', 'HH24:MI')),
      case when v_row.role = 'admin' then '/today' else '/my-day' end,
      'attendance_days', v_row.day_id, jsonb_build_object('day_id', v_row.day_id), null);
  end loop;
  return v_n;
end;
$$;
comment on function app.end_day_reminder(timestamptz) is
  '5.1 (WORKFLOWS §8/§9 "Forgot to end the day"): the 20:30 reminder job. Once per person and '
  'day, when the IST time of p_at is within [org_settings.logout_reminder_time, + 5 min) (5.1 '
  'review S1), to everyone app.end_day_reminder_due() lists (a Start day and no End day today). '
  'pg_cron runs it every 5 minutes all day; idempotent (the notifications row is the record). '
  'Returns the rows written. No actor.';
select cron.unschedule('end_day_reminder');
select cron.schedule('end_day_reminder', '*/5 * * * *', $$select app.end_day_reminder()$$);

-- S4. push_subscriptions_guard ran as its owner (SECURITY DEFINER), so app.in_transition() was
-- always true inside it and the guard never fired (the review's test for a non-permanent member
-- found it). SECURITY INVOKER, like every other insert guard: the API role runs it as itself.
create or replace function app.push_subscriptions_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if app.in_transition() then
    return new;
  end if;
  if new.member_id is distinct from auth.uid() then
    perform app.fail('FORBIDDEN', 'A subscription belongs to the person who made it.');
  end if;
  if not exists (select 1 from app.current_member() m where m.engagement = 'permanent') then
    perform app.fail('FORBIDDEN', 'Your account cannot receive push notifications.');
  end if;
  return new;
end;
$$;
comment on function app.push_subscriptions_guard() is
  '5.1: BEFORE INSERT on push_subscriptions: only an active permanent member, for themselves '
  '(service_role and transition functions pass). SECURITY INVOKER (5.1 review S4): as its owner, '
  'app.in_transition() was always true and the guard never ran.';

-- S5. push_subscriptions: not audited, and why ------------------------------------------------------
comment on table public.push_subscriptions is
  '5.1 (WORKFLOWS §9a): a member''s Web Push subscriptions, one per browser or installed app. Own '
  'rows only: a member inserts (endpoint, keys, platform, is_standalone, label, user_agent), '
  'updates the keys, label, platform, is_standalone, user_agent and last_seen_at, and deletes '
  '("Sign out of this device"); the result columns (last_success_at, last_failure_at, '
  'failure_count, disabled_*, last_test_at) are the dispatcher''s (service_role). A freelancer '
  'has no login, so never a row. Deactivation disables every row (''deactivated''). Nobody but the '
  'member ever reads an endpoint. Not audited (5.1 review S5): a row is the member''s own device '
  'state, not a fact about the business (as task_reads); its writes are the member''s own '
  'subscribe / sign-out on their own device and the dispatcher''s result of every send, which '
  'would flood activity_log with nothing anyone reviews; the one business event that touches '
  'it, deactivation, is audited by member_deactivate itself.';
