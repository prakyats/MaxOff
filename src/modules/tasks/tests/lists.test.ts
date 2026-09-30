import { describe, expect, it } from "vitest";

import {
  matchesClient,
  matchesEngagement,
  matchesOverdue,
  matchesPerson,
  matchesState,
  matchesType,
} from "../domain/list-filters";
import {
  badgeCount,
  forLabel,
  managesTask,
  MY_LIST_GROUPS,
  rowMeta,
  myGroupOf,
  myTaskGroups,
  needsYou,
  openByDeadline,
  ownPart,
  type ListViewer,
  type TaskListRow,
  waitedLabel,
} from "../domain/lists";

const NOW = new Date("2026-10-01T06:30:00.000Z"); // 1 Oct, 12:00 IST
const TODAY = "2026-10-01";

function assignee(memberId: string, over: Partial<TaskListRow["assignees"][number]> = {}) {
  return {
    memberId,
    isPrimary: false,
    assignedAt: "2026-10-01T00:00:00.000Z",
    acknowledgedAt: "2026-10-01T01:00:00.000Z",
    removedAt: null,
    ...over,
  };
}

function row(id: string, over: Partial<TaskListRow> = {}): TaskListRow {
  return {
    id,
    title: id,
    state: "todo",
    adminStep: "required",
    priority: "medium",
    dueAt: "2026-10-02T12:30:00.000Z", // 2 Oct, 6:00 pm IST
    clientId: null,
    taskTypeId: "normal",
    primaryOwnerId: "meera",
    approvingAdminId: "admin",
    createdBy: "owner",
    submittedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    assignees: [assignee("meera", { isPrimary: true })],
    ...over,
  };
}

const MEERA: ListViewer = { id: "meera", role: "staff", coordinates: [] };
const RAVI: ListViewer = { id: "ravi", role: "staff", coordinates: ["asha"] };

describe("Staff: My tasks (Kickoff 4 decision 17)", () => {
  it("lists its groups in the owner's order (Kickoff 4 decision 25: Overdue before Due today)", () => {
    expect(MY_LIST_GROUPS).toEqual([
      "not_noted",
      "changes_requested",
      "overdue",
      "due_today",
      "upcoming",
    ]);
  });

  it("puts each open task in one group, the first that applies", () => {
    const part = ownPart(row("a"), MEERA);
    const group = (over: Partial<TaskListRow>) =>
      myGroupOf(row("x", over), ownPart(row("x", over), MEERA), NOW, TODAY);
    expect(
      group({
        assignees: [assignee("meera", { acknowledgedAt: null })],
        state: "changes_requested",
      }),
    ).toBe("not_noted");
    expect(group({ state: "changes_requested" })).toBe("changes_requested");
    expect(group({ state: "submitted", dueAt: "2026-09-30T00:00:00.000Z" })).toBe("with_reviewers");
    expect(group({ state: "admin_approved" })).toBe("with_reviewers");
    expect(group({ dueAt: "2026-10-01T05:00:00.000Z" })).toBe("overdue");
    expect(group({ dueAt: "2026-10-01T12:30:00.000Z" })).toBe("due_today");
    expect(group({ state: "in_progress" })).toBe("upcoming");
    expect(group({ state: "completed" })).toBeNull();
    expect(group({ state: "cancelled" })).toBeNull();
    expect(part.self).toBe(true);
  });

  it("leaves out a task the viewer is no longer on", () => {
    const off = row("off", {
      assignees: [assignee("meera", { removedAt: "2026-10-01T02:00:00Z" })],
    });
    expect(myGroupOf(off, ownPart(off, MEERA), NOW, TODAY)).toBeNull();
  });

  it("mixes in a coordinator's freelancers' tasks, for Asha", () => {
    const asha = row("asha-task", {
      primaryOwnerId: "asha",
      assignees: [assignee("asha", { isPrimary: true, acknowledgedAt: null })],
    });
    const part = ownPart(asha, RAVI);
    expect(part).toEqual({ self: false, forIds: ["asha"], notNoted: ["asha"] });
    expect(myGroupOf(asha, part, NOW, TODAY)).toBe("not_noted");
    const groups = myTaskGroups([asha, row("mine")], RAVI, NOW, TODAY);
    expect(groups.not_noted.map((item) => item.row.id)).toEqual(["asha-task"]);
    expect(groups.upcoming).toEqual([]);
  });

  it("names the viewer and the freelancer when both still owe a note", () => {
    const both = row("both", {
      assignees: [
        assignee("ravi", { acknowledgedAt: null }),
        assignee("asha", { acknowledgedAt: null }),
      ],
    });
    expect(ownPart(both, RAVI)).toEqual({
      self: true,
      forIds: ["asha"],
      notNoted: ["ravi", "asha"],
    });
  });

  it("orders each group by deadline", () => {
    const late = row("late", { dueAt: "2026-10-05T12:30:00.000Z" });
    const soon = row("soon", { dueAt: "2026-10-03T12:30:00.000Z" });
    expect(myTaskGroups([late, soon], MEERA, NOW, TODAY).upcoming.map((i) => i.row.id)).toEqual([
      "soon",
      "late",
    ]);
  });
});

describe("the Tasks badge (Kickoff 4 decision 16)", () => {
  it("counts each open task not noted or with changes requested once, freelancers included", () => {
    const rows = [
      row("unnoted", { assignees: [assignee("meera", { acknowledgedAt: null })] }),
      row("changes", { state: "changes_requested" }),
      row("both", {
        state: "changes_requested",
        assignees: [assignee("meera", { acknowledgedAt: null })],
      }),
      row("noted"),
      row("done", { state: "completed", assignees: [assignee("meera", { acknowledgedAt: null })] }),
    ];
    expect(badgeCount(rows, MEERA)).toBe(3);
    const asha = row("asha", { assignees: [assignee("asha", { acknowledgedAt: null })] });
    expect(badgeCount([asha], RAVI)).toBe(1);
    expect(badgeCount([asha], MEERA)).toBe(0);
  });
});

describe("Owner and Admins: Needs you (Kickoff 4 decision 17)", () => {
  const OWNER: ListViewer = { id: "owner", role: "owner", coordinates: [] };
  const ADMIN: ListViewer = { id: "admin", role: "admin", coordinates: [] };
  const ESC = { ackEscalateHours: 4, ackEscalateOwnerHours: 8 };

  it("lists overdue work, but not a task handed in (it waits in Approvals)", () => {
    const overdue = row("overdue", { dueAt: "2026-09-30T12:30:00.000Z" });
    const handedIn = row("handed", { state: "submitted", dueAt: "2026-09-30T12:30:00.000Z" });
    expect(needsYou([overdue, handedIn], OWNER, NOW, ESC).map((i) => [i.row.id, i.reason])).toEqual(
      [["overdue", "overdue"]],
    );
  });

  it("lists who has not noted a task past the escalation time: the Admin's, then the Owner's", () => {
    const task = row("quiet", {
      assignees: [
        assignee("meera", { acknowledgedAt: null, assignedAt: "2026-10-01T01:00:00.000Z" }), // 5.5 h
        assignee("asha", { acknowledgedAt: null, assignedAt: "2026-09-30T20:00:00.000Z" }), // 10.5 h
      ],
    });
    const admin = needsYou([task], ADMIN, NOW, ESC);
    expect(admin).toHaveLength(1);
    expect(admin[0]?.reason).toBe("not_noted");
    expect(admin[0]?.waitingOn).toEqual([
      { memberId: "asha", hours: 10 },
      { memberId: "meera", hours: 5 },
    ]);
    expect(needsYou([task], OWNER, NOW, ESC)[0]?.waitingOn).toEqual([
      { memberId: "asha", hours: 10 },
    ]);
  });

  it("leaves an Admin out of the tasks they neither created nor approve", () => {
    const other = row("other", {
      createdBy: "owner",
      approvingAdminId: "admin2",
      dueAt: "2026-09-30T00:00:00Z",
    });
    expect(needsYou([other], ADMIN, NOW, ESC)).toEqual([]);
    expect(needsYou([other], OWNER, NOW, ESC)).toHaveLength(1);
  });

  it("sends an Admin's escalations to the approving Admin, or the creator when there is none (4C review L6)", () => {
    const quiet = {
      assignees: [
        assignee("meera", { acknowledgedAt: null, assignedAt: "2026-09-30T20:00:00.000Z" }),
      ],
    };
    // Created by this Admin, now approved by another: the approver hears, not the creator.
    const routed = row("routed", { ...quiet, createdBy: "admin", approvingAdminId: "admin2" });
    expect(managesTask(routed, ADMIN)).toBe(false);
    expect(needsYou([routed], ADMIN, NOW, ESC)).toEqual([]);
    expect(needsYou([routed], { ...ADMIN, id: "admin2" }, NOW, ESC)[0]?.reason).toBe("not_noted");
    // Nobody approves it: its creator hears.
    const direct = row("direct", { ...quiet, createdBy: "admin", approvingAdminId: null });
    expect(managesTask(direct, ADMIN)).toBe(true);
    expect(needsYou([direct], ADMIN, NOW, ESC)[0]?.reason).toBe("not_noted");
    // The Owner hears about every task.
    expect(managesTask(routed, OWNER)).toBe(true);
  });

  it("lists an Admin's own note and change request, by deadline", () => {
    const mine = row("mine", {
      dueAt: "2026-10-01T12:30:00.000Z",
      createdBy: "owner",
      approvingAdminId: "admin2",
      assignees: [assignee("admin", { acknowledgedAt: null })],
    });
    const changes = row("changes", {
      state: "changes_requested",
      approvingAdminId: "admin2",
      assignees: [assignee("admin")],
    });
    expect(needsYou([mine, changes], ADMIN, NOW, ESC).map((i) => i.reason)).toEqual([
      "your_note",
      "changes_requested",
    ]);
  });

  it("shows the open tasks by deadline without the ones already listed", () => {
    const listed = row("listed");
    const rest = row("rest", { dueAt: "2026-10-01T12:30:00.000Z" });
    const done = row("done", { state: "completed" });
    expect(openByDeadline([listed, rest, done], new Set(["listed"])).map((r) => r.id)).toEqual([
      "rest",
    ]);
  });

  it("says how long someone has waited", () => {
    expect(waitedLabel(9)).toBe("9 h");
    expect(waitedLabel(47)).toBe("47 h");
    expect(waitedLabel(50)).toBe("2 days");
  });
});

describe("the full list's filters (decisions 17, 18)", () => {
  const task = {
    state: "in_progress" as const,
    clientId: "sharma",
    taskTypeId: "shoot",
    activeIds: ["meera", "asha"],
    engagements: ["permanent" as const, "freelance" as const],
    overdue: true,
  };

  it("filters by state, with Open and With the reviewers as groups", () => {
    expect(matchesState(task, "open")).toBe(true);
    expect(matchesState(task, "in_progress")).toBe(true);
    expect(matchesState(task, "todo")).toBe(false);
    expect(matchesState({ state: "admin_approved" }, "review")).toBe(true);
    expect(matchesState({ state: "submitted" }, "review")).toBe(true);
    expect(matchesState({ state: "completed" }, "open")).toBe(false);
    expect(matchesState({ state: "completed" }, "all")).toBe(true);
  });

  it("filters by person (on the task now), client, type and overdue", () => {
    expect(matchesPerson(task, "asha")).toBe(true);
    expect(matchesPerson(task, "gone")).toBe(false);
    expect(matchesPerson(task, "all")).toBe(true);
    expect(matchesClient(task, "sharma")).toBe(true);
    expect(matchesClient(task, "none")).toBe(false);
    expect(matchesClient({ clientId: null }, "none")).toBe(true);
    expect(matchesType(task, "shoot")).toBe(true);
    expect(matchesType(task, "normal")).toBe(false);
    expect(matchesOverdue(task, "overdue")).toBe(true);
    expect(matchesOverdue({ overdue: false }, "overdue")).toBe(false);
    expect(matchesOverdue({ overdue: false }, "all")).toBe(true);
  });

  it("filters by engagement: a task with a freelancer, or with an employee, on it", () => {
    expect(matchesEngagement(task, "freelance")).toBe(true);
    expect(matchesEngagement(task, "permanent")).toBe(true);
    expect(matchesEngagement({ engagements: ["permanent"] }, "freelance")).toBe(false);
    expect(matchesEngagement({ engagements: [] }, "all")).toBe(true);
  });
});

describe("a row's lines", () => {
  const names: Record<string, string> = { meera: "Meera", asha: "Asha", kiran: "Kiran" };
  const context = {
    viewerId: "ravi",
    nameOf: (id: string) => names[id] ?? "Someone",
    engagementOf: (id: string) => (id === "asha" ? ("freelance" as const) : ("permanent" as const)),
    clientName: (id: string) => (id === "sharma" ? "Sharma Weddings" : null),
  };

  it("says the deadline, whose it is and the client label", () => {
    expect(rowMeta(row("a", { clientId: "sharma" }), context)).toBe(
      "Due Fri 2 Oct, 6:00 PM · Meera · Sharma Weddings",
    );
    expect(rowMeta(row("b", { primaryOwnerId: "asha" }), context)).toBe(
      "Due Fri 2 Oct, 6:00 PM · Asha (freelancer)",
    );
    expect(rowMeta(row("c", { primaryOwnerId: "ravi" }), context)).toBe("Due Fri 2 Oct, 6:00 PM");
  });

  it("names the freelancers a coordinator acts for", () => {
    expect(forLabel(["asha"], context.nameOf)).toBe("for Asha");
    expect(forLabel(["asha", "kiran"], context.nameOf)).toBe("for Asha and Kiran");
    expect(forLabel([], context.nameOf)).toBe("");
  });
});
