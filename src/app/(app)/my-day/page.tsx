import type { Metadata } from "next";

import { checkThenRead, startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { systemClock, todayIST } from "@/core/time";
import { EmptyRow } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getOwnToday, TodayAttendanceStrip } from "@/modules/attendance";
import {
  dateLine,
  DashSection,
  DayColumns,
  dayContext,
  MY_DAY_EMPTY,
  MY_DAY_GROUPS,
  PhoneDateLine,
  ThisWeek,
} from "@/modules/dashboards";
import { getClaimSetup } from "@/modules/expenses";
import { EndDayClaims } from "@/modules/expenses/components/end-day-claims";
import {
  forLabel,
  listUnreadCounts,
  MY_GROUP_TITLES,
  myTaskGroups,
  rowMeta,
  stateLabel,
  TaskRow,
  TaskRowList,
} from "@/modules/tasks";
import { SuggestTaskButton } from "@/modules/tasks/components/suggest-task-button";

import { ownWeek, readOwnWeek } from "../tasks/own-week";
import { readClientLabels, readDirectory, readOpenTasks, readOwnFreelancers } from "../tasks/reads";

import { rowFlag } from "./words";

export const metadata: Metadata = { title: "My Day" };

/**
 * Crew's home (6.1; Kickoff 6 decisions 1–3, 22; PRODUCT §4.7 "Crew: My Day"). Today's attendance
 * is one line on top (the strip, 2.3 polish; Start day / End day since 3b.1), then **the exception
 * rows** in the Tasks tab's order (Not noted · Changes requested · Overdue · Due today, a
 * coordinator's freelancers' tasks mixed in "for Asha"; never counts), then **This week** (V5b
 * major change 1, FINAL 8, PP-crew-7: the holidays, their events with the place, each of their
 * own deadlines by name and their own leave, a laptop column from an 896 px content width,
 * `DayColumns`; it replaces the Upcoming line and the Events section), and **Suggest a task** as
 * a quiet link at the foot (PP-crew-2). No sign-out row (decision 3): End day is in the strip and "Sign
 * out of this device" on Me. Whoever marks attendance opens it (`attendance.self`); the Owner has
 * no day. Every part is a server component or loads after the page (the first-load budget, 6.0);
 * it updates live through the bell's Realtime connection (`LiveUpdates`, decision 8).
 */
export default async function MyDayPage() {
  // The strip's day and End day's claim setup start with the session read, not after it (§19).
  startEarly(getOwnToday(), getClaimSetup());
  const today = todayIST();
  const openRows = readOpenTasks();
  const [viewer, [rows, directory, labels, own, unread, weekRead]] = await checkThenRead(
    requirePermission("attendance.self"),
    Promise.all([
      openRows,
      readDirectory(),
      readClientLabels(),
      readOwnFreelancers(),
      // Each row's unread comments (Kickoff 4 decision 28), for these rows only (A-S4).
      openRows.then((open) => listUnreadCounts(open.map((row) => row.id))),
      readOwnWeek(today),
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

  // This week (FINAL 8, major change 1, PP-crew-7), the same read and blocks as My tasks'.
  const week = ownWeek({
    read: weekRead,
    viewerId: viewer.id,
    own,
    groups,
    nameOf: context.nameOf,
    today,
  });
  // "Suggest a task" (4.6): a client label the suggester sees, Active or Paused (decision 22).
  const choices = labels
    .filter((label) => label.state === "active" || label.state === "paused")
    .map((label) => ({ id: label.id, name: label.name }));

  return (
    <>
      <PageHeader title="My Day" description={dayContext(today, viewer.name)} />
      <PhoneDateLine line={dateLine(today)} />
      <TodayAttendanceStrip
        endDayFollowUp={
          // End day's "Any expenses to claim today?" (3b.3): the claim form's setup is a
          // promise, read only if the person answers Yes.
          <EndDayClaims today={today} setup={getClaimSetup().catch(() => null)} />
        }
      />
      <DayColumns
        slot="my-day"
        week={<ThisWeek blocks={week.blocks} hidden={week.hidden} slot="my-day-events" />}
        main={
          <>
            {nothing ? (
              <EmptyRow slot="my-day-empty">{MY_DAY_EMPTY}</EmptyRow>
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

            {/* PP-crew-2: "Suggest a task" is a quiet link at the foot, not a button. */}
            {can(viewer.role, "task_requests.create") ? (
              <div data-slot="my-day-suggest" className="flex">
                <SuggestTaskButton clients={choices} variant="quiet" />
              </div>
            ) : null}
          </>
        }
      />
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
