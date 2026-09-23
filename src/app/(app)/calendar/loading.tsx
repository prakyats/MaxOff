import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The calendar (6.4) is a week strip of days above a column of blocks, which is neither a list
 * nor a grid of tiles — so it draws its own shape rather than borrowing one that would jump.
 */
export default function Loading() {
  return (
    <>
      <PageHeader title="Calendar" />
      <div role="status" aria-busy="true" className="flex flex-col gap-4">
        <div data-slot="loading-day-strip" className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <Skeleton className="h-2.5 w-6" />
              <Skeleton className="size-9 rounded-full" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {[
            ["h-14", "w-full"],
            ["h-10", "w-3/4"],
            ["h-12", "w-5/6"],
          ].map(([h, w], i) => (
            <Skeleton key={i} className={`${h} ${w} rounded-lg`} />
          ))}
        </div>
        <span className="sr-only">Loading Calendar</span>
      </div>
    </>
  );
}
