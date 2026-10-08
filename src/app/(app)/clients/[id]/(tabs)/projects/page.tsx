import { ChevronRightIcon, FolderKanbanIcon } from "lucide-react";
import type { Metadata } from "next";

import { listDefinitions } from "@/core/custom-fields/server";
import { checkThenRead } from "@/core/lib/start-early";
import { cn } from "@/core/lib/utils";
import { todayIST } from "@/core/time";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import {
  listClientProjects,
  listCycles,
  listCycleStates,
  projectSummaries,
  type ProjectSummary,
} from "@/modules/client-work";
import { NewProjectDialog } from "@/modules/client-work/components/new-project-dialog";
import { listStagePresets } from "@/modules/settings";
import { listProjectTemplates } from "@/modules/templates";

import { assertClientId, loadClientWork } from "../../client";

export const metadata: Metadata = { title: "Projects" };

/**
 * A client's Projects (7.3; PRODUCT §4.4 "page sections", §4.5; kickoff 7 decisions 1, 18, 20, 26;
 * PERMISSIONS "Screens (phase 7)"): `projects.manage` on a visible client (the Owner, the client's
 * Admin; Crew are sent to /forbidden, another Admin's client is a 404). **First glance:** each
 * project with its repeat, its state and the current cycle's progress line ("9/12 done · 8/12
 * approved"), working ones first; a project opens one tap deeper. "New project" is here, never on
 * an Inactive client (decision 1). No money (amendment C).
 */
export default async function ClientProjectsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertClientId(id);
  const [{ client }, [projects, presets, templates, definitions]] = await checkThenRead(
    loadClientWork(id),
    Promise.all([
      listClientProjects(id),
      listStagePresets(),
      listProjectTemplates(),
      listDefinitions("project"),
    ]),
  );
  const today = todayIST();
  const cycles = await listCycles(projects.map((project) => project.id));
  const states = await listCycleStates(cycles.map((cycle) => cycle.id));
  const summaries = projectSummaries(projects, cycles, states, today);
  const working = summaries.filter((summary) => !summary.finished);
  const finished = summaries.filter((summary) => summary.finished);
  const canCreate = client.state !== "inactive";

  return (
    <div className="flex max-w-2xl flex-col gap-4" data-slot="client-projects">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Projects</h2>
        {canCreate ? (
          <NewProjectDialog
            clientId={client.id}
            today={today}
            presets={presets
              .filter((preset) => !preset.archived)
              .map(({ id: presetId, name, stages }) => ({ id: presetId, name, stages }))}
            templates={templates
              .filter((template) => !template.archived)
              .map((template) => ({
                id: template.id,
                name: template.name,
                description: template.description,
                recurrence: template.recurrence,
                stages: template.stages,
                items: template.items,
                fieldDefaults: template.fieldDefaults,
              }))}
            definitions={definitions.filter((definition) => definition.archivedAt === null)}
          />
        ) : (
          <p className="text-muted-foreground text-xs">No new projects on an Inactive client.</p>
        )}
      </div>
      {summaries.length === 0 ? (
        <EmptyState
          icon={FolderKanbanIcon}
          title="No projects yet."
          description="A project holds the client's work: a monthly or weekly retainer, or a one-time job."
        />
      ) : (
        <>
          <ProjectList clientId={client.id} projects={working} label="Working projects" />
          {finished.length > 0 ? (
            <section aria-labelledby="finished-projects" className="flex flex-col gap-2">
              <h3 id="finished-projects" className="text-muted-foreground text-xs font-medium">
                Finished
              </h3>
              <ProjectList clientId={client.id} projects={finished} label="Finished projects" />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ProjectList({
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
              <span className="text-xs break-words" data-slot="project-progress">
                {project.progress}
              </span>
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
