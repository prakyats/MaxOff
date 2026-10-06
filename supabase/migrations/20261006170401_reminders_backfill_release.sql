-- v1.4.0 (owner decisions 2026-10-03 and 2026-10-06): reminders for the tasks already open. Until
-- now only tasks created after migration task_reminders (5.3) were armed; this arms every open task
-- that is not armed yet, once, at the release: app.reminders_backfill(now(), false), as built and
-- covered by pgTAP 54 (only the reminders still ahead; an already overdue task's escalation counts
-- from now; acknowledgement repeats and escalations count from now). Idempotent: an armed task is
-- skipped, so a re-run arms nothing.
--
-- The deploy log records the counts (a NOTICE): the tasks armed and reminders created, and the
-- acknowledgement messages it starts, read with app.reminders_backfill_ack_preview() just before the
-- backfill (afterwards every open task is armed and the preview reads nothing): not_noted (each gets
-- the repeat ack_repeat_hours later, 2 h at launch), the lead's escalations after ack_escalate_hours
-- (4 h) and the Owner's after ack_escalate_owner_hours (8 h), each with the assignments they name.
-- The staging dry run (preview workflow, reminders-backfill-dry-run) reported the same numbers.
--
-- Expand-only: no table or function changes; the function's comment now says how it ran.

do $$
declare
  v_ack record;
  v_run record;
begin
  select * into v_ack from app.reminders_backfill_ack_preview();
  select * into v_run from app.reminders_backfill(now(), false);
  raise notice 'reminders backfill (v1.4.0): % tasks armed, % reminders created; acknowledgements: % not noted (repeat at +ack_repeat_hours), % lead escalations naming % (at +ack_escalate_hours), % Owner escalations naming % (at +ack_escalate_owner_hours)',
    v_run.tasks, v_run.reminders, v_ack.not_noted, v_ack.lead_escalations, v_ack.lead_named,
    v_ack.owner_escalations, v_ack.owner_named;
end;
$$;

comment on function app.reminders_backfill(timestamptz, boolean) is
  '5.3 (owner, 2026-10-02), service_role only: arms the open tasks (todo, in_progress, '
  'changes_requested; not archived) that are not armed yet, with only the reminders still ahead; an '
  'already overdue task''s escalation counts from p_now; acknowledgement repeats and escalations count '
  'from p_now (armed_at). Idempotent. p_dry_run (the default) returns the counts (tasks, reminders) and '
  'rolls back. Run for real once, by the v1.4.0 release migration reminders_backfill_release (owner '
  'decision 2026-10-06), which logs its counts as a NOTICE.';
