import { ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";

import { cn } from "@/core/lib/utils";
import { CustomFieldsView } from "@/core/custom-fields/components/custom-fields-view";
import { listDefinitions } from "@/core/custom-fields/server";
import { checkThenRead, startEarly } from "@/core/lib/start-early";
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
  cycleExtras,
  extrasCycles,
  extrasQuestion,
  getProject,
  getProjectTemplateName,
  itemListPeriods,
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
  needsYouPills,
  nextStartable,
  cycleMeter,
  PROJECT_STATE_LABELS,
  RECURRENCE_LABELS,
  scheduleText,
  shortDate,
  sortCycles,
  sortItems,
} from "@/modules/client-work";
import { CycleItems } from "@/modules/client-work/components/cycle-items";
import { CycleProgress } from "@/modules/client-work/components/cycle-progress";
import { KeepExtrasPrompt } from "@/modules/client-work/components/keep-extras-prompt";
import { ProjectActivityButton } from "@/modules/client-work/components/project-activity";
import { ProjectMenu } from "@/modules/client-work/components/project-menu";
import { RecordReadReceipt } from "@/modules/notifications-center";
import { listContacts } from "@/modules/clients";
import { listStagePresets } from "@/modules/settings";

import { assertClientId, loadClientWork, loadPeople } from "../../client";
import { PROJECT_ORIGINS } from "./back";

/** The page's project read, shared with its tab title in one request. */
const readProject = cache(getProject);

/** The tab names the project ("Monthly reels · MaxOff"), from the page's own reads (cached). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; projectId: string }>;
}): Promise<Metadata> {
  const { id, projectId } = await params;
  if (!ID.test(projectId)) return { title: "Project" };
  const { client } = await loadClientWork(id);
  const project = await readProject(projectId);
  return { title: project && project.clientId === client.id ? project.name : "Project" };
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A project's page (7.3; PRODUCT §4.5, WORKFLOWS §5, kickoff 7 decisions 3, 7–9, 12, 14, 16, 18,
 * 26; amendments A, C and D; Q5–Q7), a drill-down from the client's Projects tab, and where every
 * client-work notification lands (`/clients/<client>/projects/<project>`, 7A mechanics (4)).
 * `projects.manage` on a visible client: the Owner, the client's Admin (another Admin's client is
 * a 404, Crew are sent to /forbidden). **First glance** answers "where is this cycle?": the repeat
 * and state, the cycle with its pager (a view control: `?cycle=` replaces, never history), its
 * progress ring (6b.11 (5): every stage ticked across its deliverables, the pace from the planned
 * dates, the 100% moment), an ended cycle's "decide N unfinished items", then the deliverables, open
 * ones first, with their one action (Mark done, which is the approval since D3). Everything else is
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
  // The reads keyed by the URL alone start in the first wave (§19, P2): the project's unfinished
  // items and its custom fields, and the items of the cycle the pager asked for (`?cycle=`, every
  // tap on it), which are dropped when that cycle is not this project's. Only the current cycle's
  // items (which cycle is current needs the cycles) and what is keyed by the items stay later.
  const askedItems = cycleParam && ID.test(cycleParam) ? listItems(cycleParam) : null;
  const unfinishedRead = listItemRows({ states: ["open", "done"], projectId });
  const fieldsRead = listDefinitions("project");
  // Details' Client contact and Template cells (the v1.8 sample), keyed by the URL alone, so they
  // join the first wave; RLS decides what the viewer reads (no money in either).
  const contactsRead = listContacts(id);
  const templateRead = getProjectTemplateName(projectId);
  startEarly(
    ...(askedItems ? [askedItems] : []),
    unfinishedRead,
    fieldsRead,
    contactsRead,
    templateRead,
  );
  const [{ viewer, client }, [project, cycles, stages, blueprints, people, presetRows]] =
    await checkThenRead(
      loadClientWork(id),
      Promise.all([
        readProject(projectId),
        listCycles([projectId]),
        listStages(projectId),
        listBlueprints(projectId),
        loadPeople(),
        listStagePresets(),
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

  const working = project.state === "open" || project.state === "in_progress";
  const canManage = can(viewer.role, "projects.manage");
  // 6b.16 (d): the cycle whose extras are asked about at the month's end (whichever is shown):
  // the month ending or the one just ended, the latest that has extras.
  const asking = working && canManage ? extrasCycles(project.recurrence, cycles, today) : [];
  const [items, ...askingItems] = await Promise.all([
    chosen
      ? (askedItems && chosen.id === cycleParam ? askedItems : listItems(chosen.id)).then(sortItems)
      : Promise.resolve([]),
    ...asking.map((cycle) =>
      cycle.id === chosen?.id ? Promise.resolve(null) : listItems(cycle.id),
    ),
  ]);
  const listTitles = blueprints.filter((line) => !line.archived).map((line) => line.title);
  const extrasOf = asking
    .map((cycle, index) => ({
      cycle,
      extras: cycleExtras(cycle.id, askingItems[index] ?? items, listTitles),
    }))
    .find((entry) => entry.extras.length > 0);
  const itemIds = items.map((item) => item.id);
  const originIds = [
    ...new Set(
      items.flatMap((item) => (item.originCycleId !== item.cycleId ? [item.originCycleId] : [])),
    ),
  ];
  const [itemStages, reviews, origins, unfinished, projectFields, changes, contacts, templateName] =
    await Promise.all([
      listItemStages(itemIds),
      listReviews(itemIds),
      listCyclesById(originIds),
      unfinishedRead,
      fieldsRead,
      listLastChanges(itemIds),
      contactsRead,
      templateRead,
    ]);
  // The primary contact, else the first active one (the client's Contacts order).
  const contact =
    contacts.find((row) => row.isPrimary && row.archivedAt === null) ??
    contacts.find((row) => row.archivedAt === null) ??
    null;

  const permissions = {
    manage: canManage && working,
    tick: can(viewer.role, "items.tick") && working,
    // Amendment D3: items.approve is the send-back (the Owner) or reopen (the client's Admin).
    reopen: can(viewer.role, "items.approve") && working,
    owner: viewer.role === "owner",
  };
  const active = activeStages(stages);
  const presets = presetRows
    .filter((preset) => !preset.archived)
    .map((preset) => ({ id: preset.id, name: preset.name, stages: preset.stages }));
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
  // Amendment D4: the Item list names the period a new line starts from and the running cycle.
  const itemList = itemListPeriods(
    project.recurrence,
    today,
    cycles,
    working && client.state !== "inactive",
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
        back={{ href: `/clients/${client.id}/projects`, label: client.name, from: PROJECT_ORIGINS }}
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
                groupLabel: stage.groupLabel,
                groupPosition: stage.groupPosition,
              }))}
              blueprints={sortItems(blueprints.filter((row) => !row.archived)).map((row) => ({
                id: row.id,
                name: row.title,
                position: row.position,
                stageGroups: row.stageGroups,
              }))}
              presets={presets}
              definitions={definitions}
              canManage={canManage}
              canComplete={can(viewer.role, "projects.complete")}
              unfinished={unfinished.length}
              nextCycleLabel={nextCycle?.label ?? null}
              itemList={itemList}
              schedule={
                chosen
                  ? scheduleText({ projectName: project.name, cycleLabel: chosen.label, items })
                  : null
              }
            />
          </>
        }
      />
      {/* One page grid (L1, the v1.8 sample (G)): every section shares the deliverables' width. */}
      <div className="flex min-w-0 flex-col gap-4" data-slot="project-page">
        <div className="flex min-w-0 flex-col gap-2" data-slot="project-glance">
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
            // Months as tabs (the v1.8 sample, 08): the previous · this · the next cycle in one
            // segmented control. A view control: each tab replaces the address (`?cycle=`),
            // never adds history (§14.2).
            <nav
              aria-label="Cycles"
              className="bg-muted rounded-control grid grid-cols-3 gap-1 p-1"
              data-slot="cycle-switcher"
            >
              {previous ? (
                <ViewLink
                  href={cycleHref(previous.id)}
                  scroll={false}
                  aria-label={`Previous: ${previous.label ?? "cycle"}`}
                  className={CYCLE_TAB}
                  data-slot="cycle-tab"
                >
                  <span className="max-w-full truncate">
                    {tabLabel(previous.label, chosen.label)}
                  </span>
                </ViewLink>
              ) : (
                <span aria-hidden className={CYCLE_TAB} />
              )}
              <span
                aria-current="page"
                className={cn(CYCLE_TAB, "bg-background text-foreground shadow-raised")}
                data-slot="cycle-tab"
              >
                <span className="max-w-full truncate" data-slot="cycle-label">
                  {chosen.label ?? "The project's deliverables"}
                </span>
              </span>
              {next ? (
                <ViewLink
                  href={cycleHref(next.id)}
                  scroll={false}
                  aria-label={`Next: ${next.label ?? "cycle"}`}
                  className={CYCLE_TAB}
                  data-slot="cycle-tab"
                >
                  <span className="max-w-full truncate">{tabLabel(next.label, chosen.label)}</span>
                </ViewLink>
              ) : (
                <span aria-hidden className={CYCLE_TAB} />
              )}
            </nav>
          ) : (
            <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-3 text-sm">
              No cycle yet. The current period&apos;s cycle starts once the client is Active.
            </p>
          )}
          {chosen ? (
            <CycleProgress
              cycleId={chosen.id}
              label={chosen.label}
              meter={cycleMeter(views, today)}
              cancelledAt={project.state === "cancelled" ? project.cancelledAt : null}
              // Owner and Admin only (the page's roles); never Crew, who never see client work.
              needsYou={working && canManage ? needsYouPills(views, today) : null}
            />
          ) : null}
          {toDecide > 0 && can(viewer.role, "cycles.carry_decide") ? (
            <DrillLink
              href={`/clients/items/decide?project=${project.id}`}
              data-slot="cycle-decide"
              className="border-border bg-card flex min-h-11 items-center gap-3 rounded-lg border px-4 py-2 text-sm font-medium"
            >
              <span className="min-w-0 flex-1">
                {chosen?.label} has ended: {toDecide} unfinished{" "}
                {toDecide === 1 ? "deliverable" : "deliverables"} to decide
              </span>
              <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </DrillLink>
          ) : null}
          {extrasOf ? (
            <KeepExtrasPrompt
              key={extrasOf.cycle.id}
              cycleId={extrasOf.cycle.id}
              question={extrasQuestion(project.recurrence, extrasOf.cycle.label)}
              titles={extrasOf.extras.map((item) => item.title)}
              from={itemList?.from ?? null}
            />
          ) : null}
        </div>

        {chosen ? (
          <CycleItems
            cycleId={chosen.id}
            items={views}
            permissions={permissions}
            canAdd={working && !ended && client.state !== "inactive"}
            defaultStages={active.length}
            presets={presets}
            openItemId={items.some((item) => item.id === itemParam) ? (itemParam ?? null) : null}
            // The Keep-extras card's solid Yes owns the screen's one solid button while it shows.
            solidAllowed={!extrasOf}
          />
        ) : null}

        {/* Details as the approved sample's full-width field grid (owner 2026-10-21): a cell a
            field, its small label over its value; the project fields follow in the same card. */}
        <section aria-labelledby="project-details" className="flex min-w-0 flex-col gap-2">
          <h2 id="project-details" className="text-sm font-medium">
            Details
          </h2>
          <div className="border-border bg-card overflow-hidden rounded-lg border text-sm">
            <dl
              data-slot="project-details-grid"
              className="divide-border grid grid-cols-[repeat(auto-fit,minmax(min(11rem,100%),1fr))] divide-x"
            >
              <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3" data-slot="detail-contact">
                <dt className="text-muted-foreground text-xs">Client contact</dt>
                <dd className={cn("break-words", !contact && "text-muted-foreground")}>
                  {contact ? contact.name : "Not added"}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
                <dt className="text-muted-foreground text-xs">Repeats</dt>
                <dd>{RECURRENCE_LABELS[project.recurrence]}</dd>
              </div>
              {project.deliveryDate ? (
                <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
                  <dt className="text-muted-foreground text-xs">Delivery date</dt>
                  <dd className="tabular-nums">{shortDate(project.deliveryDate)}</dd>
                </div>
              ) : null}
              {/* A template the viewer may not read (RLS) leaves the cell out. */}
              {templateName || !project.templateId ? (
                <div
                  className="flex min-w-0 flex-col gap-0.5 px-4 py-3"
                  data-slot="detail-template"
                >
                  <dt className="text-muted-foreground text-xs">Template</dt>
                  <dd className={cn("break-words", !templateName && "text-muted-foreground")}>
                    {templateName ?? "None"}
                  </dd>
                </div>
              ) : null}
              <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
                <dt className="text-muted-foreground text-xs">Notes</dt>
                <dd
                  className={cn(
                    "break-words whitespace-pre-wrap",
                    !project.description && "text-muted-foreground",
                  )}
                >
                  {project.description ?? "Not added"}
                </dd>
              </div>
            </dl>
            {definitions.length > 0 ? (
              <CustomFieldsView
                definitions={projectFields}
                values={project.customFields}
                className="border-border border-t px-4 py-3"
              />
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

/** A month tab: the segmented control's cell, 44 px, one line (§14.1). */
const CYCLE_TAB =
  "pressable text-muted-foreground focus-visible:ring-ring rounded-control flex min-h-11 min-w-0 items-center justify-center px-2 text-sm font-medium outline-none focus-visible:ring-2";

/**
 * A neighbouring tab's label: the cycle's own, without the year it shares with the chosen one
 * ("September" beside "October 2026", as in the sample), so three tabs fit a 375 px phone.
 */
function tabLabel(label: string | null, chosenLabel: string | null): string {
  if (!label) return "Cycle";
  const year = /\s(\d{4})$/.exec(chosenLabel ?? "")?.[1];
  return year && label.endsWith(` ${year}`) ? label.slice(0, -5) : label;
}
