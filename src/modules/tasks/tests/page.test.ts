import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import {
  chatLabel,
  handInFirst,
  moreSteps,
  neededLine,
  newestCommentAt,
  nextStep,
  parseTaskView,
  relativeDeadline,
  shownView,
  unreadCount,
  unreadLabel,
  viewQuery,
} from "../domain/page";
import { taskActions, type TaskActions, type TaskViewer } from "../domain/task";
import type { PeopleIndex, Task, TaskAssignee, TaskState } from "../domain/types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t",
    title: "Reel edit",
    description: null,
    taskTypeId: "normal",
    clientId: null,
    priority: "medium",
    dueAt: istInstant("2026-10-01", "18:00"),
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
    createdAt: "2026-09-28T04:30:00.000Z",
    reminderRules: [],
    templateId: null,
    ...overrides,
  };
}

function assignee(memberId: string, overrides: Partial<TaskAssignee> = {}): TaskAssignee {
  return {
    memberId,
    isPrimary: false,
    assignedAt: "2026-09-28T04:30:00.000Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    removedAt: null,
    ...overrides,
  };
}

const NOTED = "2026-09-28T05:00:00.000Z";
const people: PeopleIndex = {
  asha: { name: "Asha Rao", engagement: "permanent", coordinatorId: null },
  kiran: { name: "Kiran Das", engagement: "permanent", coordinatorId: null },
  bala: { name: "Bala Freelance", engagement: "freelance", coordinatorId: "ravi" },
  ravi: { name: "Ravi Kumar", engagement: "permanent", coordinatorId: null },
};
const staff = (id: string, coordinates: string[] = []): TaskViewer => ({
  id,
  role: "staff",
  coordinates,
});
const nameOf = (id: string) =>
  id === "asha"
    ? "you"
    : ({ kiran: "Kiran Das", bala: "Bala Freelance", ravi: "Ravi Kumar", admin: "Local Admin" }[
        id
      ] ?? "Someone");

describe("relativeDeadline (Kickoff 4 decision 26)", () => {
  // Thursday 1 Oct 2026, 3:00 PM IST.
  const now = new Date(istInstant("2026-10-01", "15:00"));

  it("names the day relative to today in IST, and the distance", () => {
    expect(relativeDeadline(task(), now)).toEqual({
      label: "Due today 6:00 PM",
      relative: "in 3 h",
      overdue: false,
    });
    expect(relativeDeadline(task({ dueAt: istInstant("2026-10-02", "10:00") }), now)).toEqual({
      label: "Due tomorrow 10:00 AM",
      relative: "in 19 h",
      overdue: false,
    });
    expect(relativeDeadline(task({ dueAt: istInstant("2026-10-05", "18:00") }), now).label).toBe(
      "Due Mon 6:00 PM",
    );
    expect(relativeDeadline(task({ dueAt: istInstant("2026-10-05", "18:00") }), now).relative).toBe(
      "in 4 days",
    );
    expect(relativeDeadline(task({ dueAt: istInstant("2026-10-12", "18:00") }), now).label).toBe(
      "Due Mon 12 Oct, 6:00 PM",
    );
    expect(relativeDeadline(task({ dueAt: istInstant("2027-01-05", "18:00") }), now).label).toBe(
      "Due Tue 5 Jan 2027, 6:00 PM",
    );
  });

  it("rounds as people say it: 2 h 50 min is 3 h", () => {
    expect(relativeDeadline(task({ dueAt: istInstant("2026-10-01", "17:50") }), now).relative).toBe(
      "in 3 h",
    );
    expect(relativeDeadline(task({ dueAt: istInstant("2026-10-01", "15:59") }), now).relative).toBe(
      "in 59 min",
    );
  });

  it("uses minutes under an hour, and the IST day across UTC midnight", () => {
    expect(relativeDeadline(task({ dueAt: istInstant("2026-10-01", "15:25") }), now).relative).toBe(
      "in 25 min",
    );
    // 00:30 IST on 2 Oct is still 1 Oct in UTC: it is tomorrow in IST.
    const late = new Date(istInstant("2026-10-01", "23:00"));
    expect(relativeDeadline(task({ dueAt: istInstant("2026-10-02", "00:30") }), late).label).toBe(
      "Due tomorrow 12:30 AM",
    );
  });

  it("is overdue once the deadline has passed, and says by how much", () => {
    expect(relativeDeadline(task({ dueAt: istInstant("2026-10-01", "11:00") }), now)).toEqual({
      label: "Due today 11:00 AM",
      relative: "overdue by 4 h",
      overdue: true,
    });
    expect(relativeDeadline(task({ dueAt: istInstant("2026-09-30", "18:00") }), now)).toEqual({
      label: "Due yesterday 6:00 PM",
      relative: "overdue by 21 h",
      overdue: true,
    });
    expect(relativeDeadline(task({ dueAt: istInstant("2026-09-25", "18:00") }), now).relative).toBe(
      "overdue by 6 days",
    );
  });

  it("drops the distance on a completed or cancelled task, which is never overdue", () => {
    for (const state of ["completed", "cancelled"] as const) {
      expect(
        relativeDeadline(task({ state, dueAt: istInstant("2026-09-25", "18:00") }), now),
      ).toEqual({ label: "Due Fri 25 Sep, 6:00 PM", relative: null, overdue: false });
    }
  });
});

describe("nextStep and moreSteps: one step at a time (decision 26)", () => {
  const actionsFor = (
    state: TaskState,
    assignees: TaskAssignee[],
    viewer: TaskViewer,
    overrides: Partial<Task> = {},
  ): TaskActions => taskActions(task({ state, ...overrides }), assignees, people, viewer);

  it("goes Task Noted → Start work → Mark done for the primary owner", () => {
    const notNoted = actionsFor("todo", [assignee("asha", { isPrimary: true })], staff("asha"));
    expect(nextStep(notNoted)).toEqual({ kind: "note", acting: { onBehalfOf: null } });
    expect(moreSteps(notNoted, nextStep(notNoted))).toEqual(["done"]);

    const noted = actionsFor(
      "todo",
      [assignee("asha", { isPrimary: true, acknowledgedAt: NOTED })],
      staff("asha"),
    );
    expect(nextStep(noted)).toEqual({ kind: "start", acting: { onBehalfOf: null } });
    // Done may come straight from To do: it waits under ⋯.
    expect(moreSteps(noted, nextStep(noted))).toEqual(["done"]);

    const started = actionsFor(
      "in_progress",
      [assignee("asha", { isPrimary: true, acknowledgedAt: NOTED })],
      staff("asha"),
    );
    expect(nextStep(started)).toEqual({
      kind: "done",
      acting: { onBehalfOf: null },
      again: false,
    });
    expect(moreSteps(started, nextStep(started))).toEqual([]);

    const back = actionsFor(
      "changes_requested",
      [assignee("asha", { isPrimary: true, acknowledgedAt: NOTED })],
      staff("asha"),
    );
    expect(nextStep(back)).toEqual({ kind: "done", acting: { onBehalfOf: null }, again: true });
  });

  it("gives another assignee Noted, then Start, and nothing once started", () => {
    const assignees = [
      assignee("asha", { isPrimary: true, acknowledgedAt: NOTED }),
      assignee("kiran"),
    ];
    const first = actionsFor("todo", assignees, staff("kiran"));
    expect(nextStep(first)).toEqual({ kind: "note", acting: { onBehalfOf: null } });
    expect(moreSteps(first, nextStep(first))).toEqual([]);
    const later = actionsFor(
      "in_progress",
      [assignees[0] as TaskAssignee, assignee("kiran", { acknowledgedAt: NOTED })],
      staff("kiran"),
    );
    expect(nextStep(later)).toBeNull();
  });

  it("lets a coordinator note for each freelancer in turn, then act for them", () => {
    const assignees = [assignee("bala", { isPrimary: true })];
    const coordinator = actionsFor("todo", assignees, staff("ravi", ["bala"]), {
      primaryOwnerId: "bala",
    });
    expect(nextStep(coordinator)).toEqual({ kind: "note", acting: { onBehalfOf: "bala" } });
    const noted = actionsFor(
      "todo",
      [assignee("bala", { isPrimary: true, acknowledgedAt: NOTED })],
      staff("ravi", ["bala"]),
      { primaryOwnerId: "bala" },
    );
    expect(nextStep(noted)).toEqual({ kind: "start", acting: { onBehalfOf: "bala" } });
  });

  it("gives the step's reviewer the review, and the Owner's way past a waiting Admin under ⋯", () => {
    const handedIn = [assignee("asha", { isPrimary: true, acknowledgedAt: NOTED })];
    const admin = actionsFor("submitted", handedIn, {
      id: "admin",
      role: "admin",
      coordinates: [],
    });
    expect(nextStep(admin)).toEqual({ kind: "review", step: "admin" });
    const owner = actionsFor("admin_approved", handedIn, {
      id: "owner",
      role: "owner",
      coordinates: [],
    });
    expect(nextStep(owner)).toEqual({ kind: "review", step: "owner" });

    const waiting = actionsFor("submitted", handedIn, {
      id: "owner",
      role: "owner",
      coordinates: [],
    });
    expect(nextStep(waiting)).toBeNull();
    expect(moreSteps(waiting, nextStep(waiting))).toEqual(["takeOver"]);
  });
});

describe("neededLine: what is needed from the viewer (decision 26)", () => {
  const assignees = [assignee("asha", { isPrimary: true, acknowledgedAt: NOTED })];
  const line = (next: ReturnType<typeof nextStep>, overrides: Partial<Task> = {}) =>
    neededLine({ task: task(overrides), assignees, next, nameOf });

  it("says the next step in a sentence", () => {
    expect(line({ kind: "note", acting: { onBehalfOf: null } })).toBe(
      "Tap Task Noted to say you've seen it.",
    );
    expect(line({ kind: "note", acting: { onBehalfOf: "bala" } })).toBe(
      "Note it for Bala Freelance when Bala Freelance has seen it.",
    );
    expect(line({ kind: "start", acting: { onBehalfOf: null } })).toBe(
      "Start work when you begin.",
    );
    expect(line({ kind: "done", acting: { onBehalfOf: null }, again: false })).toBe(
      "Mark it done when the work is finished.",
    );
    expect(line({ kind: "done", acting: { onBehalfOf: null }, again: true })).toBe(
      "Changes were asked for. Fix them, then mark it done again.",
    );
    expect(line({ kind: "done", acting: { onBehalfOf: "bala" }, again: false })).toBe(
      "Mark it done for Bala Freelance when the work is finished.",
    );
    expect(line({ kind: "review", step: "admin" })).toBe(
      "Check the hand-in, then approve it or ask for changes.",
    );
    expect(line({ kind: "review", step: "owner" })).toBe(
      "Approve it to complete the task, or ask for changes.",
    );
  });

  it("says where the task stands when nothing waits for the viewer", () => {
    expect(line(null, { state: "submitted" })).toBe(
      "Nothing needed from you now. Done. Waiting for Local Admin to check it.",
    );
    expect(line(null, { state: "in_progress", primaryOwnerId: "kiran" })).toBe(
      "Nothing needed from you now. In progress. Kiran Das marks it done.",
    );
    expect(line(null, { state: "cancelled" })).toBe("Cancelled.");
  });
});

describe("the views (decisions 27, 32)", () => {
  it("lands on Work unless the address asks for another view", () => {
    expect(parseTaskView(null)).toBe("work");
    expect(parseTaskView("")).toBe("work");
    expect(parseTaskView("chat")).toBe("chat");
    expect(parseTaskView("activity")).toBe("activity");
    expect(parseTaskView("details")).toBe("details");
    expect(parseTaskView("history")).toBe("work");
  });

  it("falls back to Work where a view does not exist: Chat on a phone, Details on a desktop", () => {
    expect(shownView("chat", false)).toBe("work");
    expect(shownView("chat", true)).toBe("chat");
    expect(shownView("details", true)).toBe("work");
    expect(shownView("details", false)).toBe("details");
    expect(shownView("activity", false)).toBe("activity");
  });

  it("keeps the view in the query, leaving Work (the landing view) out", () => {
    expect(viewQuery("", "activity")).toBe("?tab=activity");
    expect(viewQuery("?tab=activity", "work")).toBe("");
    expect(viewQuery("?tab=chat&x=1", "details")).toBe("?tab=details&x=1");
  });

  it("puts the hand-in first once the task is handed in and locked", () => {
    expect(handInFirst("submitted")).toBe(true);
    expect(handInFirst("admin_approved")).toBe(true);
    expect(handInFirst("completed")).toBe(true);
    for (const state of ["todo", "in_progress", "changes_requested", "cancelled"] as const) {
      expect(handInFirst(state)).toBe(false);
    }
  });
});

describe("unread comments (decision 28)", () => {
  const comments = [
    { authorId: "kiran", createdAt: "2026-10-01T04:00:00.000Z" },
    { authorId: "asha", createdAt: "2026-10-01T05:00:00.000Z" },
    { authorId: "ravi", createdAt: "2026-10-01T06:00:00.000Z" },
  ];

  it("counts the comments by someone else after the viewer's last read", () => {
    expect(unreadCount(comments, null, "asha")).toBe(2);
    expect(unreadCount(comments, "2026-10-01T04:30:00.000Z", "asha")).toBe(1);
    expect(unreadCount(comments, "2026-10-01T06:00:00.000Z", "asha")).toBe(0);
    expect(unreadCount([], null, "asha")).toBe(0);
  });

  it("never counts the viewer's own comments, and each member's reads are their own", () => {
    expect(unreadCount(comments, null, "ravi")).toBe(2);
    expect(unreadCount(comments, "2026-10-01T04:30:00.000Z", "kiran")).toBe(2);
  });

  it("marks up to the newest comment, and labels the count", () => {
    expect(newestCommentAt(comments)).toBe("2026-10-01T06:00:00.000Z");
    expect(newestCommentAt([])).toBeNull();
    expect(chatLabel(0)).toBe("Chat");
    expect(chatLabel(2)).toBe("Chat · 2 new");
    expect(unreadLabel(1)).toBe("1 new comment");
    expect(unreadLabel(3)).toBe("3 new comments");
  });
});
