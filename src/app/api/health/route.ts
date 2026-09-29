import { databaseReachable } from "@/core/db/health";

/**
 * `GET /api/health` (3c.1): what UptimeRobot polls on production. One cheap database round trip
 * through `core/db/health`, then `200 ok` or `503 unavailable`, plain text, never cached, no
 * data. Public in the proxy like every `/api/*` route; it reads nothing a visitor could use.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };

export async function GET(): Promise<Response> {
  const ok = await databaseReachable();
  return new Response(ok ? "ok" : "unavailable", { status: ok ? 200 : 503, headers: HEADERS });
}
