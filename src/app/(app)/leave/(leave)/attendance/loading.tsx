import { LoadingState } from "@/core/ui/composites/loading-state";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The month's days under the layout's header and tabs: the month switcher row, then cards on a
 * phone and the table from `md` up.
 */
export default function Loading() {
  return (
    <>
      <div
        data-slot="loading-leave-pager"
        aria-hidden
        className="mb-3 flex min-h-11 items-center justify-between gap-2"
      >
        <Skeleton className="size-11 rounded-md md:size-8" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-11 rounded-md md:size-8" />
      </div>
      <LoadingState shape="cards" count={5} label="Loading your attendance" className="md:hidden" />
      <LoadingState
        shape="table"
        columns={["w-1/6", "w-1/4", "w-1/6", "w-1/4"]}
        label="Loading your attendance"
        className="hidden md:block"
      />
    </>
  );
}
