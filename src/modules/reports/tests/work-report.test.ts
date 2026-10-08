import { describe, expect, it } from "vitest";

import {
  acknowledgementLag,
  countWords,
  hoursWords,
  loadThisWeek,
  loadWords,
  median,
  monthOf,
  nextPeriod,
  overdueNow,
  parsePeriod,
  periodHref,
  periodLabel,
  previousPeriod,
  rework,
  reworkWords,
  turnaround,
  weekOf,
  type ReportFacts,
} from "../domain/work-report";

const TODAY = "2026-10-07"; // a Wednesday
const NOW = new Date("2026-10-07T06:30:00.000Z");
const engagementOf = (id: string) =>
  id.startsWith("f") ? ("freelance" as const) : ("permanent" as const);

describe("the period (week, month, custom; the last period beside it)", () => {
  it("reads weeks Monday to Sunday and calendar months, in IST dates", () => {
    expect(weekOf(TODAY)).toEqual({ kind: "week", from: "2026-10-05", to: "2026-10-11" });
    expect(weekOf("2026-10-11")).toEqual({ kind: "week", from: "2026-10-05", to: "2026-10-11" });
    expect(monthOf(TODAY)).toEqual({ kind: "month", from: "2026-10-01", to: "2026-10-31" });
    expect(monthOf("2026-02-10")).toEqual({ kind: "month", from: "2026-02-01", to: "2026-02-28" });
  });

  it("parses the address, defaulting to this week; a custom range is clamped", () => {
    expect(parsePeriod({}, TODAY)).toEqual(weekOf(TODAY));
    expect(parsePeriod({ period: "month", at: "2026-09-15" }, TODAY)).toEqual(
      monthOf("2026-09-15"),
    );
    expect(parsePeriod({ period: "week", at: "2027-01-01" }, TODAY)).toEqual(weekOf(TODAY));
    expect(parsePeriod({ from: "2026-10-01", to: "2026-10-30" }, TODAY)).toEqual({
      kind: "custom",
      from: "2026-10-01",
      to: TODAY,
    });
    expect(parsePeriod({ from: "2026-01-01", to: "2026-10-01" }, TODAY).to).toBe("2026-04-02");
    expect(parsePeriod({ from: "2026-10-05", to: "2026-10-01" }, TODAY)).toEqual(weekOf(TODAY));
  });

  it("steps back and forward, never past today", () => {
    expect(previousPeriod(weekOf(TODAY))).toEqual({
      kind: "week",
      from: "2026-09-28",
      to: "2026-10-04",
    });
    expect(previousPeriod(monthOf(TODAY))).toEqual({
      kind: "month",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(previousPeriod({ kind: "custom", from: "2026-10-01", to: "2026-10-03" })).toEqual({
      kind: "custom",
      from: "2026-09-28",
      to: "2026-09-30",
    });
    expect(nextPeriod(weekOf(TODAY), TODAY)).toBeNull();
    expect(nextPeriod(weekOf("2026-09-30"), TODAY)).toEqual(weekOf(TODAY));
  });

  it("labels and addresses a period", () => {
    expect(periodLabel(weekOf(TODAY), TODAY)).toBe("This week");
    expect(periodLabel(weekOf("2026-09-30"), TODAY)).toBe("Week of 28 Sep");
    expect(periodLabel(monthOf("2026-09-01"), TODAY)).toBe("September 2026");
    expect(periodLabel({ kind: "custom", from: "2026-10-01", to: "2026-10-05" }, TODAY)).toBe(
      "1 Oct – 5 Oct",
    );
    expect(periodHref(weekOf(TODAY))).toBe("/reports?period=week&at=2026-10-05");
    expect(periodHref({ kind: "custom", from: "2026-10-01", to: "2026-10-05" })).toBe(
      "/reports?from=2026-10-01&to=2026-10-05",
    );
  });
});

const facts: ReportFacts = {
  submissions: [
    { taskId: "t1", at: "2026-10-05T05:00:00.000Z", primaryOwnerId: "asha" },
    { taskId: "t1", at: "2026-10-06T05:00:00.000Z", primaryOwnerId: "asha" },
    { taskId: "t2", at: "2026-10-06T06:00:00.000Z", primaryOwnerId: "ravi" },
    { taskId: "t3", at: "2026-10-06T07:00:00.000Z", primaryOwnerId: "farah" },
    { taskId: "t9", at: "2026-09-30T07:00:00.000Z", primaryOwnerId: "asha" },
  ],
  reviews: [
    {
      taskId: "t1",
      step: "admin",
      decision: "rejected",
      reviewerId: "admin",
      at: "2026-10-05T09:00:00.000Z",
      handedInAt: "2026-10-05T05:00:00.000Z",
      primaryOwnerId: "asha",
    },
    {
      taskId: "t1",
      step: "admin",
      decision: "approved",
      reviewerId: "admin",
      at: "2026-10-06T07:00:00.000Z",
      handedInAt: "2026-10-06T05:00:00.000Z",
      primaryOwnerId: "asha",
    },
    {
      taskId: "t2",
      step: "admin",
      decision: "approved",
      reviewerId: "admin",
      at: "2026-10-06T12:00:00.000Z",
      handedInAt: "2026-10-06T06:00:00.000Z",
      primaryOwnerId: "ravi",
    },
    {
      taskId: "t2",
      step: "owner",
      decision: "approved",
      reviewerId: "owner",
      at: "2026-10-06T13:00:00.000Z",
      handedInAt: "2026-10-06T06:00:00.000Z",
      primaryOwnerId: "ravi",
    },
    {
      taskId: "t3",
      step: "admin",
      decision: "approved",
      reviewerId: "admin",
      at: "2026-10-06T08:00:00.000Z",
      handedInAt: "2026-10-06T07:00:00.000Z",
      primaryOwnerId: "farah",
    },
  ],
  notes: [
    {
      taskId: "t1",
      memberId: "asha",
      assignedAt: "2026-10-05T00:00:00.000Z",
      acknowledgedAt: "2026-10-05T02:00:00.000Z",
    },
    {
      taskId: "t2",
      memberId: "ravi",
      assignedAt: "2026-10-05T00:00:00.000Z",
      acknowledgedAt: "2026-10-05T06:00:00.000Z",
    },
    {
      taskId: "t3",
      memberId: "farah",
      assignedAt: "2026-10-05T00:00:00.000Z",
      acknowledgedAt: "2026-10-05T10:00:00.000Z",
    },
    {
      taskId: "t9",
      memberId: "asha",
      assignedAt: "2026-09-29T00:00:00.000Z",
      acknowledgedAt: "2026-09-29T20:00:00.000Z",
    },
  ],
};

describe("the task KPIs, split by engagement (6.3, PRODUCT §4.13)", () => {
  const week = weekOf(TODAY);

  it("Rework: sent back ÷ handed in, by the primary owner's engagement", () => {
    expect(rework(facts, week, engagementOf)).toEqual({
      permanent: { sentBack: 1, handedIn: 3 },
      freelance: { sentBack: 0, handedIn: 1 },
    });
    expect(rework(facts, previousPeriod(week), engagementOf).permanent).toEqual({
      sentBack: 0,
      handedIn: 1,
    });
    expect(reworkWords({ sentBack: 1, handedIn: 3 })).toBe("1 of 3 sent back (33%)");
    expect(reworkWords({ sentBack: 0, handedIn: 0 })).toBe("None handed in");
  });

  it("My turnaround: the median hours from Done to this Admin's own approval only", () => {
    expect(turnaround(facts, week, "admin", engagementOf)).toEqual({ permanent: 4, freelance: 1 });
    expect(turnaround(facts, week, "owner", engagementOf)).toEqual({
      permanent: 7,
      freelance: null,
    });
  });

  it("Acknowledgement lag: the median hours from assignment to Task Noted", () => {
    expect(acknowledgementLag(facts, week, engagementOf)).toEqual({ permanent: 4, freelance: 10 });
    expect(acknowledgementLag(facts, previousPeriod(week), engagementOf)).toEqual({
      permanent: 20,
      freelance: null,
    });
    expect(hoursWords(4)).toBe("4 h");
    expect(hoursWords(3.25)).toBe("3.3 h");
    expect(hoursWords(60)).toBe("2.5 days");
    expect(hoursWords(null)).toBe("No data");
  });

  it("Overdue now and who is loaded this week, from the open tasks", () => {
    const open = [
      {
        id: "a",
        state: "assigned",
        dueAt: "2026-10-06T00:00:00.000Z",
        primaryOwnerId: "asha",
        assigneeIds: ["asha", "farah"],
      },
      {
        id: "b",
        state: "in_progress",
        dueAt: "2026-10-09T00:00:00.000Z",
        primaryOwnerId: "asha",
        assigneeIds: ["asha"],
      },
      {
        id: "c",
        state: "assigned",
        dueAt: "2026-10-20T00:00:00.000Z",
        primaryOwnerId: "ravi",
        assigneeIds: ["ravi"],
      },
      {
        id: "d",
        state: "completed",
        dueAt: "2026-10-01T00:00:00.000Z",
        primaryOwnerId: "ravi",
        assigneeIds: ["ravi"],
      },
      {
        id: "e",
        state: "assigned",
        dueAt: "2026-10-01T00:00:00.000Z",
        primaryOwnerId: "farah",
        assigneeIds: ["farah"],
      },
    ];
    expect(overdueNow(open, NOW, engagementOf)).toEqual({ permanent: 1, freelance: 1 });
    const load = loadThisWeek(open, TODAY, NOW, engagementOf, (id) => id);
    expect(load.permanent).toEqual([{ memberId: "asha", open: 2, overdue: 1 }]);
    expect(load.freelance).toEqual([{ memberId: "farah", open: 2, overdue: 2 }]);
    expect(loadWords({ memberId: "x", open: 2, overdue: 1 })).toBe("2 open · 1 overdue");
    expect(loadWords({ memberId: "x", open: 1, overdue: 0 })).toBe("1 open");
    expect(countWords(1)).toBe("1 task");
  });

  it("takes the median of an even list as the mean of its middle two", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
