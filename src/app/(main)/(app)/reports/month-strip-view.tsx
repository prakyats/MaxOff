import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import type { MonthStrip } from "./month-strip";

/** The strip's card: a bordered, raised card of tiles, two a row on a phone, four from `md`. */
export const STRIP_CLASS =
  "border-border bg-card shadow-raised divide-border grid grid-cols-2 overflow-hidden rounded-lg border md:grid-cols-4";
const TILE_CLASS = "flex min-h-24 min-w-0 flex-col gap-0.5 px-4 py-3";

/**
 * "This month" on Reports (major change 7): each metric a tile (its figure one step up and
 * tabular, its label, a detail line) that opens where it is decided; the metrics with nothing in
 * them fold into one muted line under the card.
 */
export function MonthStripView({ strip, month }: { strip: MonthStrip; month: string }) {
  return (
    <section
      aria-labelledby="report-month-title"
      className="mb-6 flex flex-col gap-2"
      data-slot="report-strip"
    >
      <h2 id="report-month-title" className="text-sm font-semibold">
        {month} so far
      </h2>
      {strip.tiles.length > 0 ? (
        <ul className={STRIP_CLASS}>
          {strip.tiles.map((tile, index) => (
            <li
              key={tile.key}
              className={cn(
                "border-border",
                index % 2 === 1 ? "border-l" : null,
                index >= 2 ? "border-t md:border-t-0" : null,
                index > 0 ? "md:border-l" : null,
              )}
            >
              <DrillLink
                href={tile.href}
                data-slot="report-strip-tile"
                data-tile={tile.key}
                className={cn(
                  TILE_CLASS,
                  "active:bg-muted/60 hover:bg-muted/40 focus-visible:ring-ring relative h-full outline-none focus-visible:ring-2 focus-visible:ring-inset",
                )}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-xl font-semibold tabular-nums">{tile.figure}</span>
                  <ChevronRightIcon
                    className="text-muted-foreground mt-1 size-4 shrink-0"
                    aria-hidden
                  />
                </span>
                <span className="text-muted-foreground text-xs">{tile.label}</span>
                {tile.detail ? (
                  <span
                    className={cn(
                      "text-xs",
                      tile.attention ? "text-attention" : "text-muted-foreground",
                    )}
                    data-slot="report-strip-detail"
                  >
                    {tile.detail}
                  </span>
                ) : null}
              </DrillLink>
            </li>
          ))}
        </ul>
      ) : null}
      {strip.quiet ? (
        <p className="text-muted-foreground text-sm" data-slot="report-strip-quiet">
          {strip.quiet}
        </p>
      ) : null}
    </section>
  );
}

/** The strip while it loads: the heading and four tiles (the full month, the common case). */
export function MonthStripSkeleton() {
  return (
    <div aria-hidden className="mb-6 flex flex-col gap-2">
      <span className="flex h-5 items-center">
        <Skeleton className="h-3.5 w-36" />
      </span>
      <div className={STRIP_CLASS}>
        {[0, 1, 2, 3].map((tile) => (
          <div
            key={tile}
            className={cn(
              TILE_CLASS,
              "border-border",
              tile % 2 === 1 ? "border-l" : null,
              tile >= 2 ? "border-t md:border-t-0" : null,
              tile > 0 ? "md:border-l" : null,
            )}
          >
            <span className="flex h-7 items-center">
              <Skeleton className="h-5 w-16" />
            </span>
            <span className="flex h-4 items-center">
              <Skeleton className="h-3 w-24" />
            </span>
            <span className="flex h-4 items-center">
              <Skeleton className="h-3 w-20" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
