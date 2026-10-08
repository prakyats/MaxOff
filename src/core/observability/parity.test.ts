/**
 * Scrubbing parity (task 6.5b, ADR-0014): the Worker's `@sentry/cloudflare` client sends exactly
 * what the Node SDK client of `@sentry/nextjs` sent before the switch, after the same scrubber.
 *
 * One table of cases runs against both paths, each a real SDK client with the real transport
 * (`makeFetchTransport`, `fetch` stubbed to catch the envelope):
 * - **node**: the pre-switch `initServerSentry` (`sentryOptions("server")`, no local variables,
 *   the fetch transport) on `@sentry/nextjs`'s server build. Of the Node defaults it keeps the
 *   integrations that shape an event; the rest only hook the process, `node:http` or undici,
 *   which is nothing a Worker request goes through, or are the four it already dropped on the
 *   Worker (`ContextLines`, `Modules`, `LocalVariablesAsync`, `Context`).
 * - **cloudflare**: `initServerSentry` as the Worker runs it now.
 *
 * Each case is asserted on both, and the two events must match field for field once the parts
 * that name the SDK itself are set aside (sdk, platform, runtime context, server name, ids,
 * timestamps, stack frame paths).
 */
import * as NodeSentry from "@sentry/nextjs";
import {
  addBreadcrumb,
  type Breadcrumb,
  type Client,
  type Event,
  getCurrentScope,
  getGlobalScope,
  getIsolationScope,
  initAndBind,
  type Integration,
  parseEnvelope,
} from "@sentry/core";
import type { Instrumentation } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureException, captureMessage } from "./capture";
import {
  SENTRY_DIAGNOSTIC_MESSAGE,
  SENTRY_DIAGNOSTIC_PAYLOAD,
  throwSentryDiagnostic,
} from "./diagnostic";
import { sentryOptions } from "./options";
import { captureRequestError } from "./request-error";
import { runInRequestScope } from "./request-scope";
import { SCRUBBED } from "./scrub";
import { initServerSentry } from "./server";
import { makeFetchTransport } from "./transport";
import { setSentryUser } from "./user";

const DSN = "https://key@o1.ingest.sentry.io/1";
const sent: Event[] = [];

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const [, items] = parseEnvelope(init.body as string | Uint8Array);
    for (const [header, payload] of items) {
      if (header.type === "event") sent.push(payload as Event);
    }
    return new Response(null, { status: 200 });
  });
});

function reset() {
  sent.length = 0;
  for (const scope of [getCurrentScope(), getIsolationScope(), getGlobalScope()]) scope.clear();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  reset();
});

/** The Node defaults that shape an event (see the header). */
const NODE_EVENT_INTEGRATIONS = [
  "InboundFilters",
  "FunctionToString",
  "LinkedErrors",
  "RequestData",
  "NodeSystemError",
  "ConversationId",
  "Console",
];

interface SdkPath {
  name: "node" | "cloudflare";
  init(): Client;
  onRequestError: Instrumentation.onRequestError;
}

const PATHS: SdkPath[] = [
  {
    name: "node",
    init: () =>
      initAndBind(NodeSentry.NodeClient, {
        ...sentryOptions("server"),
        includeLocalVariables: false,
        integrations: NodeSentry.getDefaultIntegrations({}).filter((integration: Integration) =>
          NODE_EVENT_INTEGRATIONS.includes(integration.name),
        ),
        stackParser: NodeSentry.defaultStackParser,
        transport: makeFetchTransport,
      }),
    onRequestError: NodeSentry.captureRequestError,
  },
  {
    name: "cloudflare",
    init: () => initServerSentry(),
    onRequestError: captureRequestError,
  },
];

/**
 * Runs one case as one Worker request would (`worker/index.js`: its own isolation scope), then
 * waits for the envelope.
 */
async function send(path: SdkPath, act: (path: SdkPath) => void): Promise<Event> {
  const client = path.init();
  runInRequestScope(() => act(path));
  await client.close(2000);
  expect(sent).toHaveLength(1);
  return sent[0] as Event;
}

function withoutTimestamp(breadcrumb: Breadcrumb): Breadcrumb {
  const copy = { ...breadcrumb };
  delete copy.timestamp;
  return copy;
}

const RUPEES = "₹12,000";
const EMAIL = "someone@example.com";
const PHONE = "+91 9876543210";

interface Case {
  name: string;
  act(path: SdkPath): void;
  check(event: Event): void;
}

const CASES: Case[] = [
  {
    name: "setUser carries the member id only",
    act: () => {
      setSentryUser("member-1");
      captureException(new Error("boom"));
    },
    check: (event) => expect(event.user).toEqual({ id: "member-1" }),
  },
  {
    name: "user.geo and every other user field are stripped, whoever set them",
    act: () => {
      setSentryUser("member-1");
      getIsolationScope().setUser({
        id: "member-1",
        email: EMAIL,
        username: "Asha",
        ip_address: "203.0.113.7",
        geo: { country_code: "IN", city: "Mumbai", region: "Maharashtra" },
      });
      captureException(new Error("boom"));
    },
    check: (event) => {
      expect(event.user).toEqual({ id: "member-1" });
      expect(JSON.stringify(event)).not.toMatch(/geo|Mumbai|203\.0\.113\.7|Asha/);
    },
  },
  {
    name: "signed out: no user at all",
    act: () => {
      setSentryUser("member-1");
      setSentryUser(null);
      captureException(new Error("boom"));
    },
    check: (event) => expect(event.user ?? {}).toEqual({}),
  },
  {
    name: "money keys and contact strings are scrubbed (the staging diagnostic's payload)",
    act: () => {
      try {
        throwSentryDiagnostic();
      } catch (error) {
        captureException(error);
      }
    },
    check: (event) => {
      const json = JSON.stringify(event);
      const { amount, email, phone } = SENTRY_DIAGNOSTIC_PAYLOAD;
      for (const value of [amount, email, phone, "12000"]) expect(json).not.toContain(value);
      expect(event.contexts?.["diagnostic"]).toEqual({
        amount: SCRUBBED,
        email: SCRUBBED,
        phone: SCRUBBED,
        billing: SCRUBBED,
      });
      expect(event.tags?.["diagnostic_contact"]).toBe(SCRUBBED);
      expect(event.extra?.["diagnostic_note"]).not.toBe(SENTRY_DIAGNOSTIC_MESSAGE);
      expect(event.exception?.values?.[0]?.value).toContain(SCRUBBED);
    },
  },
  {
    name: "request bodies, cookies, headers and query strings are dropped",
    act: () => {
      getCurrentScope().setSDKProcessingMetadata({
        normalizedRequest: {
          url: "https://app.example/today?amount=500&q=Asha",
          method: "POST",
          headers: { cookie: "sb-access-token=secret", authorization: "Bearer secret" },
          cookies: { "sb-access-token": "secret" },
          query_string: "amount=500&q=Asha",
          data: JSON.stringify({ amount: 500, email: EMAIL }),
        },
      });
      captureException(new Error("boom"));
    },
    check: (event) => {
      expect(event.request).toEqual({ url: "https://app.example/today", method: "POST" });
      expect(JSON.stringify(event)).not.toMatch(/secret|Asha|amount=500/);
    },
  },
  {
    name: "breadcrumbs follow beforeBreadcrumb, and a message is scrubbed",
    act: () => {
      addBreadcrumb({
        category: "fetch",
        data: {
          method: "POST",
          url: "https://db.example/rest/v1/revenue?select=amount",
          status_code: 500,
          request_body: `{"email":"${EMAIL}"}`,
        },
      });
      addBreadcrumb({ category: "console", level: "error", message: `paid ${RUPEES} by ${EMAIL}` });
      addBreadcrumb({
        category: "navigation",
        data: { from: "/tasks?search=Asha", to: "/people/1?phone=9876543210" },
      });
      addBreadcrumb({ category: "custom", data: { billing: { total: 12000 }, note: PHONE } });
      captureMessage(`could not reach ${EMAIL} on ${PHONE}`, "error");
    },
    check: (event) => {
      expect(event.message).toBe(`could not reach ${SCRUBBED} on ${SCRUBBED}`);
      const crumbs = (event.breadcrumbs ?? []).map(withoutTimestamp);
      expect(crumbs).toEqual([
        {
          category: "fetch",
          data: { method: "POST", status_code: 500, url: "https://db.example/rest/v1/revenue" },
        },
        { category: "console", level: "error", message: `paid ${SCRUBBED} by ${SCRUBBED}` },
        { category: "navigation", data: { from: "/tasks", to: "/people/1" } },
        { category: "custom", data: { billing: SCRUBBED, note: SCRUBBED } },
      ]);
    },
  },
  {
    name: "onRequestError: the nextjs context, path only, no headers",
    act: (path) => {
      void path.onRequestError(
        new Error(`render failed for ${EMAIL}`),
        {
          path: "/tasks/1?search=Asha&amount=500",
          method: "GET",
          headers: { cookie: "sb-access-token=secret", "x-forwarded-for": "203.0.113.7" },
        },
        {
          routerKind: "App Router",
          routePath: "/tasks/[id]",
          routeType: "render",
          revalidateReason: undefined,
        },
      );
    },
    check: (event) => {
      expect(event.contexts?.["nextjs"]).toEqual({
        request_path: "/tasks/1",
        router_kind: "App Router",
        router_path: "/tasks/[id]",
        route_type: "render",
      });
      expect(event.transaction).toBe("GET /tasks/[id]");
      expect(event.exception?.values?.[0]?.mechanism).toEqual({
        type: "auto.function.nextjs.on_request_error",
        handled: false,
      });
      expect(event.exception?.values?.[0]?.value).toBe(`render failed for ${SCRUBBED}`);
      expect(JSON.stringify(event)).not.toMatch(/secret|203\.0\.113\.7|Asha|amount=500/);
    },
  },
];

/** Everything but what names the SDK, the runtime and this one event. */
function comparable(event: Event) {
  // The runtime context names the SDK's runtime, and the trace ids are per event.
  const contexts = { ...event.contexts };
  delete contexts["runtime"];
  delete contexts["trace"];
  return {
    level: event.level,
    environment: event.environment,
    message: event.message,
    transaction: event.transaction,
    user: event.user,
    request: event.request,
    tags: event.tags,
    extra: event.extra,
    contexts,
    breadcrumbs: (event.breadcrumbs ?? []).map(withoutTimestamp),
    exception: (event.exception?.values ?? []).map(({ type, value, mechanism }) => ({
      type,
      value,
      mechanism,
    })),
  };
}

describe("server Sentry: scrubbing parity between the Node SDK and @sentry/cloudflare", () => {
  for (const testCase of CASES) {
    describe(testCase.name, () => {
      for (const path of PATHS) {
        it(`${path.name}`, async () => {
          testCase.check(await send(path, testCase.act));
        });
      }

      it("sends the same event on both paths", async () => {
        const [node, cloudflare] = PATHS;
        const before = await send(node as SdkPath, testCase.act);
        reset();
        const after = await send(cloudflare as SdkPath, testCase.act);
        expect(after.sdk?.name).toBe("sentry.javascript.cloudflare");
        expect(before.sdk?.name).toBe("sentry.javascript.node");
        expect(comparable(after)).toEqual(comparable(before));
      });
    });
  }
});
