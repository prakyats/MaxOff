import { ArrowRightIcon, FileBarChart2Icon } from "lucide-react";
import type { Metadata } from "next";

import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Reports" };

const DESCRIPTION = "Reports on the team and the work. More arrive with the end-of-day reports.";

/** The reports the Owner can open today (kickoff 3b decision 30: Month is the first). */
const OWNER_REPORTS = [
  {
    key: "month",
    label: "Month",
    href: "/reports/month",
    description:
      "Everyone's month: days worked, additional leave, comp leave, overtime and expenses to pay.",
  },
] as const;

/**
 * Owner reports (task 9.3) and the Admin's scoped operational reports (6.x) share this route.
 * Since 3b.4 the Owner's first real report is here: **Month** (the team's month summary,
 * `attendance.view_all`), a row that drills into it, in the shape of the Settings list. An Admin
 * keeps the placeholder until their reports arrive.
 */
export default async function ReportsPage() {
  const viewer = await requirePermission(["reports.all", "reports.scoped"]);
  if (!can(viewer.role, "attendance.view_all")) {
    return (
      <PlaceholderPage
        title="Reports"
        description="End-of-day reports, week and month views and exports."
        task="6.5 (end of day) and 9.3 (reports)"
        icon={FileBarChart2Icon}
      />
    );
  }
  return (
    <>
      <PageHeader title="Reports" description={DESCRIPTION} help={DESCRIPTION} />
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
