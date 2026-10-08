import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * A client's Projects (7.3) under the painted header and tabs, traced: the "Projects" heading with
 * the New project button, then project rows (the name, the repeat and cycle line, the progress
 * line, the state chip and the chevron).
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the projects"
      data-slot="loading-client-projects"
      className="flex max-w-2xl flex-col gap-4"
    >
      <div aria-hidden className="flex min-h-11 items-center justify-between">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-11 w-36 rounded-lg md:h-8" />
      </div>
      <ul aria-hidden className="border-border divide-border bg-card divide-y rounded-lg border">
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex min-h-16 items-center gap-3 px-4 py-3">
            <span className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/5" />
            </span>
            <Skeleton className="h-4 w-16 shrink-0 rounded-sm" />
            <Skeleton className="size-4 shrink-0 rounded-sm" />
          </li>
        ))}
      </ul>
      <span className="sr-only">Loading the projects</span>
    </div>
  );
}
