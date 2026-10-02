import { describe, expect, it } from "vitest";

import { GROUPED_KINDS, NOTIFY_GROUPS, notifyGroupFor } from "./groups";

/** The kinds `notification_kinds` holds today (5A); a new kind falls back to `other` until mapped. */
const KINDS_5A = [
  "absent_proposed",
  "approvals_moved",
  "attendance_decided",
  "client_admin_assigned",
  "client_admin_removed",
  "comp_leave_granted",
  "comp_leave_revoked",
  "coordinator_assigned",
  "coordinator_missing",
  "coordinator_removed",
  "end_day_reminder",
  "expense_decided",
  "expense_submitted",
  "extra_work_decided",
  "extra_work_submitted",
  "leave_decided",
  "leave_requested",
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
    expect([...GROUPED_KINDS].sort()).toEqual(KINDS_5A);
    for (const kind of KINDS_5A) expect(NOTIFY_GROUPS).toContain(notifyGroupFor(kind));
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
    expect(notifyGroupFor("coordinator_missing")).toBe("other");
  });

  it("the quiet-hours summary and an unknown or inherited name are other", () => {
    expect(notifyGroupFor("task_assigned", true)).toBe("other");
    expect(notifyGroupFor("summary")).toBe("other");
    expect(notifyGroupFor("something_new")).toBe("other");
    expect(notifyGroupFor("constructor")).toBe("other");
    expect(notifyGroupFor("__proto__")).toBe("other");
  });
});
