import { describe, expect, it } from "vitest";

import {
  FIELD_PLACEHOLDER,
  fieldLabel,
  formatDateField,
  formatTimeField,
  spokenDateField,
} from "./field";

/** V5b major change 6 (option C): how a chosen date or time reads in its field. */
describe("date and time field labels", () => {
  const today = "2026-10-22";

  it("reads a date as `Thu 22 Oct`, the year only outside the current one", () => {
    expect(formatDateField("2026-10-22", today)).toBe("Thu 22 Oct");
    expect(formatDateField("2026-12-31", today)).toBe("Thu 31 Dec");
    expect(formatDateField("2027-01-04", today)).toBe("Mon 4 Jan 2027");
    expect(formatDateField("2025-12-31", today)).toBe("Wed 31 Dec 2025");
  });

  it("gives a screen reader the full date", () => {
    expect(spokenDateField("2026-10-22")).toBe("Thursday 22 October 2026");
  });

  it("reads a time as `6:00 pm`, seconds or not", () => {
    expect(formatTimeField("18:00")).toBe("6:00 pm");
    expect(formatTimeField("09:05")).toBe("9:05 am");
    expect(formatTimeField("00:30:15")).toBe("12:30 am");
    expect(formatTimeField("12:00")).toBe("12:00 pm");
  });

  it("labels each kind of field from its native value, nothing when empty or partial", () => {
    expect(fieldLabel("date", "", today)).toBeNull();
    expect(fieldLabel("date", "2026-1", today)).toBeNull();
    expect(fieldLabel("date", "2026-10-23", today)).toEqual({
      shown: "Fri 23 Oct",
      spoken: "Friday 23 October 2026",
    });
    expect(fieldLabel("time", "18:00", today)).toEqual({ shown: "6:00 pm", spoken: "6:00 pm" });
    expect(fieldLabel("time", "", today)).toBeNull();
    expect(fieldLabel("datetime", "2027-01-04T18:00", today)).toEqual({
      shown: "Mon 4 Jan 2027, 6:00 pm",
      spoken: "Monday 4 January 2027, 6:00 pm",
    });
    expect(fieldLabel("datetime", "2026-10-22T", today)).toBeNull();
  });

  it("says what to do when empty", () => {
    expect(FIELD_PLACEHOLDER).toEqual({
      date: "Choose a date",
      time: "Choose a time",
      datetime: "Choose a date and time",
    });
  });
});
