import { describe, expect, it } from "vitest";

import { resendSender } from "./email";
import {
  type ClaimedEmail,
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
