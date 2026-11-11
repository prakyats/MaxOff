import type { Metadata } from "next";

import { measureDay } from "../day-timing/measure";

// Evaluated per request, never at build time (see /diagnostics/sentry).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Day timing", robots: { index: false } };

/**
 * `/diagnostics/day-timing` measured inside a Server Component render, where React's `cache()`
 * keeps one first-reads registry per request as it does on every real page: its `first_reads`
 * counts (holds, waits, the valve) are the ones a real page sees (v2.0 X2, the advisor's ask on
 * #89 to confirm the holds fire). The Owner's only (anyone else 404s), numbers only, nothing
 * written.
 */
export default async function DayTimingRender() {
  const body = await measureDay();
  return <pre data-slot="day-timing">{JSON.stringify(body, null, 2)}</pre>;
}
