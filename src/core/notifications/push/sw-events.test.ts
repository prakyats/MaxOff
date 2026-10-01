import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

/**
 * The service worker's push side (`public/sw.js`, task 5.2) run for real in a sandbox: `self` is
 * a fake worker scope that records the handlers, so each event is fired by hand and what the
 * worker did (a notification shown, a window opened, a subscription stored) is read back.
 * Headless Chromium has no push service, so `pushsubscriptionchange` cannot be fired in e2e.
 */
const source = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");

type Handler = (event: Record<string, unknown>) => void;

function loadWorker(options: { userAgent?: string; subscribe?: () => Promise<unknown> } = {}) {
  const handlers = new Map<string, Handler>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const fetched: { url: string; init: { method?: string; body?: string } }[] = [];
  const subscribeCalls: unknown[] = [];
  const self = {
    location: { origin: "https://app.example" },
    navigator: { userAgent: options.userAgent ?? "Mozilla/5.0 (Linux; Android 14)" },
    addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
    registration: {
      showNotification: async (title: string, opts: Record<string, unknown>) => {
        shown.push({ title, options: opts });
      },
      pushManager: {
        subscribe: async (opts: unknown) => {
          subscribeCalls.push(opts);
          return options.subscribe ? options.subscribe() : null;
        },
      },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
  };
  runInNewContext(source, {
    self,
    btoa,
    URL,
    fetch: async (url: string, init: { method?: string; body?: string }) => {
      fetched.push({ url, init });
      return new Response(null, { status: 200 });
    },
  });
  /** Fires an event and waits for what it handed to waitUntil. */
  async function fire(name: string, event: Record<string, unknown>): Promise<void> {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get(name)?.({
      ...event,
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;
  }
  return { fire, shown, opened, fetched, subscribeCalls };
}

const pushData = (value: unknown) => ({
  json: () => value,
  text: () => JSON.stringify(value),
});

describe("sw.js push events (5.2)", () => {
  it("shows the dispatcher's full text and keeps the link for the tap", async () => {
    const worker = loadWorker();
    await worker.fire("push", {
      data: pushData({
        title: "New task: Reel cut",
        body: "Due tomorrow",
        url: "/tasks/1",
        tag: "n:1",
        notificationId: "1",
      }),
    });
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0]!.title).toBe("New task: Reel cut");
    expect(worker.shown[0]!.options).toMatchObject({
      body: "Due tomorrow",
      tag: "n:1",
      data: { url: "/tasks/1" },
    });
  });

  it("a tap opens the deep-link entry; an outside link falls back to the history", async () => {
    const worker = loadWorker();
    const close = () => {};
    await worker.fire("notificationclick", { notification: { close, data: { url: "/tasks/1" } } });
    await worker.fire("notificationclick", {
      notification: { close, data: { url: "//evil.example/x" } },
    });
    expect(worker.opened).toEqual([
      "https://app.example/open?to=%2Ftasks%2F1",
      "https://app.example/open?to=%2Fnotifications",
    ]);
  });

  it("pushsubscriptionchange re-subscribes with the old key and stores the new subscription", async () => {
    const key = new Uint8Array([1, 2, 3]).buffer;
    const fresh = {
      endpoint: "https://push.example/new",
      getKey: (name: string) =>
        name === "p256dh" ? new Uint8Array([251, 255, 254]).buffer : new Uint8Array([9]).buffer,
    };
    const worker = loadWorker({ subscribe: async () => fresh });
    await worker.fire("pushsubscriptionchange", {
      oldSubscription: { options: { applicationServerKey: key } },
    });
    expect(worker.subscribeCalls).toEqual([{ userVisibleOnly: true, applicationServerKey: key }]);
    expect(worker.fetched).toHaveLength(1);
    expect(worker.fetched[0]!.url).toBe("/api/push/subscription");
    expect(worker.fetched[0]!.init.method).toBe("POST");
    expect(JSON.parse(worker.fetched[0]!.init.body ?? "{}")).toMatchObject({
      endpoint: "https://push.example/new",
      // base64url without padding, as the subscription schema wants.
      p256dh: "-__-",
      auth: "CQ",
      platform: "android",
      isStandalone: false,
    });
  });

  it("without the old key, or when the browser refuses, nothing is stored (the next page load re-subscribes)", async () => {
    const none = loadWorker();
    await none.fire("pushsubscriptionchange", { oldSubscription: null });
    expect(none.subscribeCalls).toHaveLength(0);
    expect(none.fetched).toHaveLength(0);

    const refused = loadWorker({ subscribe: () => Promise.reject(new Error("denied")) });
    await refused.fire("pushsubscriptionchange", {
      oldSubscription: { options: { applicationServerKey: new Uint8Array([1]).buffer } },
    });
    expect(refused.fetched).toHaveLength(0);
  });
});
