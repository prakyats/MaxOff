import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/*
 * The day screens' frame and skeletons in a file of their own (v7.0): Today's, My Day's and
 * Tasks' loading screens are made of them, and the tap drawings load them without the blocks'
 * live parts (their links and rows), which would otherwise follow them into other screens'
 * first-load JavaScript.
 */

/** A section heading's skeleton: the `h2`'s 20px line box. */
export function DashSectionHeadingSkeleton({ width = "w-28" }: { width?: string }) {
  return (
    <div className="flex h-5 min-w-0 items-center">
      <Skeleton className={cn("h-4 max-w-full", width)} />
    </div>
  );
}

/**
 * The date under the title on a phone (PP-phone-6), where the header's line of context does not
 * render: "Thursday, 22 October", muted, right under the title bar. The laptop has it in the
 * header's description.
 */
export function PhoneDateLine({ line }: { line: ReactNode }) {
  return (
    <p data-slot="day-date" className="text-muted-foreground -mt-1 mb-4 text-sm md:hidden">
      {line}
    </p>
  );
}

/**
 * Today's and My Day's two columns (major change 1, FINAL 8): the main column, then "This week".
 * A container query on the content width: **two columns from 896 px (56rem)** (owner 23 Oct, #89
 * comment 6370526089: a 1280 px laptop, whose content is about 960 px wide, shows the column;
 * the 1024 px asked for is wider than that), "This week" at most 30%
 * (`minmax(260px, 30%)`); below that one column, "This week" under the rest (under
 * "Overdue and risks"), full width, never squeezed and never hidden.
 */
export function DayColumns({
  main,
  week,
  slot = "day-main",
  loading,
  laptopOnly = false,
}: {
  main: ReactNode;
  week: ReactNode;
  /** The main column's `data-slot` ("owner-today"), for the screen's specs. */
  slot?: string;
  /** A loading screen's name ("Loading Today"): the main column is its busy status. */
  loading?: string;
  /**
   * "This week" only from the `md` breakpoint (the Tasks tab's "My tasks", PP-crew-7): the phone
   * keeps its one list, with nothing under it; My Day and Today show it on every width.
   */
  laptopOnly?: boolean;
}) {
  return (
    <div className="@container min-w-0" data-slot="day-columns">
      <div className="flex min-w-0 flex-col gap-6 @min-[56rem]:grid @min-[56rem]:grid-cols-[minmax(0,1fr)_minmax(260px,30%)] @min-[56rem]:items-start @min-[56rem]:gap-8">
        <div
          className="flex min-w-0 flex-col gap-6"
          data-slot={slot}
          {...(loading ? { role: "status", "aria-busy": true, "aria-label": loading } : {})}
        >
          {main}
        </div>
        {week ? (
          <aside
            aria-label="This week"
            className={cn("min-w-0", laptopOnly && "hidden md:block")}
            data-slot="day-week"
          >
            {week}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** "This week" while the page loads: its heading with "Calendar ›", then two day blocks. */
export function ThisWeekSkeleton() {
  return (
    <div aria-hidden className="flex min-w-0 flex-col gap-2" data-slot="loading-this-week">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>
      <ul className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border">
        {[0, 1].map((day) => (
          <li key={day} className="flex flex-col">
            <div className="flex min-h-9 items-center px-4 pt-2">
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="flex min-h-11 items-center gap-3 px-4 py-1.5 pb-1">
              <Skeleton className="h-3 w-14 shrink-0" />
              <Skeleton className="h-4 w-40 max-w-full" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
