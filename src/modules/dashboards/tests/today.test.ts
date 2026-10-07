import { describe, expect, it } from "vitest";

import {
  ADMIN_NEEDS_YOU_EMPTY,
  adminScope,
  boardForGroup,
  clientCounts,
  clientCountsLine,
  eventsStrip,
  heldEmailsLine,
  leaveRisks,
  leaveWindow,
  notNotedRisks,
  overdueRisks,
  OWNER_TODAY_EMPTY,
  parsePeopleGroup,
  RISKS_EMPTY,
  riskWords,
  sortRisks,
  spanWords,
  todaysTasks,
  todaysTasksLine,
  type Risk,
  type RiskTask,
} from "../domain/today";

const TODAY = "2026-10-07";
const NOW = new Date("2026-10-07T06:30:00.000Z"); // 12:00 IST

function task(id: string, over: Partial<RiskTask> = {}): RiskTask {
  return {
    id,
    title: id,
    state: "assigned",
    dueAt: "2026-10-08T12:30:00.000Z",
    primaryOwnerId: "asha",
    createdBy: "owner",
    approvingAdminId: null,
    assigneeIds: ["asha"],
    ...over,
  };
}

const person = (
  memberId: string,
  over: { endNotRecorded?: boolean; overtimeFlag?: boolean } = {},
) => ({
  memberId,
  endNotRecorded: false,
  overtimeFlag: false,
  ...over,
});

describe("the Owner's Today: the people on the card, the board by group (6.2; decision 24)", () => {
  const board = [
    { bucket: "waiting" as const, people: [person("w")] },
    { bucket: "not_chosen" as const, people: [person("n")] },
    {
      bucket: "present" as const,
      people: [
        person("fine"),
        person("late", { overtimeFlag: true }),
        person("open", { endNotRecorded: true }),
      ],
    },
    { bucket: "on_leave" as const, people: [person("away")] },
    { bucket: "absent" as const, people: [person("a")] },
  ];

  it("narrows the board to a group, or to the people whose end of day was not recorded", () => {
    expect(boardForGroup(board, "all").map((g) => [g.bucket, g.people.length])).toEqual([
      ["waiting", 1],
      ["not_chosen", 1],
      ["present", 3],
      ["on_leave", 1],
      ["absent", 1],
    ]);
    expect(boardForGroup(board, "present").map((g) => g.bucket)).toEqual(["present"]);
    expect(boardForGroup(board, "end_not_recorded")).toEqual([
      { bucket: "present", people: [person("open", { endNotRecorded: true })] },
    ]);
    expect(boardForGroup(board, "waiting")[0]?.people.map((p) => p.memberId)).toEqual(["w"]);
    expect(OWNER_TODAY_EMPTY).toBe("Nothing else needs you today.");
  });

  it("reads the board's group from the address, else everyone", () => {
    expect(parsePeopleGroup("present")).toBe("present");
    expect(parsePeopleGroup(["absent", "x"])).toBe("absent");
    expect(parsePeopleGroup("nope")).toBe("all");
    expect(parsePeopleGroup(undefined)).toBe("all");
  });
});

describe("today's tasks (decision 6)", () => {
  it("counts the open tasks due today and those handed in", () => {
    const open = [
      { dueAt: "2026-10-07T12:30:00.000Z", state: "assigned" },
      { dueAt: "2026-10-07T12:30:00.000Z", state: "submitted" },
      { dueAt: "2026-10-07T13:00:00.000Z", state: "admin_approved" },
      { dueAt: "2026-10-08T12:30:00.000Z", state: "submitted" },
    ];
    expect(todaysTasks(open, TODAY)).toEqual({ due: 3, handedIn: 2 });
    expect(todaysTasksLine({ due: 3, handedIn: 2 })).toBe("3 due today · 2 handed in");
    expect(todaysTasksLine({ due: 0, handedIn: 0 })).toBe("Nothing due today");
  });
});

describe("Overdue and risks (decision 6) and Issues (decision 10)", () => {
  it("counts overdue work still with its people, never a task handed in or finished", () => {
    const risks = overdueRisks(
      [
        task("late", { dueAt: "2026-10-07T05:00:00.000Z" }),
        task("handed-in", { dueAt: "2026-10-07T05:00:00.000Z", state: "submitted" }),
        task("done", { dueAt: "2026-10-07T05:00:00.000Z", state: "completed" }),
        task("ahead"),
      ],
      NOW,
    );
    expect(risks.map((r) => ("taskId" in r ? r.taskId : ""))).toEqual(["late"]);
  });

  it("groups not-noted rows per task, longest first, and drops tasks not on screen", () => {
    const risks = notNotedRisks(
      [
        { taskId: "t", memberId: "b", since: "2026-10-06T10:00:00.000Z" },
        { taskId: "t", memberId: "a", since: "2026-10-06T08:00:00.000Z" },
        { taskId: "gone", memberId: "a", since: "2026-10-06T08:00:00.000Z" },
      ],
      new Map([["t", "Reel 4"]]),
    );
    expect(risks).toEqual([
      {
        kind: "not_noted",
        taskId: "t",
        title: "Reel 4",
        waiting: [
          { memberId: "a", since: "2026-10-06T08:00:00.000Z" },
          { memberId: "b", since: "2026-10-06T10:00:00.000Z" },
        ],
      },
    ]);
  });

  it("finds an assignee on approved leave on the deadline day, never a pending request", () => {
    const leave = [
      { memberId: "asha", day: "2026-10-08", leave: "leave" },
      { memberId: "ravi", day: "2026-10-08", leave: "requested" },
      { memberId: "kiran", day: "2026-10-07", leave: "half_day" },
    ];
    const tasks = [
      task("asha-tomorrow"),
      task("ravi-tomorrow", { assigneeIds: ["ravi"] }),
      task("kiran-today", { assigneeIds: ["kiran"], dueAt: "2026-10-07T12:00:00.000Z" }),
      task("asha-done", { state: "completed" }),
    ];
    const owner = leaveRisks(tasks, leave, { from: TODAY, to: "2026-10-08", eventDays: false });
    expect(owner.map((r) => ("taskId" in r ? r.taskId : ""))).toEqual([
      "asha-tomorrow",
      "kiran-today",
    ]);
    expect(owner[1]).toMatchObject({ kind: "on_leave", leave: "half_day", on: "due" });
  });

  it("the Admin's Issues also check the event's day, within the window", () => {
    const leave = [{ memberId: "asha", day: "2026-10-20", leave: "comp_leave" }];
    const event = task("shoot", { dueAt: "2026-10-25T12:00:00.000Z", eventDate: "2026-10-20" });
    expect(leaveWindow([event], TODAY)).toEqual({ from: TODAY, to: "2026-10-25" });
    const issues = leaveRisks([event], leave, { from: TODAY, to: "2026-10-25", eventDays: true });
    expect(issues).toMatchObject([{ kind: "on_leave", on: "event", date: "2026-10-20" }]);
    expect(leaveRisks([event], leave, { from: TODAY, to: "2026-10-25", eventDays: false })).toEqual(
      [],
    );
  });

  it("keeps the leave window inside 62 days", () => {
    expect(leaveWindow([task("far", { dueAt: "2027-01-01T12:00:00.000Z" })], TODAY)).toEqual({
      from: TODAY,
      to: TODAY,
    });
  });

  it("scopes an Admin's Issues to the open tasks they created or approve (5.4's scope)", () => {
    const tasks = [
      task("made", { createdBy: "admin" }),
      task("approves", { approvingAdminId: "admin" }),
      task("other"),
      task("made-done", { createdBy: "admin", state: "cancelled" }),
    ];
    expect(adminScope(tasks, "admin").map((t) => t.id)).toEqual(["made", "approves"]);
  });

  it("sorts overdue, not noted, leave, then unreachable; no score", () => {
    const risks: Risk[] = [
      { kind: "unreachable", memberId: "z", name: "Zoya", openTasks: 1 },
      {
        kind: "on_leave",
        taskId: "l",
        title: "L",
        memberId: "a",
        date: TODAY,
        leave: "leave",
        on: "due",
      },
      {
        kind: "overdue",
        taskId: "o2",
        title: "O2",
        dueAt: "2026-10-06T00:00:00.000Z",
        ownerId: "a",
      },
      {
        kind: "not_noted",
        taskId: "n",
        title: "N",
        waiting: [{ memberId: "a", since: "2026-10-06T00:00:00.000Z" }],
      },
      {
        kind: "overdue",
        taskId: "o1",
        title: "O1",
        dueAt: "2026-10-05T00:00:00.000Z",
        ownerId: "a",
      },
      { kind: "unreachable", memberId: "a", name: "Asha", openTasks: 2 },
    ];
    expect(sortRisks(risks).map((r) => ("taskId" in r ? r.taskId : r.name))).toEqual([
      "o1",
      "o2",
      "n",
      "l",
      "Asha",
      "Zoya",
    ]);
    expect(RISKS_EMPTY).toBe("Nothing overdue.");
    expect(ADMIN_NEEDS_YOU_EMPTY).toBe("Nothing needs you right now.");
  });

  it("words each risk plainly and links it", () => {
    const context = {
      nameOf: (id: string) => (id === "a" ? "Asha" : "Ravi"),
      today: TODAY,
      now: NOW,
    };
    expect(
      riskWords(
        {
          kind: "overdue",
          taskId: "o",
          title: "Reel",
          dueAt: "2026-10-07T03:30:00.000Z",
          ownerId: "a",
        },
        context,
      ),
    ).toMatchObject({
      detail: "Asha · overdue by 3 h",
      href: "/tasks/o",
      marker: { label: "Overdue" },
    });
    expect(
      riskWords(
        {
          kind: "not_noted",
          taskId: "n",
          title: "Shoot",
          waiting: [
            { memberId: "a", since: "2026-10-06T06:30:00.000Z" },
            { memberId: "r", since: "2026-10-06T08:30:00.000Z" },
          ],
        },
        context,
      ).detail,
    ).toBe("Asha and 1 more hasn't noted it · 24 h");
    expect(
      riskWords(
        {
          kind: "on_leave",
          taskId: "l",
          title: "Edit",
          memberId: "r",
          date: "2026-10-08",
          leave: "half_day",
          on: "due",
        },
        context,
      ).detail,
    ).toBe("Ravi is on a half day tomorrow, the day it's due");
    expect(
      riskWords(
        {
          kind: "on_leave",
          taskId: "l",
          title: "Edit",
          memberId: "r",
          date: "2026-10-12",
          leave: "leave",
          on: "event",
        },
        context,
      ).detail,
    ).toBe("Ravi is on leave on Mon 12 Oct, the day of the event");
    expect(
      riskWords({ kind: "unreachable", memberId: "a", name: "Asha", openTasks: 3 }, context),
    ).toMatchObject({
      title: "Asha can't be reached",
      href: "/settings/notifications",
    });
    expect(spanWords(47.9)).toBe("47 h");
    expect(spanWords(50)).toBe("2 days");
  });

  it("names the limit that held emails back, and nothing at zero (decision 23)", () => {
    expect(heldEmailsLine({ orgCap: 0, memberCap: 0 })).toBeNull();
    expect(heldEmailsLine({ orgCap: 0, memberCap: 1 })).toEqual({
      title: "1 email held back today by the daily limit",
      detail: "1 by the per-person limit, which you can change in Thresholds.",
    });
    const both = heldEmailsLine({ orgCap: 3, memberCap: 2 });
    expect(both?.title).toBe("5 emails held back today by the daily limit");
    expect(both?.detail).toContain(
      "the email plan's daily limit, which can't be changed in Settings",
    );
  });
});

describe("the events strip (decision 12)", () => {
  const ev = (id: string, eventDate: string) => ({
    id,
    title: id,
    eventDate,
    eventStartAt: null,
    location: null,
    assigneeIds: [],
  });

  it("shows today and the next six days, at most five rows, then the rest as hidden", () => {
    const events = [
      ev("a", "2026-10-07"),
      ev("b", "2026-10-07"),
      ev("c", "2026-10-09"),
      ev("d", "2026-10-10"),
      ev("e", "2026-10-11"),
      ev("f", "2026-10-12"),
      ev("beyond", "2026-10-14"),
    ];
    const strip = eventsStrip({
      events,
      holidays: [{ date: "2026-10-08", name: "Holiday" }],
      leave: null,
      today: TODAY,
    });
    expect(strip.days.map((d) => [d.date, d.holiday, d.events.map((e) => e.id)])).toEqual([
      ["2026-10-07", null, ["a", "b"]],
      ["2026-10-08", "Holiday", []],
      ["2026-10-09", null, ["c"]],
      ["2026-10-10", null, ["d"]],
    ]);
    expect(strip.hidden).toBe(2);
    expect(strip.days.every((d) => d.onLeave === null)).toBe(true);
  });

  it("gives the Owner N on leave per day (approved only), a day of leave alone included", () => {
    const strip = eventsStrip({
      events: [],
      holidays: [],
      leave: [
        { memberId: "a", day: "2026-10-09", leave: "leave" },
        { memberId: "b", day: "2026-10-09", leave: "half_day" },
        { memberId: "c", day: "2026-10-09", leave: "requested" },
      ],
      today: TODAY,
    });
    expect(strip.days).toEqual([{ date: "2026-10-09", holiday: null, events: [], onLeave: 2 }]);
  });
});

describe("the Admin's clients (decision 9)", () => {
  it("counts each client's open and overdue labelled tasks", () => {
    const counts = clientCounts(
      [{ id: "c1" }, { id: "c2" }],
      [
        { clientId: "c1", state: "assigned", dueAt: "2026-10-06T00:00:00.000Z" },
        { clientId: "c1", state: "in_progress", dueAt: "2026-10-09T00:00:00.000Z" },
        { clientId: "c1", state: "completed", dueAt: "2026-10-01T00:00:00.000Z" },
        { clientId: null, state: "assigned", dueAt: "2026-10-01T00:00:00.000Z" },
      ],
      NOW,
    );
    expect(counts.map((c) => [c.client.id, c.open, c.overdue])).toEqual([
      ["c1", 2, 1],
      ["c2", 0, 0],
    ]);
    expect(clientCountsLine({ open: 2, overdue: 1 })).toBe("2 open tasks · 1 overdue");
    expect(clientCountsLine({ open: 1, overdue: 0 })).toBe("1 open task");
  });
});
