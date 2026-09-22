import { afterEach, describe, expect, it, vi } from "vitest";

import { assertObservabilityEnv, observabilityEnv, parseObservabilityEnv } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseObservabilityEnv", () => {
  it("defaults to local with Sentry off when nothing is set", () => {
    expect(parseObservabilityEnv({ appEnv: undefined, dsn: undefined })).toEqual({
      appEnv: "local",
    });
  });

  it("treats an empty DSN as unset (CI placeholders)", () => {
    expect(parseObservabilityEnv({ appEnv: "", dsn: "" })).toEqual({ appEnv: "local" });
  });

  it("accepts staging and production with a DSN, trimming pasted whitespace", () => {
    expect(
      parseObservabilityEnv({ appEnv: " staging ", dsn: "https://abc@o1.ingest.sentry.io/1 " }),
    ).toEqual({ appEnv: "staging", dsn: "https://abc@o1.ingest.sentry.io/1" });
    expect(parseObservabilityEnv({ appEnv: "production", dsn: undefined })).toEqual({
      appEnv: "production",
    });
  });

  it("rejects an unknown environment name", () => {
    expect(() => parseObservabilityEnv({ appEnv: "prod", dsn: undefined })).toThrow(
      /NEXT_PUBLIC_APP_ENV/,
    );
  });

  it("rejects a DSN that is not a URL", () => {
    expect(() => parseObservabilityEnv({ appEnv: "staging", dsn: "not a url" })).toThrow(
      /NEXT_PUBLIC_SENTRY_DSN/,
    );
  });
});

describe("assertObservabilityEnv (build time)", () => {
  it("throws so a bad value fails the build", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "stage");
    expect(() => assertObservabilityEnv()).toThrow(/NEXT_PUBLIC_APP_ENV/);
  });
});

describe("observabilityEnv (runtime)", () => {
  it("degrades to Sentry off and logs instead of throwing", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "not a url");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(observabilityEnv()).toEqual({ appEnv: "local" });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("NEXT_PUBLIC_SENTRY_DSN"));
  });

  it("returns the parsed values when they are valid", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/1");
    expect(observabilityEnv()).toEqual({
      appEnv: "production",
      dsn: "https://abc@o1.ingest.sentry.io/1",
    });
  });
});
