-- STAGING ONLY (project jcejebyjaqwcumyzrhge). Never production: production never ran
-- 20261125122018 (no v* tag carries it). Leaves staging exactly as if 20261125122018_v50_handin_files
-- (the a376551 version, applied by Preview run 45613955080) had never run, so v4.5's
-- 20261125122607 / 20261125122610 and v5.0's 20261125131800 apply in order. One transaction:
-- any check failing rolls everything back.
begin;

-- 0. Checks: this is the state 122018 left, and it holds no data anyone made.
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261125122018') then
    raise exception 'STOP: 20261125122018 is not in staging''s history';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations
             where version in ('20261125122607', '20261125122610', '20261125131800')) then
    raise exception 'STOP: a later upload/hand-in migration is already recorded';
  end if;
  if (select count(*) from public.handin_files) + (select count(*) from public.handin_folders) > 0 then
    raise exception 'STOP: the hand-in tables hold rows (% files, % folders)',
      (select count(*) from public.handin_files), (select count(*) from public.handin_folders);
  end if;
  if exists (select 1 from public.notifications where kind = 'handin_space_held') then
    raise exception 'STOP: a handin_space_held notification exists';
  end if;
  if position('handin_files' in pg_get_functiondef('public.task_submit_done(uuid, text, text, uuid)'::regprocedure)) = 0 then
    raise exception 'STOP: task_submit_done is not 122018''s version';
  end if;
end;
$$;

-- 1. task_submit_done back to main's definition (20261015045552_tasks_for_owner.sql), verbatim.
create or replace function public.task_submit_done(
  task_id uuid, note text default null, late_reason text default null, on_behalf_of uuid default null)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_subject uuid;
  v_org uuid;
  v_task public.tasks;
  v_row public.task_assignees;
  v_note text := nullif(btrim(coalesce(task_submit_done.note, '')), '');
  v_late boolean;
  v_late_reason text := app.clean_reason(task_submit_done.late_reason);
  v_version integer;
  v_submission uuid;
  v_state public.task_state;
  v_step public.admin_step;
  v_meta jsonb;
begin
  select a.actor_id, a.subject_id, a.org_id into v_actor, v_subject, v_org
  from app.task_actor(task_submit_done.task_id, task_submit_done.on_behalf_of) a;
  v_task := app.task_lock(task_submit_done.task_id, v_org);
  if v_subject <> v_task.primary_owner_id then
    perform app.fail('FORBIDDEN', 'Only the primary owner marks a task Done.');
  end if;
  if v_task.state in ('submitted', 'admin_approved') then
    perform app.fail('INVALID_STATE', 'Already submitted: the task is waiting for its review.');
  end if;
  if v_task.state = 'completed' then
    perform app.fail('INVALID_STATE', 'This task is complete.');
  end if;
  if v_task.state = 'cancelled' then
    perform app.fail('INVALID_STATE', 'This task was cancelled.');
  end if;
  if v_note is not null and length(v_note) > 5000 then
    perform app.fail('VALIDATION', 'Keep the note under 5000 characters.');
  end if;
  v_late := now() > v_task.due_at;
  if v_late and v_late_reason is null then
    perform app.fail('REASON_REQUIRED', 'The deadline has passed: say why the task is late.');
  end if;

  -- Done does not wait for acknowledgements: the primary owner's is recorded now if missing.
  select ta.* into v_row from public.task_assignees ta
  where ta.task_id = v_task.id and ta.member_id = v_subject for update;
  if v_row.acknowledged_at is null then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'acknowledged',
      'on_behalf_of', task_submit_done.on_behalf_of,
      'meta', jsonb_build_object('member_id', v_subject, 'implied', true))::text, true);
    update public.task_assignees set acknowledged_at = now(), acknowledged_by = v_actor
    where task_assignees.task_id = v_task.id and member_id = v_subject;
  end if;

  -- The hand-in: one version per Done or resubmit (WORKFLOWS §3.3).
  select coalesce(max(s.version), 0) + 1 into v_version from public.task_submissions s where s.task_id = v_task.id;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submission_added',
    'on_behalf_of', task_submit_done.on_behalf_of,
    'meta', jsonb_build_object('version', v_version))::text, true);
  insert into public.task_submissions (task_id, version, note, submitted_by, on_behalf_of)
  values (v_task.id, v_version, v_note, v_actor, task_submit_done.on_behalf_of)
  returning id into v_submission;

  -- 6b.2 (owner 2026-10-07): a task whose primary owner is the Owner completes on Done. Final
  -- completion is always the Owner's, and here the Owner did the work: no Admin check, no review
  -- row (nobody reviewed it). The audit entry is "completed", meta.step owner_done.
  if v_task.primary_owner_id = app.org_owner_id(v_org) then
    v_step := case when v_task.approving_admin_id is null then 'none' else 'skipped' end;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'completed',
      'meta', jsonb_build_object('step', 'owner_done', 'version', v_version, 'late', v_late,
                                 'submission_id', v_submission))::text, true);
    update public.tasks
    set state = 'completed', admin_step = v_step, submitted_at = now(), submitted_by = v_actor,
        submitted_on_behalf_of = null,
        late_reason = case when v_late then v_late_reason else tasks.late_reason end,
        admin_approved_at = null, completed_at = now()
    where id = v_task.id;
    -- WORKFLOWS §9 "Task completed": the assignees and the creator; never the actor (the Owner).
    perform app.notify(app.task_people(v_task.id, true), 'task_completed',
      'Completed: ' || v_task.title,
      format('%s marked it done%s', app.member_name(v_subject), case when v_late then ' (late)' else '' end),
      '/tasks/' || v_task.id, 'tasks', v_task.id,
      jsonb_build_object('task_id', v_task.id, 'version', v_version), v_actor);
    return 'completed'::public.task_state;
  end if;

  -- The route (PRODUCT §4.6): the Admin step is required, none (no approver) or skipped (the
  -- approver is on the task: an assignee, or the coordinator of a freelancer on it, decision 34;
  -- the reason lives only in the activity log).
  if v_task.approving_admin_id is null then
    v_state := 'admin_approved'; v_step := 'none';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'none');
  elsif app.task_approver_on_task(v_task.id, v_task.approving_admin_id) then
    v_state := 'admin_approved'; v_step := 'skipped';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'skipped',
      'reason', case when app.is_task_assignee(v_task.id, v_task.approving_admin_id)
                     then 'approver_is_assignee' else 'approver_is_coordinator' end);
  else
    v_state := 'submitted'; v_step := 'required';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'required');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'on_behalf_of', task_submit_done.on_behalf_of, 'meta', v_meta)::text, true);
  update public.tasks
  set state = v_state, admin_step = v_step, submitted_at = now(), submitted_by = v_actor,
      submitted_on_behalf_of = task_submit_done.on_behalf_of,
      late_reason = case when v_late then v_late_reason else tasks.late_reason end,
      admin_approved_at = null
  where id = v_task.id;

  -- WORKFLOWS §9 "Task submitted (Done)": the approving Admin, or the Owner when there is no
  -- Admin step (5.1).
  perform app.notify(
    array[case when v_state = 'submitted' then v_task.approving_admin_id else app.org_owner_id(v_org) end],
    'task_submitted', 'Done: ' || v_task.title,
    format('%s marked it Done%s', app.member_name(v_subject), case when v_late then ' (late)' else '' end),
    '/tasks/' || v_task.id, 'tasks', v_task.id,
    jsonb_build_object('task_id', v_task.id, 'version', v_version), v_actor);
  return v_state;
end;
$$;

revoke all on function public.task_submit_done(uuid, text, text, uuid) from public, anon;
grant execute on function public.task_submit_done(uuid, text, text, uuid) to authenticated, service_role;

comment on function public.task_submit_done(uuid, text, text, uuid) is
  'tasks.work, the primary owner (or their current coordinator with on_behalf_of, ADR-0013), from '
  'todo / in_progress / changes_requested. Records the primary owner''s acknowledgement if missing '
  '(audit acknowledged, meta.implied), writes the next task_submissions version (the optional note, '
  'links allowed), requires late_reason past due_at (REASON_REQUIRED), then routes: submitted with '
  'admin_step required when an approving Admin exists and is not on the task; otherwise '
  'admin_approved with admin_step none (no approver) or skipped (the approver is an assignee, '
  'meta.reason approver_is_assignee, or the current coordinator of an active freelancer assignee, '
  'meta.reason approver_is_coordinator: Kickoff 4 decision 34). Audit action: submitted. 5.1: '
  'notifies the approving Admin, or the Owner when there is no Admin step (task_submitted) through '
  'app.notify(). 6b.2: when the primary owner is the Owner the task goes straight to completed '
  '(admin_step skipped with an approver, else none; audit completed, meta.step owner_done; no '
  'task_reviews row) and the assignees and creator get task_completed.';

-- 2. What 122018 created: 19 functions, 2 tables (with their 8 indexes), 1 notification kind.
drop function public.handin_versions(uuid);
drop function public.handin_file_start(uuid, text, text, bigint, text, uuid);
drop function public.handin_progress(uuid, bigint);
drop function public.handin_file_failed(uuid, text);
drop function public.handin_file_left_out(uuid, uuid);
drop function public.handin_folder_find(uuid, integer, text, text);
drop function public.handin_folder_put(uuid, integer, text, text, text);
drop function public.handin_session_set(uuid, text, text, text);
drop function public.handin_session_get(uuid);
drop function public.handin_file_done(uuid, text, bigint, text, text, text);
drop function public.handin_drive_check_claim(uuid[]);
drop function public.handin_drive_seen(uuid, text);
drop function app.handin_own_file(uuid);
drop function app.handin_can_add(uuid);
drop function app.handin_open_version(uuid);
drop function app.handin_clean_path(text);
drop function app.handin_clean_name(text);
drop function app.handin_clean_part(text);
drop function app.upload_manager(uuid);
drop table public.handin_files;
drop table public.handin_folders;
delete from public.notification_kinds where kind = 'handin_space_held';

-- 3. Its history row, as `supabase migration repair --status reverted 20261125122018` would.
delete from supabase_migrations.schema_migrations where version = '20261125122018';

commit;
