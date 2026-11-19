import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { addISTDays, istInstant, todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  buildCalendar,
  buildCrew,
  DEFAULT_EVENT_COLOR,
  listAvailability,
  monthGrid,
  parseCalendarQuery,
  rangeFor,
  scopeFor,
} from "@/modules/calendar";
import { listItemRows } from "@/modules/client-work";
import { listClientLabels } from "@/modules/clients";
import { listLeaveBetween } from "@/modules/leave";
import { getSettings, listHolidays } from "@/modules/settings";
import {
  listEventTasks,
  listOpenTaskRowsDueBetween,
  listTaskTypes,
  taskTypeColor,
} from "@/modules/tasks";
import { listDirectory } from "@/modules/team";

import { loadTaskFormSetup } from "../tasks/task-form-setup";

import { CalendarClient } from "./calendar-client";
import { CALENDAR_HELP } from "./copy";

export const metadata: Metadata = { title: "Calendar" };

/**
 * The calendar (6.4, reworked in 6.4b; Kickoff 6 decisions 13, 14, 22 and 25; PRODUCT §4.8): event
 * tasks at their date and time in their type's colour, ordinary deadlines as a Due list and a
 * count, leave, holidays and weekly offs. Every member opens it; what each sees is their role's
 * (PERMISSIONS §2 "Calendar"): Crew their own, an Admin full detail on the tasks they see and
 * everyone else as Busy and "On leave", the Owner everything. One read serves every view: the
 * month grid of the address's day (the phone's month and week, the laptop's Day, Week and Month);
 * the Due list reads only the open tasks due in it (6B review later item (f)). The Owner and Admins
 * get each day's Crew (since v6.0 "Admin calendar": who is Busy, with the type, the time and who
 * booked it, who is On leave and who is Free; before it a one-line "Who's free") and "+ New task
 * on <day>"; Crew "Suggest a task". Since 7.3 the
 * Owner and the client's Admin also see client items on their planned day (kickoff 7 decision 21:
 * in the due counts and a "Client items · N" list, never a strip; never Crew).
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
  const creates = can(viewer.role, "tasks.create");
  const suggests = !creates && can(viewer.role, "task_requests.create");
  // Client items' planned dates (kickoff 7 decision 21): the Owner's and the client's Admin's (RLS:
  // an Admin their clients'), never Crew's; open and done ones only.
  const readsItems = scope !== "staff" && can(viewer.role, "items.tick");
  const [events, open, holidays, settings, directory, types, labels, leave, availability, items] =
    await Promise.all([
      listEventTasks(range.from, range.to),
      listOpenTaskRowsDueBetween(
        istInstant(range.from, "00:00"),
        istInstant(addISTDays(range.to, 1), "00:00"),
      ),
      listHolidays(),
      getSettings(),
      listDirectory(),
      listTaskTypes(),
      listClientLabels(),
      // The Owner reads everyone's leave; anyone else their own (RLS says the same).
      listLeaveBetween(range.from, range.to, scope === "owner" ? null : viewer.id),
      // An Admin's view of everyone; the person filter keeps the days to one person, but the
      // Crew's Busy / On leave / Free is over everyone they can see, so it reads everyone.
      scope === "admin" ? listAvailability(range.from, range.to, null) : Promise.resolve(null),
      readsItems
        ? listItemRows({ states: ["open", "done"], plannedFrom: range.from, plannedTo: range.to })
        : Promise.resolve([]),
    ]);
  const people = directory.map((member) => ({
    id: member.id,
    name: member.fullName,
    engagement: member.engagement,
    avatarFileId: member.avatarFileId,
  }));
  const typeRows = types.map((type) => ({
    id: type.id,
    name: type.name,
    showsOnCalendar: type.showsOnCalendar,
    color: taskTypeColor(type.color),
  }));
  const leaveRows = leave.map((span) => ({
    memberId: span.memberId,
    type: span.type,
    startDate: span.startDate,
    endDate: span.endDate,
    pending: span.state === "submitted",
  }));
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
      // v1.9 W8: a held task shows with its chip, never overdue.
      held: Boolean(task.heldAt),
    })),
    types: typeRows,
    clients: labels.map((label) => ({ id: label.id, name: label.name })),
    people,
    holidays,
    weeklyOffDays: settings.weeklyOffDays,
    leave: leaveRows,
    availability: availability
      ? availability.filter((row) => query.person === null || row.memberId === query.person)
      : null,
    clientItems: items.flatMap((item) =>
      item.plannedDate && (item.state === "open" || item.state === "done")
        ? [
            {
              id: item.id,
              title: item.title,
              state: item.state,
              plannedDate: item.plannedDate,
              projectName: item.projectName,
              clientId: item.clientId,
              clientName: item.clientName,
              href: `/clients/${item.clientId}/projects/${item.projectId}?cycle=${item.cycleId}&item=${item.id}`,
              held: item.projectHeldAt !== null,
            },
          ]
        : [],
    ),
  });

  // The Crew on each day (v6.0 "Admin calendar": Busy, On leave, Free), for the Owner and Admins,
  // over the active people they can see (the Owner only as Busy, 6b.2), from the unfiltered reads
  // above: an Admin's from `member_availability()`, the Owner's from the events and leave. No read
  // of its own. Crew get none.
  const owner = directory.find((member) => member.role === "owner" && member.status === "active");
  const visible = directory
    .filter((member) => member.status === "active" && member.role !== "owner")
    .map((member) => ({
      id: member.id,
      name: member.engagement === "freelance" ? `${member.fullName} (freelancer)` : member.fullName,
    }));
  const crew = buildCrew({
    scope,
    viewerId: viewer.id,
    owner: owner ? { id: owner.id, name: owner.fullName } : null,
    people: visible,
    types: typeRows,
    nameOf: (memberId) => directory.find((member) => member.id === memberId)?.fullName ?? null,
    fallbackColor: DEFAULT_EVENT_COLOR,
    events,
    leave: leaveRows,
    availability,
  });

  // "Suggest a task" (4.6): a client label the suggester sees, Active or Paused (decision 22).
  const suggestClients = labels
    .filter((label) => label.state === "active" || label.state === "paused")
    .map((label) => ({ id: label.id, name: label.name }));

  return (
    <>
      <PageHeader title="Calendar" help={CALENDAR_HELP} />
      <CalendarClient
        today={today}
        query={query}
        scope={scope}
        grid={monthGrid(query.date)}
        days={days}
        crew={crew}
        choices={{
          // Crew filter by type only (decision 15): no one else's names are handed over.
          clients:
            scope === "staff" ? [] : labels.map((label) => ({ id: label.id, name: label.name })),
          people: scope === "staff" ? [] : visible,
          types: types
            .filter((type) => !type.archived)
            .map((type) => ({ id: type.id, name: type.name })),
        }}
        create={creates ? loadTaskFormSetup(viewer).catch(() => null) : null}
        suggest={suggests ? suggestClients : null}
      />
    </>
  );
}
