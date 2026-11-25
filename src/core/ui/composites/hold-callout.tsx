import { PauseIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";

/**
 * The amber "on hold" box (v1.9 W8, DESIGN.md: attention, never red): a pause icon and its words,
 * with the Resume action beside them on a laptop and under them on a phone. One component for a
 * held task, a held project and a held deliverable's sheet (v2.0 review P5, v7.0: they were three
 * hand-written copies). A status, so a screen reader hears it once it appears.
 */
export function HoldCallout({
  slot,
  children,
  action,
}: {
  slot: string;
  /** The words: the hold's title, reason and note, laid out by the caller. */
  children: ReactNode;
  /** Resume (or nothing, for whoever may not resume). */
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      data-slot={slot}
      className={cn(
        "border-border bg-attention-soft flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm",
        action ? "md:flex-row md:items-center md:gap-3 md:py-2" : null,
      )}
    >
      <p className="flex min-w-0 flex-1 items-start gap-2 break-words">
        <PauseIcon aria-hidden className="text-attention mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">{children}</span>
      </p>
      {action}
    </div>
  );
}
