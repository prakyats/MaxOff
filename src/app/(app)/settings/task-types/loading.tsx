import { cn } from "@/core/lib/utils";
import { PageLoading } from "@/core/ui/composites/loading-state";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1): one bordered list of the seven launch types, each a
 * 56px row with the name over its kind line on the left and, on the right, the two order buttons
 * (and the ⋯ on a phone, Edit and Archive from `md` up).
 */
export default function Loading() {
  return (
    <PageLoading title="Task types" shape="list" back={{ href: "/settings", label: "Settings" }}>
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Task types"
        data-slot="loading-task-types"
        className="flex max-w-2xl flex-col gap-6"
      >
        <ul aria-hidden className="border-border divide-border divide-y rounded-lg border">
          {[0, 1, 2, 3, 4, 5, 6].map((row) => (
            <li
              key={row}
              className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
            >
              <div className={cn("flex min-w-0 flex-col gap-1.5", CARD_ROW_TITLE)}>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-44 max-w-full" />
              </div>
              <div className={cn("flex items-center gap-1", CARD_ROW_TRAILING)}>
                <Skeleton className="size-9 rounded-lg" />
                <Skeleton className="size-9 rounded-lg" />
                <Skeleton className="size-9 rounded-lg" />
                <Skeleton className="hidden size-9 rounded-lg md:block" />
              </div>
            </li>
          ))}
        </ul>
        <span className="sr-only">Loading Task types</span>
      </div>
    </PageLoading>
  );
}
