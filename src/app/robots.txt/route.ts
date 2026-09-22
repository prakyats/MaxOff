import { notFound } from "next/navigation";

import { ROBOTS_DISALLOW_ALL, isNoindexEnvironment } from "@/core/http/response-headers";
import { observabilityEnv } from "@/core/observability/env";

// Evaluated per request, never at build time (see /diagnostics/sentry).
export const dynamic = "force-dynamic";

/**
 * Staging is never indexed: `Disallow: /` here plus `X-Robots-Tag` on every response
 * (`core/http/response-headers`). Production and local builds have no robots.txt yet, so
 * production stays indexable-by-choice until that is decided.
 */
export function GET(): Response {
  if (!isNoindexEnvironment(observabilityEnv().appEnv)) notFound();
  return new Response(ROBOTS_DISALLOW_ALL, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
