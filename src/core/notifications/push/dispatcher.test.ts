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
import { classifyStatus, type PushMessage } from "./send";
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
    ).toMatchObject({ url: "/notifications", tag: "summary:m1", notificationId: null });
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
    expect(net.recorded).toEqual([{ ids: ["d1"], outcome: "retry", error: "ECONNRESET" }]);
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
