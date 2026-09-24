import { LoadingState } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { PersonTabsSkeleton } from "../person-nav";

/**
 * A person's month (2.4): their name, the two tabs, the month switcher row, then cards on a
 * phone and the table from `md` up, as on the member's own /leave/attendance.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title={<Skeleton className="h-5 w-40" />}
        back={{ href: "/people", label: "People" }}
      />
      <PersonTabsSkeleton />
      <div
        data-slot="loading-leave-pager"
        aria-hidden
        className="mb-3 flex min-h-11 items-center justify-between gap-2"
      >
        <Skeleton className="size-11 rounded-md md:size-8" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-11 rounded-md md:size-8" />
      </div>
      <LoadingState
        shape="cards"
        count={5}
        label="Loading their attendance"
        className="md:hidden"
      />
      <LoadingState
        shape="table"
        columns={["w-1/6", "w-1/4", "w-1/6", "w-1/4"]}
        label="Loading their attendance"
        className="hidden md:block"
      />
    </>
  );
}
