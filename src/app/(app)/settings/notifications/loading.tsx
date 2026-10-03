import { ReachabilityListSkeleton } from "@/core/notifications/components/reachability-list";
import { PageLoading } from "@/core/ui/composites/loading-state";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SETTINGS_HEADERS } from "../headers";

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1): the "Can't be reached" heading, then its cards (the
 * name over the reason, 64px each). The Owner's server warning and "Everyone" list come after it,
 * so nothing above the first card depends on the role.
 */
export default function Loading() {
  return (
    <PageLoading
      title="Notifications"
      {...SETTINGS_HEADERS.notifications}
      shape="cards"
      back={{ href: "/settings", label: "Settings" }}
    >
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Notifications"
        data-slot="loading-reachability"
        className="flex max-w-2xl flex-col gap-6"
      >
        <div className="flex flex-col gap-3">
          <span className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-28" />
          </span>
          <ReachabilityListSkeleton rows={4} />
        </div>
        <span className="sr-only">Loading Notifications</span>
      </div>
    </PageLoading>
  );
}
