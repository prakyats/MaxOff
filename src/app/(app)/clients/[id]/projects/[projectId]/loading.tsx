import { cn } from "@/core/lib/utils";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { DELIVERABLE_COLUMNS } from "@/modules/client-work";

import { PROJECT_ORIGINS } from "./back";

/**
 * A project's page (7.3) traced: the title bar with its back control (to the client's Projects;
 * the client's name is not read yet, so its label is a bar), the Activity button and ⋯ (both
 * 44 px), the description line (client · repeat, desktop), the state line, the month tabs (previous ·
 * this · next, one segmented control), the progress card (the ring, its line and pace; 6b.11), the
 * Deliverables heading with Select and Add deliverable, the open deliverables in the list's
 * columns (V3: one line on a laptop, the title, one progress bar with "n/m", Next, the date and the
 * row's ⋯ and "›"; a card with its planned line, its 44 px Next line (unit U) and the bar under them
 * on a phone; every row collapsed, as the page arrives) and the collapsed "Done and
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
      <div aria-hidden className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex h-5 items-center gap-2">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          {/* The month tabs: previous · this · next, one segmented control (the v1.8 sample). */}
          <div className="bg-muted rounded-control grid grid-cols-3 gap-1 p-1">
            {["w-16", "w-24", "w-16"].map((width, cell) => (
              <span
                key={cell}
                className={cn(
                  "rounded-control flex min-h-11 items-center justify-center px-2",
                  cell === 1 && "bg-background shadow-raised",
                )}
              >
                <Skeleton className={cn("h-3.5 max-w-full", width)} />
              </span>
            ))}
          </div>
          {/* The cycle's progress: the ring with its figure, the line and the pace (6b.11 (5)). */}
          <div className="border-border bg-card flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border px-3 py-3 sm:px-4">
            <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-4">
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
            {/* Needs you is drawn only when something is late or nearly done (owner 2026-10-21):
                nothing is reserved for it. */}
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
              "border-border divide-border bg-card shadow-raised divide-y rounded-lg border",
              DELIVERABLE_COLUMNS,
            )}
          >
            {/* The laptop table's header row (Deliverable · Progress by group · Next · Planned). */}
            <li
              aria-hidden
              className="bg-muted/40 hidden px-3 py-2 sm:px-4 lg:col-span-full lg:grid lg:grid-cols-subgrid"
            >
              {["w-16", "w-24", "w-8", "w-12"].map((width) => (
                <span key={width} className="flex h-4 items-center">
                  <Skeleton className={cn("h-3", width)} />
                </span>
              ))}
              <span />
            </li>
            {[0, 1, 2, 3, 4].map((row) => (
              <li
                key={row}
                data-row=""
                className="flex flex-wrap items-start gap-x-3 px-3 py-2 sm:px-4 lg:col-span-full lg:grid lg:grid-cols-subgrid lg:gap-y-1"
              >
                <span className="flex min-h-11 min-w-0 flex-[1_1_8rem] flex-col justify-center lg:min-h-7">
                  <span className="flex min-h-6 min-w-0 flex-col justify-center gap-0.5 py-0.5 lg:py-1">
                    <span className="flex h-5 items-center">
                      <Skeleton className="h-3.5 w-1/2" />
                    </span>
                    {/* Planned on a phone; "3 groups · 1 of 9 stages" on a laptop. */}
                    <span className="flex h-4 items-center">
                      <Skeleton className="h-3 w-24" />
                    </span>
                  </span>
                  {/* A phone's Next line: 44 px (a one-tap tick for whoever ticks). */}
                  <span className="flex min-h-11 items-center lg:hidden">
                    <Skeleton className="h-3 w-20" />
                  </span>
                </span>
                {/* The collapsed row's progress (the approved sample): a line per group, its name,
                    its segmented bar and "n/m" (one line drawn: an untitled list's). */}
                <span className="order-last flex min-h-11 basis-full flex-col justify-center gap-1.5 py-1 lg:order-none lg:min-h-7">
                  {[0].map((line) => (
                    <span
                      key={line}
                      className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-x-2"
                    >
                      <Skeleton className="h-3 w-12" />
                      <Skeleton className="h-1.5 w-full rounded-full" />
                      <Skeleton className="ml-auto h-3 w-6" />
                    </span>
                  ))}
                </span>
                {/* Next: the stage as a chip. */}
                <span className="hidden min-h-7 items-center lg:flex">
                  <Skeleton className="h-7 w-24 rounded-full" />
                </span>
                <span className="hidden min-h-7 items-center lg:flex">
                  <Skeleton className="h-3 w-16" />
                </span>
                {/* The row's ⋯ (Mark done waits in it until every stage is ticked) and its "›". */}
                <span className="ml-auto flex min-h-11 shrink-0 items-center justify-end gap-1 lg:ml-0 lg:min-h-7">
                  <Skeleton className="size-11 shrink-0 rounded-lg lg:size-7" />
                  <Skeleton className="size-4 shrink-0 rounded-sm" />
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
        {/* Details: its heading, then the field grid (Client contact, Repeats, Template, Notes; a
            cell a field). */}
        <div className="flex flex-col gap-2">
          <span className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-14" />
          </span>
          <div className="border-border bg-card grid grid-cols-[repeat(auto-fit,minmax(min(11rem,100%),1fr))] rounded-lg border">
            {[0, 1, 2, 3].map((cell) => (
              <span key={cell} className="flex flex-col gap-0.5 px-4 py-3">
                <span className="flex h-4 items-center">
                  <Skeleton className="h-3 w-14" />
                </span>
                <span className="flex h-5 items-center">
                  <Skeleton className="h-3.5 w-24" />
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <span className="sr-only">Loading the project</span>
    </div>
  );
}
