import { CalendarDaysIcon, ListTodoIcon } from "lucide-react";
import type { Metadata } from "next";

import { withSessionUserId } from "@/core/auth/server";
import { checkThenRead, startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { addISTDays, systemClock, todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getOwnToday, TodayAttendanceStrip } from "@/modules/attendance";
import {
  DashSection,
  EventRows,
  LinkRow,
  moreThisWeekLine,
  MY_DAY_AHEAD_DAYS,
  MY_DAY_EMPTY,
  MY_DAY_GROUPS,
  myDayEvents,
  QuietText,
  quietLine,
  RowList,
  upcomingLine,
  upcomingWithin,
} from "@/modules/dashboards";
import { getClaimSetup } from "@/modules/expenses";
import { EndDayClaims } from "@/modules/expenses/components/end-day-claims";
import { listApprovedLeaveBetween } from "@/modules/leave";
import { listHolidays } from "@/modules/settings";
import {
  forLabel,
  listEventTasks,
  listUnreadCounts,
  MY_GROUP_TITLES,
  myTaskGroups,
  rowMeta,
  stateLabel,
  TaskRow,
  TaskRowList,
} from "@/modules/tasks";
import { SuggestTaskButton } from "@/modules/tasks/components/suggest-task-button";

import { readClientLabels, readDirectory, readOpenTasks, readOwnFreelancers } from "../tasks/reads";

import { myDayGreeting, rowFlag } from "./words";

export const metadata: Metadata = { title: "My Day" };

/**
 * Crew's home (6.1; Kickoff 6 decisions 1–3, 22; PRODUCT §4.7 "Crew: My Day"). Today's attendance
 * is one line on top (the strip, 2.3 polish; Start day / End day since 3b.1), then **the exception
 * rows** in the Tasks tab's order (Not noted · Changes requested · Overdue · Due today, a
 * coordinator's freelancers' tasks mixed in "for Asha"; never counts), then **Upcoming as one line**
 * ("N more in the next 7 days", opening Tasks), the person's **events** today and tomorrow ("N more
 * this week", opening the Calendar) with one quiet line for a holiday or their own approved leave,
 * and a neutral **Suggest a task**. No sign-out row (decision 3): End day is in the strip and "Sign
 * out of this device" on Me. Whoever marks attendance opens it (`attendance.self`); the Owner has
 * no day. Every part is a server component or loads after the page (the first-load budget, 6.0);
 * it updates live through the bell's Realtime connection (`LiveUpdates`, decision 8).
 */
export default async function MyDayPage() {
  // The strip's day and End day's claim setup start with the session read, not after it (§19).
  startEarly(getOwnToday(), getClaimSetup());
  const today = todayIST();
  const last = addISTDays(today, MY_DAY_AHEAD_DAYS - 1);
  const openRows = readOpenTasks();
  const [viewer, [rows, directory, labels, own, unread, events, holidays, leave]] =
    await checkThenRead(
      requirePermission("attendance.self"),
      Promise.all([
        openRows,
        readDirectory(),
        readClientLabels(),
        readOwnFreelancers(),
        // Each row's unread comments (Kickoff 4 decision 28), for these rows only (A-S4).
        openRows.then((open) => listUnreadCounts(open.map((row) => row.id))),
        listEventTasks(today, last),
        listHolidays(),
        withSessionUserId((id) => listApprovedLeaveBetween(id, today, last)),
      ]),
    );
  const now = systemClock();
  const names = new Map(directory.map((member) => [member.id, member]));
  const clients = new Map(labels.map((label) => [label.id, label.name]));
  const context = {
    viewerId: viewer.id,
    nameOf: (id: string) => (id === viewer.id ? "you" : (names.get(id)?.fullName ?? "Someone")),
    engagementOf: (id: string) => names.get(id)?.engagement,
    clientName: (id: string) => clients.get(id) ?? null,
  };
  const listViewer = { id: viewer.id, role: viewer.role, coordinates: own };
  const groups = myTaskGroups(rows, listViewer, now, today);
  const nothing = MY_DAY_GROUPS.every((group) => groups[group].length === 0);
  const upcoming = upcomingWithin(
    groups.upcoming.map((item) => item.row),
    today,
  );

  // Their own event tasks, and their freelancers' ("for Asha"); never anyone else's (decision 2).
  const mine = new Set([viewer.id, ...own]);
  const day = myDayEvents(events, (event) => event.assigneeIds.some((id) => mine.has(id)), today);
  const quiet = quietLine({ holidays, leave, today });
  const forWhom = (event: { assigneeIds: readonly string[] }) => {
    if (event.assigneeIds.includes(viewer.id)) return null;
    const theirs = event.assigneeIds.filter((id) => own.includes(id));
    return theirs.length > 0 ? capitalise(forLabel(theirs, context.nameOf)) : null;
  };
  // "Suggest a task" (4.6): a client label the suggester sees, Active or Paused (decision 22).
  const choices = labels
    .filter((label) => label.state === "active" || label.state === "paused")
    .map((label) => ({ id: label.id, name: label.name }));

  return (
    <>
      <PageHeader title="My Day" description={myDayGreeting(viewer.name)} />
      <TodayAttendanceStrip
        endDayFollowUp={
          // End day's "Any expenses to claim today?" (3b.3): the claim form's setup is a
          // promise, read only if the person answers Yes.
          <EndDayClaims today={today} setup={getClaimSetup().catch(() => null)} />
        }
      />
      <div className="flex max-w-3xl min-w-0 flex-col gap-6" data-slot="my-day">
        {nothing ? (
          <QuietText slot="my-day-empty">{MY_DAY_EMPTY}</QuietText>
        ) : (
          MY_DAY_GROUPS.map((group) =>
            groups[group].length > 0 ? (
              <DashSection
                key={group}
                title={MY_GROUP_TITLES[group]}
                slot={`my-day-group-${group}`}
                count={groups[group].length}
              >
                <TaskRowList label={MY_GROUP_TITLES[group]}>
                  {groups[group].map(({ row, part }) => (
                    <TaskRow
                      key={row.id}
                      id={row.id}
                      title={row.title}
                      meta={rowMeta(row, context)}
                      status={row.state}
                      statusLabel={stateLabel(row)}
                      flag={rowFlag(row, now)}
                      note={forNote(
                        group === "not_noted"
                          ? part.notNoted
                          : [...(part.self ? [viewer.id] : []), ...part.forIds],
                        viewer.id,
                        context.nameOf,
                      )}
                      unread={unread[row.id] ?? 0}
                    />
                  ))}
                </TaskRowList>
              </DashSection>
            ) : null,
          )
        )}

        {upcoming > 0 ? (
          <RowList label="Upcoming" slot="my-day-upcoming">
            <LinkRow
              href="/tasks"
              slot="my-day-upcoming-line"
              icon={<ListTodoIcon className="size-4" aria-hidden />}
              title={upcomingLine(upcoming)}
              tab
            />
          </RowList>
        ) : null}

        {day.rows.length > 0 || day.moreThisWeek > 0 || quiet ? (
          <DashSection title="Events" slot="my-day-events" count={day.rows.length}>
            {day.rows.length > 0 ? (
              <EventRows
                events={day.rows}
                today={today}
                label="Your events today and tomorrow"
                slot="my-day-event-rows"
                note={forWhom}
              />
            ) : null}
            {day.moreThisWeek > 0 ? (
              <RowList label="More this week" slot="my-day-more-events">
                <LinkRow
                  href="/calendar"
                  slot="my-day-more-events-line"
                  icon={<CalendarDaysIcon className="size-4" aria-hidden />}
                  title={moreThisWeekLine(day.moreThisWeek)}
                  tab
                />
              </RowList>
            ) : null}
            {quiet ? <QuietText slot="my-day-quiet">{quiet}</QuietText> : null}
          </DashSection>
        ) : null}

        {can(viewer.role, "task_requests.create") ? (
          <div data-slot="my-day-suggest" className="flex *:w-full md:*:w-auto">
            <SuggestTaskButton clients={choices} variant="secondary" />
          </div>
        ) : null}
      </div>
    </>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whose work a row is, when it is not only the viewer's (ADR-0013): "For Asha", "You, and for Asha". */
function forNote(
  ids: readonly string[],
  viewerId: string,
  nameOf: (id: string) => string,
): string | null {
  const others = ids.filter((id) => id !== viewerId);
  if (others.length === 0) return null;
  const forWho = forLabel(others, nameOf);
  return ids.includes(viewerId) ? `You, and ${forWho}` : capitalise(forWho);
}
