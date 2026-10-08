import { describe, expect, it } from "vitest";

import { dayWord, inlineDay, nextDays } from "../domain/days";
import {
  byStart,
  MY_DAY_EMPTY,
  MY_DAY_GROUPS,
  moreThisWeekLine,
  myDayEvents,
  quietLine,
  upcomingLine,
  upcomingWithin,
  type DayEvent,
} from "../domain/my-day";

const TODAY = "2026-10-07"; // a Wednesday

function event(id: string, eventDate: string, over: Partial<DayEvent> = {}): DayEvent {
  return {
    id,
    title: id,
    eventDate,
    eventStartAt: null,
    location: null,
    assigneeIds: ["me"],
    ...over,
  };
}

describe("days", () => {
  it("names today and tomorrow, then the weekday and date (IST)", () => {
    expect(dayWord("2026-10-07", TODAY)).toBe("Today");
    expect(dayWord("2026-10-08", TODAY)).toBe("Tomorrow");
    expect(dayWord("2026-10-09", TODAY)).toBe("Fri 9 Oct");
    expect(inlineDay("2026-10-08", TODAY)).toBe("tomorrow");
    expect(inlineDay("2026-10-12", TODAY)).toBe("Mon 12 Oct");
    expect(nextDays(TODAY, 3)).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
  });
});

describe("My Day (6.1, Kickoff 6 decisions 1-3, 22)", () => {
  it("keeps the Tasks tab's exception order and its empty line", () => {
    expect(MY_DAY_GROUPS).toEqual(["not_noted", "changes_requested", "overdue", "due_today"]);
    expect(MY_DAY_EMPTY).toBe("Nothing needs you today.");
  });

  it("counts the upcoming tasks due within the next 7 IST days as one line", () => {
    const upcoming = [
      { dueAt: "2026-10-08T12:30:00.000Z" }, // tomorrow
      { dueAt: "2026-10-14T18:00:00.000Z" }, // 14 Oct 23:30 IST: day 7
      { dueAt: "2026-10-14T18:31:00.000Z" }, // 15 Oct 00:01 IST: day 8
    ];
    expect(upcomingWithin(upcoming, TODAY)).toBe(2);
    expect(upcomingLine(1)).toBe("1 more in the next 7 days");
    expect(upcomingLine(2)).toBe("2 more in the next 7 days");
  });

  it("shows own events today and tomorrow as rows, then N more this week; never another's", () => {
    const events = [
      event("tomorrow-late", "2026-10-08", { eventStartAt: "2026-10-08T12:30:00.000Z" }),
      event("tomorrow-early", "2026-10-08", { eventStartAt: "2026-10-08T03:30:00.000Z" }),
      event("today", "2026-10-07"),
      event("friday", "2026-10-09"),
      event("tuesday", "2026-10-13"),
      event("next-wednesday", "2026-10-14"),
      event("someone-else", "2026-10-07", { assigneeIds: ["other"] }),
    ];
    const day = myDayEvents(events, (e) => e.assigneeIds.includes("me"), TODAY);
    expect(day.rows.map((e) => e.id)).toEqual(["today", "tomorrow-early", "tomorrow-late"]);
    expect(day.moreThisWeek).toBe(2);
    expect(moreThisWeekLine(1)).toBe("1 more this week");
    expect(moreThisWeekLine(3)).toBe("3 more this week");
  });

  it("orders events by day, then time (an untimed one first), then title", () => {
    const sorted = byStart([
      event("b", "2026-10-08", { eventStartAt: "2026-10-08T05:00:00.000Z" }),
      event("a", "2026-10-08"),
      event("c", "2026-10-07", { eventStartAt: "2026-10-07T10:00:00.000Z" }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("gives one quiet line: the first holiday or own approved leave in the next 7 days", () => {
    expect(quietLine({ holidays: [], leave: [], today: TODAY })).toBeNull();
    expect(
      quietLine({ holidays: [{ date: "2026-10-09", name: "Dussehra" }], leave: [], today: TODAY }),
    ).toBe("Holiday Fri 9 Oct: Dussehra");
    expect(
      quietLine({ holidays: [{ date: "2026-10-20", name: "Diwali" }], leave: [], today: TODAY }),
    ).toBeNull();
    expect(
      quietLine({
        holidays: [{ date: "2026-10-12", name: "Later" }],
        leave: [{ type: "leave", startDate: "2026-10-08", endDate: "2026-10-09" }],
        today: TODAY,
      }),
    ).toBe("Your leave tomorrow – Fri 9 Oct");
    expect(
      quietLine({
        holidays: [],
        leave: [{ type: "half_day", startDate: "2026-10-07", endDate: "2026-10-07" }],
        today: TODAY,
      }),
    ).toBe("Your half day today");
    // A stretch that began before today reads from today.
    expect(
      quietLine({
        holidays: [],
        leave: [{ type: "comp_leave", startDate: "2026-10-05", endDate: "2026-10-08" }],
        today: TODAY,
      }),
    ).toBe("Your comp leave today – tomorrow");
  });
});
