import { describe, expect, it } from "vitest";

import { resendSender } from "./email";
import {
  type ClaimedEmail,
  emailGroups,
  type EmailStore,
  isRetryable,
  runEmailDispatch,
} from "./email-dispatcher";

const NOW = new Date("2026-10-01T04:30:00.000Z");

function claimed(id: string, extra: Partial<ClaimedEmail> = {}): ClaimedEmail {
  return {
    deliveryId: id,
    recipientId: "r1",
    email: "ravi@example.com",
    notificationId: `n-${id}`,
    kind: "task_assigned",
    title: "New task: Reel cut",
    body: "Due tomorrow",
    link: "/tasks/1",
    attempts: 1,
    batchId: null,
    escalationLevel: 0,
    ...extra,
  };
}

function fakeStore(items: ClaimedEmail[]) {
  const records: { id: string; outcome: string; error: string | null }[] = [];
  const claims: { now: Date; limit: number }[] = [];
  const store: EmailStore = {
    async claim(now, limit) {
      claims.push({ now, limit });
      return items;
    },
    async record(id, outcome, error) {
      records.push({ id, outcome, error });
    },
  };
  return { store, records, claims };
}

/** Resend's REST API stood in by a fetch that answers each call with the next status. */
function fakeResend(statuses: (number | "network")[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
    [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const status = statuses[calls.length - 1] ?? 200;
    if (status === "network") throw new TypeError("fetch failed");
    return new Response(status === 200 ? JSON.stringify({ id: "re_1" }) : "{}", { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("runEmailDispatch", () => {
  it("sends through Resend with the escaped content and records sent", async () => {
    const { store, records, claims } = fakeStore([
      claimed("d1", { title: "New task: <b>Reel</b>\r\nBcc: x@example.com" }),
    ]);
    const resend = fakeResend([200]);
    const report = await runEmailDispatch({
      store,
      sender: resendSender(
        "re_test_key",
        "MaxOff <notifications@mail.maxoff.in>",
        resend.fetchImpl,
      ),
      origin: "https://app.example",
      now: NOW,
    });
    expect(claims).toEqual([{ now: NOW, limit: 20 }]);
    expect(report).toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0, notConfigured: 0 });
    expect(records).toEqual([{ id: "d1", outcome: "sent", error: null }]);
    const [call] = resend.calls;
    expect(call!.url).toBe("https://api.resend.com/emails");
    expect(call!.headers.Authorization).toBe("Bearer re_test_key");
    expect(call!.body).toMatchObject({
      from: "MaxOff <notifications@mail.maxoff.in>",
      to: ["ravi@example.com"],
      subject: "New task: <b>Reel</b> Bcc: x@example.com",
    });
    expect(String(call!.body.html)).toContain("&lt;b&gt;Reel&lt;/b&gt;");
    expect(String(call!.body.html)).toContain("https://app.example/open?to=%2Ftasks%2F1");
    expect(call!.body).not.toHaveProperty("reply_to");
  });

  it("429, 5xx and a network failure retry; another 4xx fails at once", async () => {
    const { store, records } = fakeStore([
      claimed("d429"),
      claimed("d503"),
      claimed("dnet"),
      claimed("d422"),
    ]);
    const resend = fakeResend([429, 503, "network", 422]);
    const report = await runEmailDispatch({
      store,
      sender: resendSender("re_test_key", "MaxOff <n@x>", resend.fetchImpl),
      origin: "https://app.example",
      now: NOW,
    });
    expect(report).toEqual({ claimed: 4, sent: 0, retried: 3, failed: 1, notConfigured: 0 });
    expect(records).toEqual([
      { id: "d429", outcome: "retry", error: "resend_429" },
      { id: "d503", outcome: "retry", error: "resend_503" },
      { id: "dnet", outcome: "retry", error: "resend_unreachable" },
      { id: "d422", outcome: "failed", error: "resend_422" },
    ]);
  });

  it("with no RESEND_API_KEY nothing is sent: each row is failed not_configured, nothing throws", async () => {
    const { store, records } = fakeStore([claimed("d1"), claimed("d2")]);
    const report = await runEmailDispatch({
      store,
      sender: null,
      origin: "https://app.example",
      now: NOW,
    });
    expect(report).toEqual({ claimed: 2, sent: 0, retried: 0, failed: 2, notConfigured: 2 });
    expect(records.map((record) => [record.outcome, record.error])).toEqual([
      ["failed", "not_configured"],
      ["failed", "not_configured"],
    ]);
  });

  it("one item that throws is recorded as a retry and the run goes on with the others", async () => {
    const records: { id: string; outcome: string; error: string | null }[] = [];
    const store: EmailStore = {
      async claim() {
        return [claimed("d1"), claimed("bad"), claimed("d3")];
      },
      async record(id, outcome, error) {
        if (id === "bad" && outcome === "sent") throw new Error("connection reset");
        records.push({ id, outcome, error });
      },
    };
    const errors: unknown[] = [];
    const resend = fakeResend([200, 200, 200]);
    const report = await runEmailDispatch({
      store,
      sender: resendSender("re_test_key", "MaxOff <n@x>", resend.fetchImpl),
      origin: "https://app.example",
      now: NOW,
      onItemError: (error) => errors.push(error),
    });
    expect(resend.calls).toHaveLength(3);
    expect(records).toEqual([
      { id: "d1", outcome: "sent", error: null },
      { id: "bad", outcome: "retry", error: "dispatch_error" },
      { id: "d3", outcome: "sent", error: null },
    ]);
    expect(report).toEqual({ claimed: 3, sent: 2, retried: 1, failed: 0, notConfigured: 0 });
    expect(errors).toHaveLength(1);
  });

  it("a sender that throws is a retry for that item only", async () => {
    const { store, records } = fakeStore([claimed("d1"), claimed("d2")]);
    let calls = 0;
    const report = await runEmailDispatch({
      store,
      sender: {
        async send() {
          calls += 1;
          if (calls === 1) throw new Error("boom");
          return { ok: true, provider: "resend", id: null };
        },
      },
      origin: "https://app.example",
      now: NOW,
    });
    expect(records).toEqual([
      { id: "d1", outcome: "retry", error: "dispatch_error" },
      { id: "d2", outcome: "sent", error: null },
    ]);
    expect(report).toEqual({ claimed: 2, sent: 1, retried: 1, failed: 0, notConfigured: 0 });
  });

  it("when recording the retry also throws, the run still goes on (the lease expires)", async () => {
    const records: string[] = [];
    const store: EmailStore = {
      async claim() {
        return [claimed("bad"), claimed("d2")];
      },
      async record(id) {
        if (id === "bad") throw new Error("database down");
        records.push(id);
      },
    };
    const errors: unknown[] = [];
    const report = await runEmailDispatch({
      store,
      sender: null,
      origin: "https://app.example",
      now: NOW,
      onItemError: (error) => errors.push(error),
    });
    expect(records).toEqual(["d2"]);
    expect(errors).toHaveLength(2);
    expect(report).toEqual({ claimed: 2, sent: 0, retried: 0, failed: 1, notConfigured: 1 });
  });

  it("isRetryable: Resend's answers", () => {
    expect([undefined, 429, 500, 503].map(isRetryable)).toEqual([true, true, true, true]);
    expect([400, 401, 403, 404, 422].map(isRetryable)).toEqual([false, false, false, false, false]);
  });
});

describe("one email per person per run (5.3, owner 2026-10-02)", () => {
  it("groups a batch's rows, keeps every other row alone, in claim order", () => {
    const groups = emailGroups([
      claimed("a", { batchId: "b1" }),
      claimed("f"),
      claimed("b", { batchId: "b1" }),
      claimed("c", { batchId: "b2", recipientId: "r2" }),
    ]);
    expect(groups.map((group) => group.map((item) => item.deliveryId))).toEqual([
      ["a", "b"],
      ["f"],
      ["c"],
    ]);
  });

  it("sends a batch as one email named by its most urgent item, and records every row", async () => {
    const { store, records } = fakeStore([
      claimed("d1", {
        batchId: "b1",
        kind: "reminder_before_due_last",
        title: "Due in 1 day: Reel",
      }),
      claimed("d2", { batchId: "b1", kind: "reminder_overdue", title: "Overdue: Edit" }),
      claimed("d3", {
        batchId: "b1",
        kind: "escalation_not_noted",
        title: "Not noted yet: Shoot",
        escalationLevel: 1,
      }),
    ]);
    const resend = fakeResend([200]);
    const report = await runEmailDispatch({
      store,
      sender: resendSender("re_test_key", "MaxOff <n@mail.maxoff.in>", resend.fetchImpl),
      origin: "https://app.example",
      now: NOW,
    });
    expect(resend.calls).toHaveLength(1);
    expect(resend.calls[0]!.body.subject).toBe("Not noted yet: Shoot · +2 more");
    expect(String(resend.calls[0]!.body.text)).toContain("Overdue: Edit");
    expect(String(resend.calls[0]!.body.text)).toContain("Due in 1 day: Reel");
    expect(report).toEqual({ claimed: 3, sent: 3, retried: 0, failed: 0, notConfigured: 0 });
    expect(records.map((record) => `${record.id}:${record.outcome}`)).toEqual([
      "d1:sent",
      "d2:sent",
      "d3:sent",
    ]);
  });

  it("retries the whole batch together when Resend is busy", async () => {
    const { store, records } = fakeStore([
      claimed("d1", { batchId: "b1", kind: "reminder_overdue" }),
      claimed("d2", { batchId: "b1", kind: "reminder_event" }),
    ]);
    const resend = fakeResend([429]);
    await runEmailDispatch({
      store,
      sender: resendSender("re_test_key", "MaxOff <n@mail.maxoff.in>", resend.fetchImpl),
      origin: "https://app.example",
      now: NOW,
    });
    expect(records).toEqual([
      { id: "d1", outcome: "retry", error: "resend_429" },
      { id: "d2", outcome: "retry", error: "resend_429" },
    ]);
  });
});

describe("the Owner's weekly summary (6.5)", () => {
  const weeklyPayload = {
    date: "2026-10-12",
    week: { from: "2026-10-05", to: "2026-10-11" },
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
      missing: 7,
    },
    now: {
      waiting: { tasks: 0, leave: 1, expense_claims: 0, attendance: 0, extra_work: 0 },
      overdue: 0,
      unreachable: { count: 0, names: [], more: 0 },
    },
    ahead: { from: "2026-10-12", to: "2026-10-18", leave: [], events: [], holidays: [] },
  };
  const weekly = (id: string, payload: unknown) =>
    claimed(id, {
      kind: "owner_digest_weekly",
      title: "Your week · 5 – 11 Oct",
      body: "Now\nLeave requests: 1",
      link: "/reports/end-of-day",
      payload,
    });

  it("renders the weekly digest from its payload, as one email of its own", async () => {
    const { store, records } = fakeStore([weekly("w1", weeklyPayload), claimed("d2")]);
    const resend = fakeResend([200, 200]);
    const report = await runEmailDispatch({
      store,
      sender: resendSender("re_test_key", "MaxOff <n@mail.maxoff.in>", resend.fetchImpl),
      origin: "https://app.example",
      now: NOW,
    });
    expect(report).toMatchObject({ claimed: 2, sent: 2, failed: 0 });
    expect(resend.calls[0]?.body.subject).toBe("Your week · 5 – 11 Oct");
    expect(String(resend.calls[0]?.body.text)).toContain(
      `Leave requests: 1: https://app.example/open?to=${encodeURIComponent("/approvals")}`,
    );
    expect(resend.calls[1]?.body.subject).toBe("New task: Reel cut");
    expect(records).toEqual([
      { id: "w1", outcome: "sent", error: null },
      { id: "d2", outcome: "sent", error: null },
    ]);
  });

  it("records a weekly digest whose payload is not one failed at once, and goes on", async () => {
    const { store, records } = fakeStore([weekly("w1", { week: "nope" }), claimed("d2")]);
    const resend = fakeResend([200]);
    const errors: unknown[] = [];
    const report = await runEmailDispatch({
      store,
      sender: resendSender("re_test_key", "MaxOff <n@mail.maxoff.in>", resend.fetchImpl),
      origin: "https://app.example",
      now: NOW,
      onItemError: (error) => errors.push(error),
    });
    expect(report).toMatchObject({ claimed: 2, sent: 1, failed: 1, retried: 0 });
    expect(resend.calls).toHaveLength(1);
    expect(records).toEqual([
      { id: "w1", outcome: "failed", error: "invalid_payload" },
      { id: "d2", outcome: "sent", error: null },
    ]);
    expect(String(errors[0])).toContain("owner_digest_weekly");
  });
});

describe("the Owner's morning summary (5B slice 7)", () => {
  const digestPayload = {
    date: "2026-10-03",
    yesterday: "2026-10-02",
    attendance: {
      present: 0,
      on_leave: 0,
      absent: 1,
      absent_names: ["Asha"],
      absent_more: 0,
      day_not_ended: 0,
      day_not_ended_names: [],
      day_not_ended_more: 0,
    },
    tasks: { approved_yesterday: 0, overdue: 0, waiting_for_owner: 0 },
    requests: { leave: 0, expense_claims: 0 },
    held_back: [],
  };
  const digest = (id: string, payload: unknown) =>
    claimed(id, {
      kind: "owner_digest",
      title: "Your morning summary · Sat 3 Oct",
      body: "Attendance yesterday\nAbsent: 1 (Asha)",
      link: "/today",
      payload,
    });

  it("renders the digest from its payload, as one email of its own", async () => {
    const { store, records } = fakeStore([digest("d1", digestPayload), claimed("d2")]);
    const resend = fakeResend([200, 200]);
    const report = await runEmailDispatch({
      store,
      sender: resendSender("re_test_key", "MaxOff <n@mail.maxoff.in>", resend.fetchImpl),
      origin: "https://app.example",
      now: NOW,
    });
    expect(report).toMatchObject({ claimed: 2, sent: 2, failed: 0 });
    expect(resend.calls).toHaveLength(2);
    expect(resend.calls[0]?.body.subject).toBe("Your morning summary · Sat 3 Oct");
    expect(String(resend.calls[0]?.body.text)).toContain(
      `Absent: 1 (Asha): https://app.example/open?to=${encodeURIComponent("/approvals")}`,
    );
    expect(String(resend.calls[0]?.body.html)).toContain(">Attendance yesterday</h2>");
    expect(resend.calls[1]?.body.subject).toBe("New task: Reel cut");
    expect(records).toEqual([
      { id: "d1", outcome: "sent", error: null },
      { id: "d2", outcome: "sent", error: null },
    ]);
  });

  it("records a digest whose payload is not one failed at once, sends nothing, and goes on", async () => {
    const { store, records } = fakeStore([digest("d1", { date: "nope" }), claimed("d2")]);
    const resend = fakeResend([200]);
    const errors: unknown[] = [];
    const report = await runEmailDispatch({
      store,
      sender: resendSender("re_test_key", "MaxOff <n@mail.maxoff.in>", resend.fetchImpl),
      origin: "https://app.example",
      now: NOW,
      onItemError: (error) => errors.push(error),
    });
    expect(report).toMatchObject({ claimed: 2, sent: 1, failed: 1, retried: 0 });
    expect(resend.calls).toHaveLength(1);
    expect(resend.calls[0]?.body.subject).toBe("New task: Reel cut");
    expect(records).toEqual([
      { id: "d1", outcome: "failed", error: "invalid_payload" },
      { id: "d2", outcome: "sent", error: null },
    ]);
    expect(errors).toHaveLength(1);
  });
});
