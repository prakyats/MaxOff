import { describe, expect, it } from "vitest";

import type { LeaveDay } from "../domain/today";
import {
  dayHref,
  daySpan,
  leaveSpans,
  SEE_THE_WEEK_HREF,
  shortDay,
  WEEK_DAYS_SHOWN,
  WEEK_ROWS_SHOWN,
  weekBlocks,
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

const NAMES: Record<string, string> = {
  anna: "Anna",
  ravi: "Ravi Kumar",
  asha: "Asha",
  prakyat: "Prakyat",
};
const nameOf = (id: string) => NAMES[id] ?? "Someone";
const off = (memberId: string, day: string, leave: string | null = "leave"): LeaveDay => ({
  memberId,
  day,
  leave,
});
/** A block as words: "Today: All day Holiday: Diwali | 11:49 am Shoot". */
const text = (blocks: { label: string; rows: { when: string; title: string }[] }[]) =>
  blocks.map(
    (block) => `${block.label}: ${block.rows.map((row) => `${row.when} ${row.title}`).join(" | ")}`,
  );

describe("the week's day words", () => {
  it("names today and tomorrow, else a short day for a span's ends", () => {
    expect(shortDay("2026-10-09", TODAY)).toBe("Today");
    expect(shortDay("2026-10-10", TODAY)).toBe("Tomorrow");
    expect(shortDay("2026-10-14", TODAY)).toBe("Wed 14");
    expect(daySpan("2026-10-14", "2026-10-15", TODAY)).toBe("Wed 14 – Thu 15");
    expect(daySpan("2026-10-12", "2026-10-12", TODAY)).toBe("Mon 12");
  });

  it("opens the calendar on a day (today: as it opens)", () => {
    expect(dayHref(TODAY, TODAY)).toBe("/calendar");
    expect(dayHref("2026-10-12", TODAY)).toBe("/calendar?date=2026-10-12");
    expect(SEE_THE_WEEK_HREF).toBe("/calendar?view=week");
  });
});

describe("leaveSpans: consecutive days of one person's leave are one span", () => {
  it("joins consecutive days of the same kind", () => {
    expect(
      leaveSpans(
        [off("anna", "2026-10-12"), off("anna", "2026-10-13"), off("anna", "2026-10-14")],
        {
          from: TODAY,
          to: "2026-10-15",
        },
      ),
    ).toEqual([{ memberId: "anna", kind: "leave", from: "2026-10-12", to: "2026-10-14" }]);
  });

  it("splits on a gap and on a change of kind", () => {
    expect(
      leaveSpans(
        [
          off("anna", "2026-10-12"),
          off("anna", "2026-10-14"),
          off("ravi", "2026-10-12", "half_day"),
          off("ravi", "2026-10-13", "leave"),
        ],
        { from: TODAY, to: "2026-10-15" },
      ),
    ).toEqual([
      { memberId: "anna", kind: "leave", from: "2026-10-12", to: "2026-10-12" },
      { memberId: "anna", kind: "leave", from: "2026-10-14", to: "2026-10-14" },
      { memberId: "ravi", kind: "half_day", from: "2026-10-12", to: "2026-10-12" },
      { memberId: "ravi", kind: "leave", from: "2026-10-13", to: "2026-10-13" },
    ]);
  });

  it("keeps approved leave only, inside the window", () => {
    expect(
      leaveSpans([off("anna", "2026-10-12", null), off("anna", "2026-10-20")], {
        from: TODAY,
        to: "2026-10-15",
      }),
    ).toEqual([]);
  });
});

describe("weekBlocks: the Owner's This week, a block per day (owner 2026-10-09)", () => {
  it("lists each day's rows under it: time left, words right; leave as one grouped row", () => {
    const { blocks, hidden } = weekBlocks({
      days: week({
        "2026-10-09": {
          due: 2,
          events: [
            { id: "f", title: "Fire Chandan 2.0", startAt: null },
            { id: "c", title: "cal test", startAt: "2026-10-09T06:19:00.000Z" },
          ],
        },
        "2026-10-10": { events: [{ id: "e", title: "Edit", startAt: null }] },
        "2026-10-12": { holiday: "Diwali" },
      }),
      leave: [off("prakyat", "2026-10-14"), off("prakyat", "2026-10-15")],
      nameOf,
      today: TODAY,
    });
    expect(text(blocks)).toEqual([
      "Today: All day Fire Chandan 2.0 | 11:49 am cal test | Due 2 tasks due",
      "Tomorrow: All day Edit",
      "Mon 12 Oct: All day Holiday: Diwali",
      "Wed 14 Oct: All day Prakyat on leave · Wed 14 – Thu 15",
    ]);
    expect(hidden).toBe(0);
    // An event opens its task; a holiday, a leave row and the deadlines open the calendar's day.
    expect(blocks[0]?.rows.map((row) => [row.kind, row.href])).toEqual([
      ["event", "/tasks/f"],
      ["event", "/tasks/c"],
      ["due", "/calendar"],
    ]);
    expect(blocks[3]?.rows[0]).toMatchObject({ kind: "leave", href: "/calendar?date=2026-10-14" });
  });

  it("leaves out the days with nothing, and never says a day's leave per day", () => {
    const { blocks } = weekBlocks({
      days: week({ "2026-10-13": { due: 1 } }),
      leave: [
        off("anna", "2026-10-12"),
        off("anna", "2026-10-13"),
        off("ravi", "2026-10-12", "half_day"),
      ],
      nameOf,
      today: TODAY,
    });
    expect(text(blocks)).toEqual([
      "Mon 12 Oct: All day Anna on leave · Mon 12 – Tue 13 | All day Ravi Kumar on a half day · Mon 12",
      "Tue 13 Oct: Due 1 task due",
    ]);
  });

  it("puts the holiday first, then leave, then the events, then the deadlines", () => {
    const { blocks } = weekBlocks({
      days: week({
        "2026-10-12": {
          holiday: "Diwali",
          due: 3,
          events: [{ id: "s", title: "Shoot", startAt: "2026-10-12T05:30:00.000Z" }],
        },
      }),
      leave: [off("asha", "2026-10-12", "comp_leave")],
      nameOf,
      today: TODAY,
    });
    expect(blocks[0]?.rows.map((row) => row.kind)).toEqual(["holiday", "leave", "event", "due"]);
    expect(text(blocks)).toEqual([
      "Mon 12 Oct: All day Holiday: Diwali | All day Asha on comp leave · Mon 12 | 11:00 am Shoot | Due 3 tasks due",
    ]);
  });

  it(`shows at most ${WEEK_DAYS_SHOWN} days and counts the rest`, () => {
    const { blocks, hidden } = weekBlocks({
      days: week(
        Object.fromEntries(
          ["09", "10", "11", "12", "13", "14", "15"].map((d) => [`2026-10-${d}`, { due: 1 }]),
        ),
      ),
      leave: [],
      nameOf,
      today: TODAY,
    });
    expect(blocks).toHaveLength(WEEK_DAYS_SHOWN);
    expect(blocks.map((block) => block.label)).toEqual([
      "Today",
      "Tomorrow",
      "Sun 11 Oct",
      "Mon 12 Oct",
      "Tue 13 Oct",
    ]);
    expect(hidden).toBe(2);
  });

  it(`shows at most ${WEEK_ROWS_SHOWN} rows, cutting inside a day when they run out`, () => {
    const events = (date: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${date}-${i}`,
        title: `Event ${i + 1}`,
        startAt: `${date}T0${i}:00:00.000Z`,
      }));
    const { blocks, hidden } = weekBlocks({
      days: week({
        "2026-10-09": { events: events("2026-10-09", 5) },
        "2026-10-10": { events: events("2026-10-10", 5) },
        "2026-10-11": { due: 1 },
      }),
      leave: [],
      nameOf,
      today: TODAY,
    });
    expect(blocks.map((block) => block.rows.length)).toEqual([5, 3]);
    expect(blocks.reduce((sum, block) => sum + block.rows.length, 0)).toBe(WEEK_ROWS_SHOWN);
    expect(hidden).toBe(3);
  });

  it("is empty when the week holds nothing", () => {
    expect(weekBlocks({ days: week(), leave: [], nameOf, today: TODAY })).toEqual({
      blocks: [],
      hidden: 0,
    });
    expect(weekBlocks({ days: [], leave: [off("anna", TODAY)], nameOf, today: TODAY })).toEqual({
      blocks: [],
      hidden: 0,
    });
  });
});
