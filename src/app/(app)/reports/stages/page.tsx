import type { Metadata } from "next";
import { Suspense } from "react";

import { startEarly } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  CARD_GRID_CLASS,
  listStageDurations,
  OWNER_CUSTOM_MAX_DAYS,
  parsePeriod,
  ReportHeading,
  type StageFact,
  StageOverall,
  StageProjectCard,
  stageReport,
} from "@/modules/reports";

import { STAGES_DESCRIPTION } from "../copy";
import { CustomRange } from "../custom-range";
import { PeriodControls } from "../period-controls";
import { StagesSkeleton } from "./stages-skeleton";

export const metadata: Metadata = { title: "Stage durations" };

const BASE = "/reports/stages";

/**
 * The Owner's stage durations (v3.0, 9.3; kickoff 9 decision 14; the refresh's R7: grouped by
 * stage name, ignoring case, so "Edit" and "edit" are one stage, and groups and revision rounds are
 * just stages): for the deliverable stages ticked in the period, the median and longest time from
 * the stage before (or the cycle's start), first across every project by name, then each project's
 * own, slowest first. One read (`report_stage_durations()`), streamed behind its skeleton.
 */
export default async function StagesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requirePermission("reports.all"), searchParams]);
  const today = todayIST();
  const period = parsePeriod(params, today, OWNER_CUSTOM_MAX_DAYS, "month");
  const facts = listStageDurations(period.from, period.to);
  startEarly(facts);
  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="Stage durations"
        description={STAGES_DESCRIPTION}
        help={STAGES_DESCRIPTION}
      />
      <PeriodControls period={period} today={today} base={BASE} />
      {period.kind === "custom" ? (
        <div className="mb-4">
          <CustomRange from={period.from} to={period.to} today={today} base={BASE} />
        </div>
      ) : null}
      <Suspense fallback={<StagesSkeleton />}>
        <StagesSection facts={facts} />
      </Suspense>
    </>
  );
}

async function StagesSection({ facts }: { facts: Promise<StageFact[]> }) {
  const { overall, projects } = stageReport(await facts);
  if (overall.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-6" data-slot="stages-report">
        <section aria-labelledby="stages-overall-title" className="flex min-w-0 flex-col gap-2">
          <ReportHeading id="stages-overall-title">Every project</ReportHeading>
          <p className="text-muted-foreground text-sm" data-slot="stages-empty">
            No deliverable stage was ticked in this period.
          </p>
        </section>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-6" data-slot="stages-report">
      <section aria-labelledby="stages-overall-title" className="flex min-w-0 flex-col gap-2">
        <ReportHeading id="stages-overall-title">Every project</ReportHeading>
        <StageOverall stages={overall} />
      </section>
      <section aria-labelledby="stages-projects-title" className="flex min-w-0 flex-col gap-2">
        <ReportHeading id="stages-projects-title">By project</ReportHeading>
        <div className={CARD_GRID_CLASS}>
          {projects.map((project) => (
            <StageProjectCard key={project.projectId} project={project} />
          ))}
        </div>
      </section>
    </div>
  );
}
