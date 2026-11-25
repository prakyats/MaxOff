import { PageLoading } from "@/core/ui/composites/loading-state";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SETTINGS_HEADERS } from "../headers";

/**
 * Traces `page.tsx` in its usual state (connected): the bordered card with the state heading,
 * the account line and the one-line explanation; the Space row, its bar and the checked line;
 * then the two buttons (side by side from `sm`, stacked full width on a phone).
 */
export default function Loading() {
  return (
    <PageLoading
      title="Google Drive"
      {...SETTINGS_HEADERS.drive}
      shape="detail"
      back={{ href: "/settings", label: "Settings" }}
    >
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Google Drive"
        data-slot="loading-state"
        className="flex max-w-md flex-col gap-6"
      >
        <div
          aria-hidden
          data-slot="loading-drive"
          className="border-border flex flex-col gap-4 rounded-lg border p-4"
        >
          <div className="flex flex-col gap-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-36" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-11 w-full rounded-lg sm:w-44" />
            <Skeleton className="h-11 w-full rounded-lg sm:w-28" />
          </div>
        </div>
        <span className="sr-only">Loading Google Drive</span>
      </div>
    </PageLoading>
  );
}
