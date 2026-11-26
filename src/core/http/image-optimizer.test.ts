import { describe, expect, it } from "vitest";

import { isImageOptimizerRequest } from "./image-optimizer";

const BASE = "https://maxoff-staging.pixoraclips.workers.dev";

describe("isImageOptimizerRequest (v2.0.1, the closed /_next/image)", () => {
  it("matches the optimizer's route, with or without a query or a trailing slash", () => {
    expect(isImageOptimizerRequest(`${BASE}/_next/image`)).toBe(true);
    expect(isImageOptimizerRequest(`${BASE}/_next/image?url=/icons/icon-192.png&w=64&q=75`)).toBe(
      true,
    );
    expect(isImageOptimizerRequest(`${BASE}/_next/image/`)).toBe(true);
    expect(isImageOptimizerRequest(`${BASE}/_next/image//?url=https://example.com/a.svg`)).toBe(
      true,
    );
  });

  it("matches any letter case a server might normalise", () => {
    expect(isImageOptimizerRequest(`${BASE}/_NEXT/Image?url=/x.png`)).toBe(true);
  });

  it("leaves every other path alone: static files, the app, look-alike paths", () => {
    for (const path of [
      "/",
      "/today",
      "/_next/static/chunks/main.js",
      "/_next/images",
      "/_next/image-x",
      "/icons/icon-192.png",
      "/guide/staff/request-split.webp",
      "/api/next/image",
    ]) {
      expect(isImageOptimizerRequest(`${BASE}${path}`), path).toBe(false);
    }
  });

  it("does nothing for an unparsable URL", () => {
    expect(isImageOptimizerRequest("not a url")).toBe(false);
  });
});
