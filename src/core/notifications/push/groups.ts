/**
 * The push notification's large picture (owner decision 2026-10-02). Chrome on Android cannot
 * leave the large-picture slot empty: with no `icon` it draws a grey disc with the first letter of
 * the origin, and the app icon there doubled the M (5A's phone test). So every push carries the
 * **group** of its kind, a name and never a URL; the service worker maps it to one of a few fixed
 * same-origin images (`public/icons/notify/<group>.png`, `scripts/generate-notify-icons.mjs`) and
 * falls back to `other` for a group it does not know. No personal data, no avatar, nothing behind
 * auth. The status-bar `badge` (the white M) is unchanged.
 */
export const NOTIFY_GROUPS = ["tasks", "approvals", "leave", "reminders", "other"] as const;
export type NotifyGroup = (typeof NOTIFY_GROUPS)[number];

/**
 * Each notification kind's group (`notification_kinds`). What waits for the reader's decision is
 * `approvals`; the answer to their own request about time off is `leave`; work on a task is
 * `tasks`; nudges and escalations are `reminders` (5.3's included); the rest `other`.
 */
const GROUP_OF_KIND: Readonly<Record<string, NotifyGroup>> = {
  // A task's own life, for the people on it.
  task_assigned: "tasks",
  task_unassigned: "tasks",
  task_changed: "tasks",
  task_comment: "tasks",
  task_cancelled: "tasks",
  task_reopened: "tasks",
  task_completed: "tasks",
  task_changes_requested: "tasks",
  task_request_converted: "tasks",
  task_request_declined: "tasks",
  // Something waiting for the reader's decision.
  task_submitted: "approvals",
  task_admin_approved: "approvals",
  task_request_created: "approvals",
  approvals_moved: "approvals",
  leave_requested: "approvals",
  extra_work_submitted: "approvals",
  expense_submitted: "approvals",
  // Time off and the working day: the answers a member gets.
  leave_decided: "leave",
  attendance_decided: "leave",
  absent_proposed: "leave",
  comp_leave_granted: "leave",
  comp_leave_revoked: "leave",
  extra_work_decided: "leave",
  // Nudges and escalations (the end-day reminder; 5.3's reminders and escalations).
  end_day_reminder: "reminders",
  reminder_before_due: "reminders",
  reminder_before_due_last: "reminders",
  reminder_due_now: "reminders",
  reminder_overdue: "reminders",
  reminder_event: "reminders",
  reminder_not_noted: "reminders",
  escalation_not_noted: "reminders",
  escalation_overdue: "reminders",
  // Everything else: client Admins, coordinators, an expense's outcome, an unreachable person.
  client_admin_assigned: "other",
  client_admin_removed: "other",
  coordinator_assigned: "other",
  coordinator_removed: "other",
  coordinator_missing: "other",
  expense_decided: "other",
  // 5.4: someone the Owner cannot reach (about a person, like coordinator_missing).
  member_unreachable: "other",
};

/** The group a push for this kind carries; the quiet-hours summary and an unknown kind are `other`. */
export function notifyGroupFor(kind: string, isSummary = false): NotifyGroup {
  if (isSummary) return "other";
  return Object.hasOwn(GROUP_OF_KIND, kind) ? GROUP_OF_KIND[kind]! : "other";
}

/** Every kind the map names (for the test that keeps it in step with `notification_kinds`). */
export const GROUPED_KINDS: readonly string[] = Object.keys(GROUP_OF_KIND);
