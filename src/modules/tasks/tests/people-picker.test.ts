import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import {
  bookingLine,
  chosenLine,
  chosenOwnerLine,
  pickerCount,
  type PickerInput,
  pickerList,
  type PickerList,
  pickerRowOf,
  pickerSubtitle,
  searchPicker,
} from "../domain/people-picker";
import { type AvailabilityDay, type EventBlock, eventWindow } from "../domain/warnings";

const DAY = "2026-11-14";
const VIEWER = "nikhil";
const OWNER = "owner";

const PEOPLE = [
  { id: "arjun", name: "Arjun Mehta" },
  { id: "asha", name: "Asha Rao" },
  { id: "kiran", name: "Kiran Das" },
  { id: "meera", name: "Meera Iyer" },
  { id: OWNER, name: "Prishit Shetty" },
  { id: "zed", name: "Zed Freelance" },
];

function at(time: string): string {
  return istInstant(DAY, time);
}

function block(start: string | null, end: string | null, extra: Partial<EventBlock> = {}) {
  return {
    startAt: start ? at(start) : null,
    endAt: end ? at(end) : null,
    typeName: "Shoot",
    bookedById: "sana",
    bookedByName: "Sana Khan",
    ...extra,
  } satisfies EventBlock;
}

function day(memberId: string, overrides: Partial<AvailabilityDay> = {}): AvailabilityDay {
  return { memberId, day: DAY, openTasksDue: 0, eventBlocks: [], leave: null, ...overrides };
}

/** The new event: 3:00 pm – 5:00 pm IST on 14 Nov. */
const WINDOW = eventWindow(at("15:00"), at("17:00"));

function event(
  rows: AvailabilityDay[],
  extra: Partial<PickerInput> = {},
): Extract<PickerList, { kind: "event" }> {
  const list = pickerList({
    people: PEOPLE,
    when: { kind: "event", date: DAY, window: WINDOW },
    availability: rows,
    viewerId: VIEWER,
    ownerId: OWNER,
    ...extra,
  });
  if (list.kind !== "event") throw new Error("an event's list has two groups");
  return list;
}

const everyone = (overrides: Record<string, Partial<AvailabilityDay>> = {}) =>
  PEOPLE.map((person) => day(person.id, overrides[person.id]));

describe("Who's on it? for an event (v6.0): Free then and Busy then", () => {
  it("free: everyone with nothing that day, in the order given; the Owner offered, never Free", () => {
    const list = event(everyone());
    expect(list.busy).toEqual([]);
    expect(list.free.map((row) => row.memberId)).toEqual(
      PEOPLE.filter((person) => person.id !== OWNER).map((person) => person.id),
    );
    expect(list.free[0]).toEqual({
      memberId: "arjun",
      name: "Arjun Mehta",
      lines: ["Free"],
      chips: [],
      short: "Free",
    });
    // The Owner may be on a task (6b.2), so the Owner is offered, but is never listed as Free
    // (PERMISSIONS §2, v6.0): in their own group after Busy then, with no line and no word.
    expect(list.owner).toEqual([
      { memberId: OWNER, name: "Prishit Shetty", lines: [], chips: [], short: "" },
    ]);
  });

  it("the Owner: busy when a booking clashes, else in the Owner group with only what else is on", () => {
    const busy = event(
      everyone({ [OWNER]: { eventBlocks: [block("14:00", "16:00", { bookedById: VIEWER })] } }),
    );
    expect(busy.busy.map((row) => row.memberId)).toEqual([OWNER]);
    expect(busy.owner).toEqual([]);
    expect(pickerRowOf(busy, OWNER)).toMatchObject({
      lines: ["Shoot 2:00 pm – 4:00 pm · booked by you"],
      chips: ["clashes"],
      short: "Clashes",
    });
    const around = event(
      everyone({
        [OWNER]: {
          eventBlocks: [
            block("11:00", "13:00", { typeName: "Site visit", bookedById: OWNER }),
            block("18:00", "19:00", { typeName: "Meeting" }),
          ],
        },
      }),
    );
    expect(around.owner).toEqual([
      {
        memberId: OWNER,
        name: "Prishit Shetty",
        lines: [
          "Earlier: Site visit 11:00 am – 1:00 pm · booked by Owner",
          "Later: Meeting 6:00 pm – 7:00 pm · booked by Sana Khan",
        ],
        chips: [],
        short: "",
      },
    ]);
    // No answer for the Owner: still in the Owner group, never under Free then.
    const partial = event([day("asha")]);
    expect(partial.owner.map((row) => row.memberId)).toEqual([OWNER]);
    expect(partial.free.some((row) => row.memberId === OWNER)).toBe(false);
    // Find a person keeps the Owner's group.
    expect(searchPicker(around, "prishit")).toMatchObject({
      free: [],
      busy: [],
      owner: [{ memberId: OWNER }],
    });
    expect(pickerCount(around)).toBe(PEOPLE.length);
  });

  it("free with an earlier or a later booking: said, with its type, time and who booked it", () => {
    const list = event(
      everyone({
        asha: {
          eventBlocks: [
            block("11:00", "13:00", { typeName: "Site visit", bookedById: OWNER }),
            block("18:00", "19:00", { typeName: "Meeting", bookedById: VIEWER }),
          ],
        },
      }),
    );
    expect(pickerRowOf(list, "asha")).toEqual({
      memberId: "asha",
      name: "Asha Rao",
      lines: [
        "Free · earlier: Site visit 11:00 am – 1:00 pm · booked by Owner",
        "Later: Meeting 6:00 pm – 7:00 pm · booked by you",
      ],
      chips: [],
      short: "Free",
    });
    expect(list.free.some((row) => row.memberId === "asha")).toBe(true);
    // A booking that ends as this one starts does not clash.
    const edge = event(everyone({ asha: { eventBlocks: [block("14:00", "15:00")] } }));
    expect(pickerRowOf(edge, "asha")?.lines).toEqual([
      "Free · earlier: Shoot 2:00 pm – 3:00 pm · booked by Sana Khan",
    ]);
  });

  it("a timed clash: under Busy then, with the Clashes chip, naming who booked it in full", () => {
    const list = event(
      everyone({
        asha: {
          eventBlocks: [
            block("14:00", "16:00", { bookedById: "n2", bookedByName: " Nikhil  Rao " }),
          ],
        },
        kiran: { eventBlocks: [block("16:30", null, { typeName: "Meeting", bookedById: VIEWER })] },
      }),
    );
    expect(list.busy.map((row) => row.memberId)).toEqual(["asha", "kiran"]);
    expect(pickerRowOf(list, "asha")).toMatchObject({
      lines: ["Shoot 2:00 pm – 4:00 pm · booked by Nikhil Rao"],
      chips: ["clashes"],
      short: "Clashes",
    });
    // No end is an hour (the busy rule).
    expect(pickerRowOf(list, "kiran")?.lines).toEqual([
      "Meeting 4:30 pm – 5:30 pm · booked by you",
    ]);
    expect(list.free.some((row) => row.memberId === "asha")).toBe(false);
  });

  it("an all-day clash, both ways: a date-only booking, and a new event with no time", () => {
    const allDay = event(
      everyone({ meera: { eventBlocks: [block(null, null, { bookedById: VIEWER })] } }),
    );
    expect(pickerRowOf(allDay, "meera")).toMatchObject({
      lines: ["Shoot all day · booked by you"],
      chips: ["clashes"],
    });
    expect(allDay.busy.map((row) => row.memberId)).toEqual(["meera"]);
    // The new event has no time: it is busy all day, so any booking that day clashes.
    const dateOnly = event(everyone({ asha: { eventBlocks: [block("09:00", "10:00")] } }), {
      when: { kind: "event", date: DAY, window: null },
    });
    expect(pickerRowOf(dateOnly, "asha")).toMatchObject({
      lines: ["Shoot 9:00 am – 10:00 am · booked by Sana Khan"],
      chips: ["clashes"],
    });
    expect(dateOnly.free.some((row) => row.memberId === "asha")).toBe(false);
  });

  it("leave: a half day stays free, a full day is busy with On leave, a request stays free", () => {
    const list = event(
      everyone({
        arjun: { leave: "half_day" },
        asha: { leave: "leave" },
        kiran: { leave: "requested" },
        meera: { leave: "comp_leave" },
      }),
    );
    expect(list.free.map((row) => row.memberId)).toEqual(["arjun", "kiran", "zed"]);
    expect(list.busy.map((row) => row.memberId)).toEqual(["asha", "meera"]);
    expect(pickerRowOf(list, "arjun")).toMatchObject({
      lines: ["Half day that day"],
      chips: [],
      short: "Half day",
    });
    expect(pickerRowOf(list, "kiran")).toMatchObject({
      lines: ["Leave requested"],
      chips: [],
      short: "Leave requested",
    });
    // No reason and no type: comp leave reads as leave.
    for (const id of ["asha", "meera"]) {
      expect(pickerRowOf(list, id)).toEqual({
        memberId: id,
        name: PEOPLE.find((person) => person.id === id)?.name,
        lines: ["On leave that day"],
        chips: ["on_leave"],
        short: "On leave",
      });
    }
    // On leave and booked: both chips, the booking said.
    const both = event(
      everyone({ asha: { leave: "leave", eventBlocks: [block("15:30", "16:00")] } }),
    );
    expect(pickerRowOf(both, "asha")).toMatchObject({
      lines: ["Shoot 3:30 pm – 4:00 pm · booked by Sana Khan"],
      chips: ["clashes", "on_leave"],
      short: "Clashes · On leave",
    });
    // A half day with an earlier booking keeps both facts.
    const half = event(
      everyone({ arjun: { leave: "half_day", eventBlocks: [block("10:00", "11:00")] } }),
    );
    expect(pickerRowOf(half, "arjun")?.lines).toEqual([
      "Half day that day · earlier: Shoot 10:00 am – 11:00 am · booked by Sana Khan",
    ]);
  });

  it("a freelancer and the Owner never read as on leave: their answer has none", () => {
    // `member_availability()` answers null leave for both; a clash is still a clash.
    const list = event(
      everyone({
        zed: { eventBlocks: [block("15:00", "16:00")] },
        [OWNER]: { eventBlocks: [block("16:00", "18:00", { bookedById: OWNER })] },
      }),
    );
    expect(pickerRowOf(list, "zed")).toMatchObject({ chips: ["clashes"] });
    expect(pickerRowOf(list, OWNER)).toMatchObject({
      lines: ["Shoot 4:00 pm – 6:00 pm · booked by Owner"],
      chips: ["clashes"],
    });
    const free = event(everyone());
    expect(pickerRowOf(free, "zed")).toMatchObject({ lines: ["Free"], chips: [] });
  });

  it("editing: the task's own booking is no clash against itself", () => {
    const own = block("15:00", "17:00", { bookedById: VIEWER });
    const current = {
      memberIds: ["asha"],
      dueDate: DAY,
      eventDate: DAY,
      eventWindow: WINDOW,
      open: true,
    };
    const rows = everyone({
      asha: { eventBlocks: [own] },
      // Kiran has the same hours on another task and was not on this one: a real clash.
      kiran: { eventBlocks: [own] },
    });
    const list = event(rows, { current });
    expect(pickerRowOf(list, "asha")).toMatchObject({ lines: ["Free"], chips: [] });
    expect(pickerRowOf(list, "kiran")).toMatchObject({ chips: ["clashes"] });
    // The event moved to hours that overlap its old ones: its own block is still not a clash.
    const moved = event(rows, {
      current,
      when: { kind: "event", date: DAY, window: eventWindow(at("16:00"), at("18:00")) },
    });
    expect(pickerRowOf(moved, "asha")).toMatchObject({ lines: ["Free"], chips: [] });
    // Its own date-only booking, and a second booking of theirs that does clash.
    const dated = event(
      everyone({ asha: { eventBlocks: [block(null, null), block("15:30", "16:00")] } }),
      { current: { ...current, eventWindow: null } },
    );
    expect(pickerRowOf(dated, "asha")).toMatchObject({
      lines: ["Shoot 3:30 pm – 4:00 pm · booked by Sana Khan"],
      chips: ["clashes"],
    });
    // A completed or cancelled task holds no booking of its own.
    const closed = event(rows, { current: { ...current, open: false } });
    expect(pickerRowOf(closed, "asha")).toMatchObject({ chips: ["clashes"] });
  });

  it("never says a title, a client or a place: a booking is its type, time and booker", () => {
    expect(bookingLine(block("14:00", "16:00"), VIEWER, OWNER)).toBe(
      "Shoot 2:00 pm – 4:00 pm · booked by Sana Khan",
    );
    expect(bookingLine(block(null, null, { bookedById: VIEWER }), VIEWER, OWNER)).toBe(
      "Shoot all day · booked by you",
    );
    // An unknown type or booker says less, never something made up.
    expect(
      bookingLine(
        { startAt: at("14:00"), endAt: at("16:00"), typeName: null, bookedById: null },
        VIEWER,
        OWNER,
      ),
    ).toBe("Event 2:00 pm – 4:00 pm");
  });
});

describe("Who's on it? for a deadline only (v6.0): one list, no groups, no Clashes", () => {
  const deadline = (rows: AvailabilityDay[], extra: Partial<PickerInput> = {}) =>
    pickerList({
      people: PEOPLE,
      when: { kind: "deadline", date: DAY },
      availability: rows,
      viewerId: VIEWER,
      ownerId: OWNER,
      ...extra,
    });

  it("each person with that day's lines: bookings, leave, the tasks already due", () => {
    const list = deadline(
      everyone({
        arjun: { openTasksDue: 4 },
        asha: { eventBlocks: [block("14:00", "16:00")], leave: "half_day", openTasksDue: 1 },
        kiran: { leave: "leave" },
        meera: { leave: "requested" },
      }),
    );
    expect(list.kind).toBe("day");
    expect(pickerCount(list)).toBe(PEOPLE.length);
    expect(pickerRowOf(list, "arjun")).toEqual({
      memberId: "arjun",
      name: "Arjun Mehta",
      lines: ["4 tasks already due"],
      chips: [],
      short: "",
    });
    expect(pickerRowOf(list, "asha")?.lines).toEqual([
      "Shoot 2:00 pm – 4:00 pm · booked by Sana Khan",
      "Half day that day",
      "1 task already due",
    ]);
    expect(pickerRowOf(list, "kiran")?.lines).toEqual(["On leave that day"]);
    expect(pickerRowOf(list, "meera")?.lines).toEqual(["Leave requested"]);
    expect(pickerRowOf(list, "zed")?.lines).toEqual(["Nothing that day"]);
    // The Owner's day is never claimed empty (their leave is not in the answer).
    expect(pickerRowOf(list, OWNER)?.lines).toEqual([]);
    const busyOwner = deadline(everyone({ [OWNER]: { openTasksDue: 2 } }));
    expect(pickerRowOf(busyOwner, OWNER)?.lines).toEqual(["2 tasks already due"]);
    // Never a chip: a deadline clashes with nothing.
    const rows = list.kind === "day" ? list.rows : [];
    expect(rows.every((row) => row.chips.length === 0 && row.short === "")).toBe(true);
  });

  it("editing: the task itself is not in the person's count, nor its own booking in their day", () => {
    const current = {
      memberIds: ["asha"],
      dueDate: DAY,
      eventDate: DAY,
      eventWindow: WINDOW,
      open: true,
    };
    const rows = everyone({
      asha: { openTasksDue: 1, eventBlocks: [block("15:00", "17:00")] },
      kiran: { openTasksDue: 1 },
    });
    const list = deadline(rows, { current });
    expect(pickerRowOf(list, "asha")?.lines).toEqual(["Nothing that day"]);
    expect(pickerRowOf(list, "kiran")?.lines).toEqual(["1 task already due"]);
    // The deadline moved to another day: that day's count is all other tasks.
    const other = deadline(rows, {
      current: { ...current, dueDate: "2026-11-20", eventDate: null },
    });
    expect(pickerRowOf(other, "asha")?.lines).toEqual([
      "Shoot 3:00 pm – 5:00 pm · booked by Sana Khan",
      "1 task already due",
    ]);
  });
});

describe("Who's on it? before its day is known, and Find a person", () => {
  it("lists everyone with no line while there is no day, no answer yet, or the read failed", () => {
    for (const input of [
      { when: null, availability: everyone() },
      { when: { kind: "event" as const, date: DAY, window: WINDOW }, availability: null },
    ]) {
      const list = pickerList({ people: PEOPLE, viewerId: VIEWER, ownerId: OWNER, ...input });
      expect(list.kind).toBe("day");
      expect(pickerCount(list)).toBe(PEOPLE.length);
      expect(pickerRowOf(list, "asha")).toEqual({
        memberId: "asha",
        name: "Asha Rao",
        lines: [],
        chips: [],
        short: "",
      });
    }
    // A person the answer does not hold is offered, with nothing claimed about their day.
    const partial = event([day("asha")]);
    expect(pickerRowOf(partial, "kiran")).toMatchObject({ lines: [], short: "" });
    expect(partial.free).toHaveLength(PEOPLE.length - 1);
    // Another day's rows say nothing about this one.
    const stale = event(everyone().map((row) => ({ ...row, day: "2026-11-15", leave: "leave" })));
    expect(stale.busy).toEqual([]);
  });

  it("search: by any part of the name, whatever its case, accents or spacing, in both groups", () => {
    const list = event(everyone({ asha: { leave: "leave" } }));
    const found = searchPicker(list, "  RAO ");
    expect(found).toMatchObject({
      kind: "event",
      free: [],
      busy: [{ memberId: "asha" }],
      owner: [],
    });
    expect(pickerCount(searchPicker(list, "a"))).toBe(5);
    expect(pickerCount(searchPicker(list, "nobody here"))).toBe(0);
    expect(searchPicker(list, "   ")).toBe(list);
    const accented = pickerList({
      people: [{ id: "j", name: "José  Núñez" }],
      when: null,
      availability: null,
      viewerId: VIEWER,
      ownerId: OWNER,
    });
    expect(pickerCount(searchPicker(accented, "jose nunez"))).toBe(1);
  });
});

describe("Who's on it? in words", () => {
  it("the line under the title: type · day · time, in the app's one time format", () => {
    expect(
      pickerSubtitle({
        typeName: "Shoot",
        event: true,
        when: { kind: "event", date: DAY, window: WINDOW },
        dueAt: null,
      }),
    ).toBe("Shoot · Sat 14 Nov · 3:00 pm – 5:00 pm");
    expect(
      pickerSubtitle({
        typeName: "Shoot / Site Visit",
        event: true,
        when: { kind: "event", date: DAY, window: null },
        dueAt: null,
      }),
    ).toBe("Shoot / Site Visit · Sat 14 Nov · all day");
    expect(
      pickerSubtitle({
        typeName: "Normal",
        event: false,
        when: { kind: "deadline", date: DAY },
        dueAt: at("18:00"),
      }),
    ).toBe("Normal · due Sat 14 Nov, 6:00 pm");
    expect(pickerSubtitle({ typeName: "Shoot", event: true, when: null, dueAt: null })).toBe(
      "Shoot · pick the day to see who is free",
    );
    expect(pickerSubtitle({ typeName: "Normal", event: false, when: null, dueAt: null })).toBe(
      "Normal · pick the deadline to see their day",
    );
  });

  it("who is chosen: the sheet's foot and the dialog's footer", () => {
    expect(chosenLine([])).toBe("Nobody chosen yet");
    expect(chosenLine(["Kiran Das"])).toBe("1 chosen · Kiran Das");
    expect(chosenLine(["Kiran Das", "Asha Rao"])).toBe("2 chosen · Kiran Das, Asha Rao");
    expect(chosenOwnerLine(0, null)).toBe("Nobody chosen yet");
    expect(chosenOwnerLine(1, "Kiran Das")).toBe("1 chosen · Kiran Das (primary owner)");
    expect(chosenOwnerLine(3, "Asha Rao")).toBe("3 chosen · Asha Rao (primary owner)");
  });
});
