import { type Event, getIsolationScope, parseEnvelope } from "@sentry/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureException } from "./capture";
import { runInRequestScope } from "./request-scope";
import { initServerSentry } from "./server";
import { setSentryUser } from "./user";

const sent: Event[] = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    for (const [header, payload] of parseEnvelope(init.body as string | Uint8Array)[1]) {
      if (header.type === "event") sent.push(payload as Event);
    }
    return new Response(null, { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  sent.length = 0;
});

/** Two requests in flight at once, each setting its member and then reporting. */
async function twoConcurrentRequests(wrap: (handler: () => Promise<void>) => Promise<void>) {
  await Promise.all([
    wrap(async () => {
      setSentryUser("member-a");
      await tick();
      await tick();
      captureException(new Error("from a"));
    }),
    wrap(async () => {
      await tick();
      setSentryUser("member-b");
      await tick();
      captureException(new Error("from b"));
    }),
  ]);
}

const userOf = (message: string) =>
  sent.find((event) => event.exception?.values?.[0]?.value === message)?.user;

describe("runInRequestScope (ADR-0014): one isolation scope per Worker request", () => {
  it("keeps each request's member on its own reports", async () => {
    const client = initServerSentry();
    await twoConcurrentRequests((handler) => runInRequestScope(handler));
    await client.flush(2000);
    expect(userOf("from a")).toEqual({ id: "member-a" });
    expect(userOf("from b")).toEqual({ id: "member-b" });
    expect(getIsolationScope().getUser()).toEqual({});
  });

  it("is what prevents the leak: without it, a request reports the other request's member", async () => {
    const client = initServerSentry();
    await twoConcurrentRequests((handler) => handler());
    await client.flush(2000);
    expect(userOf("from a")).toEqual({ id: "member-b" });
    getIsolationScope().clear();
  });

  it("reports from later requests although Next registered inside the first one", async () => {
    const client = await runInRequestScope(async () => initServerSentry());
    await runInRequestScope(async () => {
      setSentryUser("member-c");
      captureException(new Error("later request"));
    });
    await client.flush(2000);
    expect(userOf("later request")).toEqual({ id: "member-c" });
  });
});
