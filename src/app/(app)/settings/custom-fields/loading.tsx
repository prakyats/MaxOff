import { cn } from "@/core/lib/utils";
import { PageLoading } from "@/core/ui/composites/loading-state";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1): the entity tabs (a 4-column pill bar, the Owner's
 * shape; an Admin's two-column bar is narrower but sits in the same band), then one scope group:
 * its heading row (a title and the small Add on the right) and three 56px rows, each a label
 * line over a meta line (type badge, key), with the actions on the right.
 */
export default function Loading() {
  return (
    <PageLoading title="Custom fields" shape="list" back={{ href: "/settings", label: "Settings" }}>
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Custom fields"
        data-slot="loading-state"
        className="flex flex-col gap-6"
      >
        <div
          aria-hidden
          className="bg-muted mb-[-0.5rem] grid grid-cols-4 gap-1 rounded-lg p-1 md:inline-grid md:w-[32rem]"
        >
          {[0, 1, 2, 3].map((tab) => (
            <Skeleton key={tab} className="h-11 rounded-md" />
          ))}
        </div>
        <div aria-hidden className="flex max-w-2xl flex-col gap-2">
          <div className="flex min-h-9 items-center justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-16 rounded-lg" />
          </div>
          <ul className="border-border divide-border divide-y rounded-lg border">
            {[0, 1, 2].map((row) => (
              <li
                key={row}
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                {/* The row's own metrics: at 200% the title column shrinks and the action wraps under it. */}
                <div className={cn("flex min-w-0 flex-col gap-1.5", CARD_ROW_TITLE)}>
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3.5 w-28" />
                </div>
                <Skeleton className={cn("size-9 rounded-lg", CARD_ROW_TRAILING)} />
              </li>
            ))}
          </ul>
        </div>
        <span className="sr-only">Loading Custom fields</span>
      </div>
    </PageLoading>
  );
}
