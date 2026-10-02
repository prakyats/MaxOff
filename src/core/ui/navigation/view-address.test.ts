import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { actionLeavesScreen, isRouterActionFetch } from "./progress";
import {
  endOnCompletion,
  noteRouterCommitted,
  noteRouterFetchStarted,
  resetRouterFetches,
  routerFetchesInFlight,
} from "./screen-fetches";
import { replaceViewAddress, resetViewAddress, viewAddressWaiting } from "./view-address";

/** A page at `/tasks/t1` whose address writes are recorded. */
function stubPage() {
  const writes: string[] = [];
  const location = { pathname: "/tasks/t1" };
  vi.stubGlobal("window", {
    location,
    history: {
      replaceState: (_state: unknown, _unused: string, href: string) => {
        writes.push(href);
        location.pathname = new URL(href, "http://app.test").pathname;
      },
    },
  });
  return { writes, location };
}

/** Lets the answer's body copy finish and the task after it run. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      // One more task: `endOnCompletion` posts its own after the copy has been read.
      const after = new MessageChannel();
      after.port1.onmessage = () => {
        after.port1.close();
        resolve();
      };
      after.port2.postMessage(null);
    };
    channel.port2.postMessage(null);
  });
}

describe("the view's address (ARCHITECTURE §14.2 d)", () => {
  beforeEach(() => {
    resetRouterFetches();
    resetViewAddress();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is written at once when the router is not fetching", () => {
    const { writes } = stubPage();
    replaceViewAddress("/tasks/t1?tab=activity");
    expect(writes).toEqual(["/tasks/t1?tab=activity"]);
    expect(viewAddressWaiting()).toBe(false);
  });

  it("waits while a refresh is in flight, and only the last switch is written when it ends", () => {
    const { writes } = stubPage();
    const end = noteRouterFetchStarted();
    replaceViewAddress("/tasks/t1?tab=activity");
    replaceViewAddress("/tasks/t1?tab=details");
    expect(writes).toEqual([]);
    expect(viewAddressWaiting()).toBe(true);
    end();
    expect(writes).toEqual(["/tasks/t1?tab=details"]);
    expect(viewAddressWaiting()).toBe(false);
  });

  it("waits for every fetch in flight, and an end counted twice counts once", () => {
    const { writes } = stubPage();
    const first = noteRouterFetchStarted();
    const second = noteRouterFetchStarted();
    replaceViewAddress("/tasks/t1?tab=activity");
    first();
    first();
    expect(writes).toEqual([]);
    expect(routerFetchesInFlight()).toBe(true);
    second();
    expect(writes).toEqual(["/tasks/t1?tab=activity"]);
    expect(routerFetchesInFlight()).toBe(false);
  });

  it("is dropped when the screen has changed meanwhile", () => {
    const { writes, location } = stubPage();
    const end = noteRouterFetchStarted();
    replaceViewAddress("/tasks/t1?tab=activity");
    location.pathname = "/tasks";
    end();
    expect(writes).toEqual([]);
    expect(viewAddressWaiting()).toBe(false);
  });

  it("follows a fetch's own completion: the answer read to the end, a failure, or no body", async () => {
    const { writes } = stubPage();
    let finish: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        finish = () => controller.close();
      },
    });
    endOnCompletion(Promise.resolve(new Response(body)), noteRouterFetchStarted());
    replaceViewAddress("/tasks/t1?tab=activity");
    await settle();
    expect(writes).toEqual([]);
    finish?.();
    await settle();
    expect(writes).toEqual(["/tasks/t1?tab=activity"]);

    endOnCompletion(Promise.reject(new TypeError("offline")), noteRouterFetchStarted());
    replaceViewAddress("/tasks/t1?tab=details");
    expect(writes).toHaveLength(1);
    await settle();
    expect(writes).toEqual(["/tasks/t1?tab=activity", "/tasks/t1?tab=details"]);

    endOnCompletion(Promise.resolve(new Response(null, { status: 204 })), noteRouterFetchStarted());
    replaceViewAddress("/tasks/t1?tab=work");
    await settle();
    expect(writes.at(-1)).toBe("/tasks/t1?tab=work");
  });

  it("follows an answer whose body fails part way (an abort)", async () => {
    const { writes } = stubPage();
    let fail: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        fail = () => controller.error(new DOMException("aborted", "AbortError"));
      },
    });
    endOnCompletion(Promise.resolve(new Response(body)), noteRouterFetchStarted());
    replaceViewAddress("/tasks/t1?tab=activity");
    await settle();
    expect(writes).toEqual([]);
    fail?.();
    await settle();
    expect(writes).toEqual(["/tasks/t1?tab=activity"]);
  });

  it("leaves the router's own answer readable", async () => {
    stubPage();
    const answer = Promise.resolve(new Response("flight"));
    endOnCompletion(answer, noteRouterFetchStarted());
    expect(await (await answer).text()).toBe("flight");
  });

  it("an action's answer that changes nothing ends on its headers", async () => {
    const { writes } = stubPage();
    const body = new ReadableStream<Uint8Array>({ start: () => undefined });
    endOnCompletion(
      Promise.resolve(new Response(body, { headers: { "x-action-revalidated": "0" } })),
      noteRouterFetchStarted(),
      "action",
      (answer) => actionLeavesScreen(answer.headers),
    );
    replaceViewAddress("/tasks/t1?tab=activity");
    await settle();
    expect(writes).toEqual(["/tasks/t1?tab=activity"]);
  });

  it("an action's answer the router commits ends once read and committed, in either order", async () => {
    const { writes } = stubPage();
    const revalidated = () => new Response("flight", { headers: { "x-action-revalidated": "1" } });
    const leaves = (answer: Response) => actionLeavesScreen(answer.headers);

    endOnCompletion(Promise.resolve(revalidated()), noteRouterFetchStarted(), "action", leaves);
    replaceViewAddress("/tasks/t1?tab=activity");
    await settle();
    // Read to the end, not yet committed: the address waits (Next would push a duplicate entry).
    expect(writes).toEqual([]);
    noteRouterCommitted();
    await settle();
    expect(writes).toEqual(["/tasks/t1?tab=activity"]);

    // Committed while the answer still streams: it ends once read.
    let finish: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        finish = () => controller.close();
      },
    });
    endOnCompletion(
      Promise.resolve(new Response(body, { headers: { "x-action-revalidated": "2" } })),
      noteRouterFetchStarted(),
      "action",
      leaves,
    );
    replaceViewAddress("/tasks/t1?tab=details");
    await settle();
    noteRouterCommitted();
    await settle();
    expect(writes).toHaveLength(1);
    finish?.();
    await settle();
    expect(writes.at(-1)).toBe("/tasks/t1?tab=details");
  });

  it("a failed action's answer is never committed, so it ends once read", async () => {
    const { writes } = stubPage();
    endOnCompletion(
      Promise.resolve(new Response("error", { status: 500 })),
      noteRouterFetchStarted(),
      "action",
      (answer) => actionLeavesScreen(answer.headers),
    );
    replaceViewAddress("/tasks/t1?tab=activity");
    await settle();
    expect(writes).toEqual(["/tasks/t1?tab=activity"]);
  });

  it("tells an action's call and an answer that changes nothing", () => {
    const action = new Headers({ "next-action": "abc" });
    expect(isRouterActionFetch("POST", action)).toBe(true);
    expect(isRouterActionFetch("GET", action)).toBe(false);
    expect(isRouterActionFetch("POST", new Headers())).toBe(false);
    expect(actionLeavesScreen(new Headers())).toBe(true);
    expect(actionLeavesScreen(new Headers({ "x-action-revalidated": "0" }))).toBe(true);
    expect(actionLeavesScreen(new Headers({ "x-action-revalidated": "1" }))).toBe(false);
    expect(actionLeavesScreen(new Headers({ "x-action-revalidated": "2" }))).toBe(false);
    expect(actionLeavesScreen(new Headers({ "x-action-redirect": "/tasks;push" }))).toBe(false);
  });
});
