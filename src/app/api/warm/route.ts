import { cookies } from "next/headers";

import { warmSessionVerification } from "@/core/auth/warm";

/**
 * `GET`/`HEAD /api/warm` (P2, 2026-10-15; ARCHITECTURE §19 "Warm the Worker early"): what the
 * app asks when it comes back into view (`core/ui/pwa/warm-up.ts`, at most once per 30 s), so
 * the first real tap lands on a warm isolate over an open connection. It starts the server's
 * route code and verifies the session's token without a refresh, so this bundle's JWKS is
 * cached too (`core/auth/warm.ts`). It touches no database, reads and returns no data and sets
 * no cookie: `204`, no body, never cached. Public in the proxy like every `/api/*` route, which
 * lets it straight through (`core/auth/session.ts`).
 */
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "no-store" };

async function warm(): Promise<Response> {
  await warmSessionVerification((await cookies()).getAll());
  return new Response(null, { status: 204, headers: HEADERS });
}

export const GET = warm;
export const HEAD = warm;
