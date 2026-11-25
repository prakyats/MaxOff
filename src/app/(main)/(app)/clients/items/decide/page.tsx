import { ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";

import { startEarly } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";
import { OnHoldBadge } from "@/core/ui/composites/status-badge";
import { listItemRows, shortDate, sortItemRows, splitHeldItems } from "@/modules/client-work";
import { CarryDecider, type DecideGroup } from "@/modules/client-work/components/carry-decider";

export const metadata: Metadata = { title: "Unfinished deliverables" };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESCRIPTION = "Carry forward, leave pending or close what an ended cycle left open.";

/**
 * The carry screen (7.4; PRODUCT §4.5, WORKFLOWS §5.3, §5.4 items 11–13, 16, amendment C, issue #56
 * Q2; PERMISSIONS: `cycles.carry_decide`): the open items of every ended cycle the viewer may decide
 * (the Owner any client, an Admin their clients, by RLS), grouped by project and cycle, oldest
 * cycle first; `?project=` narrows it to one project (the project page's "decide N unfinished
 * items"). Where the Admin's Needs you "N unfinished items to decide" and their morning prompt lead.
 */
export default async function DecidePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const today = todayIST();
  const { project } = await searchParams;
  const projectId = project && ID.test(project) ? project : undefined;
  const reads = listItemRows({
    states: ["open"],
    cycleEndedBefore: today,
    ...(projectId ? { projectId } : {}),
  });
  startEarly(reads);
  await requirePermission("cycles.carry_decide");
  // v1.9 W8: a held project's ended months wait for its resume (no carry decision while held).
  const { active: rows, held } = splitHeldItems(sortItemRows(await reads));
  const heldProjects = [
    ...new Map(
      held.map((row) => [
        row.projectId,
        {
          href: `/clients/${row.clientId}/projects/${row.projectId}`,
          name: row.projectName,
          client: row.clientName,
          count: held.filter((other) => other.projectId === row.projectId).length,
        },
      ]),
    ).values(),
  ];
  const groups = new Map<string, DecideGroup>();
  const ends = new Map<string, string>();
  for (const row of rows) {
    let group = groups.get(row.cycleId);
    if (!group) {
      group = {
        cycleId: row.cycleId,
        href: `/clients/${row.clientId}/projects/${row.projectId}?cycle=${row.cycleId}`,
        projectName: row.projectName,
        clientName: row.clientName,
        cycleLabel: row.cycleLabel ?? "",
        recurrence: row.recurrence,
        inactive: row.clientState === "inactive",
        notActive: row.clientState !== "active",
        rows: [],
      };
      groups.set(row.cycleId, group);
      ends.set(row.cycleId, row.cyclePeriodEnd ?? "");
    }
    group.rows.push({
      id: row.id,
      title: row.title,
      planned: row.plannedDate ? `Planned ${shortDate(row.plannedDate)}` : null,
      pending: row.carryDecision === "leave_pending",
    });
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      (ends.get(a.cycleId) ?? "").localeCompare(ends.get(b.cycleId) ?? "") ||
      a.projectName.localeCompare(b.projectName),
  );

  return (
    <>
      <PageHeader
        title="Unfinished deliverables"
        description={DESCRIPTION}
        help={DESCRIPTION}
        back={{ href: "/today", label: "Today" }}
      />
      <div className="flex min-w-0 flex-col gap-4">
        {heldProjects.length > 0 ? (
          <ul
            aria-label="On hold"
            data-slot="decide-on-hold"
            className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border"
          >
            {heldProjects.map((project) => (
              <li key={project.href}>
                <DrillLink
                  href={project.href}
                  className="focus-visible:ring-ring flex min-h-14 items-center gap-3 px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium break-words">
                      {project.name} · {project.client}
                    </span>
                    <span className="text-muted-foreground text-xs break-words">
                      {project.count === 1
                        ? "1 unfinished deliverable waits: its resume settles it."
                        : `${project.count} unfinished deliverables wait: its resume settles them.`}
                    </span>
                  </span>
                  <OnHoldBadge className="shrink-0" />
                  <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                </DrillLink>
              </li>
            ))}
          </ul>
        ) : null}
        <CarryDecider groups={ordered} />
      </div>
    </>
  );
}
