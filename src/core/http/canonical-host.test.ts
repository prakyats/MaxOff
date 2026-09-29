import { describe, expect, it } from "vitest";

import { canonicalRedirectUrl } from "./canonical-host";

const CANONICAL = "app.maxoff.in";

describe("canonicalRedirectUrl (3c.1)", () => {
  it("sends the workers.dev address to the canonical host, path and query kept", () => {
    expect(
      canonicalRedirectUrl("https://maxoff.pixoraclips.workers.dev/leave?month=2026-10", CANONICAL),
    ).toBe("https://app.maxoff.in/leave?month=2026-10");
    expect(canonicalRedirectUrl("https://maxoff.pixoraclips.workers.dev/", CANONICAL)).toBe(
      "https://app.maxoff.in/",
    );
    expect(canonicalRedirectUrl("http://Maxoff.Pixoraclips.Workers.Dev/x", "App.Maxoff.In")).toBe(
      "https://app.maxoff.in/x",
    );
  });

  it("leaves the canonical host alone", () => {
    expect(canonicalRedirectUrl("https://app.maxoff.in/today", CANONICAL)).toBeNull();
  });

  it("never redirects a host that is not workers.dev (the cron's self-call, a custom domain)", () => {
    expect(
      canonicalRedirectUrl("https://maxoff.internal/api/cron/storage-cleanup", CANONICAL),
    ).toBeNull();
    expect(canonicalRedirectUrl("https://other.example/today", CANONICAL)).toBeNull();
  });

  it("does nothing without a canonical host (staging, previews, local)", () => {
    for (const value of [undefined, "", "   "]) {
      expect(
        canonicalRedirectUrl("https://maxoff-staging.pixoraclips.workers.dev/", value),
      ).toBeNull();
    }
  });

  it("does nothing for an unparsable URL", () => {
    expect(canonicalRedirectUrl("not a url", CANONICAL)).toBeNull();
  });
});
