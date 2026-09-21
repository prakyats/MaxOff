import { describe, expect, it } from "vitest";

import {
  addISTDays,
  formatIST,
  isISODate,
  istDayRange,
  istDayStart,
  toISTDate,
  todayIST,
} from "./ist";

describe("toISTDate", () => {
  it("keeps the date until 18:29:59 UTC", () => {
    expect(toISTDate("2026-09-21T18:29:59Z")).toBe("2026-09-21");
  });

  it("rolls over to the next IST day at 18:30:00 UTC", () => {
    expect(toISTDate("2026-09-21T18:30:00Z")).toBe("2026-09-22");
  });

  it("rolls over months and years", () => {
    expect(toISTDate("2026-09-30T18:30:00Z")).toBe("2026-10-01");
    expect(toISTDate("2026-12-31T18:29:59Z")).toBe("2026-12-31");
    expect(toISTDate("2026-12-31T18:30:00Z")).toBe("2027-01-01");
  });

  it("accepts Dates, epoch milliseconds and offset strings", () => {
    expect(toISTDate(new Date("2026-09-21T18:30:00Z"))).toBe("2026-09-22");
    expect(toISTDate(Date.UTC(2026, 8, 21, 18, 30))).toBe("2026-09-22");
    expect(toISTDate("2026-09-21T23:59:59+05:30")).toBe("2026-09-21");
  });

  it("rejects invalid instants", () => {
    expect(() => toISTDate("not a date")).toThrow(RangeError);
  });

  it("rejects a bare date, which has no instant", () => {
    expect(() => toISTDate("2026-09-21")).toThrow(/not an instant/);
    expect(() => formatIST("2026-09-21")).toThrow(/not an instant/);
  });
});

describe("todayIST", () => {
  it("uses the injected clock", () => {
    expect(todayIST(() => new Date("2026-09-21T18:30:00Z"))).toBe("2026-09-22");
  });
});

describe("isISODate", () => {
  it("accepts real calendar dates only", () => {
    expect(isISODate("2026-09-21")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("21-09-2026")).toBe(false);
    expect(isISODate(20260921)).toBe(false);
  });
});

describe("istDayStart and istDayRange", () => {
  it("starts the IST day at 18:30 UTC the evening before", () => {
    expect(istDayStart("2026-09-22").toISOString()).toBe("2026-09-21T18:30:00.000Z");
  });

  it("returns a half-open range of exactly one day", () => {
    const { start, end } = istDayRange("2026-09-22");
    expect(start.toISOString()).toBe("2026-09-21T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-09-22T18:30:00.000Z");
    expect(toISTDate(start)).toBe("2026-09-22");
    expect(toISTDate(end.getTime() - 1)).toBe("2026-09-22");
    expect(toISTDate(end)).toBe("2026-09-23");
  });

  it("rejects malformed dates", () => {
    expect(() => istDayStart("2026-9-2")).toThrow(RangeError);
  });
});

describe("addISTDays", () => {
  it("adds and subtracts whole days across month ends", () => {
    expect(addISTDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addISTDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addISTDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("formatIST", () => {
  it("formats in IST with the default pattern", () => {
    expect(formatIST("2026-09-21T12:35:00Z")).toBe("21 Sep 2026, 6:05 pm");
  });

  it("accepts a custom pattern", () => {
    expect(formatIST("2026-09-21T18:30:00Z", "yyyy-MM-dd HH:mm")).toBe("2026-09-22 00:00");
  });
});
