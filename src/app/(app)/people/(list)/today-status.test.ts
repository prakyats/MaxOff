import { describe, expect, it } from "vitest";

import { todayStatus } from "./today-status";

const now = new Date("2026-10-22T06:30:00Z");
const block = { startAt: "2026-10-22T06:00:00Z", endAt: "2026-10-22T07:00:00Z" };

describe("todayStatus (PP-admin-10)", () => {
  it("reads leave, a half day, busy and available, in that order", () => {
    expect(
      todayStatus({ memberId: "a", leave: "leave", eventBlocks: [block] }, now, false)?.label,
    ).toBe("On leave");
    expect(
      todayStatus({ memberId: "a", leave: "comp_leave", eventBlocks: [] }, now, false)?.label,
    ).toBe("On leave");
    expect(
      todayStatus({ memberId: "a", leave: "half_day", eventBlocks: [] }, now, false)?.label,
    ).toBe("Half day");
    expect(
      todayStatus({ memberId: "a", leave: null, eventBlocks: [block] }, now, false)?.label,
    ).toBe("Busy");
    expect(todayStatus(undefined, now, false)?.label).toBe("Available");
  });
  it("never shows a pending request: a requested day reads available", () => {
    expect(
      todayStatus({ memberId: "a", leave: "requested", eventBlocks: [] }, now, false)?.key,
    ).toBe("available");
  });
  it("a block that ended, or has not begun, is not busy", () => {
    const later = new Date("2026-10-22T07:00:00Z");
    expect(
      todayStatus({ memberId: "a", leave: null, eventBlocks: [block] }, later, false)?.key,
    ).toBe("available");
  });
  it("the Owner is only ever busy to an Admin, else nothing", () => {
    expect(todayStatus({ memberId: "o", leave: null, eventBlocks: [block] }, now, true)?.key).toBe(
      "busy",
    );
    expect(todayStatus(undefined, now, true)).toBeNull();
  });
});
