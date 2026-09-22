import { describe, expect, it } from "vitest";

import { APP_ENVS } from "@/core/observability/env";

import {
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

  it("robots.txt on staging disallows everything", () => {
    expect(ROBOTS_DISALLOW_ALL).toBe("User-agent: *\nDisallow: /\n");
  });
});
