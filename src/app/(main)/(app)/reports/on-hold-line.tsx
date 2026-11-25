import { ChevronRightIcon, PauseIcon } from "lucide-react";

import { DrillLink } from "@/core/ui/composites/drill-link";
import { onHoldDeliverablesLine } from "@/modules/client-work";

import { type HeldProject, onHoldHref } from "./on-hold-href";

export type { HeldProject } from "./on-hold-href";

/**
 * The reports' "On hold · 3 deliverables" (v1.9 W8; the approved sample §2 with the owner's
 * correction: a count, never money, which is phase 9's): the unfinished deliverables of held
 * projects in the period, neither earned nor lost. Tappable to the held projects. The Owner reads
 * every client's, the client's Admin theirs (RLS); Crew never reach Reports. Nothing when none.
 */
export function OnHoldLine({ held }: { held: readonly HeldProject[] }) {
  const count = held.reduce((sum, project) => sum + project.deliverables, 0);
  const line = onHoldDeliverablesLine(count);
  if (!line) return null;
  return (
    <DrillLink
      href={onHoldHref(held)}
      data-slot="report-on-hold"
      className="border-border bg-card shadow-raised focus-visible:ring-ring flex min-h-12 items-center gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium outline-none focus-visible:ring-2"
    >
      <PauseIcon aria-hidden className="text-attention size-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">
        {line}
        <span className="text-muted-foreground block text-xs font-normal">
          Paused projects&apos; unfinished deliverables: neither done nor closed.
        </span>
      </span>
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </DrillLink>
  );
}
