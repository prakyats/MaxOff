import { describe, expect, it } from "vitest";

import type { LeaveDay } from "../domain/today";
import {
  daySpan,
  leaveSpans,
  SEE_THE_WEEK_HREF,
  shortDay,
  WEEK_EVENT_TITLE_MAX,
  WEEK_LINES,
  weekLineHref,
  weekLines,
  type WeekDay,
} from "../domain/week";

const TODAY = "2026-10-09"; // a Friday

/** The seven days from today, each empty unless patched. */
function week(patch: Record<string, Partial<WeekDay>> = {}): WeekDay[] {
  return ["09", "10", "11", "12", "13", "14", "15"].map((d) => {
    const date = `2026-10-${d}`;
    return { date, holiday: null, due: 0, events: [], ...patch[date] };
  });
}

const NAMES: Record<string, string> = { anna: "Anna", ravi: "Ravi Kumar", asha: "Asha" };
const nameOf = (id: string) => NAMES[id] ?? "Someone";
const off = (memberId: string, day: string, leave: string | null = "leave"): LeaveDay => ({
  memberId,
  day,
  leave,
});
const text = (lines: { parts: string[] }[]) => lines.map((line) => line.parts.join(" · "));

describe("the week's day words", () => {
  it("names today and tomorrow, else a short day", () => {
    expect(shortDay("2026-10-09", TODAY)).toBe("Today");
    expect(shortDay("2026-10-10", TODAY)).toBe("Tomorrow");
    expect(shortDay("2026-10-12", TODAY)).toBe("Mon 12");
    expect(daySpan("2026-10-12", "2026-10-14", TODAY)).toBe("Mon 12 – Wed 14");
    expect(daySpan("2026-10-12", "2026-10-12", TODAY)).toBe("Mon 12");
    expect(daySpan("2026-10-09", "2026-10-10", TODAY)).toBe("Today – Tomorrow");
  });
});

describe("leaveSpans: consecutive days of one person's leave are one span", () => {
  it("joins consecutive days of the same kind", () => {
    const spans = leaveSpans(
      [off("anna", "2026-10-12"), off("anna", "2026-10-14"), off("anna", "2026-10-13")],
      { from: TODAY, to: "2026-10-15" },
    );
    expect(spans).toEqual([
      { memberId: "anna", kind: "leave", from: "2026-10-12", to: "2026-10-14" },
    ]);
  });

  it("splits on a gap and on a change of kind", () => {
    const spans = leaveSpans(
      [
        off("anna", "2026-10-12"),
        off("anna", "2026-10-14"),
        off("ravi", "2026-10-12", "half_day"),
        off("ravi", "2026-10-13", "leave"),
      ],
      { from: TODAY, to: "2026-10-15" },
    );
    expect(spans).toEqual([
      { memberId: "anna", kind: "leave", from: "2026-10-12", to: "2026-10-12" },
      { memberId: "anna", kind: "leave", from: "2026-10-14", to: "2026-10-14" },
      { memberId: "ravi", kind: "half_day", from: "2026-10-12", to: "2026-10-12" },
      { memberId: "ravi", kind: "leave", from: "2026-10-13", to: "2026-10-13" },
    ]);
  });

  it("keeps approved leave only, inside the window", () => {
    const spans = leaveSpans(
      [
        off("anna", "2026-10-12", null),
        off("anna", "2026-10-13", "requested"),
        off("asha", "2026-10-08"),
        off("asha", "2026-10-16"),
        off("ravi", "2026-10-13", "comp_leave"),
      ],
      { from: TODAY, to: "2026-10-15" },
    );
    expect(spans).toEqual([
      { memberId: "ravi", kind: "comp_leave", from: "2026-10-13", to: "2026-10-13" },
    ]);
  });
});

describe("weekLines: the Owner's This week", () => {
  it("groups a person's leave and writes each day's deadlines and events", () => {
    const { lines, hidden } = weekLines({
      days: week({
        "2026-10-15": {
          due: 3,
          events: [{ title: "Shoot", startAt: "2026-10-15T05:30:00.000Z" }],
        },
      }),
      leave: [off("anna", "2026-10-12"), off("anna", "2026-10-13"), off("anna", "2026-10-14")],
      nameOf,
      today: TODAY,
    });
    expect(text(lines)).toEqual([
      "Anna on leave · Mon 12 – Wed 14",
      "Thu 15 · 3 due · Shoot 11:00",
    ]);
    expect(hidden).toBe(0);
    expect(lines.map((line) => line.kind)).toEqual(["leave", "day"]);
  });

  it("puts a day's own line before the leave starting that day, then leave by name", () => {
    const { lines } = weekLines({
      days: week({ "2026-10-12": { due: 1 } }),
      leave: [off("ravi", "2026-10-12", "half_day"), off("anna", "2026-10-12", "comp_leave")],
      nameOf,
      today: TODAY,
    });
    expect(text(lines)).toEqual([
      "Mon 12 · 1 due",
      "Anna on comp leave · Mon 12",
      "Ravi Kumar on a half day · Mon 12",
    ]);
  });

  it("names a holiday, counts an all-day event as due, and names two timed events before +N more", () => {
    const { lines } = weekLines({
      days: week({
        "2026-10-09": {
          due: 2,
          events: [
            { title: "Site visit", startAt: null },
            { title: "Shoot", startAt: "2026-10-09T05:30:00.000Z" },
            { title: "Client call", startAt: "2026-10-09T09:30:00.000Z" },
            { title: "Edit review", startAt: "2026-10-09T11:30:00.000Z" },
          ],
        },
        "2026-10-10": { holiday: "Dussehra" },
      }),
      leave: [],
      nameOf,
      today: TODAY,
    });
    expect(text(lines)).toEqual([
      "Today · 3 due · Shoot 11:00 · Client call 15:00 · +1 more",
      "Tomorrow · Holiday: Dussehra",
    ]);
  });

  it("never shows a bare title: the owner's two lines, labelled (owner 2026-10-09)", () => {
    // Was "Today · Fire Chandan 2.0 · cal test 11:49" and "Tomorrow · Edit".
    const { lines } = weekLines({
      days: week({
        "2026-10-09": {
          due: 2,
          events: [
            { title: "Fire Chandan 2.0", startAt: null },
            { title: "cal test", startAt: "2026-10-09T06:19:00.000Z" },
          ],
        },
        "2026-10-10": { events: [{ title: "Edit", startAt: null }] },
      }),
      leave: [off("ravi", "2026-10-14"), off("ravi", "2026-10-15")],
      nameOf,
      today: TODAY,
    });
    expect(text(lines)).toEqual([
      "Today · 3 due · cal test 11:49",
      "Tomorrow · 1 due",
      "Ravi Kumar on leave · Wed 14 – Thu 15",
    ]);
    // Every part after the day is a count, a holiday, an event with its time, or "+N more".
    for (const line of lines.filter((l) => l.kind === "day")) {
      for (const part of line.parts.slice(1)) {
        expect(part).toMatch(/^\d+ due$|^Holiday: |^.+ \d{2}:\d{2}$|^\+\d+ more$/);
      }
    }
  });

  it("cuts a long event title, never its time", () => {
    const { lines } = weekLines({
      days: week({
        "2026-10-12": {
          events: [
            {
              title: "Brand film shoot for Coastal Kitchen, day two",
              startAt: "2026-10-12T03:30:00.000Z",
            },
          ],
        },
      }),
      leave: [],
      nameOf,
      today: TODAY,
    });
    expect(text(lines)).toEqual(["Mon 12 · Brand film shoot for Co… 09:00"]);
    expect(lines[0]?.parts[1]?.length).toBeLessThanOrEqual(WEEK_EVENT_TITLE_MAX + 6);
  });

  it("shows the first five lines and counts the rest", () => {
    const { lines, hidden } = weekLines({
      days: week({
        "2026-10-09": { due: 1 },
        "2026-10-10": { due: 1 },
        "2026-10-11": { due: 1 },
        "2026-10-12": { due: 1 },
      }),
      leave: [off("anna", "2026-10-12"), off("ravi", "2026-10-13"), off("asha", "2026-10-15")],
      nameOf,
      today: TODAY,
    });
    expect(lines).toHaveLength(WEEK_LINES);
    expect(text(lines)).toEqual([
      "Today · 1 due",
      "Tomorrow · 1 due",
      "Sun 11 · 1 due",
      "Mon 12 · 1 due",
      "Anna on leave · Mon 12",
    ]);
    expect(hidden).toBe(2);
  });

  it("is empty when the week holds nothing", () => {
    expect(weekLines({ days: week(), leave: [], nameOf, today: TODAY })).toEqual({
      lines: [],
      hidden: 0,
    });
    expect(weekLines({ days: [], leave: [off("anna", TODAY)], nameOf, today: TODAY })).toEqual({
      lines: [],
      hidden: 0,
    });
  });

  it("opens the calendar on the line's first day", () => {
    expect(weekLineHref({ date: TODAY }, TODAY)).toBe("/calendar");
    expect(weekLineHref({ date: "2026-10-12" }, TODAY)).toBe("/calendar?date=2026-10-12");
    expect(SEE_THE_WEEK_HREF).toBe("/calendar?view=week");
  });
});
