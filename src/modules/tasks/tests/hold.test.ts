import { describe, expect, it } from "vitest";

import { describeTaskActivity, type TaskActivityEntry } from "../domain/activity";
import {
  HOLD_REASON_MAX,
  canHold,
  holdActions,
  holdLine,
  holdReasonProblem,
  isOnHold,
  mayHoldOrResume,
  onHoldLine,
  resumeDeadlineProblem,
  resumeNeedsDeadline,
  splitOnHold,
} from "../domain/hold";
import { matchesState } from "../domain/list-filters";
import {
  badgeCount,
  heldOpen,
  myTaskGroups,
  needsYou,
  openByDeadline,
  type TaskListRow,
} from "../domain/lists";
import { relativeDeadline } from "../domain/page";
import { isOverdue, lateLabel, taskActions } from "../domain/task";

/** On hold, for tasks (v1.9 W7; WORKFLOWS §3.1a, ADR-0016). */

const NOW = new Date("2026-10-27T06:30:00.000Z"); // 12:00 IST
const PAST = "2026-10-26T12:30:00.000Z";
const FUTURE = "2026-10-30T12:30:00.000Z";

describe("a held task's clocks stop", () => {
  it("is never overdue, and has no late chip", () => {
    expect(isOverdue({ dueAt: PAST, state: "in_progress" }, NOW)).toBe(true);
    expect(isOverdue({ dueAt: PAST, state: "in_progress", heldAt: PAST }, NOW)).toBe(false);
    expect(lateLabel({ dueAt: PAST, state: "todo", heldAt: PAST }, NOW)).toBeNull();
    expect(isOverdue({ dueAt: PAST, state: "todo", heldAt: null }, NOW)).toBe(true);
  });

  it("is never Needs you's overdue work", () => {
    const row: TaskListRow = {
      id: "t",
      title: "Reel edit",
      state: "todo",
      adminStep: "required",
      priority: "medium",
      dueAt: PAST,
      clientId: null,
      taskTypeId: "normal",
      primaryOwnerId: "asha",
      approvingAdminId: "admin",
      createdBy: "admin",
      submittedAt: null,
      createdAt: PAST,
      assignees: [
        {
          memberId: "asha",
          isPrimary: true,
          assignedAt: PAST,
          acknowledgedAt: PAST,
          removedAt: null,
        },
      ],
    };
    const viewer = { id: "admin", role: "admin" as const, coordinates: [] };
    const escalation = { ackEscalateHours: 4, ackEscalateOwnerHours: 8 };
    expect(needsYou([row], viewer, NOW, escalation).map((item) => item.reason)).toEqual([
      "overdue",
    ]);
    expect(
      needsYou([{ ...row, heldAt: PAST, holdReason: "Footage" }], viewer, NOW, escalation),
    ).toEqual([]);
    expect(badgeCount([{ ...row, state: "changes_requested" }], { ...viewer, id: "asha" })).toBe(1);
    expect(
      badgeCount([{ ...row, state: "changes_requested", heldAt: PAST }], { ...viewer, id: "asha" }),
    ).toBe(0);
  });
});

describe("who holds and resumes (owner 2026-10-23)", () => {
  it("is the creator while they may create tasks, and the Owner always", () => {
    const task = { createdBy: "admin" };
    expect(mayHoldOrResume({ id: "admin", role: "admin", canCreateTasks: true }, task)).toBe(true);
    expect(mayHoldOrResume({ id: "owner", role: "owner", canCreateTasks: true }, task)).toBe(true);
    expect(mayHoldOrResume({ id: "admin2", role: "admin", canCreateTasks: true }, task)).toBe(
      false,
    );
    expect(mayHoldOrResume({ id: "admin", role: "staff", canCreateTasks: false }, task)).toBe(
      false,
    );
    expect(mayHoldOrResume({ id: "asha", role: "staff", canCreateTasks: false }, task)).toBe(false);
  });

  it("holds only a task still with its people, once", () => {
    expect(canHold({ state: "todo" })).toBe(true);
    expect(canHold({ state: "in_progress" })).toBe(true);
    expect(canHold({ state: "changes_requested" })).toBe(true);
    expect(canHold({ state: "todo", heldAt: PAST })).toBe(false);
    for (const state of ["submitted", "admin_approved", "completed", "cancelled"] as const) {
      expect(canHold({ state })).toBe(false);
    }
  });

  it("needs a reason, at most 1000 characters", () => {
    expect(holdReasonProblem("  ")).toBe("Say why it is on hold.");
    expect(holdReasonProblem("x".repeat(HOLD_REASON_MAX + 1))).toMatch(/under 1000/);
    expect(holdReasonProblem(" Client hasn't sent the footage ")).toBeNull();
  });
});

describe("resume (owner 2026-10-23)", () => {
  it("asks for a new deadline only when the old one passed", () => {
    expect(resumeNeedsDeadline({ dueAt: PAST, heldAt: PAST }, NOW)).toBe(true);
    expect(resumeNeedsDeadline({ dueAt: FUTURE, heldAt: PAST }, NOW)).toBe(false);
    expect(resumeNeedsDeadline({ dueAt: PAST, heldAt: null }, NOW)).toBe(false);
  });

  it("refuses a missing or past new deadline, as task_resume does", () => {
    const held = { dueAt: PAST, heldAt: PAST };
    expect(resumeDeadlineProblem(held, null, NOW)).toBe("The deadline has passed: set a new one.");
    expect(resumeDeadlineProblem(held, PAST, NOW)).toBe("Choose a new deadline in the future.");
    expect(resumeDeadlineProblem(held, "not a date", NOW)).toBe("Choose a new deadline.");
    expect(resumeDeadlineProblem(held, FUTURE, NOW)).toBeNull();
    expect(resumeDeadlineProblem({ dueAt: FUTURE, heldAt: PAST }, null, NOW)).toBeNull();
  });
});

describe("the lists' On hold line (W8)", () => {
  it("splits the held tasks out, keeping the order", () => {
    const rows = [
      { id: "a", heldAt: null },
      { id: "b", heldAt: PAST },
      { id: "c" },
      { id: "d", heldAt: FUTURE },
    ];
    const { active, onHold } = splitOnHold(rows);
    expect(active.map((row) => row.id)).toEqual(["a", "c"]);
    expect(onHold.map((row) => row.id)).toEqual(["b", "d"]);
    expect(isOnHold(rows[1]!)).toBe(true);
  });

  it('reads "On hold · n", nothing at zero', () => {
    expect(onHoldLine(0)).toBeNull();
    expect(onHoldLine(1)).toBe("On hold · 1");
    expect(onHoldLine(3)).toBe("On hold · 3");
  });
});

describe("History says the hold and the resume", () => {
  const entry = (overrides: Partial<TaskActivityEntry>): TaskActivityEntry => ({
    id: 1,
    actorId: "owner",
    onBehalfOfId: null,
    entity: "tasks",
    action: "held",
    old: {},
    new: {},
    meta: {},
    at: "2026-10-24T04:30:00Z",
    ...overrides,
  });
  const context = { names: { owner: "Prishit" }, types: {}, clients: {}, tickedStages: {} };

  it("puts it on hold with the reason", () => {
    expect(
      describeTaskActivity(entry({ meta: { reason: "Client hasn't sent the footage" } }), context),
    ).toMatchObject({ text: "put the task on hold", note: "Client hasn't sent the footage" });
  });

  it("resumes it, with the old and new deadline when one was set", () => {
    expect(describeTaskActivity(entry({ action: "resumed" }), context)?.text).toBe(
      "resumed the task",
    );
    expect(
      describeTaskActivity(
        entry({
          action: "resumed",
          old: { due_at: "2026-10-26T12:30:00+00:00" },
          new: { due_at: "2026-10-30T12:30:00+00:00" },
        }),
        context,
      )?.text,
    ).toMatch(/^resumed the task and moved the deadline from .*26 Oct.* to .*30 Oct/);
  });
});

describe("the screens (W8)", () => {
  const row: TaskListRow = {
    id: "t",
    title: "Reel edit",
    state: "in_progress",
    adminStep: "required",
    priority: "medium",
    dueAt: PAST,
    clientId: null,
    taskTypeId: "normal",
    primaryOwnerId: "asha",
    approvingAdminId: null,
    createdBy: "admin",
    submittedAt: null,
    createdAt: PAST,
    assignees: [
      {
        memberId: "asha",
        isPrimary: true,
        assignedAt: PAST,
        acknowledgedAt: null,
        removedAt: null,
      },
    ],
  };
  const heldRow = { ...row, id: "h", heldAt: PAST, holdReason: "Footage" };
  const asha = { id: "asha", role: "staff" as const, coordinates: [] };

  it("offers Put on hold or Resume only to the creator and the Owner", () => {
    const admin = { id: "admin", role: "admin" as const, canCreateTasks: true };
    expect(holdActions(admin, row)).toEqual({ hold: true, resume: false });
    expect(holdActions(admin, heldRow)).toEqual({ hold: false, resume: true });
    expect(holdActions({ ...admin, id: "admin2" }, heldRow)).toEqual({
      hold: false,
      resume: false,
    });
    expect(holdActions({ id: "asha", role: "staff", canCreateTasks: false }, heldRow)).toEqual({
      hold: false,
      resume: false,
    });
    expect(holdActions({ id: "o", role: "owner", canCreateTasks: true }, row).hold).toBe(true);
  });

  it("says since when, who and why", () => {
    expect(holdLine({ since: "24 Oct", by: "Prishit", reason: " Client hasn't sent it " })).toEqual(
      { title: "On hold since 24 Oct", reason: 'Prishit: "Client hasn\'t sent it"' },
    );
    expect(holdLine({ since: "24 Oct", by: null, reason: null }).reason).toBeNull();
  });

  it("takes Start, Done, ticks and Remind away from a held task; Task Noted stays", () => {
    const people = {
      asha: { name: "Asha", engagement: "permanent" as const, coordinatorId: null },
    };
    const todo = { ...row, state: "todo" as const };
    const assignees = row.assignees.map((a) => ({ ...a, acknowledgedBy: null }));
    const free = taskActions(todo, assignees, people, asha);
    expect(free.start).not.toBeNull();
    expect(free.done).not.toBeNull();
    expect(free.tick).not.toBeNull();
    const held = taskActions({ ...todo, heldAt: PAST }, assignees, people, asha);
    expect(held.start).toBeNull();
    expect(held.done).toBeNull();
    expect(held.tick).toBeNull();
    expect(held.note).toEqual([{ onBehalfOf: null }]);
    const owner = taskActions({ ...todo, heldAt: PAST }, assignees, people, {
      id: "o",
      role: "owner",
      coordinates: [],
    });
    expect(owner.remind).toBe(false);
    expect(owner.manage.edit).toBe(true);
    expect(owner.manage.cancel).toBe(true);
  });

  it("drops the distance and the overdue from a held task's deadline", () => {
    expect(relativeDeadline(row, NOW).overdue).toBe(true);
    const held = relativeDeadline(heldRow, NOW);
    expect(held.overdue).toBe(false);
    expect(held.relative).toBeNull();
  });

  it("leaves held tasks out of My tasks, Open tasks and the work state filters", () => {
    const groups = myTaskGroups([row, heldRow], asha, NOW, "2026-10-27");
    expect(
      Object.values(groups)
        .flat()
        .map((item) => item.row.id),
    ).toEqual(["t"]);
    expect(openByDeadline([row, heldRow], new Set()).map((one) => one.id)).toEqual(["t"]);
    expect(heldOpen([row, heldRow]).map((one) => one.id)).toEqual(["h"]);
    expect(heldOpen([heldRow], { id: "ravi", role: "staff", coordinates: [] })).toEqual([]);
    const filterable = (held: boolean) => ({
      state: "in_progress" as const,
      held,
    });
    expect(matchesState(filterable(true), "on_hold")).toBe(true);
    expect(matchesState(filterable(true), "open")).toBe(false);
    expect(matchesState(filterable(true), "in_progress")).toBe(false);
    expect(matchesState(filterable(true), "all")).toBe(true);
    expect(matchesState(filterable(false), "on_hold")).toBe(false);
    expect(matchesState(filterable(false), "open")).toBe(true);
  });
});
