import { describe, expect, it, vi } from "vitest";

import { APP_ENVS } from "./env";
import {
  SENTRY_DIAGNOSTIC_MESSAGE,
  SENTRY_DIAGNOSTIC_PAYLOAD,
  isSentryDiagnosticEnabled,
  throwSentryDiagnostic,
} from "./diagnostic";
import { SCRUBBED, scrubEvent, scrubString, scrubValue } from "./scrub";

vi.mock("@sentry/nextjs", () => ({
  setContext: vi.fn(),
  setExtra: vi.fn(),
  setTag: vi.fn(),
}));

describe("isSentryDiagnosticEnabled", () => {
  it("is on for staging only", () => {
    expect(isSentryDiagnosticEnabled("staging")).toBe(true);
  });

  it("is off in production, locally and for anything unexpected", () => {
    expect(isSentryDiagnosticEnabled("production")).toBe(false);
    expect(isSentryDiagnosticEnabled("local")).toBe(false);
    expect(isSentryDiagnosticEnabled(undefined)).toBe(false);
    expect(isSentryDiagnosticEnabled("")).toBe(false);
    expect(isSentryDiagnosticEnabled("Staging")).toBe(false);
    expect(isSentryDiagnosticEnabled(" staging")).toBe(false);
  });

  it("covers every known environment exactly once", () => {
    expect(APP_ENVS.filter(isSentryDiagnosticEnabled)).toEqual(["staging"]);
  });
});

describe("throwSentryDiagnostic", () => {
  it("throws the diagnostic message", () => {
    expect(() => throwSentryDiagnostic()).toThrow(SENTRY_DIAGNOSTIC_MESSAGE);
  });

  it("uses a payload the scrubber removes completely", () => {
    const { amount, email, phone } = SENTRY_DIAGNOSTIC_PAYLOAD;
    const scrubbedMessage = scrubString(SENTRY_DIAGNOSTIC_MESSAGE);
    for (const value of [amount, email, phone]) {
      expect(scrubbedMessage).not.toContain(value);
    }
    expect(scrubbedMessage).toContain(SCRUBBED);

    expect(scrubValue({ diagnostic: { ...SENTRY_DIAGNOSTIC_PAYLOAD } })).toEqual({
      diagnostic: {
        amount: SCRUBBED,
        email: SCRUBBED,
        phone: SCRUBBED,
        billing: SCRUBBED,
      },
    });

    const event = scrubEvent({
      type: undefined,
      message: SENTRY_DIAGNOSTIC_MESSAGE,
      tags: { diagnostic_contact: email },
      extra: { diagnostic_note: SENTRY_DIAGNOSTIC_MESSAGE },
      contexts: { diagnostic: { ...SENTRY_DIAGNOSTIC_PAYLOAD } },
      exception: { values: [{ type: "Error", value: SENTRY_DIAGNOSTIC_MESSAGE }] },
    });
    for (const value of [amount, email, phone, "12000"]) {
      expect(JSON.stringify(event)).not.toContain(value);
    }
  });
});
