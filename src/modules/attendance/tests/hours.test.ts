import { describe, expect, it } from "vitest";

import {
  askSheetDescription,
  boardHoursDetail,
  canSetStayUntil,
  earlyLeavePreviewDetail,
  earlyLeaveSubtitle,
  earlyLeaveTitle,
  type EarlyLeaveRequest,
  hoursStrip,
  hoursTodayCounts,
  type HoursToday,
  lateChip,
  lateMinutesAt,
  lateRule,
  lateSheetTitle,
  minutesInFull,
  minutesWords,
  monthHoursCounts,
  type OwnHours,
} from "../domain/hours";

/** Mon 2 Nov 2026, IST (UTC+5:30). */
const at = (time: string) => new Date(`2026-11-02T${time}:00+05:30`);
const iso = (time: string) => at(time).toISOString();

const HOURS: OwnHours = {
  workDate: "2026-11-02",
  rulesOn: true,
  lateApplies: true,
  earlyApplies: true,
  half: null,
  startAt: iso("10:00"),
  lateAfter: iso("10:15"),
  endAt: iso("18:00"),
  endSource: "work",
  stayUntil: null,
  lateMinutes: null,
  lateReason: null,
  lateReasonSuggestion: null,
  earlyLeave: null,
  canEndNow: false,
  waitMinutes: 30,
};
const hours = (patch: Partial<OwnHours>): OwnHours => ({ ...HOURS, ...patch });

describe("durations", () => {
  it("says minutes short on chips and in full in titles", () => {
    expect(minutesWords(22)).toBe("22 min");
    expect(minutesWords(60)).toBe("1 h");
    expect(minutesWords(65)).toBe("1 h 5 min");
    expect(minutesInFull(1)).toBe("1 minute");
    expect(minutesInFull(22)).toBe("22 minutes");
    expect(minutesInFull(61)).toBe("1 hour 1 minute");
    expect(minutesInFull(120)).toBe("2 hours");
    expect(lateChip(22)).toBe("Late 22 min");
    expect(lateSheetTitle(22)).toBe("You're starting 22 minutes late");
  });
});

describe("Start day's Late rule (sample §1)", () => {
  it("asks the reason only after the start plus the grace", () => {
    const rule = lateRule(hours({ lateReasonSuggestion: "Shoot at 2:00 pm" }));
    expect(rule?.suggestion).toBe("Shoot at 2:00 pm");
    expect(lateMinutesAt(rule, at("10:15"))).toBeNull();
    expect(lateMinutesAt(rule, at("10:16"))).toBe(16);
    expect(lateMinutesAt(rule, at("10:22"))).toBe(22);
  });

  it("has no rule with the switch off, on a morning half day, or with no hours", () => {
    expect(lateRule(hours({ rulesOn: false }))).toBeNull();
    expect(lateRule(hours({ lateApplies: false, half: "morning" }))).toBeNull();
    expect(lateRule(null)).toBeNull();
    expect(lateMinutesAt(null, at("12:00"))).toBeNull();
  });
});

describe("the strip (sample §1–2)", () => {
  it("is as before with the switch off", () => {
    expect(hoursStrip(hours({ rulesOn: false, lateMinutes: 20 }), true, at("12:00"))).toEqual({
      late: null,
      endLine: null,
      early: null,
      endAction: "end",
      refreshAt: null,
    });
  });

  it("before the end time: Late with its reason, the end time, and Ask to leave early", () => {
    const strip = hoursStrip(hours({ lateMinutes: 22, lateReason: "Traffic" }), true, at("12:00"));
    expect(strip.late).toEqual({ chip: "Late 22 min", reason: "Traffic" });
    expect(strip.endLine).toBe("Your day ends at 6:00 pm");
    expect(strip.endAction).toBe("ask");
    expect(strip.refreshAt).toBe(iso("18:00"));
  });

  it("says why the end is later: a shoot, or the Owner's Stay until", () => {
    expect(
      hoursStrip(hours({ endAt: iso("19:30"), endSource: "shoot" }), true, at("12:00")).endLine,
    ).toBe("Your shoot runs till 7:30 pm, so today ends at 7:30 pm.");
    expect(
      hoursStrip(hours({ endAt: iso("20:00"), endSource: "stay" }), true, at("12:00")).endLine,
    ).toBe("The Owner asked you to stay until 8:00 pm. Your day ends at 8:00 pm.");
  });

  it("at or after the end time End day is one tap", () => {
    expect(hoursStrip(hours({ canEndNow: true }), true, at("18:00")).endAction).toBe("end");
  });

  it("an afternoon half day has no end time rule: End day as before", () => {
    const strip = hoursStrip(hours({ earlyApplies: false, half: "afternoon" }), true, at("13:00"));
    expect(strip.endAction).toBe("end");
    expect(strip.endLine).toBeNull();
  });

  it("while waiting: the minutes and when End day comes back; no button", () => {
    const strip = hoursStrip(
      hours({
        earlyLeave: {
          id: "r",
          state: "waiting",
          reason: "Doctor",
          requestedAt: iso("16:30"),
          endFrom: iso("17:00"),
        },
      }),
      true,
      at("16:42"),
    );
    expect(strip.endAction).toBe("none");
    expect(strip.early).toEqual({
      tone: "waiting",
      label: "Waiting",
      text: "Asked to leave at 4:30 pm · 12 min ago. You can end your day at 5:00 pm if there's no answer.",
    });
    expect(strip.refreshAt).toBe(iso("17:00"));
  });

  it("after the wait with no answer: End day, marked Left early, not answered", () => {
    const strip = hoursStrip(
      hours({
        canEndNow: true,
        earlyLeave: {
          id: "r",
          state: "waiting",
          reason: "Doctor",
          requestedAt: iso("16:30"),
          endFrom: iso("17:00"),
        },
      }),
      true,
      at("17:05"),
    );
    expect(strip.endAction).toBe("end");
    expect(strip.early?.label).toBe("No answer");
    expect(strip.early?.text).toContain('It\'s marked "Left early, not answered"');
  });

  it("after Stay: the message, and Ask to leave early again until the end time", () => {
    const strip = hoursStrip(
      hours({
        earlyLeave: {
          id: "r",
          state: "stay",
          reason: "x",
          requestedAt: iso("15:00"),
          endFrom: null,
        },
      }),
      true,
      at("15:10"),
    );
    expect(strip.early?.text).toBe(
      "The Owner asked you to stay until 6:00 pm. You'll be reminded then.",
    );
    expect(strip.endAction).toBe("ask");
  });

  it("an ended day keeps Late and how an early leave ended", () => {
    const approved = hoursStrip(
      hours({
        lateMinutes: 5,
        earlyLeave: {
          id: "r",
          state: "approved",
          reason: "x",
          requestedAt: iso("16:30"),
          endFrom: null,
        },
      }),
      false,
      at("17:00"),
    );
    expect(approved.late?.chip).toBe("Late 5 min");
    expect(approved.early?.text).toBe("The Owner approved. Your day ended at 4:30 pm.");
    expect(approved.endAction).toBe("end");
  });

  it("the ask sheet says the end time and the wait", () => {
    expect(askSheetDescription(iso("18:00"), 30)).toBe(
      "Your day ends at 6:00 pm. The Owner decides. If there's no answer in 30 minutes, you can end your day.",
    );
    expect(askSheetDescription(iso("18:00"), null)).toBe(
      "Your day ends at 6:00 pm. The Owner decides.",
    );
  });
});

describe("the Owner's words (sample §3)", () => {
  const request: EarlyLeaveRequest = {
    id: "r",
    memberId: "m",
    memberName: "PShetty",
    memberAvatarFileId: null,
    workDate: "2026-11-02",
    state: "waiting",
    reason: "Doctor's appointment at 5",
    requestedAt: iso("16:30"),
    leftAt: null,
    dayId: "d",
  };

  it("names a waiting request and a day left without an answer", () => {
    expect(earlyLeaveTitle(request)).toBe("PShetty · leave at 4:30 pm");
    expect(earlyLeaveSubtitle(request, at("16:42"), "2026-11-02", (d) => d)).toBe(
      "Doctor's appointment at 5 · waiting 12 min",
    );
    const left = { ...request, state: "left_unanswered" as const, leftAt: iso("17:05") };
    expect(earlyLeaveTitle(left)).toBe("PShetty · ended 5:05 pm");
    expect(earlyLeaveSubtitle(left, at("18:00"), "2026-11-02", (d) => d)).toBe(
      "Asked at 4:30 pm · “Doctor's appointment at 5”",
    );
    expect(earlyLeaveSubtitle(left, at("18:00"), "2026-11-03", () => "Mon 2 Nov")).toBe(
      "Mon 2 Nov · Asked at 4:30 pm · “Doctor's appointment at 5”",
    );
  });

  it("words the Owner's Today rows (W4 Q2): the time and reason, the day for a left one", () => {
    expect(earlyLeavePreviewDetail(request, () => "Mon 2 Nov")).toBe(
      "Leave at 4:30 pm · “Doctor's appointment at 5”",
    );
    const left = { ...request, state: "left_unanswered" as const, leftAt: iso("17:05") };
    expect(earlyLeavePreviewDetail(left, () => "Mon 2 Nov")).toBe(
      "Ended 5:05 pm, Mon 2 Nov · “Doctor's appointment at 5”",
    );
  });

  const today = (patch: Partial<HoursToday>): HoursToday => ({
    memberId: "m",
    rulesOn: true,
    startedAt: iso("10:22"),
    endedAt: null,
    lateMinutes: null,
    lateReason: null,
    endAt: iso("18:00"),
    endSource: "work",
    stayUntil: null,
    earlyLeaveState: null,
    leftEarly: false,
    endedAfterEnd: false,
    ...patch,
  });

  it("counts Late and ended after the end time, none with the switch off", () => {
    expect(
      hoursTodayCounts([
        today({ lateMinutes: 22 }),
        today({ endedAfterEnd: true }),
        today({ lateMinutes: 5, rulesOn: false }),
      ]),
    ).toEqual({ late: 1, afterEnd: 1 });
  });

  it("says a board row's hours and when Stay until can be set", () => {
    expect(boardHoursDetail(today({ lateMinutes: 22, lateReason: "Traffic" }))).toBe(
      "Late 22 min · “Traffic”",
    );
    expect(boardHoursDetail(today({ stayUntil: iso("20:00"), earlyLeaveState: "waiting" }))).toBe(
      "Stay until 8:00 pm · Asked to leave early",
    );
    expect(boardHoursDetail(today({}))).toBeNull();
    expect(boardHoursDetail(undefined)).toBeNull();
    expect(canSetStayUntil(today({}))).toBe(true);
    expect(canSetStayUntil(today({ endedAt: iso("18:05") }))).toBe(false);
    expect(canSetStayUntil(today({ startedAt: null }))).toBe(false);
    expect(canSetStayUntil(today({ rulesOn: false }))).toBe(false);
  });
});

describe("the month counts (sample §5)", () => {
  it("labels each, a dash for zero, Late in amber", () => {
    const counts = monthHoursCounts({
      lateDays: 3,
      lateMinutes: 52,
      leftUnanswered: 1,
      earlyLeavesApproved: 0,
      halfDaysMorning: 1,
      halfDaysAfternoon: 0,
    });
    expect(counts.map((count) => [count.label, count.value, count.detail, count.tone])).toEqual([
      ["Late days", "3", "52 min in all", "attention"],
      ["Left early, not answered", "1", null, null],
      ["Early leaves approved", "—", null, null],
      ["Half days", "1", "1 morning · 0 afternoon", null],
    ]);
  });
});
