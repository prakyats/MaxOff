import { countDeliverables, type Deliverable, type StageGroup } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";

import { countsLine } from "./editing";

/**
 * The live preview (ROADMAP 6b.16 (a)): exactly what will be created, deliverables → stage groups
 * → stages, under the counts line ("6 deliverables · 72 stages", `countDeliverables`). A
 * deliverable with `stageGroups` null shows the `defaults`. Read-only; it updates as the form
 * changes because it is drawn from the same value.
 */
export function DeliverablesPreview({
  deliverables,
  defaults,
  className,
}: {
  deliverables: readonly Deliverable[];
  defaults: readonly StageGroup[];
  className?: string;
}) {
  const counts = countDeliverables(deliverables, defaults);
  return (
    <section
      aria-label="Preview"
      data-slot="deliverables-preview"
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      <p className="text-sm font-medium" data-slot="preview-counts">
        {countsLine(counts)}
      </p>
      {deliverables.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing to create yet: add deliverables to see them here.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {deliverables.map((deliverable, index) => {
            const groups = deliverable.stageGroups ?? defaults;
            return (
              <li
                key={index}
                data-slot="preview-deliverable"
                className="flex min-w-0 flex-col gap-1"
              >
                <p className="text-sm font-medium break-words">
                  <span data-slot="preview-deliverable-title">{deliverable.title}</span>
                  {deliverable.stageGroups === null ? (
                    <span className="text-muted-foreground font-normal"> · default stages</span>
                  ) : null}
                </p>
                {groups.length === 0 ? (
                  <p className="text-muted-foreground text-xs">No stages</p>
                ) : (
                  groups.map((group, at) => (
                    <div key={at} data-slot="preview-group" className="flex min-w-0 flex-col pl-3">
                      {group.label !== null ? (
                        <p
                          className="text-xs font-medium break-words"
                          data-slot="preview-group-label"
                        >
                          {group.label}
                        </p>
                      ) : null}
                      <ol className="text-muted-foreground flex flex-col text-xs">
                        {group.stages.map((stage, position) => (
                          <li key={position} data-slot="preview-stage" className="break-words">
                            {position + 1}. {stage}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
