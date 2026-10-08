import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The calendar while it loads (6.4b; ARCHITECTURE §14.1: a loading screen traces its screen): on a
 * phone the header row (the arrows, the month's name, Today, Filters), the compact month (the
 * opening size: the weekday letters and `weeks` rows of 44px day boxes), the handle and the day's
 * heading; from `md` up the Day · Week · Month control and the pager, then the month (the opening
 * view) with its boxes. The same boxes and gaps as `CalendarScreen` and `MonthGrid`, so nothing
 * moves when the calendar arrives. A server component: no client code on the loading screen.
 */
export function CalendarSkeleton({ weeks }: { weeks: number }) {
  const grid = (density: "compact" | "laptop") => (
    <div data-slot="calendar-month" className="flex min-h-0 min-w-0 flex-col gap-1">
      <ol className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }, (_, index) => (
          <li key={index} className="flex h-4 items-center justify-center">
            <Skeleton className="h-2.5 w-2.5" />
          </li>
        ))}
      </ol>
      <div className="grid min-h-0 flex-1 gap-1">
        {Array.from({ length: weeks }, (_, row) => (
          <ol key={row} className="grid min-h-0 grid-cols-7 gap-1">
            {Array.from({ length: 7 }, (_, day) => (
              <li key={day} className="flex min-h-0 min-w-0">
                <span
                  className={cn(
                    "flex w-full min-w-0 flex-col gap-0.5 rounded-md border border-transparent p-0.5",
                    density === "compact" ? "min-h-11" : "min-h-28 p-1",
                  )}
                >
                  <span className="flex size-6 items-center justify-center">
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
      <div className="flex min-w-0 flex-col gap-2 md:hidden">
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
          <span className="flex size-11 shrink-0 items-center justify-center">
            <Skeleton className="size-6 rounded-[0.3rem]" />
          </span>
          <span className="flex min-h-11 w-24 shrink-0 items-center">
            <Skeleton className="h-11 w-full rounded-lg" />
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
        <div data-slot="calendar-controls" className="flex min-w-0 flex-wrap items-center gap-3">
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
          <span className="flex h-8 items-center">
            <Skeleton className="h-4 w-48" />
          </span>
        </div>
        {grid("laptop")}
      </div>
    </div>
  );
}
