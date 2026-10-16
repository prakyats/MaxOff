import { cn } from "@/core/lib/utils";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { DELIVERABLE_COLUMNS, STRIP_GRID } from "@/modules/client-work";

import { PROJECT_ORIGINS } from "./back";

/**
 * A project's page (7.3) traced: the title bar with its back control (to the client's Projects;
 * the client's name is not read yet, so its label is a bar), the Activity button and ⋯ (both
 * 44 px), the description line (client · repeat, desktop), the state line, the cycle pager (two
 * arrows around the cycle's name), the progress card (the ring, its line and pace; 6b.11), the
 * Deliverables heading with Select and Add deliverable, the open deliverables in the list's
 * columns (E+: the title, a progress strip, Next, the date and Mark done on a laptop; a card with
 * its planned and Next lines and the strip under them on a phone) and the collapsed "Done and
 * closed" group. No activity on
 * the page itself since the owner's preview feedback (2026-10-09): it is the header's panel.
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
        back={{
          href: "/clients",
          label: "the client",
          labelWidth: "w-24",
          // The client's own screens are where a project is opened from, too.
          from: [...PROJECT_ORIGINS, { path: "/clients/*", label: "the client" }],
        }}
        // Two header buttons (Activity and ⋯) beside the bell: at very large text (200%) the bell
        // wraps to a second row rather than pushing the bar past the screen's edge.
        className="flex-wrap"
        menu={
          <>
            <Skeleton aria-hidden className="size-11 rounded-lg" />
            <Skeleton aria-hidden className="size-11 rounded-lg md:size-8" />
          </>
        }
      />
      <div aria-hidden className="flex max-w-5xl min-w-0 flex-col gap-4">
        <div className="flex max-w-3xl min-w-0 flex-col gap-2">
          <div className="flex h-5 items-center gap-2">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          <div className="border-border bg-card flex min-h-11 items-center gap-1 rounded-lg border px-1">
            <Skeleton className="m-2.5 size-6 rounded-md" />
            <span className="flex flex-1 flex-col items-center py-1">
              <Skeleton className="h-4 w-28" />
            </span>
            <Skeleton className="m-2.5 size-6 rounded-md" />
          </div>
          {/* The cycle's progress: the ring with its figure, the line and the pace (6b.11 (5)). */}
          <div className="border-border bg-card flex items-center gap-4 rounded-lg border px-3 py-3 sm:px-4">
            <span className="flex size-20 shrink-0 items-center justify-center sm:size-22">
              <span className="border-muted size-full rounded-full border-[0.5rem] motion-safe:animate-pulse" />
            </span>
            <span className="flex flex-1 flex-col gap-1">
              <span className="flex h-5 items-center">
                <Skeleton className="h-3.5 w-56 max-w-full" />
              </span>
              <span className="flex h-5 items-center">
                <Skeleton className="h-3 w-16" />
              </span>
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex min-h-11 items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-11 w-40 rounded-lg md:h-8" />
          </div>
          {/* The open deliverables in the list's columns (E+): on a laptop the title, one
              progress strip, the Next line, the planned date and Mark done; on a phone a card:
              the title over its planned and Next lines, Mark done beside it, the strip under
              them (a 44 px line). No select column: it shows only in Select mode. */}
          <ul
            className={cn(
              "border-border divide-border bg-card divide-y rounded-lg border",
              DELIVERABLE_COLUMNS,
            )}
          >
            {[0, 1, 2, 3, 4].map((row) => (
              <li
                key={row}
                className="flex flex-wrap items-start gap-x-3 px-3 py-2 sm:px-4 lg:col-span-full lg:grid lg:grid-cols-subgrid lg:gap-y-1"
              >
                <span className="flex min-h-11 min-w-0 flex-[1_1_8rem] flex-col justify-center gap-0.5 py-0.5 lg:min-h-7 lg:py-1">
                  <span className="flex h-5 items-center">
                    <Skeleton className="h-3.5 w-1/2" />
                  </span>
                  <span className="flex h-4 items-center lg:hidden">
                    <Skeleton className="h-3 w-24" />
                  </span>
                  <span className="flex h-4 items-center lg:hidden">
                    <Skeleton className="h-3 w-20" />
                  </span>
                </span>
                {/* One strip: chevron, label, bar, count, in the row's strip columns. */}
                <span className="order-last flex min-w-0 basis-full flex-col lg:order-none">
                  <span className={cn(STRIP_GRID, "min-h-11 lg:min-h-7")}>
                    <Skeleton className="size-4 rounded-sm" />
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-1.5 w-full rounded-full" />
                    <Skeleton className="ml-auto h-3 w-6" />
                  </span>
                </span>
                <span className="hidden min-h-7 items-center lg:flex">
                  <Skeleton className="h-3 w-20" />
                </span>
                <span className="hidden min-h-7 items-center lg:flex">
                  <Skeleton className="h-3 w-16" />
                </span>
                <span className="ml-auto flex min-h-11 shrink-0 items-center justify-end lg:ml-0 lg:min-h-7">
                  <Skeleton className="h-11 w-24 shrink-0 rounded-lg md:h-7" />
                </span>
              </li>
            ))}
          </ul>
          {/* The collapsed "Done and closed (N)" group. */}
          <span className="flex min-h-11 items-center gap-2 px-1">
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-4 w-36" />
          </span>
        </div>
      </div>
      <span className="sr-only">Loading the project</span>
    </div>
  );
}
