-- Phase 1 review hardening (2026-09-23, Owner decisions).
--
-- 1. The activity-log "own member row" clause no longer shows a person the Owner's deactivation
--    reason. That reason is a management note written for the Owner's record (WORKFLOWS §1a); the
--    person it is about must not read it after a reactivation, or honest notes stop being written.
--    Everything else about their own row (edits, invited, reactivated) stays visible to them.
--
-- 2. Column-level UPDATE grants for every table the API edits, mirroring `members` (1.1):
--    RLS decides *who* may update a row, the grant decides *which columns*. Without it an Admin with
--    lists.manage could set a job title's list_key, position, is_system or meta through PostgREST,
--    and the Owner could set organizations.timezone (invariant 8 assumes IST) or any created_at.
--    Transition functions and triggers are unaffected (security definer, table owner).

-- 1. activity_log self clause ------------------------------------------------------------------
drop policy activity_log_select on public.activity_log;
create policy activity_log_select on public.activity_log for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and ((select app.has_permission('activity.view_all'))
              or (entity = 'members'
                  and entity_id = (select c.id from app.current_member() c)
                  and action <> 'deactivated')));

comment on policy activity_log_select on public.activity_log is
  'activity.view_all, or entries about the caller''s own member row except the deactivation (its '
  'reason is the Owner''s note). Scope is per entity, never per actor. Modules add per-entity policies.';

-- 2. Column-level UPDATE grants ----------------------------------------------------------------
revoke update on public.organizations from authenticated;
grant update (name) on public.organizations to authenticated;

revoke update on public.org_settings from authenticated;
grant update (
  weekly_off_days, logout_reminder_time, ack_repeat_hours, ack_escalate_hours,
  ack_escalate_owner_hours, overdue_escalate_hours, email_daily_cap_per_member,
  default_task_reminders, workload_warning_threshold
) on public.org_settings to authenticated;

revoke update on public.list_items from authenticated;
grant update (name, description, color, icon, archived_at) on public.list_items to authenticated;

revoke update on public.holidays from authenticated;
grant update (date, name) on public.holidays to authenticated;
