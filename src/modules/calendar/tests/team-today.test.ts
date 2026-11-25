import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import type { CrewBooking, CrewSource } from "../domain/crew";
import { busyAt, nextBookedLine, onLeaveLine, teamToday } from "../domain/team-today";

const DAY = "2026-11-16";
const at = (time: string) => new Date(istInstant(DAY, time));

function booking(over: Partial<CrewBooking> & { memberId: string }): CrewBooking {
  return {
    startAt: istInstant(DAY, "14:00"),
    endAt: istInstant(DAY, "16:00"),
    typeName: "Shoot",
    color: "#f5a524",
    by: "you",
    ...over,
  };
}

const source: CrewSource = {
  people: [
    { id: "p", name: "PShetty" },
    { id: "f", name: "Free Lance (freelancer)" },
    { id: "k", name: "Kiran" },
    { id: "d", name: "Divya" },
    { id: "a", name: "Arjun" },
    { id: "h", name: "Hema" },
  ],
  busyOnly: [{ id: "o", name: "Owner One" }],
  days: {
    [DAY]: {
      busy: [
        booking({ memberId: "p" }),
        booking({
          memberId: "f",
          startAt: istInstant(DAY, "11:00"),
          endAt: istInstant(DAY, "13:00"),
          typeName: "Site visit",
          by: "Nikhil Rao",
        }),
        booking({ memberId: "o", startAt: null, endAt: null, typeName: "Meeting", by: "Owner" }),
      ],
      leave: [
        ["a", "full"],
        ["h", "half"],
      ],
    },
  },
};

describe("teamToday", () => {
  it("counts free now, booked today and on leave (the approved sample)", () => {
    const noon = teamToday(source, DAY, at("12:00"));
    // Free now at noon: PShetty (booked 2–4, not yet), Kiran, Divya. The freelancer is on a visit,
    // the Owner is never counted free, Arjun and Hema are away.
    expect(noon.freeNow).toBe(3);
    expect(noon.bookedToday).toBe(3);
    expect(noon.onLeave).toBe(2);
    expect(teamToday(source, DAY, at("15:00")).freeNow).toBe(3);
    expect(teamToday(source, DAY, at("17:00")).freeNow).toBe(4);
  });

  it("lists the booked first (all-day, then by start), then free, then away, by name", () => {
    const { lines } = teamToday(source, DAY, at("09:00"));
    expect(lines.map((line) => [line.name, line.text, line.by])).toEqual([
      ["Owner One", "Meeting All day", "booked by Owner"],
      ["Free Lance (freelancer)", "Site visit 11:00 am – 1:00 pm", "booked by Nikhil Rao"],
      ["PShetty", "Shoot 2:00 pm – 4:00 pm", "you"],
      ["Divya", "Free all day", ""],
      ["Kiran", "Free all day", ""],
      ["Arjun", "On leave", ""],
      ["Hema", "Half day", ""],
    ]);
  });

  it("names the booking going on now, else the next, else the last, and counts the rest", () => {
    const two: CrewSource = {
      ...source,
      days: {
        [DAY]: {
          busy: [
            booking({
              memberId: "k",
              startAt: istInstant(DAY, "09:00"),
              endAt: istInstant(DAY, "10:00"),
              typeName: "Meeting",
            }),
            booking({ memberId: "k" }),
          ],
          leave: [],
        },
      },
    };
    const line = (time: string) => teamToday(two, DAY, at(time)).lines[0];
    expect(line("09:30")).toMatchObject({ text: "Meeting 9:00 am – 10:00 am", more: 1 });
    expect(line("11:00")).toMatchObject({ text: "Shoot 2:00 pm – 4:00 pm", more: 1 });
    expect(line("18:00")).toMatchObject({ text: "Shoot 2:00 pm – 4:00 pm", more: 1 });
  });

  it("is everyone free on an empty day, the Owner left out", () => {
    const empty = teamToday({ ...source, days: {} }, DAY, at("10:00"));
    expect(empty).toMatchObject({ freeNow: 6, bookedToday: 0, onLeave: 0 });
    expect(empty.lines.some((line) => line.memberId === "o")).toBe(false);
  });

  it("a booked person on leave is not free now", () => {
    const both: CrewSource = {
      ...source,
      days: { [DAY]: { busy: [booking({ memberId: "a" })], leave: [["a", "full"]] } },
    };
    const result = teamToday(both, DAY, at("10:00"));
    expect(result.lines.find((line) => line.memberId === "a")?.kind).toBe("booked");
    expect(result.freeNow).toBe(5);
  });
});

describe("busyAt", () => {
  it("an all-day booking is busy all day; no end is an hour", () => {
    const allDay = booking({ memberId: "x", startAt: null, endAt: null });
    expect(busyAt([allDay], at("23:59").getTime())).toBe(true);
    const noEnd = booking({ memberId: "x", endAt: null });
    expect(busyAt([noEnd], at("14:59").getTime())).toBe(true);
    expect(busyAt([noEnd], at("15:00").getTime())).toBe(false);
  });
});

describe("nextBookedLine", () => {
  const dayName = (date: string) => (date === "2026-11-19" ? "Thu 19" : date);
  it("says the day, the type and start, and who booked it", () => {
    expect(
      nextBookedLine(
        {
          memberId: "p",
          onDate: "2026-11-19",
          startAt: istInstant("2026-11-19", "10:00"),
          endAt: null,
          typeName: "Meeting",
          by: "Sana",
        },
        dayName,
      ),
    ).toBe("Thu 19 · Meeting 10:00 am · Sana");
    expect(
      nextBookedLine(
        {
          memberId: "p",
          onDate: "2026-11-19",
          startAt: null,
          endAt: null,
          typeName: null,
          by: null,
        },
        dayName,
      ),
    ).toBe("Thu 19 · Event all day");
    expect(nextBookedLine(undefined, dayName)).toBe("Nothing booked");
  });
});

describe("onLeaveLine", () => {
  it("says when they are back, when known", () => {
    const dayName = (date: string) => (date === "2026-11-17" ? "Tue 17" : date);
    expect(onLeaveLine("2026-11-17", dayName)).toBe("On leave · back Tue 17");
    expect(onLeaveLine(null, dayName)).toBe("On leave");
  });
});
