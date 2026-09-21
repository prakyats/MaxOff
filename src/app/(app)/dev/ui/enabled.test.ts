import { describe, expect, it } from "vitest";

import { isDevGalleryEnabled } from "./enabled";

describe("isDevGalleryEnabled (development-only, deleted in task 1.2)", () => {
  it("is off in production so the gallery 404s", () => {
    expect(isDevGalleryEnabled("production")).toBe(false);
  });

  it("is on in development and test only", () => {
    expect(isDevGalleryEnabled("development")).toBe(true);
    expect(isDevGalleryEnabled("test")).toBe(true);
  });

  it("is off when NODE_ENV is unset or unusual (allow-list, not deny-list)", () => {
    expect(isDevGalleryEnabled(undefined)).toBe(false);
    expect(isDevGalleryEnabled("")).toBe(false);
    expect(isDevGalleryEnabled("staging")).toBe(false);
  });
});
