import { cn } from "@/core/lib/utils";
import { StatusBadge } from "@/core/ui/composites/status-badge";

import type { PlannedLine } from "../domain/items";

/**
 * A planned date as a row says it (the design gate, 23 Oct; FINAL 4: text colour never carries a
 * status alone): "Planned 18 Oct" in the row's own tone, then the lateness as a red chip, "2 days
 * late". A screen reader and the text hear the whole line, "Planned 18 Oct · 2 days late".
 * `short` drops the word "Planned" (a laptop's Planned column, the deliverable sheet's Planned
 * fact). Server-safe.
 */
export function PlannedWords({
  planned,
  short = false,
  className,
}: {
  planned: PlannedLine;
  short?: boolean;
  className?: string;
}) {
  // Short, "Planned today" reads "Today" (it starts the line or a sheet's value).
  const bare = planned.date.replace(/^Planned /, "");
  const date = short ? bare.charAt(0).toUpperCase() + bare.slice(1) : planned.date;
  if (planned.late === null) return <span className={className}>{date}</span>;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5", className)}>
      <span className="tabular-nums">{date}</span>
      <span className="sr-only"> · </span>
      <StatusBadge status="late" tone="danger" label={planned.late} />
    </span>
  );
}
