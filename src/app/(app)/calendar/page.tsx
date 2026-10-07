import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  buildCalendar,
  CalendarPager,
  DayView,
  emptyDay,
  listAvailability,
  monthGrid,
  MonthView,
  parseCalendarQuery,
  rangeFor,
  scopeFor,
  ViewSwitcher,
  WeekStrip,
  WeekView,
} from "@/modules/calendar";
import { CalendarFilters } from "@/modules/calendar/components/calendar-filters";
import { listClientLabels } from "@/modules/clients";
import { listLeaveBetween } from "@/modules/leave";
import { getSettings, listHolidays } from "@/modules/settings";
import { listEventTasks, listOpenTaskRows, listTaskTypes } from "@/modules/tasks";
import { listDirectory } from "@/modules/team";

import { CALENDAR_DESCRIPTION } from "./copy";

export const metadata: Metadata = { title: "Calendar" };

/**
 * The calendar (6.4; Kickoff 6 decisions 13–15, 22; PRODUCT §4.8): event tasks at their date and
 * time, ordinary deadlines as a Due list, leave, holidays and weekly offs, by day, week and month.
 * Every member opens it; what each sees is their role's (PERMISSIONS §2 "Calendar"): Crew their
 * own, an Admin full detail on the tasks they see and everyone else as Busy blocks and "On
 * leave", the Owner everything. A phone opens on Day with the week strip, a desktop on Week (one
 * week's data, the width decides); the view, the day and the filters are view state, so none
 * adds history and one back leaves the calendar (ARCHITECTURE §14.2 d).
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = todayIST();
  const [viewer, params] = await Promise.all([requireMember(), searchParams]);
  const query = parseCalendarQuery(params, today);
  const range = rangeFor(query);
  const scope = scopeFor({
    viewAll: can(viewer.role, "attendance.view_all"),
    availability: can(viewer.role, "availability.view"),
  });
  const [events, open, holidays, settings, directory, types, labels, leave, availability] =
    await Promise.all([
      listEventTasks(range.from, range.to),
      listOpenTaskRows(),
      listHolidays(),
      getSettings(),
      listDirectory(),
      listTaskTypes(),
      listClientLabels(),
      // The Owner reads everyone's leave; anyone else their own (RLS says the same).
      listLeaveBetween(range.from, range.to, scope === "owner" ? null : viewer.id),
      scope === "admin"
        ? listAvailability(range.from, range.to, query.person ? [query.person] : null)
        : Promise.resolve(null),
    ]);
  const days = buildCalendar({
    range,
    scope,
    viewerId: viewer.id,
    query,
    events,
    openTasks: open.map((task) => ({
      id: task.id,
      title: task.title,
      dueAt: task.dueAt,
      clientId: task.clientId,
      taskTypeId: task.taskTypeId,
      primaryOwnerId: task.primaryOwnerId,
      assigneeIds: task.assignees.filter((a) => a.removedAt === null).map((a) => a.memberId),
    })),
    types,
    clients: labels.map((label) => ({ id: label.id, name: label.name })),
    people: directory.map((member) => ({
      id: member.id,
      name: member.fullName,
      engagement: member.engagement,
    })),
    holidays,
    weeklyOffDays: settings.weeklyOffDays,
    leave: leave.map((span) => ({
      memberId: span.memberId,
      type: span.type,
      startDate: span.startDate,
      endDate: span.endDate,
      pending: span.state === "submitted",
    })),
    availability,
  });
  // The range always holds the asked day (its week or its month's grid).
  const chosen = days.find((day) => day.date === query.date) ?? emptyDay(query.date);

  return (
    <>
      <PageHeader title="Calendar" description={CALENDAR_DESCRIPTION} help={CALENDAR_DESCRIPTION} />
      <div data-slot="calendar" className="flex max-w-3xl min-w-0 flex-col gap-3">
        <ViewSwitcher query={query} today={today} />
        <CalendarPager query={query} today={today} />
        {query.view !== "month" ? <WeekStrip query={query} days={days} today={today} /> : null}
        <CalendarFilters
          query={query}
          scope={scope}
          today={today}
          clients={labels.map((label) => ({ id: label.id, name: label.name }))}
          people={directory
            .filter((member) => member.status === "active" && member.role !== "owner")
            .map((member) => ({
              id: member.id,
              name:
                member.engagement === "freelance"
                  ? `${member.fullName} (freelancer)`
                  : member.fullName,
            }))}
          types={types
            .filter((type) => !type.archived)
            .map((type) => ({ id: type.id, name: type.name }))}
        />
        <div className="mt-1">
          {query.view === "month" ? (
            <MonthView grid={monthGrid(query.date)} days={days} today={today} query={query} />
          ) : query.view === "week" ? (
            <WeekView days={days} today={today} query={query} scope={scope} />
          ) : query.view === "day" ? (
            <DayView day={chosen} today={today} scope={scope} />
          ) : (
            // No view in the address: a phone's default is Day, a desktop's Week (decision 15).
            <>
              <div className="md:hidden">
                <DayView day={chosen} today={today} scope={scope} />
              </div>
              <div className="hidden md:block">
                <WeekView days={days} today={today} query={query} scope={scope} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
