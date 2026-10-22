import { formatIST, istDayStart } from "@/core/time";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { type CompBalance, daysLabel, expiryLabel } from "../domain/credits";

/**
 * The balance strip that leads Attendance & leave (PP-crew-1, V5b): the Crew's first question is
 * "how much leave do I have?". Two figures, one step up and tabular (FINAL 3): the leave taken so
 * far this month, and the comp leave there is to take with its use-by date ("None" without any).
 * Each tile is three lines whatever it holds. A server component; the page reads both (its own
 * loader, never the shared layout).
 */
export function LeaveBalanceStrip({
  takenDays,
  comp,
  today,
}: {
  takenDays: number;
  comp: CompBalance;
  today: string;
}) {
  const hasComp = comp.availableDays > 0 && comp.useBy !== null;
  return (
    <dl
      data-slot="leave-balance"
      className="bg-card shadow-raised border-border mb-4 grid grid-cols-2 divide-x overflow-hidden rounded-lg border"
    >
      <div data-slot="leave-taken" className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
        <dt className="text-muted-foreground text-xs">Leave taken this month</dt>
        <dd className="text-lg font-semibold tabular-nums">{daysLabel(takenDays)}</dd>
        <dd className="text-muted-foreground text-xs">
          {formatIST(istDayStart(today), "MMMM")}, to today
        </dd>
      </div>
      <div data-slot="comp-leave-balance" className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
        <dt className="text-muted-foreground text-xs">Comp leave to take</dt>
        <dd className="text-lg font-semibold tabular-nums">
          {hasComp ? daysLabel(comp.availableDays) : "None"}
        </dd>
        {/* Three lines on both tiles, so the strip never changes height (and its skeleton fits). */}
        <dd className="text-muted-foreground text-xs">
          {hasComp && comp.useBy ? expiryLabel(comp.useBy) : "Granted for extra work"}
        </dd>
      </div>
    </dl>
  );
}

/** The strip's loading state, a tracing of it: two tiles of three lines (label, figure, line). */
export function LeaveBalanceStripSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="loading-leave-balance"
      className="bg-card shadow-raised border-border mb-4 grid grid-cols-2 divide-x overflow-hidden rounded-lg border"
    >
      {["w-32", "w-28"].map((width) => (
        <div key={width} className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
          <span className="flex h-4 items-center">
            <Skeleton className={`h-3 max-w-full ${width}`} />
          </span>
          <span className="flex h-7 items-center">
            <Skeleton className="h-5 w-16" />
          </span>
          <span className="flex h-4 items-center">
            <Skeleton className="h-3 w-24 max-w-full" />
          </span>
        </div>
      ))}
    </div>
  );
}
