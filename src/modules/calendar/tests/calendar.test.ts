import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import {
  addMonths,
  buildCalendar,
  type CalendarInput,
  type CalendarQuery,
  calendarHref,
  dayHeading,
  dayWord,
  dueWords,
  eventWords,
  filterKinds,
  hasFilters,
  isEmptyDay,
  monthEnd,
  monthGrid,
  monthLabel,
  parseCalendarQuery,
  rangeFor,
  scopeFor,
  shifted,
  timeWords,
  weekLabel,
  weekOf,
} from "../domain/calendar";

const TODAY = "2026-10-07"; // a Wednesday
const WEEK = { from: "2026-10-05", to: "2026-10-11" };

const query = (patch: Partial<CalendarQuery> = {}): CalendarQuery => ({
  view: null,
  date: TODAY,
  client: null,
  person: null,
  type: null,
  status: "all",
  ...patch,
});

const SHOOT = "11111111-1111-4111-8111-111111111111";
const NORMAL = "22222222-2222-4222-8222-222222222222";
const HIDDEN = "33333333-3333-4333-8333-333333333333";
const CLIENT = "44444444-4444-4444-8444-444444444444";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RAVI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASHA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function input(patch: Partial<CalendarInput> = {}): CalendarInput {
  return {
    range: WEEK,
    scope: "owner",
    viewerId: ME,
    query: query(),
    events: [],
    openTasks: [],
    types: [
      { id: SHOOT, name: "Shoot", showsOnCalendar: true, color: "#2563eb" },
      { id: NORMAL, name: "Normal", showsOnCalendar: false, color: "#0284c7" },
      { id: HIDDEN, name: "Quiet event", showsOnCalendar: false, color: "#7c3aed" },
    ],
    clients: [{ id: CLIENT, name: "Acme" }],
    people: [
      { id: ME, name: "Me", engagement: "permanent" },
      { id: RAVI, name: "Ravi", engagement: "permanent" },
      { id: ASHA, name: "Asha", engagement: "freelance" },
    ],
    holidays: [{ date: "2026-10-09", name: "Dussehra" }],
    weeklyOffDays: [0],
    leave: [],
    availability: null,
    ...patch,
  };
}

const shoot = (
  id: string,
  date: string,
  start: string | null,
  patch: Partial<CalendarInput["events"][number]> = {},
): CalendarInput["events"][number] => ({
  id,
  title: `Shoot ${id}`,
  state: "assigned",
  eventDate: date,
  eventStartAt: start ? istInstant(date, start) : null,
  eventEndAt: null,
  location: null,
  clientId: CLIENT,
  taskTypeId: SHOOT,
  primaryOwnerId: RAVI,
  assigneeIds: [RAVI],
  ...patch,
});

describe("the address", () => {
  it("reads the view, the day and the filters, and falls back quietly", () => {
    expect(parseCalendarQuery({}, TODAY)).toEqual(query());
    expect(
      parseCalendarQuery(
        {
          view: "month",
          date: "2026-11-02",
          client: CLIENT,
          person: RAVI,
          type: SHOOT,
          status: "open",
        },
        TODAY,
      ),
    ).toEqual(
      query({
        view: "month",
        date: "2026-11-02",
        client: CLIENT,
        person: RAVI,
        type: SHOOT,
        status: "open",
      }),
    );
    expect(
      parseCalendarQuery({ view: "year", date: "yesterday", client: "x", status: ["nope"] }, TODAY),
    ).toEqual(query());
  });

  it("writes only what differs from the default", () => {
    expect(calendarHref(query(), TODAY)).toBe("/calendar");
    expect(calendarHref(query({ view: "week" }), TODAY)).toBe("/calendar?view=week");
    expect(calendarHref(query({ date: "2026-10-09", status: "done" }), TODAY)).toBe(
      "/calendar?date=2026-10-09&status=done",
    );
    expect(hasFilters(query())).toBe(false);
    expect(hasFilters(query({ type: SHOOT }))).toBe(true);
  });
});

describe("ranges", () => {
  it("knows the IST week (Monday to Sunday) and the month's grid", () => {
    expect(weekOf(TODAY)).toEqual(WEEK);
    expect(weekOf("2026-10-11")).toEqual(WEEK);
    expect(weekOf("2026-10-12")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    const grid = monthGrid("2026-10-20");
    expect(grid.month).toBe("2026-10-01");
    expect(grid.from).toBe("2026-09-28");
    expect(grid.to).toBe("2026-11-01");
    expect(grid.weeks).toHaveLength(5);
    expect(grid.weeks[0]?.[0]).toBe("2026-09-28");
    expect(grid.weeks[4]?.[6]).toBe("2026-11-01");
    expect(monthGrid("2026-02-10").weeks).toHaveLength(5);
    expect(monthEnd("2026-02-01")).toBe("2026-02-28");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });

  it("reads the month's grid for every view (decision 25: one read serves them all), and steps by the view", () => {
    const grid = { from: "2026-09-28", to: "2026-11-01" };
    expect(rangeFor(query())).toEqual(grid);
    expect(rangeFor(query({ view: "day" }))).toEqual(grid);
    expect(rangeFor(query({ view: "week" }))).toEqual(grid);
    expect(rangeFor(query({ view: "month" }))).toEqual(grid);
    // A week is always inside its month's grid, at the month's edges too.
    for (const date of ["2026-10-01", "2026-10-31", "2026-02-01", "2026-03-31"]) {
      const range = rangeFor(query({ date }));
      expect(weekOf(date).from >= range.from && weekOf(date).to <= range.to).toBe(true);
    }
    expect(shifted(query({ view: "day" }), 1).date).toBe("2026-10-08");
    expect(shifted(query({ view: "week" }), -1).date).toBe("2026-09-30");
    expect(shifted(query(), 1).date).toBe("2026-10-14");
    expect(shifted(query({ view: "month", date: "2026-10-20" }), 1).date).toBe("2026-11-01");
  });
});

describe("what a day holds", () => {
  it("puts event tasks on their day in time order, muted when completed, never a hidden type", () => {
    const days = buildCalendar(
      input({
        events: [
          shoot("b", TODAY, "14:00"),
          shoot("a", TODAY, "10:00", { state: "completed" }),
          shoot("c", TODAY, null),
          shoot("d", TODAY, "09:00", { taskTypeId: HIDDEN }),
          shoot("e", "2026-10-20", "09:00"),
        ],
      }),
    );
    const today = days.find((day) => day.date === TODAY);
    expect(days.map((day) => day.date)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(today?.events.map((event) => [event.id, event.completed])).toEqual([
      ["c", false],
      ["a", true],
      ["b", false],
    ]);
    expect(today?.events[1]).toMatchObject({
      clientName: "Acme",
      typeName: "Shoot",
      people: ["Ravi"],
      endAt: istInstant(TODAY, "11:00"),
    });
    expect(days.find((day) => day.date === "2026-10-09")?.holiday).toBe("Dussehra");
    expect(days.find((day) => day.date === "2026-10-11")?.weeklyOff).toBe(true);
  });

  it("lists other open tasks as Due on their deadline's day, a shown event never twice", () => {
    const days = buildCalendar(
      input({
        events: [shoot("a", TODAY, "10:00")],
        openTasks: [
          {
            id: "a",
            title: "Shoot a",
            dueAt: istInstant(TODAY, "18:00"),
            clientId: CLIENT,
            taskTypeId: SHOOT,
            primaryOwnerId: RAVI,
            assigneeIds: [RAVI],
          },
          {
            id: "n",
            title: "Edit the reel",
            dueAt: istInstant(TODAY, "18:00"),
            clientId: null,
            taskTypeId: NORMAL,
            primaryOwnerId: ASHA,
            assigneeIds: [ASHA],
          },
          {
            id: "q",
            title: "Quiet event",
            dueAt: istInstant("2026-10-08", "09:00"),
            clientId: null,
            taskTypeId: HIDDEN,
            primaryOwnerId: RAVI,
            assigneeIds: [RAVI],
          },
        ],
      }),
    );
    expect(days.find((day) => day.date === TODAY)?.due).toEqual([
      {
        kind: "due",
        id: "n",
        title: "Edit the reel",
        dueAt: istInstant(TODAY, "18:00"),
        owner: "Asha (freelancer)",
      },
    ]);
    expect(days.find((day) => day.date === "2026-10-08")?.due.map((d) => d.id)).toEqual(["q"]);
  });

  it("filters by client, person, type and status; Due follows the filters and hides on Completed", () => {
    const base = input({
      events: [
        shoot("a", TODAY, "10:00"),
        shoot("b", TODAY, "11:00", { clientId: null, assigneeIds: [ME], state: "completed" }),
      ],
      openTasks: [
        {
          id: "n",
          title: "Edit",
          dueAt: istInstant(TODAY, "18:00"),
          clientId: null,
          taskTypeId: NORMAL,
          primaryOwnerId: ME,
          assigneeIds: [ME],
        },
      ],
    });
    const ids = (q: Partial<CalendarQuery>) => {
      const day = buildCalendar({ ...base, query: query(q) }).find((d) => d.date === TODAY);
      return { events: day?.events.map((e) => e.id), due: day?.due.map((d) => d.id) };
    };
    expect(ids({ client: CLIENT })).toEqual({ events: ["a"], due: [] });
    expect(ids({ person: ME })).toEqual({ events: ["b"], due: ["n"] });
    expect(ids({ type: NORMAL })).toEqual({ events: [], due: ["n"] });
    expect(ids({ status: "open" })).toEqual({ events: ["a"], due: ["n"] });
    expect(ids({ status: "done" })).toEqual({ events: ["b"], due: [] });
  });

  it("expands leave over its days with the type, pending marked, own flagged", () => {
    const days = buildCalendar(
      input({
        leave: [
          {
            memberId: RAVI,
            type: "leave",
            startDate: "2026-10-01",
            endDate: "2026-10-06",
            pending: false,
          },
          { memberId: ME, type: "half_day", startDate: TODAY, endDate: TODAY, pending: true },
        ],
      }),
    );
    expect(days.find((day) => day.date === "2026-10-05")?.leave).toEqual([
      {
        kind: "leave",
        memberId: RAVI,
        name: "Ravi",
        date: "2026-10-05",
        label: "Leave",
        half: false,
        pending: false,
        own: false,
      },
    ]);
    expect(days.find((day) => day.date === TODAY)?.leave).toEqual([
      {
        kind: "leave",
        memberId: ME,
        name: "Me",
        date: TODAY,
        label: "Half day",
        half: true,
        pending: true,
        own: true,
      },
    ]);
    expect(days.find((day) => day.date === "2026-10-08")?.leave).toEqual([]);
  });

  it("an Admin sees others as Busy blocks and On leave / Half day, never a pending request, never an event twice", () => {
    const seen = shoot("a", TODAY, "10:00");
    const days = buildCalendar(
      input({
        scope: "admin",
        query: query(),
        events: [seen],
        leave: [{ memberId: ME, type: "leave", startDate: TODAY, endDate: TODAY, pending: true }],
        availability: [
          {
            memberId: RAVI,
            day: TODAY,
            leave: null,
            blocks: [
              { startAt: istInstant(TODAY, "10:00"), endAt: istInstant(TODAY, "11:00") },
              { startAt: istInstant(TODAY, "15:00"), endAt: null },
            ],
          },
          { memberId: ASHA, day: TODAY, leave: "comp_leave", blocks: [] },
          { memberId: ASHA, day: "2026-10-08", leave: "requested", blocks: [] },
          { memberId: ASHA, day: "2026-10-09", leave: "half_day", blocks: [] },
          // The Admin's own row: their own leave and events come from their own reads.
          {
            memberId: ME,
            day: TODAY,
            leave: "leave",
            blocks: [{ startAt: istInstant(TODAY, "09:00"), endAt: null }],
          },
        ],
      }),
    );
    const today = days.find((day) => day.date === TODAY);
    expect(today?.events.map((e) => e.id)).toEqual(["a"]);
    expect(today?.busy).toEqual([
      {
        kind: "busy",
        memberId: RAVI,
        name: "Ravi",
        date: TODAY,
        startAt: istInstant(TODAY, "15:00"),
        endAt: istInstant(TODAY, "16:00"),
      },
    ]);
    expect(today?.leave.map((l) => [l.name, l.label, l.pending, l.own])).toEqual([
      ["Asha (freelancer)", "On leave", false, false],
      ["Me", "Leave", true, true],
    ]);
    expect(days.find((day) => day.date === "2026-10-08")?.leave).toEqual([]);
    expect(days.find((day) => day.date === "2026-10-09")?.leave.map((l) => l.label)).toEqual([
      "Half day",
    ]);
  });

  it("the Owner and Crew never read availability, even when handed some", () => {
    const rows = [
      {
        memberId: RAVI,
        day: TODAY,
        leave: "leave",
        blocks: [{ startAt: istInstant(TODAY, "10:00"), endAt: null }],
      },
    ];
    for (const scope of ["owner", "staff"] as const) {
      const today = buildCalendar(input({ scope, availability: rows })).find(
        (d) => d.date === TODAY,
      );
      expect(today?.busy).toEqual([]);
      expect(today?.leave).toEqual([]);
    }
  });

  it("knows an empty day", () => {
    const days = buildCalendar(input());
    expect(isEmptyDay(days[2]!)).toBe(true);
    expect(isEmptyDay(days[4]!)).toBe(false); // the holiday
    expect(isEmptyDay(days[6]!)).toBe(false); // the weekly off
  });
});

describe("words and scopes", () => {
  it("names days, times, weeks and months in IST", () => {
    expect(dayWord(TODAY, TODAY)).toBe("Today");
    expect(dayWord("2026-10-08", TODAY)).toBe("Tomorrow");
    expect(dayWord("2026-10-06", TODAY)).toBe("Yesterday");
    expect(dayWord("2026-10-09", TODAY)).toBe("Fri 9 Oct");
    expect(dayHeading(TODAY, TODAY)).toBe("Today · Wed 7 Oct 2026");
    expect(dayHeading("2026-10-09", TODAY)).toBe("Fri 9 Oct 2026");
    expect(timeWords(null, null)).toBe("All day");
    expect(timeWords(istInstant(TODAY, "10:00"), null)).toBe("10:00 am");
    expect(timeWords(istInstant(TODAY, "10:00"), istInstant(TODAY, "11:30"))).toBe(
      "10:00 am – 11:30 am",
    );
    expect(weekLabel(WEEK)).toBe("5 – 11 Oct 2026");
    expect(weekLabel({ from: "2026-09-28", to: "2026-10-04" })).toBe("28 Sep – 4 Oct 2026");
    expect(monthLabel("2026-10-01")).toBe("October 2026");
    expect(dueWords(1)).toBe("1 due");
    expect(eventWords(1)).toBe("1 event");
    expect(eventWords(3)).toBe("3 events");
  });

  it("gives the Owner and Admins every filter, Crew the type only", () => {
    expect(filterKinds("owner")).toEqual(["client", "person", "type", "status"]);
    expect(filterKinds("admin")).toEqual(["client", "person", "type", "status"]);
    expect(filterKinds("staff")).toEqual(["type"]);
    expect(scopeFor({ viewAll: true, availability: true })).toBe("owner");
    expect(scopeFor({ viewAll: false, availability: true })).toBe("admin");
    expect(scopeFor({ viewAll: false, availability: false })).toBe("staff");
  });
});
