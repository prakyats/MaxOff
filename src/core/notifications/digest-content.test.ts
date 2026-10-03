import { describe, expect, it } from "vitest";

import {
  type DigestPayload,
  digestSamplePage,
  digestSections,
  digestSubject,
  heldBackLabel,
  NOTHING_NEEDS_YOU,
  parseDigestPayload,
  renderDigestEmail,
} from "./digest-content";

const ORIGIN = "https://app.example";

function payload(extra: Partial<DigestPayload> = {}): DigestPayload {
  return {
    date: "2026-10-03",
    yesterday: "2026-10-02",
    attendance: {
      present: 2,
      on_leave: 3,
      absent: 7,
      absent_names: ["Asha", "Bala", "Chitra", "Dev", "Esha"],
      absent_more: 2,
      day_not_ended: 1,
      day_not_ended_names: ["Kiran"],
      day_not_ended_more: 0,
    },
    tasks: { approved_yesterday: 1, overdue: 4, waiting_for_owner: 2 },
    requests: { leave: 1, expense_claims: 2 },
    held_back: [{ kind: "reminder_overdue", description: "Overdue (1 h)", count: 3 }],
    ...extra,
  };
}

function zero(): DigestPayload {
  return payload({
    attendance: {
      present: 0,
      on_leave: 0,
      absent: 0,
      absent_names: [],
      absent_more: 0,
      day_not_ended: 0,
      day_not_ended_names: [],
      day_not_ended_more: 0,
    },
    tasks: { approved_yesterday: 0, overdue: 0, waiting_for_owner: 0 },
    requests: { leave: 0, expense_claims: 0 },
    held_back: [],
  });
}

const open = (to: string) => `${ORIGIN}/open?to=${encodeURIComponent(to)}`;

describe("digestSections", () => {
  it("lists every line under its heading, each opening its screen", () => {
    expect(digestSections(payload())).toEqual([
      {
        heading: "Attendance yesterday",
        lines: [
          { text: "Present: 2", link: "/reports/month?month=2026-10" },
          { text: "On leave: 3", link: "/reports/month?month=2026-10" },
          {
            text: "Absent: 7 (Asha, Bala, Chitra, Dev, Esha +2 more)",
            link: "/reports/month?month=2026-10",
          },
          { text: "Day not ended: 1 (Kiran)", link: "/reports/month?month=2026-10" },
        ],
      },
      {
        heading: "Tasks",
        lines: [
          { text: "Approved yesterday: 1", link: "/tasks/all?state=completed" },
          { text: "Overdue now: 4", link: "/tasks/all?overdue=overdue" },
          { text: "Waiting for your approval: 2", link: "/approvals" },
        ],
      },
      {
        heading: "Requests waiting for you",
        lines: [
          { text: "Leave requests: 1", link: "/approvals" },
          { text: "Expense claims: 2", link: "/approvals" },
        ],
      },
      {
        heading: "Emails held back yesterday by the daily limit",
        lines: [{ text: "Overdue reminders: 3", link: null }],
      },
    ]);
  });

  it("leaves out a line at 0 and a section with no line", () => {
    const base = zero();
    const sections = digestSections({
      ...base,
      tasks: { ...base.tasks, overdue: 2 },
      held_back: [{ kind: "task_assigned", description: null, count: 0 }],
    });
    expect(sections).toEqual([
      { heading: "Tasks", lines: [{ text: "Overdue now: 2", link: "/tasks/all?overdue=overdue" }] },
    ]);
  });

  it("opens yesterday's month: on the 1st, last month", () => {
    const [attendance] = digestSections(payload({ date: "2026-11-01", yesterday: "2026-10-31" }));
    expect(attendance?.lines[0]?.link).toBe("/reports/month?month=2026-10");
  });

  it("names up to 5 and counts the rest; no names, no brackets", () => {
    const base = payload();
    const [attendance] = digestSections({
      ...base,
      attendance: { ...base.attendance, absent: 5, absent_more: 0, day_not_ended_names: [] },
    });
    expect(attendance?.lines.map((line) => line.text)).toEqual([
      "Present: 2",
      "On leave: 3",
      "Absent: 5 (Asha, Bala, Chitra, Dev, Esha)",
      "Day not ended: 1",
    ]);
  });
});

describe("heldBackLabel", () => {
  it("words a known kind, else its description, else a plain label; never the identifier", () => {
    expect(heldBackLabel("escalation_overdue", "x")).toBe("Overdue escalations");
    expect(heldBackLabel("some_new_kind", "A new kind of message")).toBe("A new kind of message");
    expect(heldBackLabel("some_new_kind", null)).toBe("Other emails");
    expect(heldBackLabel("some_new_kind", "  ")).toBe("Other emails");
  });
});

describe("renderDigestEmail", () => {
  it("names the IST day in the subject", () => {
    expect(digestSubject("2026-10-03")).toBe("Your morning summary · Sat 3 Oct");
    expect(renderDigestEmail(payload(), ORIGIN).subject).toBe("Your morning summary · Sat 3 Oct");
  });

  it("links every line through /open?to= in both parts; the held-back line opens nothing", () => {
    const email = renderDigestEmail(payload(), ORIGIN);
    expect(email.text).toContain(`Overdue now: 4: ${open("/tasks/all?overdue=overdue")}`);
    expect(email.text).toContain(`Leave requests: 1: ${open("/approvals")}`);
    expect(email.text).toContain("\nOverdue reminders: 3\n");
    expect(email.html).toContain(
      `href="${open("/tasks/all?state=completed")}" style="color:#c42126;text-decoration:underline">Approved yesterday: 1</a>`,
    );
    expect(email.html).toContain(">Overdue reminders: 3</p>");
    expect(email.html).not.toMatch(/href="[^"]*"[^>]*>Overdue reminders/);
    for (const heading of [
      "Attendance yesterday",
      "Tasks",
      "Requests waiting for you",
      "Emails held back yesterday by the daily limit",
    ]) {
      expect(email.html).toContain(`>${heading}</h2>`);
      expect(email.text).toContain(`\n${heading}\n`);
    }
  });

  it('says only "Nothing needs you today." when everything is 0', () => {
    const email = renderDigestEmail(zero(), ORIGIN);
    expect(email.text).toBe(
      [
        "Your morning summary · Sat 3 Oct",
        "",
        NOTHING_NEEDS_YOU,
        "",
        "MaxOff emails this summary to the Owner every morning at 08:00 IST. It holds counts only, never an amount.",
      ].join("\n"),
    );
    expect(email.html).toContain(`>${NOTHING_NEEDS_YOU}</p>`);
    expect(email.html).not.toContain("<h2");
  });

  it("escapes every name and label", () => {
    const base = payload();
    const email = renderDigestEmail(
      {
        ...base,
        attendance: { ...base.attendance, absent_names: ['<img src=x onerror="alert(1)">'] },
        held_back: [{ kind: "x", description: "<script>bad()</script>", count: 1 }],
      },
      ORIGIN,
    );
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(email.html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  });

  it("carries no amount: no currency sign or decimal anywhere", () => {
    const email = renderDigestEmail(payload(), ORIGIN);
    expect(`${email.subject}\n${email.text}`).not.toMatch(/₹|Rs\.?\s|INR|\d+\.\d{2}/);
  });
});

describe("parseDigestPayload", () => {
  it("accepts the database's payload", () => {
    expect(parseDigestPayload(payload())).toEqual(payload());
  });

  it("refuses anything else rather than throwing", () => {
    expect(parseDigestPayload(null)).toBeNull();
    expect(parseDigestPayload({})).toBeNull();
    expect(parseDigestPayload({ ...payload(), date: "3 Oct" })).toBeNull();
    expect(parseDigestPayload({ ...payload(), tasks: { overdue: -1 } })).toBeNull();
    const base = payload();
    expect(
      parseDigestPayload({
        ...base,
        attendance: { ...base.attendance, absent_names: ["a", "b", "c", "d", "e", "f"] },
      }),
    ).toBeNull();
  });
});

describe("digestSamplePage", () => {
  it("shows the subject and the text part above the email, escaped", () => {
    const email = renderDigestEmail(payload(), ORIGIN);
    const page = digestSamplePage(email);
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain("Sample only: nothing was sent or saved.");
    expect(page).toContain("Subject: Your morning summary · Sat 3 Oct");
    expect(page.indexOf("Subject:")).toBeLessThan(page.indexOf("<h1"));
    expect(page).toContain(email.html.slice(email.html.indexOf("<table")));
  });
});
