import { describe, expect, it } from "vitest";

import { describeOffDays, istWeekday, pinnedOffDays } from "../e2e/calendar";

describe("the e2e suite runs on a working day", () => {
  it("moves a weekly day off that falls on today to tomorrow's weekday", () => {
    expect(pinnedOffDays([0], 0)).toEqual([1]);
    expect(pinnedOffDays([6, 0], 0)).toEqual([1, 6]);
    expect(pinnedOffDays([6], 6)).toEqual([0]);
  });

  it("leaves the days alone when today is a working day", () => {
    expect(pinnedOffDays([0], 3)).toEqual([0]);
    expect(pinnedOffDays([], 0)).toEqual([]);
  });

  it("never doubles a day", () => {
    expect(pinnedOffDays([0, 1], 0)).toEqual([1]);
  });

  it("sentences the days as Settings does, Monday first", () => {
    expect(describeOffDays([0])).toBe("Sunday");
    expect(describeOffDays([6, 0])).toBe("Saturday and Sunday");
    expect(describeOffDays([1, 6])).toBe("Monday and Saturday");
    expect(describeOffDays([1, 3, 6])).toBe("Monday, Wednesday and Saturday");
    expect(describeOffDays([])).toBe("None");
  });

  it("reads the IST weekday across the UTC midnight", () => {
    // 2026-09-26 19:00 UTC is 00:30 IST on Sunday 27 September.
    expect(istWeekday(new Date("2026-09-26T19:00:00Z"))).toBe(0);
    expect(istWeekday(new Date("2026-09-26T18:00:00Z"))).toBe(6);
  });
});
