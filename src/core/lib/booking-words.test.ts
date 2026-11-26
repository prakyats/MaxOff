import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import { bookedByWord, bookingTime } from "./booking-words";

const DAY = "2026-11-14";

describe("how a booking is said", () => {
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
});
