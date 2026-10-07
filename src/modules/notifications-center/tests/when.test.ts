import { describe, expect, it } from "vitest";

import { notificationWhen, pageFrom } from "../domain/when";

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
