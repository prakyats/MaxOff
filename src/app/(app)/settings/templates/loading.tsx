import { cn } from "@/core/lib/utils";
import { ListHeadingSkeleton, ListRowsSkeleton } from "@/core/ui/composites/list-rows-skeleton";
import { PageHeader } from "@/core/ui/composites/page-header";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SETTINGS_HEADERS } from "../headers";

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1): the Task templates heading with "Add task template"
 * (C4) and its bordered list of templates, then the client-work part (6b Release 2): the 44px
 * search box, the Project templates group (7.4: its heading and "Add project template", two rows
 * with Preview, Edit and Archive) and the Deliverable templates group (the same shape); each a
 * 56px row with the name over its line.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Templates"
        {...SETTINGS_HEADERS.templates}
        back={{ href: "/settings", label: "Settings" }}
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
          <ListHeadingSkeleton titleWidth="w-28" addWidth="w-44" />
          <ListRowsSkeleton rows={3} icons={2} subtitle />
        </div>
        {/* The client-work part (6b Release 2): the search, then the two groups. */}
        <div className="flex flex-col gap-8">
          <Skeleton aria-hidden className="h-11 w-full rounded-lg md:h-8" />
          {["w-32", "w-40"].map((heading) => (
            <div key={heading} className="flex flex-col gap-3">
              <div aria-hidden className="flex min-h-11 items-center justify-between">
                <Skeleton className={cn("h-4", heading)} />
                <Skeleton className="h-11 w-52 rounded-lg md:h-8" />
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
                      <Skeleton className="size-11 rounded-lg md:size-8" />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <span className="sr-only">Loading Templates</span>
      </div>
    </>
  );
}
