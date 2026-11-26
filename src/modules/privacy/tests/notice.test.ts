import { describe, expect, it } from "vitest";

import {
  needsReading,
  PRIVACY_NOTICE_SECTIONS,
  PRIVACY_NOTICE_VERSION,
  PRIVACY_QUESTIONS_LINE,
  RETENTION,
} from "../domain/notice";

describe("the privacy notice (v7.5 Q1)", () => {
  it("has a dated version, the form privacy_notice_read() accepts", () => {
    expect(PRIVACY_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("asks to be read with no record or an older one, never once this version is read", () => {
    expect(needsReading(null)).toBe(true);
    expect(needsReading("2000-01-01")).toBe(true);
    expect(needsReading(PRIVACY_NOTICE_VERSION)).toBe(false);
  });

  it("says the owner's periods (26 Nov 2026)", () => {
    expect(RETENTION).toEqual({
      attendanceLeaveExpenses: "8 years",
      tasksChat: "3 years",
      signIn: "1 year",
    });
    const howLong = PRIVACY_NOTICE_SECTIONS.find((section) => section.heading === "How long");
    expect(howLong?.bullets?.[0]).toContain(
      "attendance, leave and expense records for 8 years, tasks and chat for 3 years, and sign-in records for 1 year",
    );
  });

  it("names nobody's contact details: the Owner only", () => {
    expect(PRIVACY_QUESTIONS_LINE).toBe(
      "Contact the Owner, who looks after your information for Pixora Clips.",
    );
    expect(PRIVACY_QUESTIONS_LINE).not.toMatch(/@/);
  });
});
