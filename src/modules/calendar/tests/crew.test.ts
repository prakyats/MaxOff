import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import type { AvailabilitySource, EventSource } from "../domain/calendar";
import {
  bookedByWord,
  bookingTime,
  buildCrew,
  crewOn,
  everyoneAvailable,
  freeSummary,
  leaveName,
} from "../domain/crew";

const DAY = "2026-11-14";
const NEXT = "2026-11-15";
const OWNER = { id: "o", name: "Owner One" };
const people = [
  { id: "n", name: "Nikhil Rao" },
  { id: "a", name: "Asha" },
  { id: "k", name: "Kiran" },
  { id: "m", name: "Meera" },
  { id: "r", name: "Arjun" },
];
const types = [
  { id: "shoot", name: "Shoot", color: "#f5a524" },
  { id: "meet", name: "Meeting", color: "#b48cff" },
];
const names: Record<string, string> = { o: "Owner One", n: "Nikhil Rao", a: "Asha" };

function admin(availability: AvailabilitySource[], viewerId = "n") {
  const crew = buildCrew({
    scope: "admin",
    viewerId,
    owner: OWNER,
    people,
    types,
    nameOf: () => null,
    fallbackColor: "#2563eb",
    events: [],
    leave: [],
    availability,
  });
  if (!crew) throw new Error("an Admin has a Crew");
  return crew;
}

function event(over: Partial<EventSource>): EventSource {
  return {
    id: "e",
    title: "Secret title",
    state: "todo",
    eventDate: DAY,
    eventStartAt: istInstant(DAY, "14:00"),
    eventEndAt: istInstant(DAY, "16:00"),
    location: "Secret place",
    clientId: "secret-client",
    taskTypeId: "shoot",
    primaryOwnerId: "a",
    createdById: "n",
    assigneeIds: ["a"],
    ...over,
  };
}

const block = (start: string | null, end: string | null, by: string, type = "shoot") => ({
  startAt: start ? istInstant(DAY, start) : null,
  endAt: end ? istInstant(DAY, end) : null,
  typeId: type,
  typeName: type === "shoot" ? "Shoot" : "Meeting",
  bookedById: by,
  bookedByName: names[by] ?? null,
});

describe("the Crew on a day (v6.0)", () => {
  it("an Admin: Busy with the type, the time and who booked it; On leave; Free", () => {
    const crew = crewOn(
      admin([
        { memberId: "a", day: DAY, leave: null, blocks: [block("14:00", "16:00", "n")] },
        { memberId: "m", day: DAY, leave: null, blocks: [block(null, null, "o")] },
        { memberId: "r", day: DAY, leave: "half_day", blocks: [] },
        { memberId: "k", day: DAY, leave: "requested", blocks: [] },
      ]),
      DAY,
    );
    expect(crew.busy).toEqual([
      {
        memberId: "m",
        name: "Meera",
        when: "All day",
        allDay: true,
        typeName: "Shoot",
        color: "#f5a524",
        bookedBy: "booked by Owner",
      },
      {
        memberId: "a",
        name: "Asha",
        when: "2:00 pm – 4:00 pm",
        allDay: false,
        typeName: "Shoot",
        color: "#f5a524",
        bookedBy: "booked by you",
      },
    ]);
    expect(crew.onLeave).toEqual([{ memberId: "r", name: "Arjun", half: true }]);
    // A pending request is not leave; the viewer, with nothing on, is free too.
    expect(crew.free.map((person) => person.name)).toEqual(["Kiran", "Nikhil Rao"]);
  });

  it("the viewer's own booking counts (the 'Everyone is available' bug, staging v2.0)", () => {
    const crew = crewOn(
      admin([{ memberId: "n", day: DAY, leave: null, blocks: [block("11:00", "13:00", "n")] }]),
      DAY,
    );
    expect(crew.busy.map((row) => [row.name, row.bookedBy])).toEqual([
      ["Nikhil Rao", "booked by you"],
    ]);
    expect(crew.free.map((person) => person.name)).not.toContain("Nikhil Rao");
    expect(everyoneAvailable(crew)).toBe(false);
  });

  it("the Owner is named only when busy: never Free, never on leave", () => {
    const quiet = crewOn(admin([{ memberId: "o", day: DAY, leave: "leave", blocks: [] }]), DAY);
    expect(quiet.free.map((person) => person.name)).not.toContain("Owner One");
    expect(quiet.onLeave).toEqual([]);
    expect(quiet.people).toBe(5);
    const busy = crewOn(
      admin([
        { memberId: "o", day: DAY, leave: null, blocks: [block("10:00", null, "o", "meet")] },
      ]),
      DAY,
    );
    expect(busy.busy).toEqual([
      {
        memberId: "o",
        name: "Owner One",
        when: "10:00 am – 11:00 am",
        allDay: false,
        typeName: "Meeting",
        color: "#b48cff",
        bookedBy: "booked by Owner",
      },
    ]);
  });

  it("someone on full leave who is also booked shows in both lists, never as Free", () => {
    const crew = crewOn(
      admin([
        { memberId: "a", day: DAY, leave: "comp_leave", blocks: [block("09:00", "10:00", "n")] },
      ]),
      DAY,
    );
    expect(crew.onLeave).toEqual([{ memberId: "a", name: "Asha", half: false }]);
    expect(crew.busy).toHaveLength(1);
    expect(crew.free.map((person) => person.name)).not.toContain("Asha");
  });

  it("two bookings of one person are two rows, in time order", () => {
    const crew = crewOn(
      admin([
        {
          memberId: "a",
          day: DAY,
          leave: null,
          blocks: [block("15:00", "16:00", "n"), block("09:00", "10:00", "o", "meet")],
        },
      ]),
      DAY,
    );
    expect(crew.busy.map((row) => `${row.typeName} ${row.when}`)).toEqual([
      "Meeting 9:00 am – 10:00 am",
      "Shoot 3:00 pm – 4:00 pm",
    ]);
  });

  it("a person the viewer cannot see is left out", () => {
    const crew = crewOn(
      admin([
        { memberId: "gone", day: DAY, leave: "leave", blocks: [block("09:00", "10:00", "n")] },
      ]),
      DAY,
    );
    expect(crew.busy).toEqual([]);
    expect(crew.onLeave).toEqual([]);
  });

  it("everyone is available only when nobody is busy or on leave", () => {
    const crew = crewOn(admin([]), DAY);
    expect(everyoneAvailable(crew)).toBe(true);
    expect(crew.free).toHaveLength(5);
    expect(freeSummary(crew)).toBe("Everyone");
  });

  it("the Owner's Crew is built from the events and leave the Owner reads, with no title in it", () => {
    const source = buildCrew({
      scope: "owner",
      viewerId: "o",
      owner: OWNER,
      people,
      types,
      nameOf: (id) => names[id] ?? null,
      fallbackColor: "#2563eb",
      events: [
        event({}),
        event({
          id: "f",
          eventStartAt: null,
          eventEndAt: null,
          assigneeIds: ["m", "o"],
          createdById: "o",
        }),
        event({ id: "g", state: "completed", assigneeIds: ["k"] }),
        event({ id: "h", state: "cancelled", assigneeIds: ["k"] }),
      ],
      leave: [
        { memberId: "r", type: "leave", startDate: DAY, endDate: NEXT, pending: false },
        { memberId: "k", type: "leave", startDate: DAY, endDate: DAY, pending: true },
      ],
      availability: null,
    });
    if (!source) throw new Error("the Owner has a Crew");
    const crew = crewOn(source, DAY);
    expect(crew.busy.map((row) => [row.name, row.typeName, row.when, row.bookedBy])).toEqual([
      ["Meera", "Shoot", "All day", "booked by you"],
      ["Owner One", "Shoot", "All day", "booked by you"],
      ["Asha", "Shoot", "2:00 pm – 4:00 pm", "booked by Nikhil Rao"],
    ]);
    expect(crew.onLeave).toEqual([{ memberId: "r", name: "Arjun", half: false }]);
    expect(crew.free.map((person) => person.name)).toEqual(["Kiran", "Nikhil Rao"]);
    expect(JSON.stringify(source)).not.toMatch(/secret/i);
    // The leave runs into the next day; nothing else is on it.
    expect(crewOn(source, NEXT).onLeave).toHaveLength(1);
    expect(crewOn(source, NEXT).busy).toEqual([]);
  });

  it("Crew have no Crew list", () => {
    expect(
      buildCrew({
        scope: "staff",
        viewerId: "k",
        owner: OWNER,
        people,
        types,
        nameOf: () => null,
        fallbackColor: "#2563eb",
        events: [event({})],
        leave: [],
        availability: null,
      }),
    ).toBeNull();
  });

  it("an unknown type reads 'Event' in the default colour", () => {
    const crew = crewOn(
      admin([
        {
          memberId: "a",
          day: DAY,
          leave: null,
          blocks: [{ startAt: null, endAt: null, typeId: "x", typeName: null }],
        },
      ]),
      DAY,
    );
    expect(crew.busy[0]).toMatchObject({ typeName: "Event", color: "#2563eb", bookedBy: "" });
  });
});

describe("the words", () => {
  it("who booked it: you, Owner, or the full name", () => {
    expect(bookedByWord({ id: "n", name: "Nikhil Rao" }, "n", "o")).toBe("you");
    expect(bookedByWord({ id: "o", name: "Owner One" }, "n", "o")).toBe("Owner");
    expect(bookedByWord({ id: "o", name: "Owner One" }, "o", "o")).toBe("you");
    expect(bookedByWord({ id: "s", name: " Sana  Khan " }, "n", "o")).toBe("Sana Khan");
    expect(bookedByWord({ id: "s", name: null }, "n", "o")).toBeNull();
    expect(bookedByWord({ id: null, name: null }, "n", "o")).toBeNull();
  });

  it("a booking's time: the one time format, an hour with no end, All day with no start", () => {
    expect(
      bookingTime({ startAt: istInstant(DAY, "14:00"), endAt: istInstant(DAY, "16:00") }),
    ).toBe("2:00 pm – 4:00 pm");
    expect(bookingTime({ startAt: istInstant(DAY, "10:00"), endAt: null })).toBe(
      "10:00 am – 11:00 am",
    );
    expect(bookingTime({ startAt: null, endAt: null })).toBe("All day");
  });

  it("a person on leave, and the week's Free cell", () => {
    expect(leaveName({ name: "Arjun", half: true })).toBe("Arjun · Half day");
    expect(leaveName({ name: "Arjun", half: false })).toBe("Arjun");
    const day = (free: string[], total: number) => ({
      busy: [],
      onLeave: [],
      free: free.map((name) => ({ memberId: name, name })),
      people: total,
    });
    expect(freeSummary(day([], 5))).toBe("Nobody");
    expect(freeSummary(day(["Kiran", "Divya"], 5))).toBe("Kiran, Divya");
    expect(freeSummary(day(["a", "b", "c"], 5))).toBe("3 people");
  });
});
