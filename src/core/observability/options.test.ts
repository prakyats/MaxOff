import { afterEach, describe, expect, it, vi } from "vitest";

import { isSentryDebugEnabled, sentryOptions } from "./options";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sentryOptions (ARCHITECTURE §18)", () => {
  it("is off without a DSN and never sends PII or traces", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "");
    const options = sentryOptions("server");
    expect(options.enabled).toBe(false);
    expect(options.environment).toBe("local");
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
    expect(options.initialScope).toEqual({ tags: { runtime: "server" } });
    expect(options.debug).toBe(false);
  });

  it("is on with a DSN and tags the deployment", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    const options = sentryOptions("client");
    expect(options.enabled).toBe(true);
    expect(options.dsn).toBe("https://key@o1.ingest.sentry.io/1");
    expect(options.environment).toBe("staging");
    expect(options.initialScope).toEqual({ tags: { runtime: "client" } });
  });
});

describe("isSentryDebugEnabled", () => {
  it("is on for the server and edge runtimes on staging only", () => {
    expect(isSentryDebugEnabled("server", "staging")).toBe(true);
    expect(isSentryDebugEnabled("edge", "staging")).toBe(true);
    expect(isSentryDebugEnabled("client", "staging")).toBe(false);
    for (const env of ["production", "local", undefined, ""]) {
      expect(isSentryDebugEnabled("server", env), String(env)).toBe(false);
    }
  });
});
