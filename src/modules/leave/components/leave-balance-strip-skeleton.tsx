import { Skeleton } from "@/core/ui/primitives/skeleton";

/** The strip's loading state, a tracing of it: two tiles of three lines (label, figure, line). */
export function LeaveBalanceStripSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="loading-leave-balance"
      className="bg-card shadow-raised border-border mb-4 grid grid-cols-2 divide-x overflow-hidden rounded-lg border"
    >
      {["w-32", "w-28"].map((width) => (
        <div key={width} className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
          <span className="flex h-4 items-center">
            <Skeleton className={`h-3 max-w-full ${width}`} />
          </span>
          <span className="flex h-7 items-center">
            <Skeleton className="h-5 w-16" />
          </span>
          <span className="flex h-4 items-center">
            <Skeleton className="h-3 w-24 max-w-full" />
          </span>
        </div>
      ))}
    </div>
  );
}
