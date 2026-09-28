import { PageHeader } from "@/core/ui/composites/page-header";
import { LoadingState } from "@/core/ui/composites/loading-state";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The team's month (3b.4): the header with its back, the month switcher row, then one card row
 * per person (name over the days line, the unpaid figure and the chevron on the right).
 */
export default function Loading() {
  return (
    <>
      <PageHeader back={{ href: "/reports", label: "Reports" }} title="Month" />
      <div
        data-slot="loading-leave-pager"
        aria-hidden
        className="mb-3 flex min-h-11 items-center justify-between gap-2"
      >
        <Skeleton className="size-11 rounded-md md:size-8" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-11 rounded-md md:size-8" />
      </div>
      <div className="md:max-w-3xl">
        <LoadingState shape="cards" count={5} label="Loading the team's month" />
      </div>
    </>
  );
}
