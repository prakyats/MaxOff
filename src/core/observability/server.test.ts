import {
  type Event,
  type EventHint,
  getCurrentScope,
  getGlobalScope,
  getIsolationScope,
  parseEnvelope,
} from "@sentry/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureException } from "./capture";
import { scrubBreadcrumb, scrubEvent } from "./scrub";
import {
  WORKER_EXCLUDED_INTEGRATIONS,
  dropReactControlFlowErrors,
  initServerSentry,
  workerClientOptions,
  workerIntegrations,
} from "./server";
import { makeFetchTransport } from "./transport";

const DSN = "https://key@o1.ingest.sentry.io/1";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const scope of [getCurrentScope(), getIsolationScope(), getGlobalScope()]) scope.clear();
});

describe("workerIntegrations", () => {
  it("leaves out Dedupe, the global fetch patch, Hono and the request-handler integration", () => {
    const defaults = ["Dedupe", "Fetch", "Hono", "HttpServer", "RequestData", "Console"].map(
      (name) => ({ name }),
    );
    expect(workerIntegrations(defaults).map((i) => i.name)).toEqual(["RequestData", "Console"]);
    expect([...WORKER_EXCLUDED_INTEGRATIONS].sort()).toEqual([
      "Dedupe",
      "Fetch",
      "Hono",
      "HttpServer",
    ]);
  });
});

describe("workerClientOptions (ADR-0014)", () => {
  it("keeps every shared option: the scrubber, no PII, no tracing, no local variables", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    const options = workerClientOptions("server");
    expect(options.dsn).toBe(DSN);
    expect(options.enabled).toBe(true);
    expect(options.environment).toBe("staging");
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
    expect(options.tracePropagationTargets).toEqual([]);
    expect(options.includeLocalVariables).toBe(false);
    expect(options.debug).toBe(false);
    expect(options.initialScope).toEqual({ tags: { runtime: "server" } });
    expect(options.transport).toBe(makeFetchTransport);
    expect(options.integrations.map((i) => i.name)).toEqual([
      "InboundFilters",
      "FunctionToString",
      "ConversationId",
      "LinkedErrors",
      "RequestData",
      "Console",
    ]);
  });

  it("is off without a DSN (local and CI)", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    expect(workerClientOptions("edge")).toMatchObject({ enabled: false, dsn: "" });
    expect(workerClientOptions("edge").initialScope).toEqual({ tags: { runtime: "edge" } });
  });

  it("parses Worker stack lines: every frame in app, paths rooted at /", () => {
    const frames = workerClientOptions("server").stackParser(
      "Error: boom\n    at render (index.js:12:34)\n    at /bundle/handler.mjs:5:6",
    );
    expect(
      frames.map(({ filename, abs_path, in_app }) => ({ filename, abs_path, in_app })),
    ).toEqual([
      { filename: "/bundle/handler.mjs", abs_path: "/bundle/handler.mjs", in_app: true },
      { filename: "index.js", abs_path: "/index.js", in_app: true },
    ]);
  });
});

describe("dropReactControlFlowErrors (as @sentry/nextjs did)", () => {
  const error = (value: string): Event => ({ exception: { values: [{ type: "Error", value }] } });

  it("drops React's postpone signal and its Suspense exceptions", () => {
    const postpone: EventHint = { originalException: { $$typeof: Symbol.for("react.postpone") } };
    expect(dropReactControlFlowErrors(error("x"), postpone)).toBeNull();
    expect(
      dropReactControlFlowErrors(error("Suspense Exception: This is not a real error!"), {}),
    ).toBeNull();
  });

  it("keeps real errors and anything that is not an error event", () => {
    const real = error("boom");
    expect(dropReactControlFlowErrors(real, { originalException: new Error("boom") })).toBe(real);
    const transaction: Event = { type: "transaction" };
    expect(dropReactControlFlowErrors(transaction, {})).toBe(transaction);
  });
});

describe("initServerSentry on the Worker", () => {
  const requests: { url: string; headers: Headers; events: Event[] }[] = [];

  beforeEach(() => {
    requests.length = 0;
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    const stub = async (input: string, init: RequestInit = {}) => {
      const events: Event[] = [];
      if (input.includes("ingest.sentry.io")) {
        for (const [header, payload] of parseEnvelope(init.body as string | Uint8Array)[1]) {
          if (header.type === "event") events.push(payload as Event);
        }
      }
      requests.push({ url: input, headers: new Headers(init.headers), events });
      return new Response(null, { status: 200 });
    };
    // workerd's fetch is native, and the SDK's fetch patch only wraps a native one.
    Object.defineProperty(stub, "toString", { value: () => "function fetch() { [native code] }" });
    vi.stubGlobal("fetch", stub);
  });

  it("never patches fetch: no breadcrumb for an outgoing call, no trace headers on it", async () => {
    const client = initServerSentry();
    await fetch("https://fcm.googleapis.com/fcm/send/device-token-123", { method: "POST" });
    captureException(new Error("push failed"));
    await client.close(2000);

    const [push, report] = requests;
    expect(push?.headers.has("sentry-trace")).toBe(false);
    expect(push?.headers.has("baggage")).toBe(false);
    expect(report?.events).toHaveLength(1);
    expect(JSON.stringify(report?.events)).not.toContain("device-token-123");
  });

  it("reports the same error twice in a row, as the Node SDK did (no Dedupe)", async () => {
    const client = initServerSentry();
    for (let i = 0; i < 2; i++) {
      try {
        throw new Error("same failure");
      } catch (error) {
        captureException(error);
      }
    }
    await client.close(2000);
    expect(requests.flatMap((request) => request.events)).toHaveLength(2);
  });

  it("drops React's control-flow errors before they are sent", async () => {
    const client = initServerSentry();
    captureException({ $$typeof: Symbol.for("react.postpone") });
    captureException(new Error("real"));
    await client.close(2000);
    const events = requests.flatMap((request) => request.events);
    expect(events.map((event) => event.exception?.values?.[0]?.value)).toEqual(["real"]);
  });
});
