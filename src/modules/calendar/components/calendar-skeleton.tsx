import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SHOW_LABELS } from "../domain/show";

/**
 * The calendar while it loads (6.4b; ARCHITECTURE §14.1: a loading screen traces its screen): on a
 * phone the header row (the arrows, the month's name, Today, Filters), the compact month (the
 * opening size: the weekday letters and `weeks` rows of 44px day boxes), the handle and the day's
 * heading; from `md` up the Day · Week · Month control, "‹ October 2026 ›" (the arrows around the
 * month's name) then Today, Filters at the right (PP-calendar-15), then the month (the opening view) with its boxes. For the
 * Owner and Admins, the `All ▾` menu button (SCOPE §6; v1.8, owner 23 Oct) in the phone's one-row
 * header before the Filters icon, and beside Filters in the laptop's one-row toolbar. The same boxes and gaps as `CalendarScreen` and `MonthGrid`, so nothing
 * moves when the calendar arrives. A server component: no client code on the loading screen.
 */
export function CalendarSkeleton({ weeks, switcher }: { weeks: number; switcher: boolean }) {
  const grid = (density: "compact" | "laptop") => (
    <div data-slot="calendar-month" className="flex min-h-0 min-w-0 flex-col gap-0.5">
      <ol className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: 7 }, (_, index) => (
          <li key={index} className="flex h-4 items-center justify-center">
            {/* The weekdays: single letters on a phone, "Mon Tue …" on a laptop (PP-calendar-6). */}
            <Skeleton className={cn("h-2.5", density === "laptop" ? "w-6" : "w-2.5")} />
          </li>
        ))}
      </ol>
      <div className="grid min-h-0 flex-1 gap-0.5">
        {Array.from({ length: weeks }, (_, row) => (
          <ol key={row} className="grid min-h-0 grid-cols-7 gap-0.5">
            {Array.from({ length: 7 }, (_, day) => (
              <li key={day} className="flex min-h-0 min-w-0">
                <span
                  className={cn(
                    "border-border/60 flex w-full min-w-0 flex-col gap-0.5 rounded-md border p-0.5",
                    density === "compact" ? "min-h-11" : "min-h-28 p-1",
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center justify-center",
                      density === "compact" ? "size-5" : "size-6",
                    )}
                  >
                    <Skeleton className="h-3 w-3" />
                  </span>
                </span>
              </li>
            ))}
          </ol>
        ))}
      </div>
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1 md:hidden">
        <div data-slot="calendar-header" className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="flex size-11 shrink-0 items-center justify-center">
            <Skeleton className="size-4 rounded-sm" />
          </span>
          <span className="flex h-6 min-w-0 flex-1 items-center">
            <Skeleton className="h-4 w-32" />
          </span>
          <span className="flex size-11 shrink-0 items-center justify-center">
            <Skeleton className="size-4 rounded-sm" />
          </span>
          {/* Today, dimmed: the calendar opens on today's month (the owner, 22 Oct). */}
          <span className="flex size-11 shrink-0 items-center justify-center opacity-40">
            <Skeleton className="size-6 rounded-sm" />
          </span>
          {/* Option A (owner 23 Oct): the Owner's and Admins' All ▾, then Filters as an icon. */}
          {switcher ? (
            <span className="border-control-border text-muted-foreground flex min-h-11 shrink-0 items-center gap-1 rounded-lg border pr-1 pl-2 text-sm font-medium whitespace-nowrap">
              {SHOW_LABELS.all}
              <ChevronDownIcon className="size-4" aria-hidden />
            </span>
          ) : null}
          <span className="flex size-11 shrink-0 items-center justify-center">
            <Skeleton className="size-4 rounded-sm" />
          </span>
        </div>
        <div className="flex min-w-0 flex-col">{grid("compact")}</div>
        <div
          data-slot="calendar-handle"
          className="flex min-h-11 w-full items-center justify-center"
        >
          <Skeleton className="h-1 w-10 rounded-full" />
        </div>
        <div className="flex h-5 items-center">
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="hidden min-w-0 flex-col gap-3 md:flex">
        <div data-slot="calendar-controls" className="flex min-w-0 flex-nowrap items-center gap-3">
          <div className="bg-muted grid h-10 w-72 grid-cols-3 gap-1 rounded-lg p-1">
            {["Day", "Week", "Month"].map((label) => (
              <span
                key={label}
                className="text-muted-foreground flex min-h-8 items-center justify-center text-sm font-medium"
              >
                {label}
              </span>
            ))}
          </div>
          {/* PP-calendar-15: "‹ October 2026 ›" (the arrows around the name), then Today; Filters
              at the right. */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              <span className="flex size-8 items-center justify-center">
                <Skeleton className="size-4 rounded-sm" />
              </span>
              <span className="flex h-6 items-center px-1">
                <Skeleton className="h-4 w-32" />
              </span>
              <span className="flex size-8 items-center justify-center">
                <Skeleton className="size-4 rounded-sm" />
              </span>
            </div>
            <span className="border-control-border text-muted-foreground flex min-h-8 items-center rounded-lg border px-3 text-sm font-medium opacity-40">
              Today
            </span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* The laptop's All ▾ (v1.8 calendar toolbar, owner 23 Oct), as `ShowTrigger`. */}
            {switcher ? (
              <span className="border-control-border text-muted-foreground flex min-h-8 items-center gap-1 rounded-lg border pr-2 pl-3 text-sm font-medium whitespace-nowrap">
                {SHOW_LABELS.all}
                <ChevronDownIcon className="size-4" aria-hidden />
              </span>
            ) : null}
            <span className="border-control-border text-muted-foreground flex min-h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium">
              <Skeleton className="size-4 rounded-sm" />
              Filters
            </span>
          </div>
        </div>
        {grid("laptop")}
      </div>
    </div>
  );
}
