import type { Metadata } from "next";

import { measureMe } from "./measure";

// Evaluated per request, never at build time (see /diagnostics/sentry).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Me timing", robots: { index: false } };

/** `measureMe()` as a page inside the `(app)` layout (v2.0 X4): milliseconds and counts only. */
export default async function MeTiming() {
  const body = await measureMe();
  return <pre data-slot="me-timing">{JSON.stringify(body, null, 2)}</pre>;
}
