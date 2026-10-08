import { cn } from "@/core/lib/utils";
import { PageHeader } from "@/core/ui/composites/page-header";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SETTINGS_HEADERS } from "../headers";

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1): the header with "Add preset" (the FAB on a phone), then
 * one bordered list of presets, each a 56px row with the name over its stages line and the Edit
 * and Archive buttons.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Stage presets"
        {...SETTINGS_HEADERS.stagePresets}
        back={{ href: "/settings", label: "Settings" }}
        actions={<Skeleton aria-hidden data-slot="loading-fab" className="w-32" />}
      />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Stage presets"
        data-slot="loading-stage-presets"
        className="flex max-w-2xl flex-col gap-6"
      >
        <ul aria-hidden className="border-border divide-border divide-y rounded-lg border">
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
            >
              <div className={cn("flex min-w-0 flex-col gap-1.5", CARD_ROW_TITLE)}>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <div className={cn("flex items-center gap-1", CARD_ROW_TRAILING)}>
                <Skeleton className="size-11 rounded-lg md:size-8" />
                <Skeleton className="size-11 rounded-lg md:size-8" />
              </div>
            </li>
          ))}
        </ul>
        <span className="sr-only">Loading Stage presets</span>
      </div>
    </>
  );
}
