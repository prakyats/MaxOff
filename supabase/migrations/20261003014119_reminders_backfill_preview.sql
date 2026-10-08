-- 5.3 (unit 5B), owner 2026-10-03: the staging dry run of the release backfill also says how many
-- acknowledgement messages it starts. The backfill arms every open task with armed_at = the
-- backfill, so on an old task nobody has noted, reminders_tick sends the repeat ack_repeat_hours
-- after it (2 h at launch), the lead's escalation after ack_escalate_hours (4 h: the approving Admin,
-- else whoever created the task) and the Owner's after ack_escalate_owner_hours (8 h). Read only and
-- expand-only: one new function, nothing written.
--
-- The counts follow reminders_tick's own conditions (migration reminders_followups): only the tasks
-- the backfill would arm (open, not archived, not armed yet); assignments not removed, not noted, of
-- active members; an escalation is one message a task, skipped when its recipient is one of the
-- people not noted; the Owner's is skipped when the lead's already went to the Owner. A repeat due
-- on a person's holiday or approved leave waits for their next working day; it is counted here.

create function app.reminders_backfill_ack_preview()
returns table (not_noted integer, lead_escalations integer, lead_named integer,
               owner_escalations integer, owner_named integer)
language sql
stable
security definer
set search_path = ''
as $$
  with armed as (
    select t.id, t.org_id, coalesce(t.approving_admin_id, t.created_by) as lead, app.org_owner_id(t.org_id) as owner
    from public.tasks t
    where t.state in ('todo', 'in_progress', 'changes_requested') and t.archived_at is null
      and not exists (select 1 from public.task_reminder_arms a where a.task_id = t.id)
  ), waiting as (
    select armed.id, armed.lead, armed.owner, array_agg(a.member_id) as members
    from armed
    join public.task_assignees a on a.task_id = armed.id
    join public.members m on m.id = a.member_id and m.status = 'active'
    where a.removed_at is null and a.acknowledged_at is null
    group by armed.id, armed.lead, armed.owner
  ), messages as (
    select cardinality(w.members) as named,
      w.lead is not null and not (w.lead = any (w.members)) as to_lead,
      w.owner is not null and w.lead is distinct from w.owner and not (w.owner = any (w.members)) as to_owner
    from waiting w
  )
  select coalesce(sum(named), 0)::integer,
    (count(*) filter (where to_lead))::integer,
    coalesce(sum(named) filter (where to_lead), 0)::integer,
    (count(*) filter (where to_owner))::integer,
    coalesce(sum(named) filter (where to_owner), 0)::integer
  from messages;
$$;
comment on function app.reminders_backfill_ack_preview() is
  '5.3, service_role only, read only: for the tasks app.reminders_backfill would arm now, the '
  'acknowledgement messages it starts: not_noted (assignments not noted: each gets the repeat '
  'ack_repeat_hours after the backfill), lead_escalations / lead_named (messages to the approving '
  'Admin or the creator after ack_escalate_hours, and the assignments they name), owner_escalations '
  '/ owner_named (the Owner''s after ack_escalate_owner_hours). The conditions are reminders_tick''s.';
revoke all on function app.reminders_backfill_ack_preview() from public, authenticated;
grant execute on function app.reminders_backfill_ack_preview() to service_role;
