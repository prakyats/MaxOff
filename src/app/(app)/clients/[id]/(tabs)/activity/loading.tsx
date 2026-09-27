import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * A client's Activity (3.4) under the painted header and tabs: rows of one sentence over a
 * date line, as the history draws them.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the history"
      data-slot="loading-client-activity"
      className="flex max-w-2xl flex-col gap-2"
    >
      <ul aria-hidden className="border-border divide-border bg-card divide-y rounded-lg border">
        {[0, 1, 2, 3, 4].map((row) => (
          <li key={row} className="flex flex-col gap-1.5 px-4 py-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-28" />
          </li>
        ))}
      </ul>
      <span className="sr-only">Loading the history</span>
    </div>
  );
}
