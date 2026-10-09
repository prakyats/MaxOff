"use client";

import dynamic from "next/dynamic";
import { type ComponentProps, Suspense } from "react";

/**
 * The Admin's Client work rows on Today (7.3, kickoff 7 decision 19) **in their own chunk**:
 * Today's first-load JavaScript never grows (owner note 2, ARCHITECTURE §19: `/today` stays at its
 * 670 KB budget). They still render on the server, so the rows are in the first paint and nothing
 * moves; their own Suspense boundary keeps the chunk to their own hydration (as
 * `approvals-preview.tsx`).
 */
const ClientWorkChunk = dynamic(() =>
  import("@/modules/client-work/components/today-client-work").then(
    (module) => module.TodayClientWork,
  ),
);

export function TodayClientWorkLazy(props: ComponentProps<typeof ClientWorkChunk>) {
  return (
    <Suspense>
      <ClientWorkChunk {...props} />
    </Suspense>
  );
}
