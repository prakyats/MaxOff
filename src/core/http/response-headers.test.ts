import { describe, expect, it } from "vitest";

import { APP_ENVS } from "@/core/observability/env";

import {
  applyResponseHeaders,
  AUTH_LINK_ROUTE_HEADERS,
  AUTH_LINK_ROUTE_SOURCE,
  FILE_ROUTE_CSP,
  FILE_ROUTE_SOURCE,
  NOINDEX_HEADER,
  REPORT_ONLY_CSP_SOURCE,
  reportOnlyCspHeaders,
  ROBOTS_DISALLOW_ALL,
  SECURITY_HEADERS,
  isNoindexEnvironment,
  responseHeaders,
  sentryCspReportUrl,
} from "./response-headers";

describe("isNoindexEnvironment", () => {
  it("is staging only", () => {
    expect(APP_ENVS.filter(isNoindexEnvironment)).toEqual(["staging"]);
    expect(isNoindexEnvironment(undefined)).toBe(false);
    expect(isNoindexEnvironment("")).toBe(false);
    expect(isNoindexEnvironment("Staging")).toBe(false);
  });
});

describe("responseHeaders", () => {
  it("adds X-Robots-Tag noindex, nofollow on staging only", () => {
    expect(responseHeaders("staging")).toEqual([...SECURITY_HEADERS, NOINDEX_HEADER]);
    expect(NOINDEX_HEADER).toEqual({ key: "X-Robots-Tag", value: "noindex, nofollow" });
  });

  it("keeps production and local indexable-by-choice (no robots header at all)", () => {
    for (const env of ["production", "local", undefined]) {
      const keys = responseHeaders(env).map((header) => header.key.toLowerCase());
      expect(keys, String(env)).not.toContain("x-robots-tag");
      expect(responseHeaders(env), String(env)).toEqual([...SECURITY_HEADERS]);
    }
  });

  it("never drops a security header", () => {
    for (const env of APP_ENVS) {
      for (const header of SECURITY_HEADERS) {
        expect(responseHeaders(env)).toContainEqual(header);
      }
    }
  });

  it("sandboxes what /api/files serves and still forbids framing (3.3)", () => {
    expect(FILE_ROUTE_SOURCE).toBe("/api/files/:path*");
    expect(FILE_ROUTE_CSP.key).toBe("Content-Security-Policy");
    for (const directive of ["default-src 'none'", "sandbox", "frame-ancestors 'none'"]) {
      expect(FILE_ROUTE_CSP.value).toContain(directive);
    }
    expect(FILE_ROUTE_CSP.value).not.toMatch(/script-src|img-src|connect-src/);
  });

  it("keeps a one-time link's page out of caches, indexes and referrers (3cB review)", () => {
    expect(AUTH_LINK_ROUTE_SOURCE).toBe("/auth/confirm");
    const byKey = Object.fromEntries(AUTH_LINK_ROUTE_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey["Cache-Control"]).toBe("no-store");
    expect(byKey["X-Robots-Tag"]).toContain("noindex");
    expect(byKey["Referrer-Policy"]).toBe("no-referrer");
    // A stricter value than the build's, never a header the build does not already govern.
    const global = SECURITY_HEADERS.find((h) => h.key === "Referrer-Policy");
    expect(global?.value).not.toBe("no-referrer");
  });

  it("puts the build's list on a response the proxy answers itself (3c.1)", () => {
    const headers = applyResponseHeaders(
      new Headers({ "X-Frame-Options": "SAMEORIGIN" }),
      "staging",
    );
    for (const header of [...SECURITY_HEADERS, NOINDEX_HEADER]) {
      expect(headers.get(header.key)).toBe(header.value);
    }
    expect(applyResponseHeaders(new Headers(), "production").get("X-Robots-Tag")).toBeNull();
  });

  it("robots.txt on staging disallows everything", () => {
    expect(ROBOTS_DISALLOW_ALL).toBe("User-agent: *\nDisallow: /\n");
  });
});

describe("the report-only CSP (v7.5 Q7)", () => {
  const DSN = "https://abc123@o42.ingest.sentry.io/4507";
  const policy = (sources: Parameters<typeof reportOnlyCspHeaders>[0]) =>
    reportOnlyCspHeaders(sources).find(
      (header) => header.key === "Content-Security-Policy-Report-Only",
    )?.value ?? "";
  const directive = (value: string, name: string) =>
    value
      .split("; ")
      .find((part) => part.startsWith(`${name} `))
      ?.slice(name.length + 1)
      .split(" ") ?? [];

  it("reports to Sentry's security endpoint for the DSN's project, per environment", () => {
    expect(sentryCspReportUrl(DSN, "staging")).toBe(
      "https://o42.ingest.sentry.io/api/4507/security/?sentry_key=abc123&sentry_environment=staging",
    );
    expect(sentryCspReportUrl(undefined, "production")).toBeNull();
    expect(sentryCspReportUrl("not a url", "production")).toBeNull();
    expect(sentryCspReportUrl("http://abc@o42.ingest.sentry.io/4507", "production")).toBeNull();
    expect(sentryCspReportUrl("https://o42.ingest.sentry.io/4507", "production")).toBeNull();
  });

  it("is report-only: the enforced CSP stays frame-ancestors 'none' alone", () => {
    const headers = reportOnlyCspHeaders({
      appEnv: "production",
      supabaseUrl: "https://ref.supabase.co",
      sentryDsn: DSN,
    });
    expect(headers.map((header) => header.key)).toEqual([
      "Content-Security-Policy-Report-Only",
      "Reporting-Endpoints",
    ]);
    expect(SECURITY_HEADERS).toContainEqual({
      key: "Content-Security-Policy",
      value: "frame-ancestors 'none'",
    });
  });

  it("allows the app's own origin, Supabase and its socket, R2 uploads, Google uploads and Sentry", () => {
    const value = policy({
      appEnv: "production",
      supabaseUrl: "https://ref.supabase.co",
      sentryDsn: DSN,
    });
    expect(directive(value, "default-src")).toEqual(["'self'"]);
    expect(directive(value, "connect-src")).toEqual([
      "'self'",
      "https://ref.supabase.co",
      "wss://ref.supabase.co",
      "https://*.r2.cloudflarestorage.com",
      "https://www.googleapis.com",
      "https://o42.ingest.sentry.io",
    ]);
    for (const [name, sources] of [
      ["object-src", ["'none'"]],
      ["base-uri", ["'none'"]],
      ["frame-src", ["'none'"]],
      ["form-action", ["'self'"]],
      ["worker-src", ["'self'"]],
      ["img-src", ["'self'", "data:", "blob:"]],
    ] as const) {
      expect(directive(value, name), name).toEqual(sources);
    }
    expect(directive(value, "report-uri")).toEqual([sentryCspReportUrl(DSN, "production")]);
    expect(directive(value, "report-to")).toEqual(["csp"]);
  });

  it("names the loopback host only off the deployed environments", () => {
    for (const appEnv of ["staging", "production"]) {
      expect(policy({ appEnv, supabaseUrl: undefined, sentryDsn: undefined })).not.toMatch(
        /127\.0\.0\.1|localhost/,
      );
    }
    for (const appEnv of ["local", undefined]) {
      expect(
        directive(
          policy({ appEnv, supabaseUrl: "http://127.0.0.1:54331", sentryDsn: undefined }),
          "connect-src",
        ),
      ).toEqual(
        expect.arrayContaining([
          "http://127.0.0.1:54331",
          "ws://127.0.0.1:54331",
          "http://127.0.0.1:*",
        ]),
      );
    }
  });

  it("without a DSN there is nowhere to report: no reporting directives", () => {
    const headers = reportOnlyCspHeaders({
      appEnv: "local",
      supabaseUrl: undefined,
      sentryDsn: undefined,
    });
    expect(headers.map((header) => header.key)).toEqual(["Content-Security-Policy-Report-Only"]);
    expect(headers[0]?.value).not.toMatch(/report-(uri|to)/);
  });
});

describe("where the report-only CSP applies (v7.5 review)", () => {
  // Next's `headers()` sources are path-to-regexp; the group here is a plain regular expression.
  const applies = (path: string) =>
    new RegExp(`^${REPORT_ONLY_CSP_SOURCE.replace(/^\/\(/, "/(")}$`).test(path);
  it("covers every page but the auth link page, whose address carries a token", () => {
    for (const path of ["/", "/today", "/login", "/set-password", "/auth/signout", "/me/privacy"]) {
      expect(applies(path), path).toBe(true);
    }
    expect(applies("/auth/confirm")).toBe(false);
    expect(applies("/auth/confirm/")).toBe(false);
    expect(AUTH_LINK_ROUTE_SOURCE).toBe("/auth/confirm");
  });
});
