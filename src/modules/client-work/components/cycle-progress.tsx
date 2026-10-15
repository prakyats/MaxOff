"use client";

import { cn } from "@/core/lib/utils";
import { ProgressRing } from "@/core/ui/progress/segmented-meter";

import { completeWords, meterLine, meterPace, type CycleMeter } from "../domain/progress";

import { CycleCompleteMoment } from "./cycle-complete";

/**
 * A cycle's progress on its project page (6b.11 (5); owner: "very premium, high quality", to
 * motivate by showing the work moving): the segmented ring of every stage across the cycle's
 * deliverables (ticked solid, each open one's next stage lighter; closed ones left out) with the
 * large figure inside, the calm line ("12 of 18 stages · 3 of 7 deliverables done") and the quiet
 * pace ("On track", "2 behind plan" in the overdue tone), or the 100% moment. The pace line keeps
 * its height whatever it says, so nothing moves when the numbers change.
 */
export function CycleProgress({
  cycleId,
  label,
  meter,
}: {
  cycleId: string;
  /** The cycle's label ("October 2026"), null for a one-time project's. */
  label: string | null;
  meter: CycleMeter;
}) {
  const line = meterLine(meter);
  const pace = meterPace(meter);
  return (
    <section
      aria-label="Progress"
      data-slot="cycle-meter"
      data-complete={meter.complete ? "" : undefined}
      className="border-border bg-card flex items-center gap-4 rounded-lg border px-3 py-3 sm:px-4"
    >
      <ProgressRing
        counts={{ done: meter.done, next: meter.next, total: meter.units }}
        label={`${meter.percent}%: ${line}`}
        slot="cycle-ring"
        className="size-20 sm:size-22"
      >
        <span
          data-slot="cycle-percent"
          className="text-xl leading-none font-semibold tracking-tight tabular-nums"
        >
          {meter.percent}
          <span className="text-muted-foreground text-xs font-medium">%</span>
        </span>
      </ProgressRing>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p data-slot="cycle-meter-line" className="text-sm break-words">
          {line}
        </p>
        <p className="flex min-h-5 items-center text-xs">
          {meter.complete ? (
            <CycleCompleteMoment cycleId={cycleId} words={completeWords(label)} />
          ) : pace ? (
            <span
              data-slot="cycle-pace"
              data-tone={pace.tone}
              className={cn(pace.tone === "danger" ? "text-danger" : "text-success")}
            >
              {pace.text}
            </span>
          ) : null}
        </p>
      </div>
    </section>
  );
}
