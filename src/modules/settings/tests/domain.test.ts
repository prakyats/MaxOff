import { describe, expect, it } from "vitest";

import {
  createHolidaySchema,
  updateCompanySchema,
  updateThresholdsSchema,
  updateWeeklyOffSchema,
} from "../domain/schemas";
import {
  describeWeeklyOff,
  holidaysByYear,
  isUpcoming,
  weeklyOffChoices,
} from "../domain/settings";

describe("updateCompanySchema", () => {
  it("trims the name and refuses an empty or overlong one", () => {
    expect(updateCompanySchema.parse({ name: "  Pixora Clips " }).name).toBe("Pixora Clips");
    expect(updateCompanySchema.safeParse({ name: "   " }).success).toBe(false);
    expect(updateCompanySchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
  });
});

describe("updateWeeklyOffSchema", () => {
  it("sorts the days and drops duplicates", () => {
    expect(updateWeeklyOffSchema.parse({ weeklyOffDays: [6, 0, 6] }).weeklyOffDays).toEqual([0, 6]);
  });

  it("accepts no days off at all", () => {
    expect(updateWeeklyOffSchema.parse({ weeklyOffDays: [] }).weeklyOffDays).toEqual([]);
  });

  it("refuses a week with no working day", () => {
    const result = updateWeeklyOffSchema.safeParse({ weeklyOffDays: [0, 1, 2, 3, 4, 5, 6] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/working day/);
  });

  it("refuses a weekday outside 0..6", () => {
    expect(updateWeeklyOffSchema.safeParse({ weeklyOffDays: [7] }).success).toBe(false);
    expect(updateWeeklyOffSchema.safeParse({ weeklyOffDays: [-1] }).success).toBe(false);
  });
});

describe("createHolidaySchema", () => {
  it("takes a real calendar date and a name", () => {
    expect(createHolidaySchema.parse({ date: "2026-10-02", name: " Gandhi Jayanti " })).toEqual({
      date: "2026-10-02",
      name: "Gandhi Jayanti",
    });
  });

  it("refuses a date that does not exist and an empty name", () => {
    expect(createHolidaySchema.safeParse({ date: "2026-02-30", name: "X" }).success).toBe(false);
    expect(createHolidaySchema.safeParse({ date: "02/10/2026", name: "X" }).success).toBe(false);
    expect(createHolidaySchema.safeParse({ date: "2026-10-02", name: " " }).success).toBe(false);
  });
});

describe("updateThresholdsSchema", () => {
  const valid = {
    logoutReminderTime: "20:30",
    ackRepeatHours: "2",
    ackEscalateHours: "4",
    ackEscalateOwnerHours: "8",
    overdueEscalateHours: "24",
    emailDailyCapPerMember: "20",
  };

  it("takes the launch settings (PRODUCT §7) as numbers", () => {
    expect(updateThresholdsSchema.parse(valid)).toEqual({
      logoutReminderTime: "20:30",
      ackRepeatHours: 2,
      ackEscalateHours: 4,
      ackEscalateOwnerHours: 8,
      overdueEscalateHours: 24,
      emailDailyCapPerMember: 20,
    });
  });

  it("refuses a time that is not HH:MM", () => {
    expect(updateThresholdsSchema.safeParse({ ...valid, logoutReminderTime: "8pm" }).success).toBe(
      false,
    );
    expect(
      updateThresholdsSchema.safeParse({ ...valid, logoutReminderTime: "24:00" }).success,
    ).toBe(false);
  });

  it("refuses zero, fractional and absurd hours", () => {
    expect(updateThresholdsSchema.safeParse({ ...valid, ackRepeatHours: "0" }).success).toBe(false);
    expect(updateThresholdsSchema.safeParse({ ...valid, ackRepeatHours: "1.5" }).success).toBe(
      false,
    );
    expect(updateThresholdsSchema.safeParse({ ...valid, ackRepeatHours: "999" }).success).toBe(
      false,
    );
  });

  it("allows an email cap of zero but not a negative one", () => {
    expect(
      updateThresholdsSchema.safeParse({ ...valid, emailDailyCapPerMember: "0" }).success,
    ).toBe(true);
    expect(
      updateThresholdsSchema.safeParse({ ...valid, emailDailyCapPerMember: "-1" }).success,
    ).toBe(false);
  });

  it("refuses an Owner escalation that comes before the Admin one (WORKFLOWS §9)", () => {
    const result = updateThresholdsSchema.safeParse({
      ...valid,
      ackEscalateHours: "8",
      ackEscalateOwnerHours: "4",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["ackEscalateOwnerHours"]);
  });

  it("allows both escalations at the same hour", () => {
    expect(
      updateThresholdsSchema.safeParse({
        ...valid,
        ackEscalateHours: "4",
        ackEscalateOwnerHours: "4",
      }).success,
    ).toBe(true);
  });
});

describe("weeklyOffChoices", () => {
  it("lists Monday first with the current setting applied", () => {
    const choices = weeklyOffChoices([0]);
    expect(choices.map((choice) => choice.short)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(choices.filter((choice) => choice.checked).map((choice) => choice.label)).toEqual([
      "Sunday",
    ]);
  });
});

describe("describeWeeklyOff", () => {
  it("reads as a sentence", () => {
    expect(describeWeeklyOff([])).toBe("None");
    expect(describeWeeklyOff([0])).toBe("Sunday");
    expect(describeWeeklyOff([0, 6])).toBe("Saturday and Sunday");
    expect(describeWeeklyOff([0, 5, 6])).toBe("Friday, Saturday and Sunday");
  });
});

describe("holidaysByYear", () => {
  const holidays = [
    { id: "3", date: "2027-01-26", name: "Republic Day" },
    { id: "1", date: "2026-10-02", name: "Gandhi Jayanti" },
    { id: "2", date: "2026-08-15", name: "Independence Day" },
  ];

  it("groups by year, oldest first, naming the weekday", () => {
    const years = holidaysByYear(holidays);
    expect(years.map((year) => year.year)).toEqual(["2026", "2027"]);
    expect(years[0]?.holidays.map((holiday) => holiday.name)).toEqual([
      "Independence Day",
      "Gandhi Jayanti",
    ]);
    expect(years[0]?.holidays[0]?.weekday).toBe("Saturday");
  });

  it("has nothing to group when there are no holidays", () => {
    expect(holidaysByYear([])).toEqual([]);
  });
});

describe("isUpcoming", () => {
  it("counts today as upcoming", () => {
    const holiday = { id: "1", date: "2026-10-02", name: "Gandhi Jayanti" };
    expect(isUpcoming(holiday, "2026-10-02")).toBe(true);
    expect(isUpcoming(holiday, "2026-10-03")).toBe(false);
  });
});
