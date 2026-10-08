import { describe, expect, it } from "vitest";

import { GROUPED_KINDS, NOTIFY_GROUPS, notifyGroupFor } from "./groups";

/** The kinds `notification_kinds` holds today (5A, 5.3, 5.4, 6.5, 7A, amendment C's escalations; the email-only digest is never pushed); a new kind falls back to `other` until mapped. */
const KINDS = [
  "absent_proposed",
  "approvals_moved",
  "attendance_decided",
  "carry_decided",
  "client_admin_assigned",
  "client_admin_removed",
  "client_created",
  "comp_leave_granted",
  "comp_leave_revoked",
  "coordinator_assigned",
  "coordinator_missing",
  "coordinator_removed",
  "cycle_generated",
  "end_day_reminder",
  "eod_report_ready",
  "escalation_cycle_undecided",
  "escalation_delivery_missed",
  "escalation_item_overdue",
  "escalation_not_noted",
  "escalation_overdue",
  "expense_decided",
  "expense_submitted",
  "extra_work_decided",
  "extra_work_submitted",
  "item_cancelled",
  "item_rejected",
  "items_to_decide",
  "leave_decided",
  "leave_requested",
  "member_unreachable",
  "owner_digest_weekly",
  "project_cancelled",
  "project_completed",
  "project_created",
  "project_reopened",
  "reminder_before_due",
  "reminder_before_due_last",
  "reminder_due_now",
  "reminder_event",
  "reminder_item_overdue",
  "reminder_not_noted",
  "reminder_overdue",
  "task_admin_approved",
  "task_assigned",
  "task_cancelled",
  "task_changed",
  "task_changes_requested",
  "task_comment",
  "task_completed",
  "task_reopened",
  "task_request_converted",
  "task_request_created",
  "task_request_declined",
  "task_submitted",
  "task_unassigned",
];

describe("notifyGroupFor (the push's large picture, owner 2026-10-02)", () => {
  it("names every kind there is, each in one of the five groups", () => {
    expect([...GROUPED_KINDS].sort()).toEqual(KINDS);
    for (const kind of KINDS) expect(NOTIFY_GROUPS).toContain(notifyGroupFor(kind));
  });

  it("groups by what the reader does with it", () => {
    expect(notifyGroupFor("task_assigned")).toBe("tasks");
    expect(notifyGroupFor("task_comment")).toBe("tasks");
    expect(notifyGroupFor("task_submitted")).toBe("approvals");
    expect(notifyGroupFor("leave_requested")).toBe("approvals");
    expect(notifyGroupFor("expense_submitted")).toBe("approvals");
    expect(notifyGroupFor("leave_decided")).toBe("leave");
    expect(notifyGroupFor("attendance_decided")).toBe("leave");
    expect(notifyGroupFor("end_day_reminder")).toBe("reminders");
    // 5.3: every reminder and escalation is the alarm clock.
    for (const kind of KINDS.filter((k) => /^(reminder|escalation)_/.test(k))) {
      expect(notifyGroupFor(kind)).toBe("reminders");
    }
    expect(notifyGroupFor("coordinator_missing")).toBe("other");
    expect(notifyGroupFor("member_unreachable")).toBe("other");
    // 6.5: the report is its own group; the weekly digest is never pushed (email only).
    expect(notifyGroupFor("eod_report_ready")).toBe("reports");
    expect(notifyGroupFor("owner_digest_weekly")).toBe("other");
  });

  it("the quiet-hours summary and an unknown or inherited name are other", () => {
    expect(notifyGroupFor("task_assigned", true)).toBe("other");
    expect(notifyGroupFor("summary")).toBe("other");
    expect(notifyGroupFor("something_new")).toBe("other");
    expect(notifyGroupFor("constructor")).toBe("other");
    expect(notifyGroupFor("__proto__")).toBe("other");
  });
});
