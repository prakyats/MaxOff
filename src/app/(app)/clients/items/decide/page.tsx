import type { Metadata } from "next";

import { startEarly } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { listItemRows, shortDate, sortItemRows } from "@/modules/client-work";
import { CarryDecider, type DecideGroup } from "@/modules/client-work/components/carry-decider";

export const metadata: Metadata = { title: "Unfinished items" };

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
  const rows = sortItemRows(await reads);
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
        title="Unfinished items"
        description={DESCRIPTION}
        help={DESCRIPTION}
        back={{ href: "/today", label: "Today" }}
      />
      <div className="max-w-3xl">
        <CarryDecider groups={ordered} />
      </div>
    </>
  );
}
