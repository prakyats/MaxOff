import { FolderKanbanIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { listDefinitions } from "@/core/custom-fields/server";
import { checkThenRead } from "@/core/lib/start-early";
import { todayIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { Skeleton } from "@/core/ui/primitives/skeleton";
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

/**
 * The tab names the client, then this view ("Shetty · Projects · MaxOff"), from `loadClientWork`
 * (`loadClient` and the session's member row).
 * Next resolves metadata on a prefetch too; the layout's header makes this same `cache()`d read
 * on it (it always has), so the title adds no read to a prefetch (P2 item 6).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { client } = await loadClientWork((await params).id);
  return { title: `${client.name} · Projects` };
}

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
  // v7.0: New project's setup (the stage presets, the templates, the project fields) is not in
  // the first wave (§19 "Six connections"): it streams in once the client is checked.
  const [{ client }, [projects, current]] = await checkThenRead(
    loadClientWork(id),
    Promise.all([listClientProjects(id), listCurrentCycleMeters(today, id)]),
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
          <Suspense fallback={<NewProjectButtonSkeleton />}>
            <NewProject clientId={client.id} clientName={client.name} today={today} />
          </Suspense>
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

/**
 * New project with its setup (v7.0): the stage presets, the templates and the project fields,
 * read after the client's check, so the tab's first wave stays at six. The button is the same in
 * its fallback's place.
 */
async function NewProject({
  clientId,
  clientName,
  today,
}: {
  clientId: string;
  clientName: string;
  today: string;
}) {
  const [presets, templates, definitions] = await Promise.all([
    listStagePresets(),
    listProjectTemplates(),
    listDefinitions("project"),
  ]);
  return (
    <NewProjectButton
      clientId={clientId}
      clientName={clientName}
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
  );
}

/** New project's place while its setup streams: the loading screen's own button shape. */
function NewProjectButtonSkeleton() {
  return <Skeleton aria-hidden className="h-11 w-36 rounded-lg md:h-8" />;
}
