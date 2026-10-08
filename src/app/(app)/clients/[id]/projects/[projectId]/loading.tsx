import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * A project's page (7.3) traced: the title bar with its back control (to the client's Projects;
 * the client's name is not read yet, so its label is a bar) and ⋯, the description line (client ·
 * repeat, desktop), the state line, the
 * cycle pager (two arrows around the cycle's name and its progress line), the Items heading with
 * Add item, item rows (the select box, the title over its state and date line, the one action)
 * and the Activity heading with its rows.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the project"
      data-slot="loading-project"
      className="flex min-w-0 flex-col"
    >
      <PageHeader
        title={
          <span className="flex h-6 items-center md:h-8">
            <Skeleton className="h-5 w-48 max-w-full" />
          </span>
        }
        description={
          <span className="bg-muted inline-block h-3.5 w-56 max-w-full rounded-md align-middle motion-safe:animate-pulse" />
        }
        back={{ href: "/clients", label: "the client", labelWidth: "w-24" }}
        menu={<Skeleton aria-hidden className="size-11 rounded-lg md:size-8" />}
      />
      <div aria-hidden className="flex max-w-3xl min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex h-5 items-center gap-2">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          <div className="border-border bg-card flex min-h-11 items-center gap-1 rounded-lg border px-1">
            <Skeleton className="m-2.5 size-6 rounded-md" />
            <span className="flex flex-1 flex-col items-center gap-1.5 py-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </span>
            <Skeleton className="m-2.5 size-6 rounded-md" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex min-h-11 items-center justify-between">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-11 w-28 rounded-lg md:h-8" />
          </div>
          <ul className="border-border divide-border bg-card divide-y rounded-lg border">
            {[0, 1, 2, 3, 4].map((row) => (
              <li key={row} className="flex min-h-15 items-center gap-3 px-3 py-2 sm:px-4">
                {/* The row's 44 px select target around its box (§14.1), as the row draws it. */}
                <span className="-ml-2 flex size-11 shrink-0 items-center justify-center">
                  <Skeleton className="size-4 rounded-[4px]" />
                </span>
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </span>
                <Skeleton className="h-11 w-24 shrink-0 rounded-lg md:h-7" />
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <ul className="border-border divide-border bg-card divide-y rounded-lg border">
            {[0, 1, 2].map((row) => (
              <li key={row} className="flex flex-col gap-1.5 px-4 py-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-28" />
              </li>
            ))}
          </ul>
        </div>
      </div>
      <span className="sr-only">Loading the project</span>
    </div>
  );
}
