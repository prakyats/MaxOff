import { cn } from "@/core/lib/utils";
import { PageHeader } from "@/core/ui/composites/page-header";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SETTINGS_HEADERS } from "../headers";

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1): the header with "Add template" (the FAB on a phone),
 * the Task templates heading and its bordered list of templates (below), then the Project
 * templates group (7.4: its heading and Add button, two rows); each a 56px row with the name over its line (type,
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
        className="flex max-w-2xl flex-col gap-8"
      >
        {/* Task templates (4.6), as the page's section: the heading, then the list. */}
        <div className="flex flex-col gap-3">
          <div aria-hidden className="flex min-h-11 items-center">
            <Skeleton className="h-4 w-28" />
          </div>
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
        </div>
        {/* Project templates (7.4): the heading with its Add button, then rows. */}
        <div className="flex flex-col gap-3">
          <div aria-hidden className="flex min-h-11 items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-11 w-20 rounded-lg md:h-8" />
          </div>
          <ul aria-hidden className="border-border divide-border divide-y rounded-lg border">
            {[0, 1].map((row) => (
              <li
                key={row}
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                <div className={cn("flex min-w-0 flex-col gap-1.5", CARD_ROW_TITLE)}>
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56 max-w-full" />
                </div>
                <div className={cn("flex items-center gap-1", CARD_ROW_TRAILING)}>
                  <Skeleton className="size-11 rounded-lg md:size-8" />
                  <Skeleton className="size-11 rounded-lg md:size-8" />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <span className="sr-only">Loading Templates</span>
      </div>
    </>
  );
}
