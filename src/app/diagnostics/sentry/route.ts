import { notFound } from "next/navigation";

import { isSentryDiagnosticEnabled, throwSentryDiagnostic } from "@/core/observability/diagnostic";
import { observabilityEnv } from "@/core/observability/env";

// Evaluated per request, never at build time: a static evaluation would throw during
// `next build` on staging and bake a 404 everywhere else.
export const dynamic = "force-dynamic";

/**
 * Staging-only diagnostic (README → "Confirming the Sentry pipeline"). Throws a deliberate
 * error carrying fake money and contact details, so the Sentry event proves that the SDK runs
 * on the Worker, that `onRequestError` reports, that source maps resolve, and that the scrubber
 * removed every one of those values. 404 everywhere else.
 */
export function GET(): never {
  if (!isSentryDiagnosticEnabled(observabilityEnv().appEnv)) notFound();
  throwSentryDiagnostic();
}
