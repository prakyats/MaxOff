import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_PATH,
  attendanceHref,
  gateNext,
  isGated,
  signDayPass,
  verifyDayPass,
} from "./day-gate";

const SECRET = "a-test-secret-that-is-long-enough-for-hmac";
const MEMBER = "10000000-0000-4000-8000-000000000003";
const OTHER = "10000000-0000-4000-8000-000000000002";

describe("the day pass", () => {
  it("verifies for the same secret, member and IST date", async () => {
    const pass = await signDayPass(SECRET, MEMBER, "2026-09-23");
    expect(pass.startsWith("2026-09-23.")).toBe(true);
    expect(await verifyDayPass(SECRET, pass, MEMBER, "2026-09-23")).toBe(true);
  });

  it("is useless tomorrow, for another member, or under another secret", async () => {
    const pass = await signDayPass(SECRET, MEMBER, "2026-09-23");
    expect(await verifyDayPass(SECRET, pass, MEMBER, "2026-09-24")).toBe(false);
    expect(await verifyDayPass(SECRET, pass, OTHER, "2026-09-23")).toBe(false);
    expect(await verifyDayPass(`${SECRET}x`, pass, MEMBER, "2026-09-23")).toBe(false);
  });

  it("refuses a missing, tampered or malformed value", async () => {
    const pass = await signDayPass(SECRET, MEMBER, "2026-09-23");
    const tampered = `${pass.slice(0, -1)}${pass.endsWith("A") ? "B" : "A"}`;
    for (const value of [undefined, "", "2026-09-23", "2026-09-23.", tampered, `${pass}.extra`]) {
      expect(await verifyDayPass(SECRET, value, MEMBER, "2026-09-23"), String(value)).toBe(false);
    }
    // A pass re-dated by hand keeps yesterday's MAC, so it fails.
    const redated = pass.replace("2026-09-23", "2026-09-24");
    expect(await verifyDayPass(SECRET, redated, MEMBER, "2026-09-24")).toBe(false);
  });
});

describe("who is gated", () => {
  it("gates Admin and Staff (attendance.self), never the Owner", () => {
    expect(isGated("admin")).toBe(true);
    expect(isGated("staff")).toBe(true);
    expect(isGated("owner")).toBe(false);
  });
});

describe("gateNext", () => {
  it("keeps a safe in-app path with its query", () => {
    expect(gateNext("/me?welcome=1")).toBe("/me?welcome=1");
    expect(gateNext("/my-day")).toBe("/my-day");
  });

  it("falls back to / for anything unsafe or missing", () => {
    for (const value of [null, undefined, "", "https://evil.example", "//evil.example", "/login"]) {
      expect(gateNext(value), String(value)).toBe("/");
    }
  });

  it("never sends the member back into the gate (that would loop)", () => {
    expect(gateNext(ATTENDANCE_PATH)).toBe("/");
    expect(gateNext(`${ATTENDANCE_PATH}?next=/today`)).toBe("/");
  });

  it("builds the gate links with next encoded", () => {
    expect(attendanceHref("/me?welcome=1")).toBe("/attendance?next=%2Fme%3Fwelcome%3D1");
  });
});
