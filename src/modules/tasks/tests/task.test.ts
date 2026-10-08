import { describe, expect, it } from "vitest";

import {
  isOverdue,
  joinNames,
  latestChangeRequest,
  pairName,
  reviewerName,
  routeLine,
  stateLabel,
  statusLine,
  taskActions,
  type TaskViewer,
} from "../domain/task";
import type { PeopleIndex, Task, TaskAssignee, TaskState } from "../domain/types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t",
    title: "Reel edit",
    description: null,
    taskTypeId: "normal",
    clientId: null,
    priority: "medium",
    dueAt: "2026-10-03T12:30:00.000Z",
    eventDate: null,
    eventStartAt: null,
    eventEndAt: null,
    location: null,
    purpose: null,
    state: "todo",
    approvingAdminId: "admin",
    adminStep: "required",
    createdBy: "admin",
    primaryOwnerId: "asha",
    lateReason: null,
    cancelledReason: null,
    customFields: {},
    submittedAt: null,
    submittedBy: null,
    submittedOnBehalfOf: null,
    adminApprovedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2026-10-01T04:30:00.000Z",
    reminderRules: [],
    templateId: null,
    ...overrides,
  };
}

function assignee(memberId: string, overrides: Partial<TaskAssignee> = {}): TaskAssignee {
  return {
    memberId,
    isPrimary: false,
    assignedAt: "2026-10-01T04:30:00.000Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    removedAt: null,
    ...overrides,
  };
}

const PEOPLE: PeopleIndex = {
  asha: { name: "Asha", engagement: "freelance", coordinatorId: "ravi" },
  ravi: { name: "Ravi", engagement: "permanent", coordinatorId: null },
  meera: { name: "Meera", engagement: "permanent", coordinatorId: null },
  admin: { name: "Local Admin", engagement: "permanent", coordinatorId: null },
};

const OWNER: TaskViewer = { id: "owner", role: "owner", coordinates: [] };
const ADMIN: TaskViewer = { id: "admin", role: "admin", coordinates: [] };
const RAVI: TaskViewer = { id: "ravi", role: "staff", coordinates: ["asha"] };
const MEERA: TaskViewer = { id: "meera", role: "staff", coordinates: [] };

const TEAM = [assignee("asha", { isPrimary: true }), assignee("meera")];

describe("what a viewer may do (4.4; PERMISSIONS §3, ADR-0013)", () => {
  it("offers each assignee Task Noted, and a coordinator Noted for their freelancer", () => {
    expect(taskActions(task(), TEAM, PEOPLE, MEERA).note).toEqual([{ onBehalfOf: null }]);
    expect(taskActions(task(), TEAM, PEOPLE, RAVI).note).toEqual([{ onBehalfOf: "asha" }]);
    // A former coordinator (no longer coordinating) gets nothing.
    expect(taskActions(task(), TEAM, PEOPLE, { ...RAVI, coordinates: [] }).note).toEqual([]);
    const noted = [
      assignee("asha", { isPrimary: true, acknowledgedAt: "x", acknowledgedBy: "ravi" }),
    ];
    expect(taskActions(task(), noted, PEOPLE, RAVI).note).toEqual([]);
  });

  it("lets only the primary owner (or their coordinator) mark it done, until it is submitted", () => {
    expect(taskActions(task(), TEAM, PEOPLE, MEERA).done).toBeNull();
    expect(taskActions(task(), TEAM, PEOPLE, RAVI).done).toEqual({
      onBehalfOf: "asha",
      again: false,
    });
    expect(taskActions(task({ state: "changes_requested" }), TEAM, PEOPLE, RAVI).done).toEqual({
      onBehalfOf: "asha",
      again: true,
    });
    for (const state of ["submitted", "admin_approved", "completed", "cancelled"] as TaskState[]) {
      const actions = taskActions(task({ state }), TEAM, PEOPLE, RAVI);
      expect(actions.done, state).toBeNull();
      expect(actions.tick, state).toBeNull();
    }
  });

  it("gives the Admin step to the approving Admin, never to one on the task, and the last to the Owner", () => {
    const submitted = task({ state: "submitted" });
    expect(taskActions(submitted, TEAM, PEOPLE, ADMIN).review).toBe("admin");
    expect(taskActions(submitted, [...TEAM, assignee("admin")], PEOPLE, ADMIN).review).toBeNull();
    // Kickoff 4 decision 34: coordinating Asha, a freelancer on the task, counts as being on it.
    expect(
      taskActions(submitted, TEAM, PEOPLE, { ...ADMIN, coordinates: ["asha"] }).review,
    ).toBeNull();
    expect(taskActions(submitted, TEAM, PEOPLE, OWNER).review).toBeNull();
    expect(taskActions(submitted, TEAM, PEOPLE, OWNER).takeOver).toBe(true);
    expect(taskActions(task({ state: "admin_approved" }), TEAM, PEOPLE, OWNER).review).toBe(
      "owner",
    );
    expect(taskActions(task({ state: "admin_approved" }), TEAM, PEOPLE, ADMIN).review).toBeNull();
  });

  it("lets the creator, the approving Admin and the Owner manage it, and no other Admin", () => {
    const other: TaskViewer = { id: "other-admin", role: "admin", coordinates: [] };
    expect(taskActions(task(), TEAM, PEOPLE, ADMIN).manage).toEqual({
      edit: true,
      cancel: true,
      reopen: false,
      stages: true,
    });
    expect(taskActions(task(), TEAM, PEOPLE, other).manage.edit).toBe(false);
    expect(taskActions(task({ state: "completed" }), TEAM, PEOPLE, OWNER).manage).toEqual({
      edit: false,
      cancel: false,
      reopen: true,
      stages: false,
    });
    expect(taskActions(task(), TEAM, PEOPLE, MEERA).manage.edit).toBe(false);
    expect(taskActions(task(), TEAM, PEOPLE, OWNER).changeApprover).toBe(true);
    expect(taskActions(task(), TEAM, PEOPLE, ADMIN).changeApprover).toBe(false);
  });

  it("lets a coordinator start, tick and comment for their freelancer", () => {
    const actions = taskActions(task(), TEAM, PEOPLE, RAVI);
    expect(actions.start).toEqual({ onBehalfOf: "asha" });
    expect(actions.tick).toEqual({ onBehalfOf: "asha" });
    expect(actions.commentFor).toEqual(["asha"]);
    expect(taskActions(task({ state: "in_progress" }), TEAM, PEOPLE, RAVI).start).toBeNull();
  });
});

describe("the task at a glance", () => {
  const nameOf = (id: string) => (id === "meera" ? "you" : (PEOPLE[id]?.name ?? "someone"));

  it("says who holds it", () => {
    expect(statusLine(task(), TEAM, nameOf)).toBe("Waiting for Asha and you to note it.");
    const noted = TEAM.map((a) => ({ ...a, acknowledgedAt: "x", acknowledgedBy: a.memberId }));
    expect(statusLine(task(), noted, nameOf)).toBe("Everyone has noted it. Asha marks it done.");
    expect(statusLine(task({ state: "submitted" }), TEAM, nameOf)).toBe(
      "Done. Waiting for Local Admin to check it.",
    );
    expect(statusLine(task({ state: "admin_approved", adminStep: "skipped" }), TEAM, nameOf)).toBe(
      "Done. Waiting for the Owner's approval.",
    );
    expect(statusLine(task({ state: "changes_requested" }), TEAM, nameOf)).toBe(
      "Changes requested. Back with Asha.",
    );
  });

  it("names the approval route, and a skipped Admin step", () => {
    const nameOfAdmin = (id: string) => PEOPLE[id]?.name ?? "someone";
    expect(routeLine(task(), TEAM, nameOfAdmin)).toBe(
      "Local Admin checks it, then the Owner approves it",
    );
    expect(routeLine(task({ approvingAdminId: null, adminStep: "none" }), TEAM, nameOfAdmin)).toBe(
      "The Owner approves it",
    );
    expect(routeLine(task(), [...TEAM, assignee("admin")], nameOfAdmin)).toMatch(/no Admin check/);
  });

  it("reads the state by its Admin step, and overdue from the clock", () => {
    expect(stateLabel(task({ state: "admin_approved", adminStep: "required" }))).toBe("Checked");
    expect(stateLabel(task({ state: "admin_approved", adminStep: "none" }))).toBe(
      "Waiting for approval",
    );
    const after = new Date("2026-10-03T12:31:00.000Z");
    expect(isOverdue(task(), after)).toBe(true);
    expect(isOverdue(task({ state: "completed" }), after)).toBe(false);
    expect(isOverdue(task(), new Date("2026-10-03T12:29:00.000Z"))).toBe(false);
  });

  it("joins names briefly and finds the latest change request", () => {
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B", "C", "D"])).toBe("A, B and 2 more");
    const reviews = [
      {
        id: "1",
        step: "admin" as const,
        decision: "rejected" as const,
        reason: "old",
        reviewerId: "admin",
        at: "2026-10-01T00:00:00Z",
      },
      {
        id: "2",
        step: "owner" as const,
        decision: "rejected" as const,
        reason: "new",
        reviewerId: "owner",
        at: "2026-10-02T00:00:00Z",
      },
      {
        id: "3",
        step: "owner" as const,
        decision: "approved" as const,
        reason: null,
        reviewerId: "owner",
        at: "2026-10-03T00:00:00Z",
      },
    ];
    expect(latestChangeRequest(reviews)?.reason).toBe("new");
  });
});

describe("naming who acted (ADR-0013: the pair wherever a person is named)", () => {
  const names = { ravi: "Ravi", asha: "Asha" };

  it("names the coordinator and the freelancer", () => {
    expect(pairName(names, "ravi", "asha")).toBe("Ravi for Asha");
    expect(pairName(names, "ravi", null)).toBe("Ravi");
  });

  it("names both from the directory; a missing name reads Someone (a race), never a role", () => {
    expect(pairName(names, "hidden", "asha")).toBe("Someone for Asha");
    expect(pairName(names, "hidden", null)).toBe("Someone");
    expect(pairName(names, null, null)).toBe("MaxOff");
  });

  it("names the reviewer who asked for changes (Kickoff 4 decision 21)", () => {
    expect(reviewerName({ reviewerId: "ravi" }, names)).toBe("Ravi");
    expect(reviewerName({ reviewerId: "owner" }, { owner: "Prishit" })).toBe("Prishit");
    expect(reviewerName({ reviewerId: "gone" }, names)).toBe("Someone");
  });
});
