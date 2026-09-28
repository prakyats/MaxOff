import { describe, expect, it } from "vitest";

import { APP_ENVS } from "@/core/observability/env";

import {
  applyResponseHeaders,
  AUTH_LINK_ROUTE_HEADERS,
  AUTH_LINK_ROUTE_SOURCE,
  FILE_ROUTE_CSP,
  FILE_ROUTE_SOURCE,
  NOINDEX_HEADER,
  ROBOTS_DISALLOW_ALL,
  SECURITY_HEADERS,
  isNoindexEnvironment,
  responseHeaders,
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
