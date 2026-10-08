import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The carry screen (7.4) traced: the title bar, then a cycle group: the project · cycle heading
 * and the client line, its rows (the select box, the title over its date line, Close…) and the
 * group's two buttons.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading Unfinished items"
      data-slot="loading-decide"
    >
      <PageHeader title="Unfinished items" back={{ href: "/today", label: "Today" }} />
      <div aria-hidden className="flex max-w-3xl flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-24" />
        <ul className="border-border divide-border bg-card divide-y rounded-lg border">
          {[0, 1, 2].map((row) => (
            <li key={row} className="flex min-h-15 items-center gap-3 px-3 py-2 sm:px-4">
              <Skeleton className="size-4 shrink-0 rounded-[4px]" />
              <span className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </span>
              <Skeleton className="h-11 w-16 shrink-0 rounded-lg md:h-7" />
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Skeleton className="h-11 w-36 rounded-lg md:h-8" />
          <Skeleton className="h-11 w-36 rounded-lg md:h-8" />
        </div>
      </div>
      <span className="sr-only">Loading Unfinished items</span>
    </div>
  );
}
