import { PageLoading } from "@/core/ui/composites/loading-state";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * Traces `page.tsx`: the logo card (a 96px logo tile beside a title line and a 44px button,
 * 3.3), then the company form's two labelled fields.
 */
export default function Loading() {
  return (
    <PageLoading title="Company" shape="detail" back={{ href: "/settings", label: "Settings" }}>
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Company"
        data-slot="loading-state"
        className="flex max-w-md flex-col gap-6"
      >
        <div
          aria-hidden
          className="border-border flex items-center gap-4 rounded-lg border p-4"
          data-slot="loading-logo-card"
        >
          <Skeleton className="size-24 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-48 max-w-full" />
            <Skeleton className="mt-1 h-11 w-36 rounded-lg" />
          </div>
        </div>
        <div aria-hidden className="flex flex-col gap-4">
          {[0, 1].map((row) => (
            <div key={row} className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <span className="sr-only">Loading Company</span>
      </div>
    </PageLoading>
  );
}
