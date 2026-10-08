import { describe, expect, it } from "vitest";

import { alertsFilterFrom, alertsHref, dayGroupOf, entryTitle, groupByDay } from "../domain/alerts";

// 2026-10-02 is a Friday; its IST week began on Monday 2026-09-28.
const FRIDAY = "2026-10-02";

describe("the Alerts filter (5B decision 10)", () => {
  it("is Unread only for show=unread", () => {
    expect(alertsFilterFrom("unread")).toBe("unread");
    expect(alertsFilterFrom("all")).toBe("all");
    expect(alertsFilterFrom(undefined)).toBe("all");
    expect(alertsFilterFrom(["unread"])).toBe("all");
    expect(alertsFilterFrom("UNREAD")).toBe("all");
  });

  it("writes the address with only what differs from the first page of All", () => {
    expect(alertsHref("all")).toBe("/notifications");
    expect(alertsHref("all", 1)).toBe("/notifications");
    expect(alertsHref("all", 3)).toBe("/notifications?page=3");
    expect(alertsHref("unread")).toBe("/notifications?show=unread");
    expect(alertsHref("unread", 2)).toBe("/notifications?show=unread&page=2");
  });
});

describe("the day groups (IST)", () => {
  it("puts a row in Today, Yesterday, Earlier this week or Older by its IST day", () => {
    // 00:30 IST on Friday is still Thursday in UTC.
    expect(dayGroupOf("2026-10-01T19:00:00Z", FRIDAY)).toBe("today");
    expect(dayGroupOf("2026-10-02T18:00:00Z", FRIDAY)).toBe("today");
    // 23:59 IST on Thursday.
    expect(dayGroupOf("2026-10-01T18:29:00Z", FRIDAY)).toBe("yesterday");
    expect(dayGroupOf("2026-09-30T10:00:00Z", FRIDAY)).toBe("this_week");
    // Monday 00:00 IST is the week's first moment.
    expect(dayGroupOf("2026-09-27T18:30:00Z", FRIDAY)).toBe("this_week");
    // Sunday 23:59 IST belongs to the week before.
    expect(dayGroupOf("2026-09-27T18:29:00Z", FRIDAY)).toBe("older");
    expect(dayGroupOf("2025-12-31T10:00:00Z", FRIDAY)).toBe("older");
  });

  it("has no Earlier this week on a Monday or a Tuesday", () => {
    const monday = "2026-09-28";
    expect(dayGroupOf("2026-09-27T10:00:00Z", monday)).toBe("yesterday");
    expect(dayGroupOf("2026-09-26T10:00:00Z", monday)).toBe("older");
    const tuesday = "2026-09-29";
    expect(dayGroupOf("2026-09-28T10:00:00Z", tuesday)).toBe("yesterday");
    expect(dayGroupOf("2026-09-27T10:00:00Z", tuesday)).toBe("older");
  });

  it("cuts rows into groups in order, leaving out empty ones", () => {
    const rows = [
      { id: "a", createdAt: "2026-10-02T05:00:00Z" },
      { id: "b", createdAt: "2026-10-02T04:00:00Z" },
      { id: "c", createdAt: "2026-09-29T04:00:00Z" },
      { id: "d", createdAt: "2026-09-20T04:00:00Z" },
    ];
    expect(
      groupByDay(rows, FRIDAY).map((group) => [group.label, group.rows.map((row) => row.id)]),
    ).toEqual([
      ["Today", ["a", "b"]],
      ["Earlier this week", ["c"]],
      ["Older", ["d"]],
    ]);
    expect(groupByDay([], FRIDAY)).toEqual([]);
  });
});

describe("a row's title and count", () => {
  it("leaves a single notification as it is", () => {
    expect(
      entryTitle({ title: "Comment on Edit", runSize: 1, runKinds: ["task_comment"] }),
    ).toEqual({ title: "Comment on Edit", count: null });
  });

  it("says how many comments a run of comments holds (the decision's example)", () => {
    expect(
      entryTitle({ title: "Comment on Edit", runSize: 3, runKinds: ["task_comment"] }),
    ).toEqual({ title: "3 comments on Edit", count: null });
    expect(
      entryTitle({ title: "Comment on Edit · for Asha", runSize: 2, runKinds: ["task_comment"] }),
    ).toEqual({ title: "2 comments on Edit · for Asha", count: null });
  });

  it("keeps the newest title of a mixed run and shows its count", () => {
    expect(
      entryTitle({
        title: "Task changed: Edit",
        runSize: 4,
        runKinds: ["task_changed", "task_comment"],
      }),
    ).toEqual({ title: "Task changed: Edit", count: 4 });
  });
});
