import { describe, expect, it } from "vitest";

import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";

import { APP_ENVS } from "@/core/observability/env";

import {
  applyResponseHeaders,
  AUTH_LINK_ROUTE_HEADERS,
  AUTH_LINK_ROUTE_SOURCE,
  EVERY_PATH_BUT_UPLOAD_PAGE,
  globalHeaderRules,
  UPLOAD_API_ROUTE_HEADERS,
  UPLOAD_API_ROUTE_SOURCE,
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

  it("keeps the upload page's API out of caches, indexes and referrers, isolated (v4.5, plan J)", () => {
    expect(UPLOAD_API_ROUTE_SOURCE).toBe("/api/upload/:path*");
    const byKey = Object.fromEntries(UPLOAD_API_ROUTE_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey).toMatchObject({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    expect(byKey["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(byKey["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    for (const feature of [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
    ]) {
      expect(byKey["Permissions-Policy"]).toContain(feature);
    }
    expect(byKey).not.toHaveProperty("Access-Control-Allow-Origin");
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

describe("globalHeaderRules (v4.5, pen test M17)", () => {
  // Next's own matcher, as it reads a `headers()` source (strict, case-insensitive).
  const matches = (source: string, path: string) =>
    getPathMatch(source, { strict: true })(path) !== false;

  it("the global CSP rule covers every path but the upload page", () => {
    for (const path of ["/", "/login", "/today", "/tasks/abc", "/uploads", "/api/upload/start"]) {
      expect(matches(EVERY_PATH_BUT_UPLOAD_PAGE, path), path).toBe(true);
    }
    expect(matches(EVERY_PATH_BUT_UPLOAD_PAGE, "/upload")).toBe(false);
  });

  it("keeps every header: all but the CSP on every path, the CSP on its own rule", () => {
    for (const env of APP_ENVS) {
      const list = responseHeaders(env);
      const [all, csp] = globalHeaderRules(list);
      expect(all!.source).toBe("/:path*");
      expect(csp!.source).toBe(EVERY_PATH_BUT_UPLOAD_PAGE);
      expect([...all!.headers, ...csp!.headers]).toEqual(expect.arrayContaining([...list]));
      expect(all!.headers.length + csp!.headers.length).toBe(list.length);
      expect(csp!.headers).toEqual([
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ]);
    }
  });
});
