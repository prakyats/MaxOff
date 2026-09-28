import { LoadingState } from "@/core/ui/composites/loading-state";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The Extra work view under the layout's header and tabs (which stay painted): the comp leave
 * card (title, balance line, a couple of credit rows), the "Extra work N · Add note" row, then
 * the note cards.
 */
export default function Loading() {
  return (
    <>
      <div
        data-slot="loading-comp-leave-card"
        aria-hidden
        className="border-border bg-card mb-4 rounded-xl border"
      >
        <div className="flex items-center justify-between gap-3 px-6 py-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3.5 w-52" />
          </div>
        </div>
        <ul className="divide-border divide-y border-t">
          {[0, 1].map((i) => (
            <li key={i} className="flex min-h-14 items-center gap-3 px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/3" />
              </span>
              <Skeleton className="h-3 w-16" />
            </li>
          ))}
        </ul>
      </div>
      <div aria-hidden className="mb-3 flex min-h-11 items-center justify-between gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-11 w-24 rounded-md" />
      </div>
      <LoadingState shape="cards" count={3} label="Loading your extra work" />
    </>
  );
}
