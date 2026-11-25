import type { Metadata } from "next";
import { Suspense } from "react";

import { startEarly } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { systemClock, todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  getMonthSummary,
  monthHoursCounts,
  type MonthSummary,
  monthOf,
} from "@/modules/attendance";
import {
  AttendanceFacts,
  CARD_GRID_CLASS,
  type DelayFact,
  delayPatterns,
  DelayReport,
  DelayReportSkeleton,
  ENGAGEMENT_LABELS,
  ENGAGEMENTS,
  listDelays,
  listPeopleFacts,
  OWNER_CUSTOM_MAX_DAYS,
  parsePeriod,
  PersonCard,
  type PersonFacts,
  peopleRows,
  ReportHeading,
} from "@/modules/reports";
import type { TeamMember } from "@/modules/team";

import { readDirectory } from "../../tasks/reads";
import { PEOPLE_DESCRIPTION } from "../copy";
import { CustomRange } from "../custom-range";
import { PeriodControls } from "../period-controls";
import { attendanceLines } from "./attendance-lines";
import { PeopleSkeleton } from "./people-skeleton";

export const metadata: Metadata = { title: "People" };

const BASE = "/reports/people";

/**
 * The Owner's people report (v3.0, 9.3; PRODUCT §4.13 "raw employee metrics"; kickoff 9 decision
 * 13): per person, freelancers in their own block, sorted by name, nothing ranked, scored or
 * coloured. The task facts come from `report_people()`; in the **Month** view each employee's card
 * also carries their attendance lines and working-hours counts (decision 13, the refresh's Q5),
 * from the Month report's own summary. Then the delay patterns (decision 14): the tasks due in the
 * period that ran late, by person, type and client label, each with its late reason. The header and
 * the period switch paint at once; each section streams in behind a skeleton of its own shape.
 */
export default async function PeopleReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requirePermission("reports.all"), searchParams]);
  const today = todayIST();
  const period = parsePeriod(params, today, OWNER_CUSTOM_MAX_DAYS, "month");
  const facts = listPeopleFacts(period.from, period.to);
  const delays = listDelays(period.from, period.to);
  const directory = readDirectory();
  const month =
    period.kind === "month"
      ? getMonthSummary(monthOf(period.from), undefined, { hours: true })
      : Promise.resolve(null);
  startEarly(facts, delays, directory, month);
  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="People"
        description={PEOPLE_DESCRIPTION}
        help={PEOPLE_DESCRIPTION}
      />
      <PeriodControls period={period} today={today} base={BASE} />
      {period.kind === "custom" ? (
        <div className="mb-4">
          <CustomRange from={period.from} to={period.to} today={today} base={BASE} />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-6" data-slot="people-report">
        <section aria-labelledby="people-title" className="flex min-w-0 flex-col gap-2">
          <ReportHeading id="people-title">Tasks by person</ReportHeading>
          <Suspense fallback={<PeopleSkeleton period={period} />}>
            <PeopleSection facts={facts} directory={directory} month={month} />
          </Suspense>
        </section>
        <section aria-labelledby="delays-title" className="flex min-w-0 flex-col gap-2">
          <ReportHeading id="delays-title">Late and overdue tasks</ReportHeading>
          <Suspense fallback={<DelayReportSkeleton />}>
            <DelaysSection delays={delays} directory={directory} />
          </Suspense>
        </section>
      </div>
    </>
  );
}

function names(rows: readonly { fullName: string }[]): string {
  const all = rows.map((row) => row.fullName);
  if (all.length <= 1) return all[0] ?? "";
  return `${all.slice(0, -1).join(", ")} and ${all.at(-1)}`;
}

async function PeopleSection({
  facts,
  directory,
  month,
}: {
  facts: Promise<PersonFacts[]>;
  directory: Promise<TeamMember[]>;
  month: Promise<MonthSummary[] | null>;
}) {
  const [rows, members, summaries] = await Promise.all([facts, directory, month]);
  const { rows: active, quiet } = peopleRows(
    rows,
    members.map((member) => ({
      id: member.id,
      fullName: member.fullName,
      engagement: member.engagement,
    })),
  );
  const summaryOf = new Map((summaries ?? []).map((summary) => [summary.memberId, summary]));
  const nobody = ENGAGEMENTS.every((engagement) => active[engagement].length === 0);
  if (nobody) {
    return (
      <p className="text-muted-foreground text-sm" data-slot="people-empty">
        Nobody had task work in this period.
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {ENGAGEMENTS.map((engagement) =>
        active[engagement].length === 0 && quiet[engagement].length === 0 ? null : (
          <div
            key={engagement}
            className="flex min-w-0 flex-col gap-2"
            data-slot="people-block"
            data-engagement={engagement}
          >
            <h3 className="text-muted-foreground text-xs font-medium">
              {ENGAGEMENT_LABELS[engagement]}
            </h3>
            {active[engagement].length > 0 ? (
              <div className={CARD_GRID_CLASS}>
                {active[engagement].map((row) => {
                  const summary = summaryOf.get(row.memberId);
                  return (
                    <PersonCard
                      key={row.memberId}
                      row={row}
                      attendance={
                        summary ? (
                          <AttendanceFacts lines={attendanceLines(summary, monthHoursCounts)} />
                        ) : undefined
                      }
                    />
                  );
                })}
              </div>
            ) : null}
            {quiet[engagement].length > 0 ? (
              <p className="text-muted-foreground text-sm" data-slot="people-quiet">
                No tasks in this period: {names(quiet[engagement])}.
              </p>
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}

async function DelaysSection({
  delays,
  directory,
}: {
  delays: Promise<DelayFact[]>;
  directory: Promise<TeamMember[]>;
}) {
  const [facts, members] = await Promise.all([delays, directory]);
  if (facts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-slot="delays-empty">
        No task due in this period ran late.
      </p>
    );
  }
  const people = new Map(members.map((member) => [member.id, member.fullName]));
  const nameOf = (id: string) => people.get(id) ?? "Someone";
  return (
    <DelayReport
      patterns={delayPatterns(facts, nameOf)}
      facts={facts}
      nameOf={nameOf}
      now={systemClock()}
    />
  );
}
