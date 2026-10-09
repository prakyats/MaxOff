import type { CurrentMember } from "@/core/auth/server";
import { systemClock, todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  acknowledgementLag,
  countWords,
  ENGAGEMENTS,
  type Engagement,
  hoursWords,
  ItemKpiCard,
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
import {
  cycleProgressWords,
  isOverdue,
  itemCount,
  listItemRows,
  listPlannedItems,
  listItemStages,
  onTime,
  onTimeWords,
  sitLongest,
  sitWords,
} from "@/modules/client-work";
import { activeAssignees, listKpiFacts } from "@/modules/tasks";

import { readDirectory, readOpenTasks } from "../tasks/reads";
import { readClientProgress } from "../today/reads";

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
 * each split by engagement (Kickoff 4 decision 18). **The item KPIs** (7.4, kickoff 7 decision 25):
 * On time (with the last period), Cycle progress (the current cycles, now) and where items sit
 * longest (the open items by their first unticked stage), over the items of the clients the Admin
 * runs. Computed live from what the Admin sees (RLS): never money, attendance or leave
 * (`reports.scoped`).
 */
export async function AdminReport({ viewer, period }: { viewer: CurrentMember; period: Period }) {
  const before = previousPeriod(period);
  const today = todayIST();
  const [facts, open, directory, planned, current, openItems] = await Promise.all([
    listKpiFacts(before.from, period.to),
    readOpenTasks(),
    readDirectory(),
    listPlannedItems(before.from, period.to),
    readClientProgress(today),
    listItemRows({ states: ["open"] }),
  ]);
  const now = systemClock();
  const people = new Map(directory.map((member) => [member.id, member]));
  const engagementOf = (id: string): Engagement => people.get(id)?.engagement ?? "permanent";
  const nameOf = (id: string) => people.get(id)?.fullName ?? "Someone";
  // Cycle progress and where items sit: the current cycles of the working projects.
  const currentIds = new Set(current.map((cycle) => cycle.id));
  const totals = current
    .flatMap((cycle) => cycle.states)
    .reduce(
      (sum, state) => {
        if (state === "cancelled" || state === "carried") return sum;
        return {
          total: sum.total + 1,
          done: sum.done + (state === "done" || state === "approved" ? 1 : 0),
        };
      },
      { total: 0, done: 0 },
    );
  // Overdue now (PRODUCT §4.13): the open items past their planned date, beside the tasks.
  const overdueItems = openItems.filter((item) => isOverdue(item, today)).length;
  const waiting = openItems.filter((item) => currentIds.has(item.cycleId));
  // Amendment D2: each open item's own stages and ticks.
  const stages = await listItemStages(waiting.map((item) => item.id));
  const sits = sitLongest({ items: waiting, stages, cycles: current, now });
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
          aria-labelledby="items-title"
          className="flex min-w-0 flex-col gap-2"
          data-slot="report-items"
        >
          <h2 id="items-title" className="text-sm font-semibold">
            Client items
          </h2>
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
            <ItemKpiCard
              slot="kpi-on-time"
              title="On time"
              definition="Items done on or before their planned date, of the items planned."
              now={onTimeWords(onTime(planned, period))}
              before={onTimeWords(onTime(planned, before))}
            />
            <ItemKpiCard
              slot="kpi-cycle-progress"
              title="Cycle progress"
              definition="The current cycles: done of planned."
              now={cycleProgressWords(totals)}
              before={null}
            />
            <ItemKpiCard
              slot="kpi-items-overdue"
              title="Overdue now"
              definition="Open items past their planned date."
              now={itemCount(overdueItems)}
              before={null}
              href="/clients/items?filter=overdue"
            />
            <ItemKpiCard
              slot="kpi-sit-longest"
              title="Where items sit longest"
              definition="Open items by their first unticked stage, with the median days waiting."
              lines={sits.slice(0, 5).map(sitWords)}
              empty="No open items waiting at a stage."
            />
          </div>
        </section>
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
