import { describe, expect, it } from "vitest";

import { isPreviewEnvironment, resolvePreviewRole } from "./preview-role";

describe("resolvePreviewRole (development-only shim, deleted in task 1.2)", () => {
  it("returns null in production whatever the cookie says", () => {
    expect(resolvePreviewRole("ceo", "production")).toBeNull();
    expect(resolvePreviewRole("staff", "production")).toBeNull();
    expect(resolvePreviewRole(undefined, "production")).toBeNull();
  });

  it("returns null when NODE_ENV is unset or unusual (allow-list, not deny-list)", () => {
    expect(resolvePreviewRole("ceo", undefined)).toBeNull();
    expect(resolvePreviewRole("ceo", "")).toBeNull();
    expect(resolvePreviewRole("ceo", "staging")).toBeNull();
    expect(isPreviewEnvironment("development")).toBe(true);
    expect(isPreviewEnvironment("test")).toBe(true);
    expect(isPreviewEnvironment("production")).toBe(false);
  });

  it("previews the cookie's role in development and test", () => {
    expect(resolvePreviewRole("staff", "development")).toBe("staff");
    expect(resolvePreviewRole("admin", "development")).toBe("admin");
    expect(resolvePreviewRole("admin", "test")).toBe("admin");
  });

  it("falls back to the CEO when the cookie is missing or invalid", () => {
    expect(resolvePreviewRole(undefined, "development")).toBe("ceo");
    expect(resolvePreviewRole("owner", "development")).toBe("ceo");
    expect(resolvePreviewRole("", "development")).toBe("ceo");
  });
});
