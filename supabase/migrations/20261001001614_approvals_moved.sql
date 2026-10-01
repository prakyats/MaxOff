-- 5A build decision 27 (owner, 2026-10-01): when an approving Admin is deactivated or made Staff
-- (Kickoff 4 decision 33's re-route, app.members_task_route() of 20260930070616), the Owner gets
-- ONE combined notification for that Admin's submitted tasks that moved to them ("3 submitted
-- tasks moved to you: Ravi was deactivated"), linking to Approvals. Singular for one task, nothing
-- for none; open tasks that only lose the approver notify nobody. Expand-only: a new info kind
-- (not actionable, never email) and the same trigger function re-created with the one call added.

insert into public.notification_kinds (kind, actionable, always_email, description) values
  ('approvals_moved', false, false, 'Submitted tasks moved to you when their approving Admin left (decision 27)');

create or replace function app.members_task_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_reason text;
  v_state public.task_state;
  v_id uuid;
  v_moved integer := 0;
begin
  -- (33) An approving Admin who stops being an active Admin: their open tasks lose the approver,
  -- and what waits for their check goes to the Owner (admin_step none), in this transaction.
  if old.role = 'admin' and old.status = 'active' and (new.role <> 'admin' or new.status <> 'active') then
    v_reason := case when new.status <> 'active' then 'approver_deactivated' else 'approver_role_changed' end;
    for v_task in
      select t.* from public.tasks t
      where t.approving_admin_id = old.id and t.state not in ('completed', 'cancelled')
      order by t.id
      for update
    loop
      v_state := case when v_task.state = 'submitted' then 'admin_approved' else v_task.state end;
      if v_task.state = 'submitted' then
        v_moved := v_moved + 1;
      end if;
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'approver_changed',
        'meta', jsonb_build_object('from', old.id, 'to', null, 'reason', v_reason,
                                   'from_state', v_task.state, 'to_state', v_state))::text, true);
      update public.tasks set approving_admin_id = null, admin_step = 'none', state = v_state
      where id = v_task.id;
    end loop;

    -- 5A decision 27: one row for the Owner when submitted tasks moved to them; none for open
    -- tasks that only lost the approver. Only the Owner deactivates or changes roles, so the Owner
    -- is this change's actor: like coordinator_missing (decision 17), the row is written with no
    -- actor, the one place the "never the actor" rule yields, because the decision names the Owner.
    if v_moved > 0 then
      perform app.notify(array[app.org_owner_id(new.org_id)], 'approvals_moved',
        format('%s submitted %s moved to you: %s %s',
          v_moved, case when v_moved = 1 then 'task' else 'tasks' end, old.full_name,
          case when new.status <> 'active' then 'was deactivated' else 'is no longer an Admin' end),
        case when v_moved = 1 then 'It waits for your approval.' else 'They wait for your approval.' end,
        '/approvals', null, null,
        jsonb_build_object('admin_id', old.id, 'count', v_moved, 'reason', v_reason), null);
    end if;
  end if;

  -- (34) A freelancer back at work: a submitted task of theirs waiting for their coordinator's
  -- check goes to the Owner.
  if new.engagement = 'freelance' and old.status <> 'active' and new.status = 'active' then
    for v_id in
      select t.id from public.tasks t
      join public.task_assignees a on a.task_id = t.id and a.removed_at is null
      where a.member_id = new.id and t.state = 'submitted'
      order by t.id
    loop
      perform app.task_skip_admin_step(v_id);
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function app.members_task_route() from public, anon;
grant execute on function app.members_task_route() to authenticated, service_role;

comment on function app.members_task_route() is
  'AFTER UPDATE OF role, status on members (Kickoff 4 decisions 33 and 34), in the same '
  'transaction as member_deactivate() or a role edit. An active Admin who is deactivated or no '
  'longer an Admin: every open task they approve loses its approver (admin_step none; submitted -> '
  'admin_approved, the Owner decides), audited as approver_changed with meta.reason '
  'approver_deactivated | approver_role_changed; when any submitted task moved, the Owner gets one '
  'approvals_moved row with the count and the Admin''s name, linking to /approvals, written with no '
  'actor (5A decision 27). A freelancer reactivated: a submitted task of theirs whose approving '
  'Admin is their coordinator goes to the Owner (app.task_skip_admin_step).';
