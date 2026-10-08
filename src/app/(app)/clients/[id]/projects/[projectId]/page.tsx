import { ChevronLeftIcon, ChevronRightIcon, HistoryIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CustomFieldsView } from "@/core/custom-fields/components/custom-fields-view";
import { listDefinitions } from "@/core/custom-fields/server";
import { checkThenRead } from "@/core/lib/start-early";
import { cn } from "@/core/lib/utils";
import { can } from "@/core/permissions";
import { formatIST, todayIST } from "@/core/time";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { ViewLink } from "@/core/ui/composites/view-link";
import {
  activeStages,
  currentCycle,
  cycleEnded,
  describeProjectActivity,
  getProject,
  itemView,
  listBlueprints,
  listCycles,
  listCyclesById,
  listItemRows,
  listItems,
  listProjectActivity,
  listReviews,
  listStages,
  listTicks,
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
import { ProjectMenu } from "@/modules/client-work/components/project-menu";
import { RecordReadReceipt } from "@/modules/notifications-center";

import { assertClientId, loadClientWork, loadPeople } from "../../client";

export const metadata: Metadata = { title: "Project" };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A project's page (7.3; PRODUCT §4.5, WORKFLOWS §5, kickoff 7 decisions 3, 6–9, 12, 14, 16, 18,
 * 26; amendments A and C; Q5–Q7), a drill-down from the client's Projects tab, and where every
 * client-work notification lands (`/clients/<client>/projects/<project>`, 7A mechanics (4)).
 * `projects.manage` on a visible client: the Owner, the client's Admin (another Admin's client is
 * a 404, Crew are sent to /forbidden). **First glance** answers "where is this cycle?": the repeat
 * and state, the cycle with its pager (a view control: `?cycle=` replaces, never history), the
 * progress line "9/12 done · 8/12 approved · 1 closed", an ended cycle's "decide N unfinished
 * items", then the items with their one action. Everything else is under ⋯ (details, stages,
 * item list, next cycle, complete / cancel / reopen) or one tap deeper (the item sheet). The
 * Owner approves items here (his Approvals take none: issue #56 Q1). No money (amendment C).
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
  const [ticks, reviews, origins, unfinished, projectFields, entries] = await Promise.all([
    listTicks(itemIds),
    listReviews(itemIds),
    listCyclesById(originIds),
    listItemRows({ states: ["open", "done"], projectId }),
    listDefinitions("project"),
    listProjectActivity(projectId, itemIds),
  ]);

  const working = project.state === "open" || project.state === "in_progress";
  const canManage = can(viewer.role, "projects.manage");
  const permissions = {
    manage: canManage && working,
    tick: can(viewer.role, "items.tick") && working,
    approve: can(viewer.role, "items.approve") && working,
  };
  const active = activeStages(stages);
  const views = items.map((item) =>
    itemView(item, {
      today,
      names: people.names,
      ticks,
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
  const lines = entries.flatMap((entry) => {
    const line = describeProjectActivity(entry, {
      names: people.names,
      items: Object.fromEntries(items.map((item) => [item.id, item.title])),
      stages: Object.fromEntries(stages.map((stage) => [stage.id, stage.name])),
    });
    return line ? [line] : [];
  });
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
        menu={
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
            }))}
            definitions={definitions}
            canManage={canManage}
            canComplete={can(viewer.role, "projects.complete")}
            unfinished={unfinished.length}
            nextCycleLabel={nextCycle?.label ?? null}
          />
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
            stages={active.map((stage) => ({ id: stage.id, name: stage.name }))}
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

        <section aria-labelledby="project-activity" className="flex flex-col gap-2">
          <h2 id="project-activity" className="text-sm font-medium">
            Activity
          </h2>
          {lines.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <HistoryIcon className="size-4" aria-hidden />
              Nothing recorded yet.
            </p>
          ) : (
            <ol
              aria-label="Activity"
              data-slot="project-activity"
              className="border-border divide-border bg-card divide-y rounded-lg border"
            >
              {lines.map((line) => (
                <li key={line.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                  <span className="break-words">
                    <span className="font-medium">{line.actor}</span> {line.text}
                  </span>
                  {line.note ? (
                    <span className="text-muted-foreground break-words">{line.note}</span>
                  ) : null}
                  <span className={cn("text-muted-foreground text-xs")}>
                    {formatIST(line.at, "d MMM yyyy, h:mm a")}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
