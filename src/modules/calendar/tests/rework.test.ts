import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import type { CalendarDay, EventItem, LeaveItem } from "../domain/calendar";
import {
  directionOf,
  grow,
  handleLabel,
  handleNext,
  OPENING_SIZE,
  shrink,
  sizeAfter,
  stepDate,
  swipeOf,
} from "../domain/size";
import {
  allStrips,
  compactBars,
  dayLabel,
  dayStrips,
  dueBadge,
  eventStripText,
  HOLIDAY_COLOR,
} from "../domain/strips";
import { allDayEvents, minutesInDay, openingMinute, placeBlocks } from "../domain/timeline";
import { busyWindow, whoFreeLine, whoIsFree } from "../domain/who-free";

/**
 * The calendar rework's rules (6.4b; Kickoff 6 decision 25): the month boxes' strips by priority,
 * the corner counts and the compact bars; "Who's free"; the phone's three sizes and its swipes;
 * the hour timelines' layout.
 */

const TODAY = "2026-10-08";
const BLUE = "#2563eb";
const VIOLET = "#7c3aed";

function day(patch: Partial<CalendarDay> = {}): CalendarDay {
  return {
    date: TODAY,
    holiday: null,
    weeklyOff: false,
    leave: [],
    events: [],
    busy: [],
    due: [],
    items: [],
    ...patch,
  };
}

function event(id: string, patch: Partial<EventItem> = {}): EventItem {
  return {
    kind: "event",
    id,
    title: `Event ${id}`,
    date: TODAY,
    startAt: istInstant(TODAY, "10:00"),
    endAt: istInstant(TODAY, "11:00"),
    location: null,
    clientName: null,
    typeName: "Shoot / Site Visit",
    color: BLUE,
    rank: 1,
    completed: false,
    people: [],
    ...patch,
  };
}

function off(memberId: string, name: string, patch: Partial<LeaveItem> = {}): LeaveItem {
  return {
    kind: "leave",
    memberId,
    name,
    date: TODAY,
    label: "Leave",
    half: false,
    pending: false,
    own: false,
    ...patch,
  };
}

const busy = (memberId: string, name: string, from: string, to: string) => ({
  kind: "busy" as const,
  memberId,
  name,
  date: TODAY,
  startAt: istInstant(TODAY, from),
  endAt: istInstant(TODAY, to),
});

describe("the month's strips (decision 25 C, amended by the owner 2026-10-08)", () => {
  const dueOn = (date: string) => [
    {
      kind: "due" as const,
      id: `t-${date}`,
      title: "Edit",
      dueAt: istInstant(date, "18:00"),
      owner: "Ravi",
    },
  ];

  it("orders events › the tasks' count › holiday › others busy › one leave line, at most three then +N", () => {
    const full = day({
      holiday: "Dussehra",
      events: [
        event("meet", { title: "Client call", rank: 2, color: VIOLET }),
        event("shoot", { title: "Brand reel", rank: 1 }),
      ],
      due: dueOn(TODAY),
      busy: [busy("r", "Ravi Kumar", "09:00", "10:00"), busy("r", "Ravi Kumar", "14:00", "15:00")],
      leave: [off("a", "Asha Rao"), off("b", "Meera N")],
    });
    expect(allStrips(full, TODAY).map((strip) => `${strip.kind}:${strip.label}`)).toEqual([
      "event:Brand reel",
      "event:Client call",
      "tasks:1 due",
      "holiday:Dussehra",
      "busy:Ravi busy",
      "leave:2 off",
    ]);
    // The box keeps what the Owner acts on: leave is cut first and "+N" counts it; a holiday cut
    // for space turns the date number green.
    const shown = dayStrips(full, TODAY);
    expect(shown.strips.map((strip) => strip.kind)).toEqual(["event", "event", "tasks"]);
    expect(shown.more).toBe(3);
    expect(shown.holidayHidden).toBe(true);
    expect(dayStrips(day({ holiday: "Diwali", leave: [off("a", "Asha")] }), TODAY)).toEqual({
      strips: [
        { kind: "holiday", key: "holiday", label: "Diwali" },
        { kind: "leave", key: "leave", label: "Asha", spoken: "Asha off", pending: false },
      ],
      more: 0,
      holidayHidden: false,
    });
  });

  it("gives leave one line a day: the first name for one person, a count for several", () => {
    expect(allStrips(day({ leave: [off("a", "Asha Rao", { half: true })] }), TODAY)).toEqual([
      { kind: "leave", key: "leave", label: "Asha", spoken: "Asha off, half day", pending: false },
    ]);
    expect(
      allStrips(
        day({ leave: [off("a", "Asha"), off("b", "Ravi"), off("a", "Asha", { half: true })] }),
        TODAY,
      ),
    ).toEqual([{ kind: "leave", key: "leave", label: "2 off", spoken: "2 off", pending: false }]);
    expect(
      allStrips(day({ leave: [off("m", "Me", { own: true, pending: true })] }), TODAY),
    ).toEqual([{ kind: "leave", key: "leave", label: "You", spoken: "You off", pending: true }]);
  });

  it("puts the time and the client on a laptop's strip; never a red colour of its own", () => {
    expect(eventStripText(event("e", { title: "Brand reel", clientName: "Acme" }))).toBe(
      "10:00 Brand reel · Acme",
    );
    expect(eventStripText(event("e", { title: "Posting", startAt: null }))).toBe("Posting");
    for (const strip of allStrips(day({ holiday: "Diwali", events: [event("e")] }), TODAY)) {
      if (strip.kind === "event") expect(strip.color).toBe(BLUE);
    }
    expect(HOLIDAY_COLOR).toBe("#16a34a");
  });

  it("counts the tasks: amber due, red overdue on a past day, nothing when none", () => {
    expect(dueBadge(day({ due: dueOn(TODAY) }), TODAY)).toEqual({
      tone: "due",
      count: 1,
      label: "1 due",
    });
    const past = day({ date: "2026-10-07", due: dueOn("2026-10-07") });
    expect(dueBadge(past, TODAY)).toEqual({ tone: "overdue", count: 1, label: "1 overdue" });
    expect(allStrips(past, TODAY)).toEqual([
      { kind: "tasks", key: "tasks", tone: "overdue", count: 1, label: "1 overdue" },
    ]);
    expect(dueBadge(day(), TODAY)).toBeNull();
  });

  it("draws the compact month as one bar per kind present, no text, in the strips' order", () => {
    expect(
      compactBars(
        day({
          holiday: "Diwali",
          events: [event("a", { color: VIOLET, rank: 2 }), event("b", { rank: 1 })],
          leave: [off("a", "Asha")],
        }),
      ),
    ).toEqual([
      { kind: "event", color: BLUE },
      { kind: "holiday", color: HOLIDAY_COLOR },
      { kind: "leave", color: null },
    ]);
    expect(compactBars(day())).toEqual([]);
  });

  it("tells a screen reader what the box holds", () => {
    expect(
      dayLabel(day({ weeklyOff: true, leave: [off("a", "Asha", { pending: true })] }), TODAY),
    ).toBe("Thursday 8 October, today, weekly off, Asha off, requested");
  });
});

describe("who's free (decision 25 D)", () => {
  const people = [
    { id: "a", name: "Asha" },
    { id: "k", name: "Kiran" },
    { id: "m", name: "Meera" },
    { id: "r", name: "Ravi" },
    { id: "z", name: "Zoya (freelancer)" },
  ];
  const ev = (id: string, assignees: string[], from: string | null, to: string | null) => ({
    id,
    title: id,
    state: "assigned",
    eventDate: TODAY,
    eventStartAt: from ? istInstant(TODAY, from) : null,
    eventEndAt: to ? istInstant(TODAY, to) : null,
    location: null,
    clientId: null,
    taskTypeId: "t",
    primaryOwnerId: assignees[0] ?? "a",
    assigneeIds: assignees,
  });

  it("the Owner: free, busy grouped by the same time, on leave (half day marked), from everything", () => {
    const who = whoIsFree({
      date: TODAY,
      scope: "owner",
      viewerId: "owner",
      people,
      events: [ev("shoot", ["k", "z"], "10:00", "13:00"), ev("call", ["r"], "14:30", null)],
      leave: [
        { memberId: "m", type: "half_day", startDate: TODAY, endDate: TODAY, pending: false },
        { memberId: "a", type: "leave", startDate: TODAY, endDate: TODAY, pending: true },
      ],
      availability: null,
    });
    expect(who).toEqual({
      free: ["Asha"],
      busy: [
        { when: "10–1", names: ["Kiran", "Zoya (freelancer)"] },
        { when: "2:30–3:30", names: ["Ravi"] },
      ],
      onLeave: ["Meera (½)"],
    });
    expect(whoFreeLine(who!)).toBe(
      "Who's free: Asha · Busy 10–1: Kiran, Zoya (freelancer) · Busy 2:30–3:30: Ravi · On leave: Meera (½)",
    );
  });

  it("an Admin: their own in full, everyone else through availability only (no title, no pending)", () => {
    const who = whoIsFree({
      date: TODAY,
      scope: "admin",
      viewerId: "a",
      people,
      // The Admin's own date-only shoot; someone else's timed event they can see is taken from
      // availability instead, so it is never counted twice.
      events: [ev("own", ["a"], null, null), ev("seen", ["k"], "10:00", "11:00")],
      leave: [],
      availability: [
        {
          memberId: "k",
          day: TODAY,
          leave: null,
          blocks: [{ startAt: istInstant(TODAY, "10:00"), endAt: istInstant(TODAY, "11:00") }],
        },
        { memberId: "r", day: TODAY, leave: "leave", blocks: [] },
        { memberId: "m", day: "2026-10-09", leave: "leave", blocks: [] },
      ],
    });
    expect(who).toEqual({
      free: ["Meera", "Zoya (freelancer)"],
      busy: [
        { when: "all day", names: ["Asha"] },
        { when: "10–11", names: ["Kiran"] },
      ],
      onLeave: ["Ravi"],
    });
  });

  it("Crew have none; an empty day says so", () => {
    expect(
      whoIsFree({
        date: TODAY,
        scope: "staff",
        viewerId: "a",
        people,
        events: [],
        leave: [],
        availability: null,
      }),
    ).toBeNull();
    expect(whoFreeLine({ free: ["Asha", "Ravi"], busy: [], onLeave: [] })).toBe(
      "Who's free: Asha, Ravi",
    );
    expect(
      whoFreeLine({ free: [], busy: [{ when: "all day", names: ["Kiran"] }], onLeave: [] }),
    ).toBe("Who's free: nobody · Busy all day: Kiran");
    expect(busyWindow({ startAt: istInstant(TODAY, "09:15"), endAt: null })).toBe("9:15–10:15");
  });
});

describe("the phone's three sizes (decision 25 A)", () => {
  it("opens on the compact month; swipes down grow, up shrink, within 1..3", () => {
    expect(OPENING_SIZE).toBe(2);
    expect([grow(1), grow(2), grow(3)]).toEqual([2, 3, 3]);
    expect([shrink(1), shrink(2), shrink(3)]).toEqual([1, 1, 2]);
    expect(sizeAfter(2, "down")).toBe(3);
    expect(sizeAfter(2, "up")).toBe(1);
    expect(sizeAfter(2, "left")).toBe(2);
  });

  it("the handle reaches every size in turn and says what it does", () => {
    expect([handleNext(1), handleNext(2), handleNext(3)]).toEqual([2, 3, 1]);
    expect(handleLabel(1)).toBe("Show more of the month");
    expect(handleLabel(2)).toBe("Show more of the month");
    expect(handleLabel(3)).toBe("Show less");
  });

  it("tells a swipe from a tap, by its longer axis", () => {
    expect(swipeOf(5, 8)).toBeNull();
    expect(swipeOf(10, 80)).toBe("down");
    expect(swipeOf(-3, -60)).toBe("up");
    expect(swipeOf(-90, 20)).toBe("left");
    expect(swipeOf(90, -20)).toBe("right");
    expect(directionOf("left")).toBe(1);
    expect(directionOf("right")).toBe(-1);
    expect(directionOf("up")).toBeNull();
  });

  it("moves a week at the week size and a month otherwise, keeping the day of the month", () => {
    expect(stepDate("2026-10-08", 1, 1, TODAY)).toBe("2026-10-15");
    expect(stepDate("2026-10-31", 2, 1, TODAY)).toBe("2026-11-30");
    expect(stepDate("2026-11-30", 3, -1, TODAY)).toBe(TODAY);
    expect(stepDate("2026-01-31", 2, 1, TODAY)).toBe("2026-02-28");
    expect(stepDate("2026-12-15", 2, 1, TODAY)).toBe("2027-01-15");
  });
});

describe("the hour timelines (decision 25 E)", () => {
  it("places blocks at their IST minutes, an hour with no end, overlapping ones side by side", () => {
    const placed = placeBlocks(
      day({
        events: [
          event("a", { startAt: istInstant(TODAY, "10:00"), endAt: istInstant(TODAY, "12:00") }),
          event("b", { startAt: istInstant(TODAY, "11:00"), endAt: null }),
          event("c", { startAt: istInstant(TODAY, "13:00"), endAt: istInstant(TODAY, "13:05") }),
          event("d", { startAt: null, endAt: null }),
        ],
        busy: [busy("r", "Ravi", "16:00", "17:30")],
      }),
    );
    expect(
      placed.map((block) => [
        block.item.kind === "event" ? block.item.id : "busy",
        block.start,
        block.end,
        block.column,
        block.columns,
      ]),
    ).toEqual([
      ["a", 600, 720, 0, 2],
      ["b", 660, 720, 1, 2],
      ["c", 780, 795, 0, 1],
      ["busy", 960, 1050, 0, 1],
    ]);
    expect(allDayEvents(day({ events: [event("d", { startAt: null })] })).map((e) => e.id)).toEqual(
      ["d"],
    );
  });

  it("clamps an event crossing midnight to the day, and opens at now on today, else 08:00", () => {
    expect(minutesInDay(istInstant("2026-10-09", "01:00"), TODAY)).toBe(1440);
    expect(minutesInDay(istInstant("2026-10-07", "23:00"), TODAY)).toBe(0);
    expect(openingMinute(TODAY, TODAY, 15 * 60)).toBe(14 * 60);
    expect(openingMinute("2026-10-09", TODAY, 15 * 60)).toBe(8 * 60);
    expect(openingMinute(TODAY, TODAY, 30)).toBe(0);
  });
});
