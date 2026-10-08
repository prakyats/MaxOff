import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";

import { cn } from "@/core/lib/utils";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";

import { parsePeriod } from "@/modules/reports";
import { todayIST } from "@/core/time";

import { AdminReport } from "./admin-report";
import { REPORTS_DESCRIPTION } from "./copy";
import {
  OWNER_REPORTS,
  REPORT_LINES_CLASS,
  REPORT_ROW_CLASS,
  REPORTS_LIST_CLASS,
} from "./list-row";

export const metadata: Metadata = { title: "Reports" };

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
      <ul data-slot="reports-list" className={REPORTS_LIST_CLASS}>
        {OWNER_REPORTS.map((report) => (
          <li key={report.key}>
            <DrillLink
              href={report.href}
              data-slot="report-link"
              className={cn(
                REPORT_ROW_CLASS,
                "active:bg-muted/60 focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset",
              )}
            >
              <span className={REPORT_LINES_CLASS}>
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
