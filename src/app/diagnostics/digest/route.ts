import { notFound } from "next/navigation";

import { resolveAppOrigin } from "@/core/lib/app-url";
import { digestSamplePage } from "@/core/notifications/digest-content";
import {
  digestDiagnosticEnv,
  isDigestDiagnosticEnabled,
} from "@/core/notifications/digest-diagnostic";
import { readWeeklyDigestPreview } from "@/core/notifications/digest-preview";
import { renderWeeklyDigestEmail } from "@/core/notifications/weekly-digest-content";
import { observabilityEnv } from "@/core/observability/env";

// Evaluated per request, never at build time (see /diagnostics/sentry).
export const dynamic = "force-dynamic";

/**
 * The Owner's weekly summary as it would be sent now (5B slice 7, owner decision 2026-10-03; the
 * weekly digest since 6.5, Kickoff 6 decision 23): built from live data by
 * `owner_digest_weekly_preview()`, which reads only, and rendered by the dispatcher's own renderer,
 * with the subject and text part above it. Local and staging builds only (production 404s,
 * decided at runtime: `isDigestDiagnosticEnabled`); the Owner only (anyone else, signed out
 * included, 404s: the database refuses them). Nothing is written or sent.
 */
export async function GET(request: Request): Promise<Response> {
  const appEnv = observabilityEnv().appEnv;
  if (!isDigestDiagnosticEnabled(digestDiagnosticEnv(appEnv))) notFound();
  const payload = await readWeeklyDigestPreview();
  if (!payload) notFound();
  const url = new URL(request.url);
  const origin = resolveAppOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    url.host,
    url.protocol.replace(":", ""),
    appEnv,
  );
  return new Response(digestSamplePage(renderWeeklyDigestEmail(payload, origin)), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
