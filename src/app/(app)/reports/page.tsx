import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";

import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";

import { parsePeriod } from "@/modules/reports";
import { todayIST } from "@/core/time";

import { AdminReport } from "./admin-report";
import { REPORTS_DESCRIPTION } from "./copy";

export const metadata: Metadata = { title: "Reports" };

/** The reports the Owner can open today (kickoff 3b decision 30: Month is the first; 6.5: End of day). */
const OWNER_REPORTS = [
  {
    key: "month",
    label: "Month",
    href: "/reports/month",
    description:
      "Everyone's month: days worked, additional leave, comp leave, overtime and expenses to pay.",
  },
  {
    key: "end-of-day",
    label: "End of day",
    href: "/reports/end-of-day",
    description:
      "Each day's attendance, decisions, tasks, approvals and tomorrow's events: today live, every day before saved.",
  },
] as const;

/**
 * Owner reports (task 9.3) and the Admin's scoped operational reports share this route. Since
 * 3b.4 the Owner's first real report is here: **Month** (the team's month summary,
 * `attendance.view_all`), a row that drills into it, in the shape of the Settings list. Since 6.3
 * an Admin reads their **work report** (`reports.scoped`, `AdminReport`).
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, params] = await Promise.all([
    requirePermission(["reports.all", "reports.scoped"]),
    searchParams,
  ]);
  if (!can(viewer.role, "attendance.view_all")) {
    return <AdminReport viewer={viewer} period={parsePeriod(params, todayIST())} />;
  }
  return (
    <>
      <PageHeader title="Reports" description={REPORTS_DESCRIPTION} help={REPORTS_DESCRIPTION} />
      <ul
        data-slot="reports-list"
        className="border-border divide-border divide-y overflow-hidden rounded-lg border md:max-w-2xl"
      >
        {OWNER_REPORTS.map((report) => (
          <li key={report.key}>
            <DrillLink
              href={report.href}
              data-slot="report-link"
              className="active:bg-muted/60 focus-visible:ring-ring flex min-h-14 items-center gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{report.label}</span>
                <span className="text-muted-foreground text-sm">{report.description}</span>
              </span>
              <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </DrillLink>
          </li>
        ))}
      </ul>
    </>
  );
}
