import { cn } from "@/core/lib/utils";
import { PageHeader } from "@/core/ui/composites/page-header";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SETTINGS_HEADERS } from "../headers";

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1): the header with "Add template" (the FAB on a phone),
 * then one bordered list of templates, each a 56px row with the name over its line (type,
 * priority, stages, author) and the ⋯ on a phone, Edit and Archive from `md` up.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Templates"
        {...SETTINGS_HEADERS.templates}
        back={{ href: "/settings", label: "Settings" }}
        actions={<Skeleton aria-hidden data-slot="loading-fab" className="w-36" />}
      />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Templates"
        data-slot="loading-templates"
        className="flex max-w-2xl flex-col gap-6"
      >
        <ul aria-hidden className="border-border divide-border divide-y rounded-lg border">
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
            >
              <div className={cn("flex min-w-0 flex-col gap-1.5", CARD_ROW_TITLE)}>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <div className={cn("flex items-center gap-1", CARD_ROW_TRAILING)}>
                <Skeleton className="size-9 rounded-lg md:hidden" />
                <Skeleton className="hidden size-9 rounded-lg md:block" />
                <Skeleton className="hidden size-9 rounded-lg md:block" />
              </div>
            </li>
          ))}
        </ul>
        <span className="sr-only">Loading Templates</span>
      </div>
    </>
  );
}
