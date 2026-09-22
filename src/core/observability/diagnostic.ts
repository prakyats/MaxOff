import * as Sentry from "@sentry/nextjs";

import type { AppEnv } from "./env";

/**
 * `GET /diagnostics/sentry` (ARCHITECTURE §18.2, README → "Confirming the Sentry pipeline"):
 * a deliberate server error that proves the whole pipeline after a deploy: SDK on the Worker,
 * `onRequestError`, source maps, and the scrubber. Staging only. Production and local builds
 * answer 404, and `diagnostic.test.ts` pins that.
 */
export function isSentryDiagnosticEnabled(appEnv: AppEnv | string | undefined): boolean {
  return appEnv === "staging";
}

/**
 * Fake values that must never appear in the Sentry event. Each one matches a scrubber rule:
 * a rupee amount, an email address and an Indian mobile number inside strings, and the keys
 * `amount` / `billing` as financial keys in a context.
 */
export const SENTRY_DIAGNOSTIC_PAYLOAD = {
  amount: "₹12,000",
  email: "diagnostic@example.com",
  phone: "+91 9876543210",
  billing: { total: 12000 },
} as const;

export const SENTRY_DIAGNOSTIC_MESSAGE = `Sentry diagnostic: ${SENTRY_DIAGNOSTIC_PAYLOAD.amount} paid by ${SENTRY_DIAGNOSTIC_PAYLOAD.email}, call ${SENTRY_DIAGNOSTIC_PAYLOAD.phone}`;

/** Attaches the payload to the current scope (context, extra, tag) and throws. Never returns. */
export function throwSentryDiagnostic(): never {
  Sentry.setContext("diagnostic", { ...SENTRY_DIAGNOSTIC_PAYLOAD });
  Sentry.setExtra("diagnostic_note", SENTRY_DIAGNOSTIC_MESSAGE);
  Sentry.setTag("diagnostic_contact", SENTRY_DIAGNOSTIC_PAYLOAD.email);
  throw new Error(SENTRY_DIAGNOSTIC_MESSAGE);
}
