import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import {
  approvalDetail,
  attendanceLine,
  cutoffWords,
  decisionLines,
  type EodReport,
  eodDateHeading,
  eodDayState,
  eodHref,
  eodListEntries,
  eventDetail,
  groupCount,
  isQuietDay,
  liveNote,
  parseEodDate,
  parseEodReport,
  personDetail,
  personStatus,
  savedNote,
  taskDetail,
} from "../domain/eod";

const TODAY = "2026-10-07";
const KIRAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const group = (count = 0, items: EodReport["tasks"]["completed"]["items"] = [], freelance = 0) => ({
  count,
  freelance,
  more: 0,
  items,
});

function report(patch: Partial<EodReport> = {}): EodReport {
  return {
    date: "2026-10-06",
    day_off: { holiday: null, weekly_off: false },
    attendance: {
      counts: {
        present: 2,
        on_leave: 1,
        absent: 1,
        proposed_absent: 1,
        waiting: 1,
        end_not_recorded: 1,
        overtime: 1,
      },
      people: [
        {
          member_id: KIRAN,
          name: "Kiran",
          status: "present",
          waiting: false,
          proposed: false,
          started_at: istInstant("2026-10-06", "09:30"),
          ended_at: istInstant("2026-10-06", "20:00"),
          end_not_recorded: false,
          overtime: true,
          overtime_reason: "Late shoot",
        },
      ],
    },
    decisions: {
      attendance: 2,
      leave: { approved: 1, rejected: 0 },
      comp_leave: { granted: 0, revoked: 1, reviewed: 0 },
      expense_claims: 2,
    },
    tasks: {
      completed: group(2, [{ id: TASK, title: "Reel", owner: "Asha", freelance: true }], 1),
      handed_in: group(),
      overdue: group(1, [
        {
          id: TASK,
          title: "Edit",
          owner: "Kiran",
          freelance: false,
          due_at: istInstant("2026-10-06", "18:00"),
          late_reason: "Client moved it",
        },
      ]),
      cancelled: group(),
      created: group(),
    },
    approvals: [
      { reviewer_id: KIRAN, name: "Owner", step: "owner", approved: 2, changes_requested: 1 },
    ],
    tomorrow: {
      date: "2026-10-07",
      events: [
        {
          id: TASK,
          title: "Shoot",
          start_at: istInstant("2026-10-07", "10:00"),
          end_at: istInstant("2026-10-07", "12:00"),
          location: "Studio B",
          people: ["Kiran", "Lata"],
        },
      ],
    },
    ...patch,
  };
}

describe("the report's payload", () => {
  it("is checked, and a payload that is not one reads as null", () => {
    expect(parseEodReport(report())).toEqual(report());
    expect(parseEodReport({ date: "nope" })).toBeNull();
    expect(parseEodReport(null)).toBeNull();
  });

  it("has no amount anywhere in its shape", () => {
    expect(JSON.stringify(report())).not.toMatch(/amount|rupee|paid|salary|revenue/i);
  });
});

describe("live, saved or still to come (decision 17)", () => {
  const at = (time: string) => new Date(istInstant(TODAY, time));

  it("today is live; yesterday live until the cutoff, saved after; earlier saved; later future", () => {
    expect(eodDayState({ date: TODAY, today: TODAY, cutoff: "05:00", now: at("09:00") })).toBe(
      "today",
    );
    expect(
      eodDayState({ date: "2026-10-06", today: TODAY, cutoff: "05:00", now: at("04:59") }),
    ).toBe("yesterday_live");
    expect(
      eodDayState({ date: "2026-10-06", today: TODAY, cutoff: "05:00", now: at("05:00") }),
    ).toBe("saved");
    expect(
      eodDayState({ date: "2026-10-06", today: TODAY, cutoff: "09:30", now: at("09:29") }),
    ).toBe("yesterday_live");
    expect(
      eodDayState({ date: "2026-10-01", today: TODAY, cutoff: "05:00", now: at("01:00") }),
    ).toBe("saved");
    expect(
      eodDayState({ date: "2026-10-08", today: TODAY, cutoff: "05:00", now: at("23:00") }),
    ).toBe("future");
  });

  it("says when a live day saves, in the setting's words", () => {
    expect(cutoffWords("05:00")).toBe("5:00 AM");
    expect(cutoffWords("00:00")).toBe("12:00 AM");
    expect(cutoffWords("11:45")).toBe("11:45 AM");
    expect(liveNote("yesterday_live", "05:00")).toBe("Live until it saves at 5:00 AM.");
    expect(liveNote("today", "05:00")).toBe("Live: today so far. It saves tomorrow morning.");
    expect(liveNote("saved", "05:00")).toBeNull();
    // A saved day says when, in IST, on the live note's line.
    expect(savedNote("2026-10-06T23:30:00.000Z")).toBe("Saved 7 Oct, 5:00 am.");
  });

  it("names the day and its address", () => {
    expect(eodDateHeading(TODAY, TODAY)).toBe("Today · Wed 7 Oct 2026");
    expect(eodDateHeading("2026-10-06", TODAY)).toBe("Yesterday · Tue 6 Oct 2026");
    expect(eodDateHeading("2026-10-01", TODAY)).toBe("Thu 1 Oct 2026");
    expect(eodHref("2026-10-06")).toBe("/reports/end-of-day/2026-10-06");
    expect(parseEodDate("2026-10-06")).toBe("2026-10-06");
    expect(parseEodDate("yesterday")).toBeNull();
    expect(parseEodDate(undefined)).toBeNull();
  });

  it("lists today, yesterday, then the saved history newest first", () => {
    const entries = eodListEntries({
      today: TODAY,
      cutoff: "05:00",
      now: at("04:30"),
      saved: [
        { date: "2026-10-04", generatedAt: istInstant("2026-10-05", "05:00") },
        { date: "2026-10-05", generatedAt: istInstant("2026-10-06", "05:00") },
      ],
    });
    expect(entries.map((e) => [e.date, e.state, e.detail])).toEqual([
      [TODAY, "today", "Live, so far"],
      ["2026-10-06", "yesterday_live", "Live · saves at 5:00 AM"],
      ["2026-10-05", "saved", "Saved 6 Oct, 5:00 am"],
      ["2026-10-04", "saved", "Saved 5 Oct, 5:00 am"],
    ]);
    const after = eodListEntries({ today: TODAY, cutoff: "05:00", now: at("06:00"), saved: [] });
    expect(after[1]).toMatchObject({ date: "2026-10-06", state: "missing", detail: "Not saved" });
  });
});

describe("words", () => {
  it("says what a person's day was", () => {
    const [kiran] = report().attendance.people;
    expect(personStatus(kiran!)).toBe("Present");
    expect(personDetail(kiran!)).toBe("Started 9:30 am · Ended 8:00 pm · Overtime: Late shoot");
    expect(personStatus({ ...kiran!, status: "absent", waiting: true, proposed: true })).toBe(
      "Absent (proposed)",
    );
    expect(personStatus({ ...kiran!, status: "leave", waiting: true, proposed: false })).toBe(
      "Leave · waiting",
    );
    expect(
      personDetail({ ...kiran!, ended_at: null, end_not_recorded: true, overtime: false }),
    ).toBe("Started 9:30 am · End of day not recorded");
  });

  it("sums the attendance, lists the decisions, counts freelancers apart", () => {
    expect(attendanceLine(report().attendance.counts)).toBe(
      "2 present · 1 on leave · 1 absent (1 proposed) · 1 waiting · 1 end not recorded · 1 overtime",
    );
    expect(decisionLines(report().decisions)).toEqual([
      "2 attendance decisions",
      "1 leave request approved",
      "1 comp leave taken back",
      "2 expense claims decided",
    ]);
    expect(groupCount(report().tasks.completed)).toBe("2 · 1 freelance");
    expect(groupCount(report().tasks.overdue)).toBe("1");
  });

  it("details a task, an approver and an event", () => {
    expect(taskDetail("overdue", report().tasks.overdue.items[0]!)).toBe(
      "Kiran · due 6 Oct, 6:00 pm · Late: Client moved it",
    );
    expect(taskDetail("completed", report().tasks.completed.items[0]!)).toBe("Asha (freelancer)");
    expect(
      taskDetail("cancelled", {
        id: TASK,
        title: "X",
        owner: "Kiran",
        freelance: false,
        reason: "Not needed",
      }),
    ).toBe("Kiran · Not needed");
    expect(approvalDetail(report().approvals[0]!)).toBe("Approved 2 · Changes requested 1");
    expect(eventDetail(report().tomorrow.events[0]!)).toBe(
      "10:00 am – 12:00 pm · Studio B · Kiran, Lata",
    );
  });

  it("knows a quiet day", () => {
    expect(isQuietDay(report())).toBe(false);
    expect(
      isQuietDay(
        report({
          attendance: {
            counts: {
              present: 0,
              on_leave: 0,
              absent: 0,
              proposed_absent: 0,
              waiting: 0,
              end_not_recorded: 0,
              overtime: 0,
            },
            people: [],
          },
          decisions: {
            attendance: 0,
            leave: { approved: 0, rejected: 0 },
            comp_leave: { granted: 0, revoked: 0, reviewed: 0 },
            expense_claims: 0,
          },
          tasks: {
            completed: group(),
            handed_in: group(),
            overdue: group(),
            cancelled: group(),
            created: group(),
          },
          approvals: [],
          tomorrow: { date: "2026-10-07", events: [] },
        }),
      ),
    ).toBe(true);
  });
});
