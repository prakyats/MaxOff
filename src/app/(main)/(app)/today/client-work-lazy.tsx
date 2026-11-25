"use client";

import dynamic from "next/dynamic";

/**
 * The Admin's Client work rows on Today (7.3, kickoff 7 decision 19) **in their own chunk**:
 * Today's first-load JavaScript never grows (owner note 2, ARCHITECTURE §19: `/today` stays at its
 * 670 KB budget). They render on the server, in their own Suspense boundary placed by
 * `admin-today.tsx` with a fallback tracing the rows (X5, as `approvals-preview.tsx`).
 */
export const TodayClientWorkLazy = dynamic(() =>
  import("@/modules/client-work/components/today-client-work").then(
    (module) => module.TodayClientWork,
  ),
);
