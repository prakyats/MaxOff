import { describe, expect, it } from "vitest";

import {
  clearedReason,
  firstName,
  lateNoNetworkWords,
  offlineTryReason,
  planDay,
  planLine,
  planOnLeave,
  stayPlanStripLine,
  triedLine,
} from "../domain/stay-plans";

// 9:58 am and 8:00 pm IST, 10:22 am IST.
const TRIED = "2026-11-25T04:28:00Z";
const UNTIL = "2026-11-28T14:30:00Z";
const STARTED = "2026-11-25T04:52:00Z";

describe("Stay until ahead (v7.0; owner 12 Nov, Q1-Q4 25 Nov; sample screens 4-6)", () => {
  it("names a date the way the card shows it", () => {
    expect(planDay("2026-11-28")).toBe("Sat 28 Nov");
    expect(planDay("2027-01-01")).toBe("Fri 1 Jan");
  });

  it("words a plan, with Today for today's", () => {
    expect(planLine({ workDate: "2026-11-28", until: UNTIL }, "2026-11-25")).toBe(
      "Sat 28 Nov · until 8:00 pm",
    );
    expect(planLine({ workDate: "2026-11-28", until: UNTIL }, "2026-11-28")).toBe(
      "Today · until 8:00 pm",
    );
  });

  it("is not used on a full day off or an afternoon off, but is on a morning off", () => {
    const leave = (half: string | null) => [
      { startDate: "2026-11-27", endDate: "2026-11-29", half },
    ];
    expect(planOnLeave("2026-11-28", leave(null))).toBe(true);
    expect(planOnLeave("2026-11-28", leave("afternoon"))).toBe(true);
    expect(planOnLeave("2026-11-28", leave("morning"))).toBe(false);
    expect(planOnLeave("2026-11-30", leave(null))).toBe(false);
    expect(planOnLeave("2026-11-28", [])).toBe(false);
  });

  it("tells the person in the morning who set it", () => {
    expect(stayPlanStripLine(UNTIL, "Prishit Shetty")).toBe(
      "Stay until 8:00 pm today (set by Prishit)",
    );
    expect(stayPlanStripLine(UNTIL, null)).toBe("Stay until 8:00 pm today (set by the Owner)");
    expect(firstName("  Asha  Rao ")).toBe("Asha");
  });
});

describe("Clear Late (v7.0; owner Q2 14 Nov, confirmations 25 Nov; sample screens 1-3)", () => {
  it("words the phone's try as a note, never the record", () => {
    expect(triedLine(TRIED)).toBe("Tried at 9:58 am, no network (phone time)");
    expect(offlineTryReason(TRIED)).toBe("No network. First tried 9:58 am (phone time)");
    expect(clearedReason(TRIED)).toBe(
      "No network at the start; tried 9:58 am by the phone's clock.",
    );
  });

  it("words an Approvals row, with the day only when it is not today", () => {
    const day = {
      dayId: "d",
      memberId: "m",
      memberName: "Asha Rao",
      memberAvatarFileId: null,
      workDate: "2026-11-25",
      startedAt: STARTED,
      lateMinutes: 22,
      triedAt: TRIED,
    };
    expect(lateNoNetworkWords(day, "2026-11-25")).toEqual({
      started: "Started 10:22 am",
      lateChip: "Late 22 min",
      tried: "Tried at 9:58 am, no network (phone time)",
      clearedReason: "No network at the start; tried 9:58 am by the phone's clock.",
    });
    expect(lateNoNetworkWords(day, "2026-11-26").started).toBe("Wed 25 Nov · Started 10:22 am");
  });
});
