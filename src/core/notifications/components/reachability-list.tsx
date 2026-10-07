import { cn } from "@/core/lib/utils";
import { formatIST } from "@/core/time";
import {
  CARD_ROW_MIN_H,
  CARD_ROW_PADDING,
  CARD_ROW_TITLE,
  CARD_ROW_TRAILING,
} from "@/core/ui/composites/row-metrics";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { platformLabel, type ReachabilityRow, reachabilityReason } from "../reachability";

/**
 * Settings → Notifications' people (task 5.4): one card per person, never a table (ARCHITECTURE
 * §14.1). The name over the reason (a dot and the plain words: green when reachable, amber when
 * someone must act); for the Owner, the device and the last delivery that worked on the right.
 * Server-rendered: no JavaScript of its own.
 */
export function ReachabilityList({
  rows,
  detailed,
  label,
}: {
  rows: readonly ReachabilityRow[];
  /** The Owner's view: platform and last success (an Admin sees status and reason only). */
  detailed: boolean;
  label: string;
}) {
  return (
    <ul
      aria-label={label}
      data-slot="reachability-list"
      className="border-border divide-border bg-card divide-y rounded-lg border"
    >
      {rows.map((row) => (
        <li
          key={row.memberId}
          data-slot="reachability-row"
          data-state={row.state}
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1",
            CARD_ROW_MIN_H,
            CARD_ROW_PADDING,
          )}
        >
          <div className={cn("flex flex-col gap-1", CARD_ROW_TITLE)}>
            <span className="truncate text-sm font-medium">{row.fullName}</span>
            <StatusDot
              status={row.state}
              tone={row.state === "ok" ? "success" : "attention"}
              label={reachabilityReason(row.state)}
            />
          </div>
          {detailed ? (
            <div
              data-slot="reachability-device"
              className={cn(
                "text-muted-foreground flex flex-col items-end gap-1 text-xs",
                CARD_ROW_TRAILING,
              )}
            >
              <span>{platformLabel(row.platform) ?? "No device yet"}</span>
              <span>
                {row.lastSuccessAt
                  ? `Last delivered ${formatIST(row.lastSuccessAt, "d MMM")}`
                  : "Nothing delivered yet"}
              </span>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The same cards while the page loads: the same heights, paddings and line boxes. */
export function ReachabilityListSkeleton({ rows }: { rows: number }) {
  return (
    <ul aria-hidden className="border-border divide-border bg-card divide-y rounded-lg border">
      {Array.from({ length: rows }, (_, row) => (
        <li
          key={row}
          data-slot="loading-row"
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1",
            CARD_ROW_MIN_H,
            CARD_ROW_PADDING,
          )}
        >
          <div className={cn("flex flex-col gap-1", CARD_ROW_TITLE)}>
            <span className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-32 max-w-full" />
            </span>
            <span className="flex h-4 items-center">
              <Skeleton className="h-3 w-44 max-w-full" />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
