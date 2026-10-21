import { FolderKanbanIcon } from "lucide-react";
import type { Metadata } from "next";

import { listDefinitions } from "@/core/custom-fields/server";
import { checkThenRead } from "@/core/lib/start-early";
import { todayIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import {
  listClientProjects,
  listCurrentCycleMeters,
  projectSummaries,
} from "@/modules/client-work";
import { NewProjectButton } from "@/modules/client-work/components/new-project-button";
import { listStagePresets } from "@/modules/settings";
import { listProjectTemplates } from "@/modules/templates";

import { assertClientId, loadClientWork } from "../../client";
import { ProjectList } from "../../project-list";

export const metadata: Metadata = { title: "Projects" };

/**
 * A client's Projects (7.3; PRODUCT §4.4 "page sections", §4.5; kickoff 7 decisions 1, 18, 20, 26;
 * PERMISSIONS "Screens (phase 7)"): `projects.manage` on a visible client (the Owner, the client's
 * Admin; Crew are sent to /forbidden, another Admin's client is a 404). **First glance:** each
 * project with its repeat, its state and the current cycle's progress line ("9/12 done · 1
 * closed") beside its meter in miniature (6b.11 (5): the stages ticked across the cycle, "68%"),
 * working ones first; a project opens one tap deeper. "New project" is here, never on
 * an Inactive client (decision 1). No money (amendment C).
 */
export default async function ClientProjectsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertClientId(id);
  const today = todayIST();
  // One wave (ARCHITECTURE §19): the projects and their current cycles' progress read together.
  const [{ client }, [projects, current, presets, templates, definitions]] = await checkThenRead(
    loadClientWork(id),
    Promise.all([
      listClientProjects(id),
      listCurrentCycleMeters(today, id),
      listStagePresets(),
      listProjectTemplates(),
      listDefinitions("project"),
    ]),
  );
  const summaries = projectSummaries(projects, current, today);
  const working = summaries.filter((summary) => !summary.finished);
  const finished = summaries.filter((summary) => summary.finished);
  const canCreate = client.state !== "inactive";

  return (
    <div className="flex flex-col gap-4" data-slot="client-projects">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Projects</h2>
        {canCreate ? (
          <NewProjectButton
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
                stageGroups: template.stageGroups,
                deliverables: template.deliverables,
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
