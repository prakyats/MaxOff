import { measureDay } from "./measure";

// Evaluated per request, never at build time (see /diagnostics/sentry).
export const dynamic = "force-dynamic";

/**
 * The own-day screens' read times on the Worker, as JSON (`measure.ts`). Its `first_reads` counts
 * read 0 by construction (a route handler has no `cache()` scope); the page
 * `/diagnostics/day-timing-render` shows the true ones.
 */
export async function GET(): Promise<Response> {
  return Response.json(await measureDay(), {
    headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
}
