import { afterEach, describe, expect, it, vi } from "vitest";

import { digestDiagnosticEnv, isDigestDiagnosticEnabled } from "./digest-diagnostic";

describe("isDigestDiagnosticEnabled", () => {
  const open = { buildAppEnv: "staging", runtimeAppEnv: undefined, canonicalHost: undefined };

  it("is on for local and staging builds (branch previews are staging builds)", () => {
    expect(isDigestDiagnosticEnabled(open)).toBe(true);
    expect(isDigestDiagnosticEnabled({ ...open, buildAppEnv: "local" })).toBe(true);
    expect(isDigestDiagnosticEnabled({ ...open, runtimeAppEnv: "staging" })).toBe(true);
  });

  it("is off for a production build", () => {
    expect(isDigestDiagnosticEnabled({ ...open, buildAppEnv: "production" })).toBe(false);
  });

  it("is off when the runtime says production, whatever the build said", () => {
    expect(isDigestDiagnosticEnabled({ ...open, runtimeAppEnv: "production" })).toBe(false);
    expect(isDigestDiagnosticEnabled({ ...open, runtimeAppEnv: " production " })).toBe(false);
    expect(isDigestDiagnosticEnabled({ ...open, runtimeAppEnv: "something" })).toBe(false);
  });

  it("is off on the production Worker (CANONICAL_HOST set), whatever the build said", () => {
    expect(isDigestDiagnosticEnabled({ ...open, canonicalHost: "app.maxoff.in" })).toBe(false);
  });

  it("is off for a missing or unexpected build value", () => {
    expect(isDigestDiagnosticEnabled({ ...open, buildAppEnv: undefined })).toBe(false);
    expect(isDigestDiagnosticEnabled({ ...open, buildAppEnv: "" })).toBe(false);
    expect(isDigestDiagnosticEnabled({ ...open, buildAppEnv: "Staging" })).toBe(false);
  });
});

describe("digestDiagnosticEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the runtime values on each call", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    vi.stubEnv("CANONICAL_HOST", "app.maxoff.in");
    expect(digestDiagnosticEnv("staging")).toEqual({
      buildAppEnv: "staging",
      runtimeAppEnv: "production",
      canonicalHost: "app.maxoff.in",
    });
  });
});
