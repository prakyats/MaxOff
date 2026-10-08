import type { CurrentMember } from "@/core/auth/server";
import { systemClock, todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  acknowledgementLag,
  countWords,
  ENGAGEMENTS,
  type Engagement,
  hoursWords,
  KpiCard,
  LoadList,
  loadThisWeek,
  overdueNow,
  type Period,
  previousPeriod,
  rework,
  reworkWords,
  type Split,
  turnaround,
} from "@/modules/reports";
import { activeAssignees, listKpiFacts } from "@/modules/tasks";

import { readDirectory, readOpenTasks } from "../tasks/reads";

import { ADMIN_REPORT_DESCRIPTION } from "./copy";
import { CustomRange } from "./custom-range";
import { PeriodControls } from "./period-controls";

function words<T>(split: Split<T>, say: (value: T) => string): Split<string> {
  return Object.fromEntries(
    ENGAGEMENTS.map((engagement) => [engagement, say(split[engagement])]),
  ) as Split<string>;
}

/**
 * The Admin's work report (6.3; PRODUCT §4.13: "is the work getting done?"; Kickoff 6 decision 11):
 * the task KPIs for the period with the last period beside each (Rework, My turnaround,
 * Acknowledgement lag), Overdue now (tapping through to the list), and who is loaded this week,
 * each split by engagement (Kickoff 4 decision 18). On time, Cycle progress and "where items sit
 * longest" join in phase 7 with the items. Computed live from the tasks the Admin sees (RLS):
 * never money, attendance or leave (`reports.scoped`).
 */
export async function AdminReport({ viewer, period }: { viewer: CurrentMember; period: Period }) {
  const before = previousPeriod(period);
  const [facts, open, directory] = await Promise.all([
    listKpiFacts(before.from, period.to),
    readOpenTasks(),
    readDirectory(),
  ]);
  const now = systemClock();
  const today = todayIST();
  const people = new Map(directory.map((member) => [member.id, member]));
  const engagementOf = (id: string): Engagement => people.get(id)?.engagement ?? "permanent";
  const nameOf = (id: string) => people.get(id)?.fullName ?? "Someone";
  const openTasks = open.map((row) => ({
    id: row.id,
    state: row.state,
    dueAt: row.dueAt,
    primaryOwnerId: row.primaryOwnerId,
    assigneeIds: activeAssignees(row.assignees).map((a) => a.memberId),
  }));

  return (
    <>
      <PageHeader title="Reports" description={ADMIN_REPORT_DESCRIPTION} />
      <PeriodControls period={period} today={today} />
      {period.kind === "custom" ? (
        <div className="mb-4">
          <CustomRange from={period.from} to={period.to} today={today} />
        </div>
      ) : null}
      <div className="flex max-w-3xl min-w-0 flex-col gap-6" data-slot="work-report">
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <KpiCard
            slot="kpi-rework"
            title="Rework"
            definition="Hand-ins sent back with changes requested, of all hand-ins."
            now={words(rework(facts, period, engagementOf), reworkWords)}
            before={words(rework(facts, before, engagementOf), reworkWords)}
          />
          <KpiCard
            slot="kpi-turnaround"
            title="My turnaround"
            definition="Median time from a task's Done to your approval."
            now={words(turnaround(facts, period, viewer.id, engagementOf), hoursWords)}
            before={words(turnaround(facts, before, viewer.id, engagementOf), hoursWords)}
          />
          <KpiCard
            slot="kpi-overdue"
            title="Overdue now"
            definition="Open tasks past their deadline."
            now={words(overdueNow(openTasks, now, engagementOf), countWords)}
            before={null}
            href="/tasks/all?overdue=overdue"
          />
          <KpiCard
            slot="kpi-ack-lag"
            title="Acknowledgement lag"
            definition="Median time from assignment to Task Noted."
            now={words(acknowledgementLag(facts, period, engagementOf), hoursWords)}
            before={words(acknowledgementLag(facts, before, engagementOf), hoursWords)}
          />
        </div>
        <section
          aria-labelledby="load-title"
          className="flex min-w-0 flex-col gap-2"
          data-slot="report-load"
        >
          <h2 id="load-title" className="text-sm font-semibold">
            Who is loaded this week
          </h2>
          <LoadList
            rows={loadThisWeek(openTasks, today, now, engagementOf, nameOf)}
            nameOf={nameOf}
            empty={
              <p className="text-muted-foreground text-sm" data-slot="report-load-empty">
                Nobody has open work due this week.
              </p>
            }
          />
        </section>
      </div>
    </>
  );
}
