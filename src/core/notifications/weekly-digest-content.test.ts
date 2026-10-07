import { describe, expect, it } from "vitest";

import {
  NOTHING_THIS_WEEK,
  parseWeeklyDigestPayload,
  renderWeeklyDigestEmail,
  type WeeklyDigestPayload,
  weeklyDigestSections,
  weeklyDigestSubject,
} from "./weekly-digest-content";

const ORIGIN = "https://app.example";
const REPORT = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";
const RAVI = "33333333-3333-4333-8333-333333333333";

const day = (date: string, patch: Partial<WeeklyDigestPayload["days"][number]> = {}) => ({
  date,
  report_id: REPORT,
  saved: true,
  present: 0,
  on_leave: 0,
  absent: 0,
  end_not_recorded: 0,
  overtime: 0,
  completed: 0,
  cancelled: 0,
  created: 0,
  decisions: 0,
  holiday: null,
  weekly_off: false,
  ...patch,
});

function payload(extra: Partial<WeeklyDigestPayload> = {}): WeeklyDigestPayload {
  return {
    date: "2026-10-12",
    week: { from: "2026-10-05", to: "2026-10-11" },
    days: [
      day("2026-10-05", { present: 4, completed: 2, decisions: 3 }),
      day("2026-10-06", { present: 3, absent: 1, end_not_recorded: 1 }),
      day("2026-10-07", { saved: false, report_id: null }),
      day("2026-10-08"),
      day("2026-10-09", { holiday: "Dussehra" }),
      day("2026-10-10", { present: 2, overtime: 1 }),
      day("2026-10-11", { weekly_off: true }),
    ],
    totals: {
      present: 9,
      on_leave: 0,
      absent: 1,
      end_not_recorded: 1,
      overtime: 1,
      completed: 2,
      cancelled: 0,
      created: 0,
      decisions: 3,
      missing: 1,
    },
    now: {
      waiting: { tasks: 1, leave: 2, expense_claims: 0, attendance: 1, extra_work: 0 },
      overdue: 4,
      unreachable: { count: 1, names: ["Ravi"], more: 0 },
    },
    ahead: {
      from: "2026-10-12",
      to: "2026-10-18",
      leave: [
        {
          member_id: RAVI,
          name: "Ravi",
          type: "leave",
          from: "2026-10-13",
          to: "2026-10-14",
          pending: false,
        },
        {
          member_id: RAVI,
          name: "Sana",
          type: "half_day",
          from: "2026-10-15",
          to: "2026-10-15",
          pending: true,
        },
      ],
      events: [
        {
          id: TASK,
          title: "Shoot",
          date: "2026-10-14",
          start_at: "2026-10-14T04:30:00.000Z",
          location: "Studio B",
        },
      ],
      holidays: [{ date: "2026-10-16", name: "Founders' day" }],
    },
    ...extra,
  };
}

function zero(): WeeklyDigestPayload {
  return payload({
    days: [],
    totals: {
      present: 0,
      on_leave: 0,
      absent: 0,
      end_not_recorded: 0,
      overtime: 0,
      completed: 0,
      cancelled: 0,
      created: 0,
      decisions: 0,
      missing: 0,
    },
    now: {
      waiting: { tasks: 0, leave: 0, expense_claims: 0, attendance: 0, extra_work: 0 },
      overdue: 0,
      unreachable: { count: 0, names: [], more: 0 },
    },
    ahead: { from: "2026-10-12", to: "2026-10-18", leave: [], events: [], holidays: [] },
  });
}

describe("the weekly digest's payload and subject", () => {
  it("is checked; anything else reads as null", () => {
    expect(parseWeeklyDigestPayload(payload())).toEqual(payload());
    expect(parseWeeklyDigestPayload({ date: "nope" })).toBeNull();
    expect(parseWeeklyDigestPayload({ ...payload(), now: { overdue: -1 } })).toBeNull();
  });

  it("names the week", () => {
    expect(weeklyDigestSubject({ from: "2026-10-05", to: "2026-10-11" })).toBe(
      "Your week · 5 – 11 Oct",
    );
    expect(weeklyDigestSubject({ from: "2026-09-28", to: "2026-10-04" })).toBe(
      "Your week · 28 Sep – 4 Oct",
    );
  });
});

describe("the sections (decision 23: the week from the saved reports, now, the week ahead)", () => {
  it("lists each day with its counts, opening its report; a missing day says so; the quiet ones drop", () => {
    const [week] = weeklyDigestSections(payload());
    expect(week?.heading).toBe("The week: Mon 5 Oct – Sun 11 Oct");
    expect(week?.lines).toEqual([
      {
        text: "Mon 5 Oct: 4 present, 2 completed, 3 decisions",
        link: "/reports/end-of-day/2026-10-05",
      },
      {
        text: "Tue 6 Oct: 3 present, 1 absent, 1 end not recorded",
        link: "/reports/end-of-day/2026-10-06",
      },
      { text: "Wed 7 Oct: no report saved", link: null },
      { text: "Fri 9 Oct: holiday, Dussehra", link: "/reports/end-of-day/2026-10-09" },
      { text: "Sat 10 Oct: 2 present, 1 overtime", link: "/reports/end-of-day/2026-10-10" },
      { text: "Sun 11 Oct: weekly off", link: "/reports/end-of-day/2026-10-11" },
    ]);
  });

  it("sums the week, then now, then the week ahead, each line opening its screen", () => {
    const sections = weeklyDigestSections(payload());
    expect(sections.map((s) => s.heading)).toEqual([
      "The week: Mon 5 Oct – Sun 11 Oct",
      "The week's totals",
      "Now",
      "The week ahead: Mon 12 Oct – Sun 18 Oct",
    ]);
    expect(sections[1]?.lines.map((l) => l.text)).toEqual([
      "Present, person-days: 9",
      "Absent, person-days: 1",
      "End of day not recorded: 1",
      "Overtime flagged: 1",
      "Tasks completed: 2",
      "Decisions you made: 3",
    ]);
    expect(sections[2]?.lines).toEqual([
      { text: "Tasks waiting for your approval: 1", link: "/approvals" },
      { text: "Attendance waiting for a decision: 1", link: "/approvals" },
      { text: "Leave requests: 2", link: "/approvals" },
      { text: "Overdue now: 4", link: "/tasks/all?overdue=overdue" },
      { text: "Can't be reached: 1 (Ravi)", link: "/settings/notifications" },
    ]);
    expect(sections[3]?.lines).toEqual([
      { text: "Holiday Fri 16 Oct: Founders' day", link: "/calendar?view=day&date=2026-10-16" },
      {
        text: "Ravi is on leave Tue 13 Oct – Wed 14 Oct",
        link: "/calendar?view=day&date=2026-10-13",
      },
      {
        text: "Sana has asked for a half day Thu 15 Oct",
        link: "/calendar?view=day&date=2026-10-15",
      },
      { text: "Wed 14 Oct, 10:00 am: Shoot · Studio B", link: `/tasks/${TASK}` },
    ]);
  });

  it("has no section when everything is zero", () => {
    expect(weeklyDigestSections(zero())).toEqual([]);
  });
});

describe("the email", () => {
  it("renders the subject, the sections with links through /open, and the footer", () => {
    const email = renderWeeklyDigestEmail(payload(), ORIGIN);
    expect(email.subject).toBe("Your week · 5 – 11 Oct");
    expect(email.text).toContain(
      `Mon 5 Oct: 4 present, 2 completed, 3 decisions: ${ORIGIN}/open?to=${encodeURIComponent("/reports/end-of-day/2026-10-05")}`,
    );
    expect(email.text).toContain("Wed 7 Oct: no report saved");
    expect(email.html).toContain(">The week&#39;s totals</h2>");
    expect(email.html).toContain("Founders&#39; day");
    expect(email.text).toContain("counts only, never an amount");
    expect(email.text).not.toMatch(/₹|\d+\.\d{2}\b/);
  });

  it("says when nothing needs the Owner", () => {
    const email = renderWeeklyDigestEmail(zero(), ORIGIN);
    expect(email.text).toContain(NOTHING_THIS_WEEK);
    expect(email.html).toContain(NOTHING_THIS_WEEK);
  });

  it("escapes what people typed", () => {
    const email = renderWeeklyDigestEmail(
      payload({
        ahead: {
          ...payload().ahead,
          events: [
            { id: TASK, title: "<b>Shoot</b>", date: "2026-10-14", start_at: null, location: null },
          ],
        },
      }),
      ORIGIN,
    );
    expect(email.html).toContain("&lt;b&gt;Shoot&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Shoot</b>");
    expect(email.text).toContain("Wed 14 Oct: <b>Shoot</b>");
  });
});
