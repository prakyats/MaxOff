"use client";

import type { Result } from "@/core/errors";
import { cn } from "@/core/lib/utils";
import { attendanceStatus, StatusDot } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import type { ReviewContext } from "../domain/review-context";

/**
 * The person's week around the day (B4): Monday to today, one line a day with its status in the
 * shared colours (`attendanceStatus`, B13), the reviewed day marked. Its own number of skeleton
 * lines while it loads, a quiet line if it cannot be read.
 */
export function ReviewWeek({
  context,
  lines,
}: {
  context: Result<ReviewContext> | undefined;
  lines: number;
}) {
  return (
    <section aria-label="This week" data-slot="review-week" className="mt-4 flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-medium">This week</h3>
      {context === undefined ? (
        <ul aria-hidden className="flex flex-col gap-1">
          {Array.from({ length: lines }, (_, index) => (
            <li key={index} className="flex min-h-7 items-center justify-between gap-4">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-24" />
            </li>
          ))}
        </ul>
      ) : context.ok ? (
        <ul className="flex flex-col gap-1">
          {context.data.week.map((day) => (
            <li
              key={day.date}
              data-slot="review-week-day"
              data-current={day.current ? "" : undefined}
              className={cn(
                "flex min-h-7 items-center justify-between gap-4 rounded-md px-2",
                day.current && "bg-muted font-medium",
              )}
            >
              <span>{day.current ? `${day.label} (this day)` : day.label}</span>
              <StatusDot
                status={attendanceStatus(day.dot)}
                label={day.status}
                className="text-sm"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">The week could not be loaded.</p>
      )}
    </section>
  );
}
