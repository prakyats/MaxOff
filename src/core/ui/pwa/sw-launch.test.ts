import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The launch screen (`public/sw.js`, the owner's walk note 3, 2026-10-08) run for real in a
 * sandbox, on fake timers: which requests are a launch, the race between the document and the
 * 100 ms timer, the hand-off that takes the held response once, and the offline launch. The
 * browser half (the screen painted before the document, one back exits) is
 * `e2e/launch.spec.ts`.
 */
const source = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://app.example";

type FetchEvent = {
  request: FakeRequest;
  respondWith: (answer: Promise<Response>) => void;
  waitUntil: (promise: Promise<unknown>) => void;
};
type FakeRequest = { url: string; method: string; mode: string; destination: string };
type Worker = {
  launchStep: (request: FakeRequest) => "launch" | "handoff" | null;
};

const navigation = (pathAndQuery: string, overrides: Partial<FakeRequest> = {}): FakeRequest => ({
  url: `${ORIGIN}${pathAndQuery}`,
  method: "GET",
  mode: "navigate",
  destination: "document",
  ...overrides,
});

/** A network that answers each request after `delayMs` (or fails), and counts the requests. */
function loadWorker(network: { delayMs: number; fail?: boolean }) {
  const handlers = new Map<string, (event: FetchEvent) => void>();
  const requests: string[] = [];
  const offlinePage = new Response("<title>Offline</title>", { status: 200 });
  const context: Record<string, unknown> = {
    self: {
      location: { origin: ORIGIN },
      navigator: { userAgent: "test" },
      crypto: { randomUUID: () => `id-${requests.length}-${Math.random().toString(36).slice(2)}` },
      addEventListener: (name: string, handler: (event: FetchEvent) => void) =>
        handlers.set(name, handler),
      registration: {},
      clients: {},
    },
    URL,
    Response,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    caches: {
      match: async (key: string) => (key === "/offline" ? offlinePage.clone() : undefined),
      open: async () => ({ put: async () => undefined }),
    },
    fetch: (request: FakeRequest | string) => {
      const url = typeof request === "string" ? request : request.url;
      requests.push(url);
      return new Promise<Response>((resolve, reject) => {
        setTimeout(() => {
          if (network.fail) reject(new TypeError("Failed to fetch"));
          else
            resolve(
              new Response(null, { status: 307, headers: { location: "/today", "x-from": url } }),
            );
        }, network.delayMs);
      });
    },
  };
  runInNewContext(source, context);

  /** Dispatches a navigation; resolves to what the worker answered with (or null: untouched). */
  function navigate(request: FakeRequest): Promise<Response> | null {
    let answer: Promise<Response> | null = null;
    handlers.get("fetch")!({
      request,
      respondWith: (promise) => {
        answer = promise;
      },
      waitUntil: () => undefined,
    });
    return answer;
  }
  return { navigate, requests, worker: context as unknown as Worker };
}

/** The id the launch screen hands over with, read from its script. */
async function handoffTarget(screen: Response): Promise<string> {
  const html = await screen.text();
  const target = html.match(/location\.replace\("([^"]+)"\)/)?.[1];
  expect(target).toBeTruthy();
  return target!;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("which requests are a launch", () => {
  it("only the installed app's start_url is a launch; its hand-off is recognised", () => {
    const { worker } = loadWorker({ delayMs: 0 });
    expect(worker.launchStep(navigation("/?source=pwa"))).toBe("launch");
    expect(worker.launchStep(navigation("/?launch=abc"))).toBe("handoff");
  });

  it("everything else is untouched: in-app pages, a tab's /, deep links, frames, other origins", () => {
    const { worker } = loadWorker({ delayMs: 0 });
    for (const request of [
      navigation("/"),
      navigation("/today"),
      navigation("/today?source=pwa"),
      navigation("/?source=other"),
      navigation("/open?to=%2Ftasks%2F1"),
      navigation("/?source=pwa", { destination: "iframe" }),
      navigation("/?source=pwa", { mode: "cors", destination: "" }),
      navigation("/?source=pwa", { method: "POST" }),
      { ...navigation("/"), url: "https://elsewhere.example/?source=pwa" },
    ]) {
      expect(worker.launchStep(request), request.url).toBeNull();
    }
  });
});

describe("the launch race", () => {
  it("a document inside 100 ms is answered as before: no launch screen, one request", async () => {
    const { navigate, requests } = loadWorker({ delayMs: 99 });
    const answer = navigate(navigation("/?source=pwa"))!;
    await vi.advanceTimersByTimeAsync(99);
    const response = await answer;
    expect(response.status).toBe(307);
    expect(response.headers.has("X-MaxOff-Launch-Screen")).toBe(false);
    expect(requests).toEqual([`${ORIGIN}/?source=pwa`]);
  });

  it("a slow document: the launch screen at 100 ms, then the hand-off takes the held response", async () => {
    const { navigate, requests } = loadWorker({ delayMs: 2000 });
    let settled = false;
    const answer = navigate(navigation("/?source=pwa"))!.then((response) => {
      settled = true;
      return response;
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    const screen = await answer;
    expect(screen.status).toBe(200);
    expect(screen.headers.get("X-MaxOff-Launch-Screen")).toBe("1");
    expect(screen.headers.get("Cache-Control")).toBe("no-store");

    const target = await handoffTarget(screen);
    expect(target).toMatch(/^\/\?launch=[^&]+$/);
    const handoff = navigate(navigation(target))!;
    await vi.advanceTimersByTimeAsync(1900);
    const real = await handoff;
    expect(real.status).toBe(307);
    // The server was asked once, for the launch itself: the hand-off reused its answer.
    expect(real.headers.get("x-from")).toBe(`${ORIGIN}/?source=pwa`);
    expect(requests).toEqual([`${ORIGIN}/?source=pwa`]);
  });

  it("a held response is taken once: a second hand-off with the same id goes to the network", async () => {
    const { navigate, requests } = loadWorker({ delayMs: 500 });
    const answer = navigate(navigation("/?source=pwa"))!;
    await vi.advanceTimersByTimeAsync(100);
    const target = await handoffTarget(await answer);
    const first = navigate(navigation(target))!;
    const second = navigate(navigation(target))!;
    await vi.advanceTimersByTimeAsync(500);
    expect((await first).headers.get("x-from")).toBe(`${ORIGIN}/?source=pwa`);
    expect((await second).headers.get("x-from")).toBe(`${ORIGIN}${target}`);
    expect(requests).toEqual([`${ORIGIN}/?source=pwa`, `${ORIGIN}${target}`]);
  });

  it("an unknown or expired id is an ordinary navigation, never a second launch screen", async () => {
    const { navigate, requests } = loadWorker({ delayMs: 3000 });
    const unknown = navigate(navigation("/?launch=nobody"))!;
    await vi.advanceTimersByTimeAsync(3000);
    expect((await unknown).headers.has("X-MaxOff-Launch-Screen")).toBe(false);

    const answer = navigate(navigation("/?source=pwa"))!;
    await vi.advanceTimersByTimeAsync(100);
    const target = await handoffTarget(await answer);
    // Nobody came for it (the window was closed): let go after 10 s.
    await vi.advanceTimersByTimeAsync(10_000);
    const late = navigate(navigation(target))!;
    await vi.advanceTimersByTimeAsync(3000);
    const response = await late;
    expect(response.headers.has("X-MaxOff-Launch-Screen")).toBe(false);
    expect(response.headers.get("x-from")).toBe(`${ORIGIN}${target}`);
    expect(requests).toHaveLength(3);
  });

  it("offline: the launch screen while the navigation is retried, then the offline page", async () => {
    const { navigate } = loadWorker({ delayMs: 0, fail: true });
    const answer = navigate(navigation("/?source=pwa"))!;
    await vi.advanceTimersByTimeAsync(100);
    const target = await handoffTarget(await answer);
    const handoff = navigate(navigation(target))!;
    // The retry after 1.5 s fails too.
    await vi.advanceTimersByTimeAsync(1500);
    expect(await (await handoff).text()).toContain("<title>Offline</title>");
  });

  it("an ordinary navigation is untouched by all of it: one request, its own answer", async () => {
    const { navigate, requests } = loadWorker({ delayMs: 2000 });
    const answer = navigate(navigation("/"))!;
    await vi.advanceTimersByTimeAsync(2000);
    expect((await answer).headers.get("x-from")).toBe(`${ORIGIN}/`);
    expect(requests).toEqual([`${ORIGIN}/`]);
  });
});

describe("the launch screen", () => {
  async function screenHtml(): Promise<string> {
    const { navigate } = loadWorker({ delayMs: 5000 });
    const answer = navigate(navigation("/?source=pwa"))!;
    await vi.advanceTimersByTimeAsync(100);
    return (await answer).text();
  }

  it("is static and data-free: nothing loaded, nothing stored, only the hand-off", async () => {
    const html = await screenHtml();
    expect(html).not.toMatch(/\s(src|href)=/);
    expect(html).not.toMatch(/fetch\(|Storage|cookie|indexedDB|serviceWorker/);
    // The hand-off replaces the entry: the launch adds nothing to history (§14.2 c).
    expect(html).toContain("location.replace(");
    expect(html).not.toMatch(/location\.(assign|href\s*=)|history\.push/);
  });

  it("draws the icon's mark at the launch intro's size, centred on the launch background", async () => {
    const html = await screenHtml();
    const icon = readFileSync(path.join(process.cwd(), "public", "icons", "icon.svg"), "utf8");
    const launch = JSON.parse(
      readFileSync(path.join(process.cwd(), "src/core/ui/pwa/launch-screens.json"), "utf8"),
    ) as { background: string; markSize: number };
    expect(html).toContain(`d="${icon.match(/<path d="([^"]+)"/)![1]}"`);
    expect(html).toContain('rx="112"');
    expect(html).toContain(`fill="${icon.match(/<rect[^>]*fill="(#[0-9a-fA-F]{6})"/)![1]}"`);
    expect(html).toContain(`width="${launch.markSize}" height="${launch.markSize}"`);
    expect(html).toContain(`background:${launch.background}`);
    expect(html).toContain("place-items:center");
  });

  it("shows its indicator only once the wait goes on, and still under reduced motion", async () => {
    const html = await screenHtml();
    expect(html).toMatch(/\[data-slot="launch-indicator"\]\{[^}]*opacity:0;[^}]*400ms forwards/);
    expect(html).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\{\[data-slot="launch-indicator"\] span\{animation:none\}\}/,
    );
  });
});
