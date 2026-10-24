import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { systemClock } from "@/core/time/clock";

/**
 * The service worker's instant skeleton (P2, ADR-0014; `public/sw.js`) run for real in a sandbox:
 * which requests may be answered from the skeleton cache, stale-while-revalidate once the viewer is
 * named and for the page's deployment only, and the cache dropped on a new role, a signed-out page
 * or a sign-in redirect. The browser half is `e2e/instant-skeleton.spec.ts`.
 */
const source = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://app.example";
const DEPLOYMENT = "abc123-1-1";

type Handler = (event: FakeEvent) => void;
type FakeEvent = {
  request?: Request | NavigationRequest;
  data?: unknown;
  respondWith: (answer: Promise<Response>) => void;
  waitUntil: (promise: Promise<unknown>) => void;
};
type NavigationRequest = { url: string; method: string; mode: string; destination: string };

/** A Cache Storage stand-in: named caches of URL → Response. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (key: string | Request | { url: string }) =>
    typeof key === "string" ? key : key.url;
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      match: async (key: string | Request) => store.get(new URL(keyOf(key), ORIGIN).href)?.clone(),
      put: async (key: string | Request, response: Response) => {
        store.set(new URL(keyOf(key), ORIGIN).href, response);
      },
      delete: async (key: string | Request) => store.delete(new URL(keyOf(key), ORIGIN).href),
      keys: async () => [...store.keys()].map((url) => ({ url })),
      addAll: async () => undefined,
    };
  };
  return {
    stores,
    api: {
      open,
      delete: async (name: string) => stores.delete(name),
      keys: async () => [...stores.keys()],
      match: async (key: string | Request, options?: { cacheName?: string }) => {
        const names = options?.cacheName ? [options.cacheName] : [...stores.keys()];
        for (const name of names) {
          const hit = stores.get(name)?.get(new URL(keyOf(key), ORIGIN).href);
          if (hit) return hit.clone();
        }
        return undefined;
      },
    },
  };
}

/** A network answer's `url` and `redirected`, which a constructed Response cannot set: kept by its clones, as a browser's are. */
function fromNetwork(response: Response, url: string, redirected = false): Response {
  const clone = response.clone.bind(response);
  Object.defineProperties(response, {
    url: { value: url },
    redirected: { value: redirected },
    clone: { value: () => fromNetwork(clone(), url, redirected) },
  });
  return response;
}

/** A skeleton answer as the server gives it (an RSC payload of the loading screen). */
function payload(
  body: string,
  url: string,
  init: { status?: number; type?: string; redirected?: boolean } = {},
) {
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.type ?? "text/x-component", vary: "rsc" },
  });
  return fromNetwork(response, url, init.redirected);
}

function loadWorker() {
  const handlers = new Map<string, Handler>();
  const caches = fakeCaches();
  const network: {
    url: string;
    resolve: (response: Response) => void;
    reject: (e: Error) => void;
  }[] = [];
  const context: Record<string, unknown> = {
    self: {
      location: { origin: ORIGIN },
      navigator: { userAgent: "test" },
      crypto: { randomUUID: () => "id" },
      addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
      registration: {},
      // The faked Date drives the worker's clock too.
      performance: { timeOrigin: 0, now: () => systemClock().getTime() },
      clients: {},
    },
    URL,
    Headers,
    Response,
    TextEncoder,
    Uint8Array,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    caches: caches.api,
    fetch: (request: Request | NavigationRequest | string) =>
      new Promise<Response>((resolve, reject) => {
        network.push({
          url: typeof request === "string" ? request : request.url,
          resolve,
          reject,
        });
      }),
  };
  runInNewContext(source, context);

  function dispatch(name: string, event: Partial<FakeEvent>): Promise<Response> | null {
    let answer: Promise<Response> | null = null;
    handlers.get(name)!({
      respondWith: (promise) => {
        answer = promise;
      },
      waitUntil: () => undefined,
      ...event,
    });
    return answer;
  }
  /** Lets every pending promise run (the cache work a `waitUntil` holds included). */
  async function settle() {
    for (let i = 0; i < 30; i += 1) await vi.advanceTimersByTimeAsync(0);
  }
  const tell = async (viewer: unknown) => {
    dispatch("message", { data: { type: "maxoff-shell-viewer", viewer } });
    await settle();
  };
  return { dispatch, network, caches, settle, tell };
}

/** The router's prefetch of a destination, as Next sends it. */
function prefetch(
  pathAndQuery: string,
  headers: Record<string, string> = {},
  init: RequestInit = {},
): Request {
  return new Request(`${ORIGIN}${pathAndQuery}`, {
    ...init,
    headers: {
      rsc: "1",
      "next-router-prefetch": "1",
      "x-deployment-id": DEPLOYMENT,
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("which requests the skeleton cache may answer", () => {
  it("only the router's prefetch of a top-level destination, from a page naming its deployment", async () => {
    const worker = loadWorker();
    await worker.tell("owner");
    const handled = (request: Request) => worker.dispatch("fetch", { request }) !== null;
    expect(handled(prefetch("/tasks?_rsc=abc"))).toBe(true);
    expect(
      handled(prefetch("/calendar?_rsc=abc", { "next-router-segment-prefetch": "/_tree" })),
    ).toBe(true);
    // A task's page: no layout, a static title, the skeleton and its own id only.
    expect(handled(prefetch("/tasks/10000000-0000-4000-8000-000000000001?_rsc=abc"))).toBe(true);
    // Tasks' foot links (v13, ADR-0014 amendment 2026-10-24): the bare address only.
    expect(handled(prefetch("/tasks/all?_rsc=abc"))).toBe(true);
    expect(handled(prefetch("/tasks/requests?_rsc=abc"))).toBe(true);

    // A navigation's or a refresh's request (no prefetch header) carries the page's data.
    const notPrefetch = new Request(`${ORIGIN}/tasks?_rsc=abc`, {
      headers: { rsc: "1", "x-deployment-id": DEPLOYMENT },
    });
    for (const request of [
      notPrefetch,
      // A client's and a person's pages and /leave: their layouts read a record or a balance.
      prefetch("/clients/10000000-0000-4000-8000-000000000001?_rsc=abc"),
      prefetch("/people/10000000-0000-4000-8000-000000000001?_rsc=abc"),
      prefetch("/tasks/10000000-0000-4000-8000-000000000001/x?_rsc=abc"),
      prefetch("/tasks/all?state=review&_rsc=abc"),
      prefetch("/leave?_rsc=abc"),
      prefetch("/today/people?group=present&_rsc=abc"),
      // Home and Reports: their skeletons show the viewer's name or a date.
      prefetch("/today?_rsc=abc"),
      prefetch("/my-day?_rsc=abc"),
      prefetch("/reports?_rsc=abc"),
      prefetch("/tasks"),
      prefetch("/tasks?_rsc=abc", { "x-deployment-id": "" }),
      new Request(`${ORIGIN}/tasks?_rsc=abc`, {
        headers: { rsc: "1", "next-router-prefetch": "1" },
      }),
      prefetch("/tasks?_rsc=abc", {}, { method: "POST", body: "x" }),
      new Request(`https://elsewhere.example/tasks?_rsc=abc`, {
        headers: { rsc: "1", "next-router-prefetch": "1", "x-deployment-id": DEPLOYMENT },
      }),
      prefetch("/api/warm?_rsc=abc"),
    ]) {
      expect(handled(request), `${request.method} ${request.url}`).toBe(false);
    }
  });
});

describe("stale-while-revalidate for the viewer's role", () => {
  it("before the shell names its viewer: kept, but answered only once it has", async () => {
    const worker = loadWorker();
    const answer = worker.dispatch("fetch", { request: prefetch("/tasks?_rsc=abc") })!;
    await worker.settle();
    worker.network[0]!.resolve(payload("skeleton", `${ORIGIN}/tasks?_rsc=abc`));
    expect(await (await answer).text()).toBe("skeleton");
    await worker.settle();
    // Not answered from the cache while nobody has said whose it is.
    expect(await answeredAtOnce(worker)).toBe(false);
    // The first name adopts it: the same session fetched it.
    await worker.tell("owner");
    expect(await answeredAtOnce(worker)).toBe(true);
  });

  it("a skeleton fetched before a drop is never kept after it", async () => {
    const worker = loadWorker();
    await worker.tell("owner");
    worker.dispatch("fetch", { request: prefetch("/tasks?_rsc=abc") });
    await worker.settle();
    // Signed out while it was on its way.
    worker.dispatch("fetch", {
      request: { url: `${ORIGIN}/login`, method: "GET", mode: "navigate", destination: "document" },
    });
    await worker.settle();
    worker.network[0]!.resolve(payload("owner skeleton", `${ORIGIN}/tasks?_rsc=abc`));
    await worker.settle();
    await worker.tell("staff");
    expect(await answeredAtOnce(worker)).toBe(false);
  });

  it("first the network (kept), then the kept copy at once, the Worker not asked for an hour", async () => {
    const worker = loadWorker();
    await worker.tell("owner");
    const first = worker.dispatch("fetch", { request: prefetch("/tasks?_rsc=abc") })!;
    await worker.settle();
    worker.network[0]!.resolve(payload("skeleton v1", `${ORIGIN}/tasks?_rsc=abc`));
    expect(await (await first).text()).toBe("skeleton v1");
    await worker.settle();

    // The Worker is cold now: the kept skeleton answers at once, and the Worker is not asked.
    const second = worker.dispatch("fetch", { request: prefetch("/tasks?_rsc=abc") })!;
    await worker.settle();
    const cached = await second;
    expect(await cached.text()).toBe("skeleton v1");
    expect(cached.headers.get("vary")).toBeNull();
    expect(worker.network).toHaveLength(1);

    // An hour on: the copy still answers at once, and the network's replaces it behind it.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    const third = worker.dispatch("fetch", { request: prefetch("/tasks?_rsc=abc") })!;
    await worker.settle();
    expect(await (await third).text()).toBe("skeleton v1");
    expect(worker.network).toHaveLength(2);
    worker.network[1]!.resolve(payload("skeleton v2", `${ORIGIN}/tasks?_rsc=abc`));
    await worker.settle();
    const fourth = worker.dispatch("fetch", { request: prefetch("/tasks?_rsc=abc") })!;
    await worker.settle();
    expect(await (await fourth).text()).toBe("skeleton v2");
    expect(worker.network).toHaveLength(2);
  });

  it("keeps only a full skeleton: never an error, a redirect, or anything but an RSC payload", async () => {
    const worker = loadWorker();
    await worker.tell("admin");
    const answers = [
      payload("oops", `${ORIGIN}/tasks?_rsc=a`, { status: 500 }),
      payload("<html>", `${ORIGIN}/tasks?_rsc=b`, { type: "text/html" }),
      payload("other", `${ORIGIN}/today?_rsc=c`),
    ];
    for (const [index, query] of ["a", "b", "c"].entries()) {
      worker.dispatch("fetch", { request: prefetch(`/tasks?_rsc=${query}`) });
      await worker.settle();
      worker.network[index]!.resolve(answers[index]!);
      await worker.settle();
    }
    const kept = [...(worker.caches.stores.get("maxoff-shell-v13")?.keys() ?? [])];
    expect(kept.filter((key) => !key.includes("__maxoff"))).toEqual([]);
  });
});

describe("one kept copy whichever page asked", () => {
  it("a prefetch made from another page (another `Next-Url`, so another `_rsc`) is answered by the kept copy", async () => {
    const worker = loadWorker();
    await worker.tell("owner");
    const tree = { "next-router-segment-prefetch": "/_tree" };
    worker.dispatch("fetch", {
      request: prefetch("/tasks/10000000-0000-4000-8000-000000000001?_rsc=fromToday", {
        ...tree,
        "next-url": "/today",
      }),
    });
    await worker.settle();
    worker.network[0]!.resolve(
      payload("task tree", `${ORIGIN}/tasks/10000000-0000-4000-8000-000000000001?_rsc=fromToday`),
    );
    await worker.settle();
    const fromTasks = prefetch("/tasks/10000000-0000-4000-8000-000000000001?_rsc=fromTasks", {
      ...tree,
      "next-url": "/tasks",
    });
    expect(await answeredAtOnce(worker, fromTasks)).toBe(true);
    expect(worker.network).toHaveLength(1);
  });

  it("a task's skeleton kept from Today answers the same task tapped on Tasks (the tree's shared-layout mark aside)", async () => {
    const worker = loadWorker();
    await worker.tell("owner");
    const id = "10000000-0000-4000-8000-000000000001";
    // The router's request tree: from Today the tasks segment is new to the page and in its
    // memory ("inside-shared-layout"); from Tasks it is shared (no mark). The task's own segment
    // is the "refetch" in both, where the server starts rendering.
    const tree = (tasksMark: string | null) =>
      encodeURIComponent(
        JSON.stringify([
          "",
          {
            children: [
              "(app)",
              {
                children: [
                  "tasks",
                  {
                    children: [
                      ["id", id, "d", null],
                      { children: ["__PAGE__", {}, null, null, 4096] },
                      null,
                      "refetch",
                      4100,
                    ],
                  },
                  null,
                  tasksMark,
                  4104,
                ],
              },
              null,
              null,
              4108,
            ],
          },
          null,
          null,
          4120,
        ]),
      );
    worker.dispatch("fetch", {
      request: prefetch(`/tasks/${id}?_rsc=fromToday`, {
        "next-router-state-tree": tree("inside-shared-layout"),
        "next-url": "/today",
      }),
    });
    await worker.settle();
    worker.network[0]!.resolve(payload("task skeleton", `${ORIGIN}/tasks/${id}?_rsc=fromToday`));
    await worker.settle();
    const fromTasks = prefetch(`/tasks/${id}?_rsc=fromTasks`, {
      "next-router-state-tree": tree(null),
      "next-url": "/tasks",
    });
    expect(await answeredAtOnce(worker, fromTasks)).toBe(true);
    expect(worker.network).toHaveLength(1);
    // A tree whose tasks segment the router must fetch ("refetch") is another answer: not kept.
    const fresh = prefetch(`/tasks/${id}?_rsc=fresh`, {
      "next-router-state-tree": tree("refetch"),
      "next-url": "/today",
    });
    expect(await answeredAtOnce(worker, fresh)).toBe(false);
  });

  it("the segment asked for and the router state tree each keep their own copy", async () => {
    const worker = await withKeptSkeleton("owner");
    const others = [
      prefetch("/tasks?_rsc=t", { "next-router-segment-prefetch": "/_tree" }),
      prefetch("/tasks?_rsc=s", { "next-router-state-tree": "%5B%22%22%5D" }),
    ];
    for (const request of others) expect(await answeredAtOnce(worker, request)).toBe(false);
    expect(await answeredAtOnce(worker)).toBe(true);
  });

  it("never keeps an answer that varies by the page it was asked from", async () => {
    const worker = loadWorker();
    await worker.tell("owner");
    worker.dispatch("fetch", { request: prefetch("/tasks?_rsc=abc", { "next-url": "/today" }) });
    await worker.settle();
    const response = payload("intercepted", `${ORIGIN}/tasks?_rsc=abc`);
    response.headers.set("vary", "rsc, next-router-state-tree, next-url");
    worker.network[0]!.resolve(response);
    await worker.settle();
    const kept = [...(worker.caches.stores.get("maxoff-shell-v13")?.keys() ?? [])];
    expect(kept.filter((key) => !key.includes("__maxoff"))).toEqual([]);
  });
});

/** Keeps `/tasks`'s skeleton for `viewer` and returns the worker. */
async function withKeptSkeleton(viewer: string) {
  const worker = loadWorker();
  await worker.tell(viewer);
  worker.dispatch("fetch", { request: prefetch("/tasks?_rsc=abc") });
  await worker.settle();
  worker.network[0]!.resolve(payload(`${viewer} skeleton`, `${ORIGIN}/tasks?_rsc=abc`));
  await worker.settle();
  return worker;
}

/** Whether the next prefetch of `/tasks` is answered before the network (from the cache). */
async function answeredAtOnce(
  worker: ReturnType<typeof loadWorker>,
  request = prefetch("/tasks?_rsc=abc"),
) {
  let done = false;
  void worker.dispatch("fetch", { request })!.then(() => {
    done = true;
  });
  await worker.settle();
  return done;
}

describe("one viewer, one deployment: everything else is dropped", () => {
  it("a different role drops the kept skeletons; the same role keeps them", async () => {
    const worker = await withKeptSkeleton("owner");
    await worker.tell("owner");
    expect(await answeredAtOnce(worker)).toBe(true);
    await worker.tell("staff");
    expect(await answeredAtOnce(worker)).toBe(false);
  });

  it("no viewer (sign-out, a signed-out page's arrival) drops them", async () => {
    const worker = await withKeptSkeleton("owner");
    await worker.tell(null);
    expect(await answeredAtOnce(worker)).toBe(false);
    expect(worker.caches.stores.has("maxoff-shell-v13")).toBe(false);
  });

  it("an unknown viewer counts as none", async () => {
    const worker = await withKeptSkeleton("owner");
    await worker.tell("root");
    expect(await answeredAtOnce(worker)).toBe(false);
  });

  it("a signed-out page (sign-out, sign-in, an auth link) drops them before anyone signs in", async () => {
    for (const page of ["/login", "/forgot-password", "/set-password", "/auth/confirm?x=1"]) {
      const worker = await withKeptSkeleton("owner");
      worker.dispatch("fetch", {
        request: {
          url: `${ORIGIN}${page}`,
          method: "GET",
          mode: "navigate",
          destination: "document",
        },
      });
      await worker.settle();
      expect(await answeredAtOnce(worker), page).toBe(false);
    }
  });

  it("a prefetch sent to sign in (an ended session) drops them", async () => {
    const worker = await withKeptSkeleton("owner");
    worker.dispatch("fetch", { request: prefetch("/calendar?_rsc=xyz") });
    await worker.settle();
    worker.network[1]!.resolve(
      payload("<html>", `${ORIGIN}/login?next=%2Ftoday`, { type: "text/html", redirected: true }),
    );
    await worker.settle();
    expect(await answeredAtOnce(worker)).toBe(false);
  });

  it("another deployment's page is never answered with this one's, and its first skeleton clears them", async () => {
    const worker = await withKeptSkeleton("owner");
    const next = prefetch("/tasks?_rsc=abc", { "x-deployment-id": "def456-2-1" });
    expect(await answeredAtOnce(worker, next)).toBe(false);
    worker.network[1]!.resolve(payload("new build", `${ORIGIN}/tasks?_rsc=abc`));
    await worker.settle();
    const kept = [...(worker.caches.stores.get("maxoff-shell-v13")?.keys() ?? [])].filter(
      (key) => !key.includes("__maxoff"),
    );
    expect(kept).toEqual([`${ORIGIN}/tasks?segment=&tree=&dpl=def456-2-1`]);
  });

  it("one kept task skeleton answers every task, with that task's own id in it", async () => {
    const worker = loadWorker();
    await worker.tell("owner");
    const first = "10000000-0000-4000-8000-000000000001";
    const other = "10000000-0000-4000-8000-000000000002";
    const tree = (id: string) =>
      encodeURIComponent(JSON.stringify(["", { children: [["id", id, "d", null], {}] }, null]));
    worker.dispatch("fetch", {
      request: prefetch(`/tasks/${first}?_rsc=a`, { "next-router-state-tree": tree(first) }),
    });
    await worker.settle();
    worker.network[0]!.resolve(
      payload(`0:["id","${first}","d"] loading ${first}`, `${ORIGIN}/tasks/${first}?_rsc=a`),
    );
    await worker.settle();
    // A task never seen: answered at once from the one copy, the Worker not asked.
    const answer = worker.dispatch("fetch", {
      request: prefetch(`/tasks/${other}?_rsc=b`, { "next-router-state-tree": tree(other) }),
    })!;
    await worker.settle();
    expect(await (await answer).text()).toBe(`0:["id","${other}","d"] loading ${other}`);
    expect(worker.network).toHaveLength(1);
    const kept = [...(worker.caches.stores.get("maxoff-shell-v13")?.keys() ?? [])].filter((key) =>
      key.includes("/tasks/"),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain("/tasks/:id?");
    expect(kept[0]).not.toContain(first);
  });

  it("keeps the newest 60 task skeleton copies, never the destinations' among them", async () => {
    const worker = await withKeptSkeleton("owner");
    const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    for (let n = 0; n < 65; n += 1) {
      // Another segment each time: a copy of its own.
      worker.dispatch("fetch", {
        request: prefetch(`/tasks/${id(n)}?_rsc=abc`, {
          "next-router-segment-prefetch": `/seg-${n}`,
        }),
      });
      await worker.settle();
      worker.network.at(-1)!.resolve(payload("task skeleton", `${ORIGIN}/tasks/${id(n)}?_rsc=abc`));
      await worker.settle();
    }
    const kept = [...(worker.caches.stores.get("maxoff-shell-v13")?.keys() ?? [])];
    const tasks = kept.filter((key) => key.includes("/tasks/:id"));
    expect(tasks).toHaveLength(60);
    expect(tasks[0]).toContain("seg-5");
    expect(kept).toContain(`${ORIGIN}/tasks?segment=&tree=&dpl=${DEPLOYMENT}`);
  });

  it("the viewer survives the worker being stopped: a new worker reads it back", async () => {
    const worker = await withKeptSkeleton("admin");
    // A restarted worker shares the same Cache Storage but none of the old worker's memory.
    const restarted = loadWorker();
    for (const [name, store] of worker.caches.stores) restarted.caches.stores.set(name, store);
    expect(await answeredAtOnce(restarted)).toBe(true);
  });
});
