import { describe, expect, it } from "vitest";

import {
  describeEvent,
  describeHistoryDay,
  eventActor,
  type HistoryDay,
  type HistoryEvent,
} from "../domain/history";
import {
  addMonths,
  historyMonth,
  isMonth,
  monthLabel,
  monthOf,
  monthRange,
} from "../domain/months";

const ME = "00000000-0000-4000-8000-000000000003";
const OWNER = "00000000-0000-4000-8000-000000000001";

const EVENT: HistoryEvent = {
  id: 1,
  action: "submitted",
  fromStatus: null,
  toStatus: "present",
  reason: null,
  actor: "you",
  at: "2026-09-24T03:40:00Z",
};
const event = (patch: Partial<HistoryEvent>): HistoryEvent => ({ ...EVENT, ...patch });

const DAY: HistoryDay = {
  id: "00000000-0000-4000-8000-0000000000aa",
  workDate: "2026-09-24",
  state: "approved",
  submittedChoice: "present",
  finalStatus: "present",
  isDayOff: false,
  workedOnLeave: false,
  firstLoginAt: "2026-09-24T03:40:00Z",
  lastLogoutAt: null,
  logoutNotRecorded: false,
  overtimeFlag: false,
  overtimeReason: null,
  events: [],
};
const day = (patch: Partial<HistoryDay>): HistoryDay => ({ ...DAY, ...patch });

describe("eventActor", () => {
  it("tells the member, the Owner and MaxOff apart", () => {
    expect(eventActor(ME, ME)).toBe("you");
    expect(eventActor(OWNER, ME)).toBe("owner");
    expect(eventActor(null, ME)).toBe("system");
  });
});

describe("describeEvent speaks to the member, not in database words", () => {
  it("a system correction after a leave approval", () => {
    expect(
      describeEvent(
        event({
          action: "corrected",
          actor: "system",
          fromStatus: "present",
          toStatus: "leave",
          reason: "leave approved",
        }),
      ),
    ).toEqual({ text: "Changed to leave: your leave request was approved", note: null });
  });

  it("a day handed back to the gate when leave was cancelled", () => {
    expect(
      describeEvent(
        event({ action: "corrected", actor: "system", toStatus: null, reason: "leave cancelled" }),
      ).text,
    ).toBe("Your leave was cancelled, so the day asked for a choice again");
  });

  it("the Owner's correction, with the Owner's reason", () => {
    expect(
      describeEvent(
        event({ action: "corrected", actor: "owner", toStatus: "absent", reason: "Not in office" }),
      ),
    ).toEqual({
      text: "The Owner changed it to absent",
      note: "The Owner's reason: Not in office",
    });
  });

  it("the member's own choice and note", () => {
    expect(describeEvent(event({ reason: "Client visit" }))).toEqual({
      text: "You chose present",
      note: "Your note: Client visit",
    });
    expect(describeEvent(event({ toStatus: "half_day" })).text).toBe("You chose half day");
  });

  it("working on a day of approved leave", () => {
    expect(describeEvent(event({ fromStatus: "leave", toStatus: "present" })).text).toBe(
      "You said you're working on a day of approved leave",
    );
  });

  it("every other action", () => {
    expect(describeEvent(event({ action: "approved", actor: "owner" })).text).toBe(
      "The Owner approved present",
    );
    expect(
      describeEvent(
        event({ action: "derived_from_leave", actor: "system", toStatus: "comp_leave" }),
      ).text,
    ).toBe("Comp leave from your approved leave");
    expect(describeEvent(event({ action: "proposed_absent", actor: "system" })).text).toBe(
      "No attendance was chosen, so absent was proposed for the Owner",
    );
    expect(describeEvent(event({ action: "logout", toStatus: null })).text).toBe("Logged out");
    expect(
      describeEvent(event({ action: "overtime_flagged", toStatus: null, reason: "Late edit" })),
    ).toEqual({ text: "You flagged overtime", note: "Your note: Late edit" });
  });
});

describe("describeHistoryDay", () => {
  it("a day with no choice", () => {
    expect(
      describeHistoryDay(
        day({ state: "awaiting_choice", submittedChoice: null, finalStatus: null }),
      ),
    ).toMatchObject({ status: "Not chosen", dotStatus: "awaiting_choice" });
  });

  it("a choice waiting for the Owner, and a proposed absence", () => {
    expect(describeHistoryDay(day({ state: "pending_review", finalStatus: null }))).toMatchObject({
      status: "Present",
      standing: "Waiting for the Owner",
      dotStatus: "pending_review",
    });
    expect(
      describeHistoryDay(
        day({ state: "pending_review", submittedChoice: null, finalStatus: "absent" }),
      ).status,
    ).toBe("Absent (proposed)");
  });

  it("who changed a corrected day", () => {
    const system = event({
      action: "corrected",
      actor: "system",
      toStatus: "leave",
      reason: "leave approved",
    });
    const owner = event({
      id: 2,
      action: "corrected",
      actor: "owner",
      toStatus: "absent",
      reason: "x",
    });
    expect(
      describeHistoryDay(day({ state: "corrected", finalStatus: "leave", events: [system] })),
    ).toMatchObject({ status: "Leave", standing: "Your leave was approved", dotStatus: "leave" });
    expect(
      describeHistoryDay(
        day({ state: "corrected", finalStatus: "absent", events: [system, owner] }),
      ).standing,
    ).toBe("Changed by the Owner");
  });

  it("flags what is worth seeing without opening the day", () => {
    expect(
      describeHistoryDay(day({ isDayOff: true, overtimeFlag: true, logoutNotRecorded: true }))
        .flags,
    ).toEqual(["Worked on a day off", "Overtime", "Logout not recorded"]);
    expect(describeHistoryDay(day({ workedOnLeave: true })).flags).toEqual(["1 day worked"]);
    expect(describeHistoryDay(day({ isDayOff: true, finalStatus: "leave" })).flags).toEqual([]);
  });
});

describe("months", () => {
  it("reads and moves months across a year end", () => {
    expect(isMonth("2026-09")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth(["2026-09"])).toBe(false);
    expect(monthOf("2026-09-24")).toBe("2026-09");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-09", -21)).toBe("2024-12");
  });

  it("knows a month's first and last date, February included", () => {
    expect(monthRange("2026-09")).toEqual({ first: "2026-09-01", last: "2026-09-30" });
    expect(monthRange("2028-02")).toEqual({ first: "2028-02-01", last: "2028-02-29" });
    expect(monthLabel("2026-09")).toBe("September 2026");
  });

  it("holds the history between the first month and this one", () => {
    const bounds = { first: "2026-07", current: "2026-09" };
    expect(historyMonth(undefined, bounds)).toEqual({
      month: "2026-09",
      previous: "2026-08",
      next: null,
    });
    expect(historyMonth("2026-07", bounds)).toEqual({
      month: "2026-07",
      previous: null,
      next: "2026-08",
    });
    expect(historyMonth("2025-01", bounds).month).toBe("2026-07");
    expect(historyMonth("2031-01", bounds).month).toBe("2026-09");
    expect(historyMonth("nonsense", bounds).month).toBe("2026-09");
  });

  it("has one month when the member started this month (or starts tomorrow, next month)", () => {
    expect(historyMonth(undefined, { first: "2026-09", current: "2026-09" })).toEqual({
      month: "2026-09",
      previous: null,
      next: null,
    });
    expect(historyMonth(undefined, { first: "2026-10", current: "2026-09" }).month).toBe("2026-09");
  });
});
