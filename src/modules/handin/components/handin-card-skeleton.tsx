"use client";

import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The Hand-in files card while it loads (ARCHITECTURE §14.1): the card's header row and two file
 * rows at their own height (60 px, the type square, two lines, the status chip on the right).
 */
export function HandinCardSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="handin-card-skeleton"
      className="border-border bg-card flex min-w-0 flex-col rounded-lg border"
    >
      <div className="border-border flex min-h-11 items-center gap-2 border-b px-3 py-2">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-5 w-36 rounded-full" />
      </div>
      <div className="flex flex-col px-3 py-1">
        {[0, 1].map((row) => (
          <div key={row} className="flex min-h-[60px] items-center gap-3 py-2">
            <Skeleton className="size-9 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
