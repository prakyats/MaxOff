import { LoadingState, PageLoading } from "@/core/ui/composites/loading-state";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * Attendance & leave: the two tab links, the pager row, then the list — cards on a phone, the
 * table from `md` up — so nothing moves when the requests (or the month's days) arrive. Both
 * tabs have this same shape, so one tracing serves either.
 */
export default function Loading() {
  return (
    <PageLoading title="Attendance & leave" shape="cards">
      <div
        data-slot="loading-leave-tabs"
        aria-hidden
        className="bg-muted mb-4 grid grid-cols-2 gap-1 rounded-lg p-1 md:inline-grid md:w-80"
      >
        <Skeleton className="bg-background h-11 rounded-md" />
        <div className="h-11" />
      </div>
      <div aria-hidden className="mb-3 flex min-h-11 items-center justify-between gap-2">
        <Skeleton className="size-11 rounded-md md:size-8" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-11 rounded-md md:size-8" />
      </div>
      <LoadingState shape="cards" count={5} label="Loading your leave" className="md:hidden" />
      <LoadingState
        shape="table"
        columns={["w-1/4", "w-1/4", "w-1/6", "w-1/6"]}
        label="Loading your leave"
        className="hidden md:block"
      />
    </PageLoading>
  );
}
