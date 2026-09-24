import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The choice screen's tracing (ARCHITECTURE §14.1): the date, the heading and its line, four
 * option rows of the same height as the real ones (`min-h-14`), the reason box and Submit.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading today's attendance"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-1">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="mb-2 h-4 w-24" />
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            data-slot="loading-row"
            className="border-border bg-card flex min-h-14 items-center gap-3 rounded-lg border px-4 py-3"
          >
            <Skeleton className="size-5 shrink-0 rounded-full" />
            <span className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3.5 w-40" />
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-11 w-full md:w-24" />
      <span className="sr-only">Loading today&apos;s attendance</span>
    </div>
  );
}
