import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CustomFieldsView } from "@/core/custom-fields/components/custom-fields-view";
import { listDefinitions } from "@/core/custom-fields/server";
import { checkThenRead } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { ViewLink } from "@/core/ui/composites/view-link";
import {
  activeStages,
  currentCycle,
  cycleEnded,
  getProject,
  itemView,
  lastChangeOf,
  listBlueprints,
  listCycles,
  listCyclesById,
  listItemRows,
  listItems,
  listItemStages,
  listLastChanges,
  listReviews,
  listStages,
  nextStartable,
  PROJECT_STATE_LABELS,
  progressLine,
  progressOf,
  RECURRENCE_LABELS,
  shortDate,
  sortCycles,
  sortItems,
} from "@/modules/client-work";
import { CycleItems } from "@/modules/client-work/components/cycle-items";
import { ProjectActivityButton } from "@/modules/client-work/components/project-activity";
import { ProjectMenu } from "@/modules/client-work/components/project-menu";
import { RecordReadReceipt } from "@/modules/notifications-center";

import { assertClientId, loadClientWork, loadPeople } from "../../client";

export const metadata: Metadata = { title: "Project" };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A project's page (7.3; PRODUCT §4.5, WORKFLOWS §5, kickoff 7 decisions 3, 7–9, 12, 14, 16, 18,
 * 26; amendments A, C and D; Q5–Q7), a drill-down from the client's Projects tab, and where every
 * client-work notification lands (`/clients/<client>/projects/<project>`, 7A mechanics (4)).
 * `projects.manage` on a visible client: the Owner, the client's Admin (another Admin's client is
 * a 404, Crew are sent to /forbidden). **First glance** answers "where is this cycle?": the repeat
 * and state, the cycle with its pager (a view control: `?cycle=` replaces, never history), the
 * progress line "9/12 done · 1 closed", an ended cycle's "decide N unfinished items", then the
 * items with their one action (Mark done, which is the approval since D3). Everything else is
 * under ⋯ (details, default stages, item list, next cycle, complete / cancel / reopen), the
 * header's **Activity** (the project's history in a panel, paged; never inline) or one tap deeper
 * (the item sheet: its own stages, send back / reopen, its last change and history). No money
 * (amendment C).
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; projectId: string }>;
  searchParams: Promise<{ cycle?: string; item?: string }>;
}) {
  const [{ id, projectId }, { cycle: cycleParam, item: itemParam }] = await Promise.all([
    params,
    searchParams,
  ]);
  assertClientId(id);
  if (!ID.test(projectId)) notFound();
  const [{ viewer, client }, [project, cycles, stages, blueprints, people]] = await checkThenRead(
    loadClientWork(id),
    Promise.all([
      getProject(projectId),
      listCycles([projectId]),
      listStages(projectId),
      listBlueprints(projectId),
      loadPeople(),
    ]),
  );
  if (!project || project.clientId !== client.id) notFound();

  const today = todayIST();
  const ordered = sortCycles(cycles);
  const chosen =
    ordered.find((cycle) => cycle.id === cycleParam) ?? currentCycle(ordered, today) ?? null;
  const index = chosen ? ordered.indexOf(chosen) : -1;
  const previous = index > 0 ? ordered[index - 1] : undefined;
  const next = index >= 0 ? ordered[index + 1] : undefined;

  const items = chosen ? sortItems(await listItems(chosen.id)) : [];
  const itemIds = items.map((item) => item.id);
  const originIds = [
    ...new Set(
      items.flatMap((item) => (item.originCycleId !== item.cycleId ? [item.originCycleId] : [])),
    ),
  ];
  const [itemStages, reviews, origins, unfinished, projectFields, changes] = await Promise.all([
    listItemStages(itemIds),
    listReviews(itemIds),
    listCyclesById(originIds),
    listItemRows({ states: ["open", "done"], projectId }),
    listDefinitions("project"),
    listLastChanges(itemIds),
  ]);

  const working = project.state === "open" || project.state === "in_progress";
  const canManage = can(viewer.role, "projects.manage");
  const permissions = {
    manage: canManage && working,
    tick: can(viewer.role, "items.tick") && working,
    // Amendment D3: items.approve is the send-back (the Owner) or reopen (the client's Admin).
    reopen: can(viewer.role, "items.approve") && working,
    owner: viewer.role === "owner",
  };
  const active = activeStages(stages);
  const activityContext = {
    names: people.names,
    items: Object.fromEntries(items.map((item) => [item.id, item.title])),
    stages: Object.fromEntries(stages.map((stage) => [stage.id, stage.name])),
  };
  const lastChanges = Object.fromEntries(
    changes.flatMap((entry) => {
      const change = lastChangeOf(entry, activityContext);
      return change ? [[entry.entityId, change] as const] : [];
    }),
  );
  const views = items.map((item) =>
    itemView(item, {
      today,
      names: people.names,
      ownerId: people.ownerId,
      stages: itemStages,
      lastChanges,
      reviews,
      cycleLabels: Object.fromEntries(origins.map((cycle) => [cycle.id, cycle.label])),
      cycleLabel: chosen?.label ?? null,
    }),
  );
  const ended = chosen ? cycleEnded(chosen, today) : false;
  const toDecide = ended ? items.filter((item) => item.state === "open").length : 0;
  const nextCycle = nextStartable(
    project.recurrence,
    today,
    cycles.map((cycle) => cycle.periodStart),
  );
  const definitions = projectFields.filter((definition) => definition.archivedAt === null);
  const base = `/clients/${client.id}/projects/${project.id}`;
  const cycleHref = (cycleId: string) => `${base}?cycle=${cycleId}`;
  const meta = [
    client.name,
    RECURRENCE_LABELS[project.recurrence],
    project.deliveryDate ? `Delivery ${shortDate(project.deliveryDate)}` : null,
  ].filter(Boolean);

  return (
    <>
      <Suspense fallback={null}>
        <RecordReadReceipt entity="projects" id={project.id} />
      </Suspense>
      <PageHeader
        title={project.name}
        description={meta.join(" · ")}
        back={{ href: `/clients/${client.id}/projects`, label: client.name }}
        // Two header buttons (Activity and ⋯) beside the bell: at very large text (200%) the bell
        // wraps to a second row rather than pushing the bar past the screen's edge.
        className="flex-wrap"
        menu={
          <>
            <ProjectActivityButton projectId={project.id} />
            <ProjectMenu
              project={{
                id: project.id,
                name: project.name,
                description: project.description,
                recurrence: project.recurrence,
                state: project.state,
                deliveryDate: project.deliveryDate,
                customFields: project.customFields,
              }}
              stages={active.map((stage) => ({
                id: stage.id,
                name: stage.name,
                position: stage.position,
              }))}
              blueprints={sortItems(blueprints.filter((row) => !row.archived)).map((row) => ({
                id: row.id,
                name: row.title,
                position: row.position,
                stages: row.stages,
              }))}
              definitions={definitions}
              canManage={canManage}
              canComplete={can(viewer.role, "projects.complete")}
              unfinished={unfinished.length}
              nextCycleLabel={nextCycle?.label ?? null}
            />
          </>
        }
      />
      <div className="flex max-w-3xl min-w-0 flex-col gap-4" data-slot="project-page">
        <div className="flex flex-col gap-2" data-slot="project-glance">
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <StatusBadge status={project.state} label={PROJECT_STATE_LABELS[project.state]} />
            <span className="md:hidden">{meta.join(" · ")}</span>
          </p>
          {!working ? (
            <p
              role="status"
              data-slot="project-read-only"
              className="border-border bg-muted/50 rounded-lg border px-3 py-2.5 text-sm"
            >
              {project.state === "completed" ? "Completed" : "Cancelled"}: read-only.
              {project.cancelledReason ? ` ${project.cancelledReason}.` : ""}{" "}
              <span className="text-muted-foreground">
                {can(viewer.role, "projects.complete")
                  ? "Reopen it from ⋯ to change anything."
                  : "Only the Owner or the client's Admin can reopen it."}
              </span>
            </p>
          ) : null}
          {chosen ? (
            <div
              className="border-border bg-card flex min-h-11 items-center gap-1 rounded-lg border px-1"
              data-slot="cycle-switcher"
            >
              {previous ? (
                <ViewLink
                  href={cycleHref(previous.id)}
                  scroll={false}
                  aria-label={`Previous: ${previous.label ?? "cycle"}`}
                  className="flex size-11 items-center justify-center rounded-md"
                  icon
                >
                  <ChevronLeftIcon className="size-5" aria-hidden />
                </ViewLink>
              ) : (
                <span aria-hidden className="size-11 shrink-0" />
              )}
              <div className="flex min-w-0 flex-1 flex-col items-center py-1 text-center">
                <span className="text-sm font-medium break-words" data-slot="cycle-label">
                  {chosen.label ?? "The project's items"}
                </span>
                <span className="text-muted-foreground text-xs" data-slot="cycle-progress">
                  {progressLine(progressOf(items))}
                </span>
              </div>
              {next ? (
                <ViewLink
                  href={cycleHref(next.id)}
                  scroll={false}
                  aria-label={`Next: ${next.label ?? "cycle"}`}
                  className="flex size-11 items-center justify-center rounded-md"
                  icon
                >
                  <ChevronRightIcon className="size-5" aria-hidden />
                </ViewLink>
              ) : (
                <span aria-hidden className="size-11 shrink-0" />
              )}
            </div>
          ) : (
            <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-3 text-sm">
              No cycle yet. The current period&apos;s cycle starts once the client is Active.
            </p>
          )}
          {toDecide > 0 && can(viewer.role, "cycles.carry_decide") ? (
            <DrillLink
              href={`/clients/items/decide?project=${project.id}`}
              data-slot="cycle-decide"
              className="border-border bg-card flex min-h-11 items-center gap-3 rounded-lg border px-4 py-2 text-sm font-medium"
            >
              <span className="min-w-0 flex-1">
                {chosen?.label} has ended: {toDecide} unfinished {toDecide === 1 ? "item" : "items"}{" "}
                to decide
              </span>
              <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </DrillLink>
          ) : null}
        </div>

        {chosen ? (
          <CycleItems
            cycleId={chosen.id}
            items={views}
            permissions={permissions}
            canAdd={working && !ended && client.state !== "inactive"}
            openItemId={items.some((item) => item.id === itemParam) ? (itemParam ?? null) : null}
          />
        ) : null}

        {project.description || definitions.length > 0 ? (
          <section aria-labelledby="project-details" className="flex flex-col gap-2">
            <h2 id="project-details" className="text-sm font-medium">
              Details
            </h2>
            <div className="border-border bg-card flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm">
              {project.description ? (
                <p className="break-words whitespace-pre-wrap">{project.description}</p>
              ) : null}
              <CustomFieldsView definitions={projectFields} values={project.customFields} />
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
