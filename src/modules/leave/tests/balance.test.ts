import { describe, expect, it } from "vitest";

import { leaveTakenThisMonth } from "../domain/balance";

describe("leaveTakenThisMonth (PP-crew-1)", () => {
  const today = "2026-10-22";
  it("counts calendar days within this month up to today, a half day as ½", () => {
    expect(
      leaveTakenThisMonth(
        [
          { type: "leave", startDate: "2026-10-05", endDate: "2026-10-07" },
          { type: "half_day", startDate: "2026-10-12", endDate: "2026-10-12" },
          { type: "comp_leave", startDate: "2026-10-20", endDate: "2026-10-20" },
        ],
        today,
      ),
    ).toBe(4.5);
  });
  it("leaves out the days before the month and after today", () => {
    expect(
      leaveTakenThisMonth(
        [
          { type: "leave", startDate: "2026-09-29", endDate: "2026-10-02" },
          { type: "leave", startDate: "2026-10-21", endDate: "2026-10-25" },
          { type: "leave", startDate: "2026-10-28", endDate: "2026-10-29" },
        ],
        today,
      ),
    ).toBe(4);
  });
  it("is zero with nothing taken", () => {
    expect(leaveTakenThisMonth([], today)).toBe(0);
  });
});
