import { describe, expect, it } from "vitest";

import { systemClock } from "@/core/time";

import { fromBase64Url } from "./base64url";
import {
  type ClaimedItem,
  DISPATCH_LIMIT,
  messageFor,
  type PushStore,
  type PushTargetRow,
  runPushDispatch,
} from "./dispatcher";
import { decryptPayload, generateReceiverKeys, generateVapidKeysForTests } from "./encrypt";
import { MAX_PLAINTEXT_BYTES } from "./encrypt";
import {
  classifyStatus,
  fitPayload,
  type PushMessage,
  pushEndpointAllowed,
  sendWebPush,
} from "./send";
import { verifyVapidToken } from "./vapid";

type Recorded = { ids: string[]; outcome: string; error: string | null };
type DeviceResult = { id: string; outcome: string };

/** An in-memory store: what was claimed, what was recorded. */
function fakeStore(items: ClaimedItem[], targets: Record<string, PushTargetRow[]>) {
  const recorded: Recorded[] = [];
  const devices: DeviceResult[] = [];
  const claims: number[] = [];
  const store: PushStore = {
    async claim(_now, limit) {
      claims.push(limit);
      return items.splice(0, limit);
    },
    async targets(recipientId) {
      return targets[recipientId] ?? [];
    },
    async record(ids, outcome, error) {
      recorded.push({ ids, outcome, error });
    },
    async subscriptionResult(id, outcome) {
      devices.push({ id, outcome });
    },
  };
  return { store, recorded, devices, claims };
}

function item(overrides: Partial<ClaimedItem> = {}): ClaimedItem {
  return {
    deliveryIds: ["d1"],
    recipientId: "m1",
    notificationId: "n1",
    kind: "task_assigned",
    title: "New task: Wedding reel",
    body: "Due 12 Oct, 18:00",
    link: "/tasks/t1",
    attempts: 1,
    isSummary: false,
    heldCount: 1,
    ...overrides,
  };
}

/** A fake push service: answers by endpoint, keeps every request for the assertions. */
function fakePushService(statusFor: (endpoint: string) => number | "network") {
  const requests: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const status = statusFor(url);
    if (status === "network") throw new Error("ECONNRESET");
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    requests.push({ url, headers, body: new Uint8Array(init.body as ArrayBuffer) });
    return new Response(null, { status });
  };
  return { fetch, requests };
}

describe("classifyStatus", () => {
  it("maps the push service's answers", () => {
    expect([200, 201, 202].map(classifyStatus)).toEqual(["sent", "sent", "sent"]);
    expect([404, 410].map(classifyStatus)).toEqual(["gone", "gone"]);
    expect([400, 401, 403, 413, 429, 500, 503].map(classifyStatus)).toEqual(Array(7).fill("error"));
  });
});

describe("messageFor", () => {
  it("carries the full text, the link and a tag; the summary opens the history", () => {
    expect(messageFor(item())).toEqual<PushMessage>({
      title: "New task: Wedding reel",
      body: "Due 12 Oct, 18:00",
      url: "/tasks/t1",
      tag: "n:n1",
      notificationId: "n1",
      group: "tasks",
    });
    expect(
      messageFor(
        item({
          deliveryIds: ["a", "b", "c"],
          notificationId: null,
          kind: "summary",
          title: "3 updates while you were away",
          body: "Open MaxOff to see what happened.",
          link: "/notifications",
          isSummary: true,
          heldCount: 3,
        }),
      ),
    ).toMatchObject({
      url: "/notifications",
      tag: "summary:m1",
      notificationId: null,
      group: "other",
    });
    expect(messageFor(item({ link: null })).url).toBe("/notifications");
  });
});

describe("runPushDispatch", () => {
  it("encrypts the message for every device, the VAPID header verifies, and records sent", async () => {
    const vapid = { ...(await generateVapidKeysForTests()), subject: "mailto:o@example.com" };
    const phone = await generateReceiverKeys();
    const laptop = await generateReceiverKeys();
    const targets: PushTargetRow[] = [
      {
        id: "s1",
        endpoint: "https://push.example/phone",
        p256dh: phone.publicKey,
        auth: phone.auth,
      },
      {
        id: "s2",
        endpoint: "https://push.example/laptop",
        p256dh: laptop.publicKey,
        auth: laptop.auth,
      },
    ];
    const { store, recorded, devices } = fakeStore([item()], { m1: targets });
    const service = fakePushService(() => 201);

    const report = await runPushDispatch({
      store,
      vapid,
      fetch: service.fetch,
      now: systemClock(),
    });

    expect(report).toMatchObject({ claimed: 1, sent: 1, retried: 0, failed: 0, noSubscription: 0 });
    expect(report.devices).toEqual({ sent: 2, gone: 0, error: 0 });
    expect(devices).toEqual([
      { id: "s1", outcome: "sent" },
      { id: "s2", outcome: "sent" },
    ]);
    expect(recorded).toEqual([{ ids: ["d1"], outcome: "sent", error: null }]);
    expect(service.requests).toHaveLength(2);
    const [first] = service.requests;
    expect(first!.headers["content-encoding"]).toBe("aes128gcm");
    expect(first!.headers["ttl"]).toBe(String(24 * 3600));
    const auth = first!.headers["authorization"]!;
    expect(auth.startsWith("vapid t=")).toBe(true);
    const token = auth.slice("vapid t=".length, auth.indexOf(", k="));
    expect(await verifyVapidToken(vapid.publicKey, token)).toBe(true);
    expect(auth.endsWith(`, k=${vapid.publicKey}`)).toBe(true);
    // Only the phone's key opens the phone's message: the full text, the link, no amount.
    const opened = JSON.parse(new TextDecoder().decode(await decryptPayload(first!.body, phone)));
    expect(opened).toEqual(messageFor(item()));
    await expect(decryptPayload(first!.body, laptop)).rejects.toThrow();
    // The second device's message is its own encryption of the same text.
    const second = service.requests[1]!;
    expect(JSON.parse(new TextDecoder().decode(await decryptPayload(second.body, laptop)))).toEqual(
      messageFor(item()),
    );
    expect(fromBase64Url(vapid.publicKey)).toHaveLength(65);
  });

  it("records no_subscription for a person with no active device (the email seam)", async () => {
    const vapid = { ...(await generateVapidKeysForTests()), subject: "mailto:o@example.com" };
    const { store, recorded, devices } = fakeStore([item()], {});
    const service = fakePushService(() => 201);
    const report = await runPushDispatch({ store, vapid, fetch: service.fetch });
    expect(report).toMatchObject({ claimed: 1, sent: 0, failed: 1, noSubscription: 1 });
    expect(recorded).toEqual([{ ids: ["d1"], outcome: "failed", error: "no_subscription" }]);
    expect(devices).toEqual([]);
    expect(service.requests).toHaveLength(0);
  });

  it("404/410 marks the device gone; every device gone is no_subscription; one accepting is sent", async () => {
    const vapid = { ...(await generateVapidKeysForTests()), subject: "mailto:o@example.com" };
    const a = await generateReceiverKeys();
    const b = await generateReceiverKeys();
    const targets: PushTargetRow[] = [
      { id: "s1", endpoint: "https://push.example/gone", p256dh: a.publicKey, auth: a.auth },
      { id: "s2", endpoint: "https://push.example/ok", p256dh: b.publicKey, auth: b.auth },
    ];
    const one = fakeStore([item()], { m1: targets });
    const service = fakePushService((url) => (url.endsWith("/gone") ? 410 : 201));
    expect(await runPushDispatch({ store: one.store, vapid, fetch: service.fetch })).toMatchObject({
      sent: 1,
      devices: { sent: 1, gone: 1, error: 0 },
    });
    expect(one.devices).toEqual([
      { id: "s1", outcome: "gone" },
      { id: "s2", outcome: "sent" },
    ]);
    expect(one.recorded).toEqual([{ ids: ["d1"], outcome: "sent", error: null }]);

    const all = fakeStore([item()], { m1: targets });
    const allGone = fakePushService(() => 404);
    expect(await runPushDispatch({ store: all.store, vapid, fetch: allGone.fetch })).toMatchObject({
      failed: 1,
      noSubscription: 1,
      devices: { sent: 0, gone: 2, error: 0 },
    });
    expect(all.recorded).toEqual([{ ids: ["d1"], outcome: "failed", error: "no_subscription" }]);
  });

  it("other errors and network failures retry with the reason; a device error is counted", async () => {
    const vapid = { ...(await generateVapidKeysForTests()), subject: "mailto:o@example.com" };
    const a = await generateReceiverKeys();
    const targets: PushTargetRow[] = [
      { id: "s1", endpoint: "https://push.example/flaky", p256dh: a.publicKey, auth: a.auth },
    ];
    const http = fakeStore([item()], { m1: targets });
    expect(
      await runPushDispatch({ store: http.store, vapid, fetch: fakePushService(() => 503).fetch }),
    ).toMatchObject({ retried: 1, devices: { sent: 0, gone: 0, error: 1 } });
    expect(http.recorded).toEqual([{ ids: ["d1"], outcome: "retry", error: "HTTP 503" }]);
    expect(http.devices).toEqual([{ id: "s1", outcome: "error" }]);

    const net = fakeStore([item()], { m1: targets });
    expect(
      await runPushDispatch({
        store: net.store,
        vapid,
        fetch: fakePushService(() => "network").fetch,
      }),
    ).toMatchObject({ retried: 1 });
    // A code, never the error's message (it could name a host; 5A review, later item).
    expect(net.recorded).toEqual([{ ids: ["d1"], outcome: "retry", error: "network_error" }]);
  });

  it("claims a bounded batch and sends a summary as one push over all its rows", async () => {
    const vapid = { ...(await generateVapidKeysForTests()), subject: "mailto:o@example.com" };
    const a = await generateReceiverKeys();
    const summary = item({
      deliveryIds: ["d1", "d2", "d3"],
      notificationId: null,
      kind: "summary",
      title: "3 updates while you were away",
      body: "Open MaxOff to see what happened.",
      link: "/notifications",
      isSummary: true,
      heldCount: 3,
    });
    const { store, recorded, claims } = fakeStore([summary], {
      m1: [{ id: "s1", endpoint: "https://push.example/p", p256dh: a.publicKey, auth: a.auth }],
    });
    const service = fakePushService(() => 201);
    await runPushDispatch({ store, vapid, fetch: service.fetch, limit: 5 });
    expect(claims).toEqual([5]);
    expect(service.requests).toHaveLength(1);
    expect(recorded).toEqual([{ ids: ["d1", "d2", "d3"], outcome: "sent", error: null }]);
    expect(
      JSON.parse(new TextDecoder().decode(await decryptPayload(service.requests[0]!.body, a))),
    ).toMatchObject({ title: "3 updates while you were away", url: "/notifications" });
    const empty = fakeStore([], {});
    expect(
      await runPushDispatch({ store: empty.store, vapid, fetch: service.fetch }),
    ).toMatchObject({
      claimed: 0,
    });
    expect(empty.claims).toEqual([DISPATCH_LIMIT]);
  });
});

describe("one bad subscription never stalls the run (5A review M1)", () => {
  it("a poisoned device beside a good one: the good one is sent, the bad one is an error", async () => {
    const vapid = { ...(await generateVapidKeysForTests()), subject: "mailto:o@example.com" };
    const good = await generateReceiverKeys();
    const targets: PushTargetRow[] = [
      { id: "bad", endpoint: "https://push.example/bad", p256dh: "not-a-key", auth: "x" },
      {
        id: "good",
        endpoint: "https://push.example/good",
        p256dh: good.publicKey,
        auth: good.auth,
      },
    ];
    const { store, recorded, devices } = fakeStore([item()], { m1: targets });
    const service = fakePushService(() => 201);
    const report = await runPushDispatch({ store, vapid, fetch: service.fetch });
    expect(report).toMatchObject({ sent: 1, devices: { sent: 1, gone: 0, error: 1 } });
    expect(devices).toEqual([
      { id: "bad", outcome: "error" },
      { id: "good", outcome: "sent" },
    ]);
    expect(recorded).toEqual([{ ids: ["d1"], outcome: "sent", error: null }]);
    expect(service.requests.map((request) => request.url)).toEqual(["https://push.example/good"]);
  });

  it("a person whose only device is poisoned is retried (failing at the last backoff); the next item still goes", async () => {
    const vapid = { ...(await generateVapidKeysForTests()), subject: "mailto:o@example.com" };
    const good = await generateReceiverKeys();
    const { store, recorded } = fakeStore(
      [item(), item({ deliveryIds: ["d2"], recipientId: "m2", notificationId: "n2" })],
      {
        m1: [
          {
            id: "bad",
            endpoint: "https://push.example/bad",
            p256dh: "B" + "A".repeat(86),
            auth: "x",
          },
        ],
        m2: [
          {
            id: "ok",
            endpoint: "https://push.example/ok",
            p256dh: good.publicKey,
            auth: good.auth,
          },
        ],
      },
    );
    const report = await runPushDispatch({ store, vapid, fetch: fakePushService(() => 201).fetch });
    expect(report).toMatchObject({ claimed: 2, sent: 1, retried: 1 });
    expect(recorded).toEqual([
      { ids: ["d1"], outcome: "retry", error: "encrypt_failed" },
      { ids: ["d2"], outcome: "sent", error: null },
    ]);
  });

  it("a store call that throws for one item records it as a retry and goes on", async () => {
    const vapid = { ...(await generateVapidKeysForTests()), subject: "mailto:o@example.com" };
    const good = await generateReceiverKeys();
    const base = fakeStore([item(), item({ deliveryIds: ["d2"], recipientId: "m2" })], {
      m2: [
        { id: "ok", endpoint: "https://push.example/ok", p256dh: good.publicKey, auth: good.auth },
      ],
    });
    const errors: unknown[] = [];
    const store: PushStore = {
      ...base.store,
      async targets(recipientId) {
        if (recipientId === "m1") throw new Error("connection reset");
        return base.store.targets(recipientId);
      },
    };
    const report = await runPushDispatch({
      store,
      vapid,
      fetch: fakePushService(() => 201).fetch,
      onItemError: (error) => errors.push(error),
    });
    expect(report).toMatchObject({ claimed: 2, sent: 1, retried: 1 });
    expect(base.recorded).toEqual([
      { ids: ["d1"], outcome: "retry", error: "dispatch_error" },
      { ids: ["d2"], outcome: "sent", error: null },
    ]);
    expect(errors).toHaveLength(1);
  });

  it("a body too long for one record is cut with an ellipsis; the title and link stay whole", async () => {
    const vapid = { ...(await generateVapidKeysForTests()), subject: "mailto:o@example.com" };
    const phone = await generateReceiverKeys();
    const long = item({ body: "Brighter colours, please. ".repeat(400) + "€ ✓ 漢字" });
    expect(new TextEncoder().encode(JSON.stringify(messageFor(long))).length).toBeGreaterThan(
      MAX_PLAINTEXT_BYTES,
    );
    const { store, recorded } = fakeStore([long], {
      m1: [
        { id: "s1", endpoint: "https://push.example/p", p256dh: phone.publicKey, auth: phone.auth },
      ],
    });
    const service = fakePushService(() => 201);
    await runPushDispatch({ store, vapid, fetch: service.fetch });
    expect(recorded).toEqual([{ ids: ["d1"], outcome: "sent", error: null }]);
    const opened = JSON.parse(
      new TextDecoder().decode(await decryptPayload(service.requests[0]!.body, phone)),
    ) as PushMessage;
    expect(opened.title).toBe(long.title);
    expect(opened.url).toBe(long.link);
    expect(opened.body?.endsWith("…")).toBe(true);
    expect(long.body?.startsWith(opened.body!.slice(0, -1))).toBe(true);
    // As long as fits: one more character would not.
    expect(fitPayload(messageFor(long)).length).toBeLessThanOrEqual(MAX_PLAINTEXT_BYTES);
    expect(fitPayload(messageFor(long)).length).toBeGreaterThan(MAX_PLAINTEXT_BYTES - 8);
    // A message that fits is untouched.
    expect(new TextDecoder().decode(fitPayload(messageFor(item())))).toBe(
      JSON.stringify(messageFor(item())),
    );
  });

  it("a push service that never answers times out as a retryable error", async () => {
    const vapid = { ...(await generateVapidKeysForTests()), subject: "mailto:o@example.com" };
    const phone = await generateReceiverKeys();
    const hanging = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const result = await sendWebPush({
      target: { endpoint: "https://push.example/slow", p256dh: phone.publicKey, auth: phone.auth },
      message: messageFor(item()),
      vapid,
      fetch: hanging,
      timeoutMs: 20,
    });
    expect(result).toEqual({ outcome: "error", status: null, detail: "timeout" });
  });
});

describe("pushEndpointAllowed (5A review M2, defence in depth)", () => {
  it("takes https on a public DNS name only; loopback http only when allowed", () => {
    const allowed = (url: string, loopback = false) => pushEndpointAllowed(url, loopback);
    expect(allowed("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(allowed("https://web.push.apple.com/QK")).toBe(true);
    expect(allowed("https://updates.push.services.mozilla.com:443/wpush/v2/x")).toBe(true);
    for (const refused of [
      "http://169.254.169.254/latest/meta-data",
      "https://169.254.169.254/latest/meta-data",
      "https://2130706433/",
      "https://0x7f.1/",
      "https://[::1]/x",
      "https://localhost/x",
      "https://metadata.google.internal/x",
      "https://printer.local/x",
      "https://user:pw@push.example/x",
      "ftp://push.example/x",
      "not a url",
    ]) {
      expect(allowed(refused), refused).toBe(false);
    }
    expect(allowed("http://127.0.0.1:3111/ok/x")).toBe(false);
    expect(allowed("http://127.0.0.1:3111/ok/x", true)).toBe(true);
    expect(allowed("http://localhost:3111/ok/x", true)).toBe(true);
    expect(allowed("http://10.0.0.1/x", true)).toBe(false);
  });

  it("a refused endpoint is never fetched", async () => {
    const vapid = { ...(await generateVapidKeysForTests()), subject: "mailto:o@example.com" };
    const phone = await generateReceiverKeys();
    const service = fakePushService(() => 201);
    const result = await sendWebPush({
      target: { endpoint: "http://169.254.169.254/x", p256dh: phone.publicKey, auth: phone.auth },
      message: messageFor(item()),
      vapid,
      fetch: service.fetch,
    });
    expect(result).toEqual({ outcome: "error", status: null, detail: "endpoint_refused" });
    expect(service.requests).toHaveLength(0);
  });
});
