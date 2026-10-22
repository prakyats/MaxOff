import { describe, expect, it } from "vitest";

import { notificationWhen, pageFrom, twelveHourTimes } from "../domain/when";

describe("notificationWhen (IST)", () => {
  const today = "2026-10-01";

  it("says the time for today's, in IST", () => {
    // 10:35 UTC = 4:05 pm IST.
    expect(notificationWhen("2026-10-01T10:35:00Z", today)).toBe("4:05 pm");
    // 19:00 UTC on 30 Sep is 00:30 IST on 1 Oct: today, not yesterday.
    expect(notificationWhen("2026-09-30T19:00:00Z", today)).toBe("12:30 am");
  });

  it("says Yesterday, a day this year, then a year", () => {
    expect(notificationWhen("2026-09-30T10:35:00Z", today)).toBe("Yesterday, 4:05 pm");
    expect(notificationWhen("2026-09-03T10:35:00Z", today)).toBe("3 Sep, 4:05 pm");
    expect(notificationWhen("2025-10-03T10:35:00Z", today)).toBe("3 Oct 2025");
  });
});

describe("pageFrom", () => {
  it("reads a whole page number, else the first page", () => {
    expect(pageFrom("3")).toBe(3);
    expect(pageFrom(undefined)).toBe(1);
    expect(pageFrom("0")).toBe(1);
    expect(pageFrom("-2")).toBe(1);
    expect(pageFrom("2.5")).toBe(1);
    expect(pageFrom(["2"])).toBe(1);
    expect(pageFrom("123456")).toBe(1);
  });
});

describe("twelveHourTimes (PP-alerts-1)", () => {
  it("shows an old body's 24-hour times on the 12-hour clock", () => {
    expect(twelveHourTimes("Edit is due at 18:00 on 22 Oct.")).toBe(
      "Edit is due at 6:00 pm on 22 Oct.",
    );
    expect(twelveHourTimes("From 09:30 to 12:00")).toBe("From 9:30 am to 12:00 pm");
    expect(twelveHourTimes("Started at 00:05")).toBe("Started at 12:05 am");
  });
  it("leaves a time that already says am or pm, and other numbers, as they are", () => {
    expect(twelveHourTimes("Due 22 Oct, 6:00 pm")).toBe("Due 22 Oct, 6:00 pm");
    expect(twelveHourTimes("Due 10:30 am")).toBe("Due 10:30 am");
    expect(twelveHourTimes("Ratio 25:61 and 3 of 4")).toBe("Ratio 25:61 and 3 of 4");
  });
});
