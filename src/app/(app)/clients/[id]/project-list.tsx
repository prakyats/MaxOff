import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { ProgressBar } from "@/core/ui/progress/segmented-meter";
import { meterLine, type ProjectSummary } from "@/modules/client-work";

/**
 * A client's projects as rows (7.3, 6b.11 (5)): the name, its repeat, the current cycle's meter in
 * miniature with its percent and progress line, the state; one tap opens the project. Shared by
 * the client's Projects tab and, since L6, the top of its Overview (the working ones).
 */
export function ProjectList({
  clientId,
  projects,
  label,
}: {
  clientId: string;
  projects: readonly ProjectSummary[];
  label: string;
}) {
  if (projects.length === 0) return null;
  return (
    <ul
      aria-label={label}
      data-slot="project-list"
      className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
    >
      {projects.map((project) => (
        <li key={project.id}>
          <DrillLink
            href={`/clients/${clientId}/projects/${project.id}`}
            data-slot="project-row"
            className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
          >
            <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
              <span className="text-sm font-medium break-words">{project.name}</span>
              <span className="text-muted-foreground text-xs break-words">{project.meta}</span>
              {project.meter ? (
                // The cycle's meter in miniature (6b.11 (5)); its words are the line beside it.
                <span className="mt-1 flex min-w-0 items-center gap-2" data-slot="project-meter">
                  <ProgressBar
                    counts={{
                      done: project.meter.done,
                      next: project.meter.next,
                      total: project.meter.units,
                    }}
                    label={`${project.meter.percent}%: ${meterLine(project.meter)}`}
                    slot="project-meter-bar"
                    className="w-24 shrink-0 sm:w-32"
                  />
                  <span className="text-xs font-medium tabular-nums" data-slot="project-percent">
                    {project.meter.percent}%
                  </span>
                </span>
              ) : null}
              {project.progress ? (
                <span className="text-xs break-words" data-slot="project-progress">
                  {project.progress}
                </span>
              ) : null}
            </span>
            <span className={cn("flex items-center gap-2", CARD_ROW_TRAILING)}>
              <StatusBadge status={project.state} label={project.stateLabel} />
              <ChevronRightIcon className="text-muted-foreground size-4" aria-hidden />
            </span>
          </DrillLink>
        </li>
      ))}
    </ul>
  );
}
