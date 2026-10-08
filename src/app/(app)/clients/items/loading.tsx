import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The cross-client item list (7.3) traced: the title bar, the three filters (one column on a
 * phone, a row from `sm` up), a group heading (the Owner's list is grouped by Admin) and item rows
 * (the title, the project · client line, the state and date line, the chevron).
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading Client items" data-slot="loading-items">
      <PageHeader title="Client items" back={{ href: "/clients", label: "Clients" }} />
      <div aria-hidden className="flex max-w-3xl flex-col gap-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:flex">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-11 w-full rounded-lg md:h-8 md:w-44" />
          ))}
        </div>
        <Skeleton className="h-3 w-24" />
        <ul className="border-border divide-border bg-card divide-y rounded-lg border">
          {[0, 1, 2, 3, 4].map((row) => (
            <li key={row} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              <span className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </span>
              <Skeleton className="size-4 shrink-0 rounded-sm" />
            </li>
          ))}
        </ul>
      </div>
      <span className="sr-only">Loading Client items</span>
    </div>
  );
}
