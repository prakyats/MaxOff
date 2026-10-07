import { CalendarDaysIcon, CheckCheckIcon, PalmtreeIcon, UserCheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import {
  DashSection,
  DashSectionHeadingSkeleton,
  LinkRow,
  LinkRowsSkeleton,
  QuietText,
  RowList,
} from "@/modules/dashboards";

import {
  approvalDetail,
  attendanceLine,
  decisionLines,
  type EodReport,
  type EodTaskGroup,
  eventDetail,
  groupCount,
  isQuietDay,
  personDetail,
  personStatus,
  taskDetail,
} from "../domain/eod";

/**
 * The end-of-day report as a screen (6.5; PRODUCT §4.7, WORKFLOWS §8a): the day off line,
 * attendance (the counts line, then each employee's row: status, times, flags), the decisions made
 * that day, the tasks (completed, handed in, overdue with the late reason, cancelled, created;
 * freelancers counted apart), approvals per approver and step, and tomorrow's events. The same
 * component for the live view and a saved row. Server components only; a task row is a
 * drill-down into its task, a person's row into their history. No money anywhere.
 */

const DOT_STATUS: Record<
  NonNullable<EodReport["attendance"]["people"][number]["status"]>,
  string
> = {
  present: "present",
  leave: "leave",
  half_day: "half_day",
  comp_leave: "comp_leave",
  absent: "absent",
};

const TASK_GROUPS: {
  key: keyof EodReport["tasks"];
  title: string;
  slot: string;
}[] = [
  { key: "completed", title: "Completed", slot: "eod-completed" },
  { key: "handed_in", title: "Handed in, waiting", slot: "eod-handed-in" },
  { key: "overdue", title: "Overdue", slot: "eod-overdue" },
  { key: "cancelled", title: "Cancelled", slot: "eod-cancelled" },
  { key: "created", title: "Created", slot: "eod-created" },
];

function Line({ slot, icon, children }: { slot: string; icon: ReactNode; children: ReactNode }) {
  return (
    <p data-slot={slot} className="flex items-start gap-2 text-sm">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function TaskGroupRows({
  group,
  value,
}: {
  group: (typeof TASK_GROUPS)[number];
  value: EodTaskGroup;
}) {
  if (value.count === 0) return null;
  return (
    <DashSection title={group.title} slot={group.slot}>
      <p className="text-muted-foreground -mt-1 text-xs">{groupCount(value)}</p>
      <RowList label={group.title} slot={`${group.slot}-rows`}>
        {value.items.map((item) => (
          <LinkRow
            key={item.id}
            href={`/tasks/${item.id}`}
            slot="eod-task"
            title={item.title}
            detail={taskDetail(group.key, item)}
          />
        ))}
      </RowList>
      {value.more > 0 ? (
        <QuietText slot={`${group.slot}-more`}>and {value.more} more</QuietText>
      ) : null}
    </DashSection>
  );
}

export function EodReportView({ report }: { report: EodReport }) {
  const quiet = isQuietDay(report);
  const decisions = decisionLines(report.decisions);
  return (
    <div data-slot="eod-report" className="flex max-w-3xl min-w-0 flex-col gap-6">
      {report.day_off.holiday || report.day_off.weekly_off ? (
        <Line slot="eod-day-off" icon={<CalendarDaysIcon className="size-4" aria-hidden />}>
          {report.day_off.holiday ? `Holiday: ${report.day_off.holiday}` : "Weekly off"}
        </Line>
      ) : null}

      {quiet ? (
        <QuietText slot="eod-quiet">Nothing happened on this day.</QuietText>
      ) : (
        <>
          <DashSection title="Attendance" slot="eod-attendance">
            <Line
              slot="eod-attendance-line"
              icon={<UserCheckIcon className="size-4" aria-hidden />}
            >
              {attendanceLine(report.attendance.counts)}
            </Line>
            {report.attendance.people.length > 0 ? (
              <RowList label="Everyone's day" slot="eod-people">
                {report.attendance.people.map((person) => (
                  <LinkRow
                    key={person.member_id}
                    href={`/people/${person.member_id}/attendance`}
                    slot="eod-person"
                    title={person.name}
                    detail={personDetail(person) || undefined}
                    trailing={
                      <StatusDot
                        status={person.status ? DOT_STATUS[person.status] : "awaiting_choice"}
                        label={personStatus(person)}
                      />
                    }
                  />
                ))}
              </RowList>
            ) : (
              <QuietText slot="eod-people-empty">Nobody had a day recorded.</QuietText>
            )}
          </DashSection>

          <DashSection title="Decisions that day" slot="eod-decisions">
            {decisions.length > 0 ? (
              <ul data-slot="eod-decision-lines" className="flex flex-col gap-1.5">
                {decisions.map((line) => (
                  <li key={line}>
                    <Line
                      slot="eod-decision"
                      icon={<CheckCheckIcon className="size-4" aria-hidden />}
                    >
                      {line}
                    </Line>
                  </li>
                ))}
              </ul>
            ) : (
              <QuietText slot="eod-decisions-empty">No decisions that day.</QuietText>
            )}
          </DashSection>

          {Object.values(report.tasks).every((group) => group.count === 0) ? (
            <DashSection title="Tasks" slot="eod-tasks">
              <QuietText slot="eod-tasks-empty">
                Nothing completed, handed in, overdue, cancelled or created.
              </QuietText>
            </DashSection>
          ) : (
            TASK_GROUPS.map((group) => (
              <TaskGroupRows key={group.key} group={group} value={report.tasks[group.key]} />
            ))
          )}

          <DashSection title="Approvals" slot="eod-approvals">
            {report.approvals.length > 0 ? (
              <ul
                aria-label="Approvals per approver"
                data-slot="eod-approval-rows"
                className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
              >
                {report.approvals.map((row) => (
                  <li
                    key={`${row.reviewer_id ?? row.name}-${row.step}`}
                    data-slot="eod-approval"
                    className="flex min-h-12 flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                  >
                    <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
                      <span className="font-medium">{row.name}</span>
                      <span className="text-muted-foreground text-xs">{approvalDetail(row)}</span>
                    </span>
                    <span className={cn("text-muted-foreground text-xs", CARD_ROW_TRAILING)}>
                      {row.step === "owner" ? "Owner step" : "Admin step"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <QuietText slot="eod-approvals-empty">No approvals that day.</QuietText>
            )}
          </DashSection>

          <DashSection
            title="Tomorrow's events"
            slot="eod-tomorrow"
            count={report.tomorrow.events.length}
          >
            {report.tomorrow.events.length > 0 ? (
              <RowList label="Tomorrow's events" slot="eod-events">
                {report.tomorrow.events.map((event) => (
                  <LinkRow
                    key={event.id}
                    href={`/tasks/${event.id}`}
                    slot="eod-event"
                    icon={<PalmtreeIcon className="size-4" aria-hidden />}
                    title={event.title}
                    detail={eventDetail(event)}
                  />
                ))}
              </RowList>
            ) : (
              <QuietText slot="eod-tomorrow-empty">No events tomorrow.</QuietText>
            )}
          </DashSection>
        </>
      )}
    </div>
  );
}

/** The report's skeleton: the attendance heading, its counts line and two person rows. */
export function EodReportSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="loading-eod-report"
      className="flex max-w-3xl min-w-0 flex-col gap-6"
    >
      <section className="flex min-w-0 flex-col gap-2">
        <DashSectionHeadingSkeleton width="w-24" />
        <div className="flex h-5 items-center gap-2">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-3.5 w-56 max-w-full" />
        </div>
        <LinkRowsSkeleton rows={2} detail trailing slot="loading-eod-people" />
      </section>
      <section className="flex min-w-0 flex-col gap-2">
        <DashSectionHeadingSkeleton width="w-32" />
        <div className="flex h-5 items-center gap-2">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-3.5 w-40 max-w-full" />
        </div>
      </section>
      <span className="sr-only">Loading the report</span>
    </div>
  );
}
