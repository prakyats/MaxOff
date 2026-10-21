"use client";

import { cn } from "@/core/lib/utils";
import { ProgressRing } from "@/core/ui/progress/segmented-meter";

import {
  completeWords,
  meterLine,
  meterPace,
  type CycleMeter,
  type NeedsYouPill,
} from "../domain/progress";

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
  cancelledAt = null,
  needsYou = null,
}: {
  /**
   * The "Needs you" pills beside the ring (the v1.8 sample; Owner and Admin, the only roles on this
   * page): late in red, nearly done in amber, each a dot and a sentence. Null: none drawn.
   */
  needsYou?: { pills: readonly NeedsYouPill[]; more: number } | null;
  cycleId: string;
  /** The cycle's label ("October 2026"), null for a one-time project's. */
  label: string | null;
  meter: CycleMeter;
  /** A cancelled project's cancel time: the line says "Cancelled 21 Oct · …" (B8). */
  cancelledAt?: string | null;
}) {
  const line = meterLine(meter, cancelledAt);
  const pace = cancelledAt ? null : meterPace(meter);
  // A cancelled project never plays the 100% moment.
  const complete = meter.complete && !cancelledAt;
  return (
    <section
      aria-label="Progress"
      data-slot="cycle-meter"
      data-complete={complete ? "" : undefined}
      className="border-border bg-card flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border px-3 py-3 sm:px-4"
    >
      <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-4">
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
            {complete ? (
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
      </div>
      {needsYou && needsYou.pills.length > 0 ? (
        // Beside the ring, as the approved sample: only when something is late or nearly done
        // (owner 2026-10-21: nothing at all otherwise); one line on a phone (the first pill and
        // "+N more").
        <div
          data-slot="project-needs-you"
          className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1.5"
        >
          <h2 className="sr-only">Needs you</h2>
          {needsYou.pills.length === 0 ? null : (
            <ul className="flex min-h-7 min-w-0 flex-nowrap gap-1.5 sm:flex-wrap">
              {needsYou.pills.map((pill, index) => (
                <li
                  key={pill.itemId}
                  data-slot="project-needs-you-pill"
                  data-tone={pill.tone}
                  className={cn(
                    "border-border flex min-h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-xs",
                    // A phone keeps one line: the first pill, the rest counted beside it.
                    index > 0 && "max-sm:hidden",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      pill.tone === "danger" ? "bg-danger" : "bg-attention",
                    )}
                  />
                  <span className="min-w-0 truncate" title={pill.text}>
                    {pill.text}
                  </span>
                </li>
              ))}
              {needsYou.pills.length - 1 + needsYou.more > 0 ? (
                <li className="text-muted-foreground flex shrink-0 items-center px-1 text-xs whitespace-nowrap sm:hidden">
                  +{needsYou.pills.length - 1 + needsYou.more} more
                </li>
              ) : null}
              {needsYou.more > 0 ? (
                <li className="text-muted-foreground flex shrink-0 items-center px-1 text-xs whitespace-nowrap max-sm:hidden">
                  +{needsYou.more} more
                </li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
