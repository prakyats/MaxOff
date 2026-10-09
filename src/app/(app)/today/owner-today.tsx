import { FolderClockIcon, ListChecksIcon } from "lucide-react";

import type { CurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { addISTDays, systemClock, todayIST, type ISODate } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  getTodayPeople,
  getUnendedYesterday,
  summariseToday,
  TodayAttendanceCard,
} from "@/modules/attendance";
import { buildCalendar, parseCalendarQuery } from "@/modules/calendar";
import {
  CalendarHeaderLink,
  DashSection,
  heldEmailsLine,
  LinkRow,
  leaveRisks,
  notNotedRisks,
  overdueRisks,
  OWNER_APPROVALS_SHOWN,
  OWNER_NEEDS_YOU_EMPTY,
  OWNER_TODAY_EMPTY,
  QuietText,
  reachedAt,
  RiskRows,
  RowList,
  sortRisks,
  STRIP_DAYS,
  todaysTasks,
  todaysTasksLine,
  waitingFor,
  WeekBlocks,
  weekBlocks,
  type Risk,
  type Waiting,
} from "@/modules/dashboards";
import {
  activeAssignees,
  listUnreadCounts,
  taskTypeColor,
  type TaskListRow,
} from "@/modules/tasks";

import { firstInGroupOrder, taskItem } from "../approvals/items";
import { readDirectory, readOpenTasks, readTaskTypes } from "../tasks/reads";

import {
  PreviewClaims,
  PreviewDays,
  PreviewLeave,
  PreviewNotes,
  PreviewTasks,
} from "./approvals-preview";
import {
  readApprovals,
  readEventTasks,
  readHeldEmails,
  readHolidays,
  readLeaveDays,
  readNotNoted,
  readOverdueItems,
  readUnreachable,
  eventsHorizon,
} from "./reads";
import { ownerGreeting } from "./words";

/**
 * The Owner's Today (6.2; PRODUCT §2 principle 11, its first application; Kickoff 6 decisions 4–8,
 * 12, 22, 23 and 24; **the Today refresh, owner 2026-10-09, ROADMAP 6b.7**). In order:
 *
 * 1. **Needs you**: the approvals, first. One list of compact rows, no heading per kind: the
 *    oldest five in the Approvals group order (decision 5's cut), each a kind label and the name
 *    or title, then two short meta lines: what and when ("Absent (proposed) · Thu 8 Oct"), and
 *    how long it has waited alone ("Waiting 11 h", from when it reached the Owner; amber from a
 *    day, red from three), and one outlined button: Approve with the 6-second Undo, or Review
 *    where the decision needs the review (extra work and expenses, as on Approvals). A tap on the
 *    row opens the review. "See all N" only when the list is cut; "Nothing needs you." when
 *    nothing waits (the section always stands, so the screen keeps its shape).
 * 2. **Attendance**: the four counts in one row; Absent and yesterday's unended days as red lines
 *    under it, only above zero (decision 24's counts, links and colours; owner 2026-10-09).
 * 3. **Today's tasks**: one line, "N due today · M handed in".
 * 4. **Client work** (7.4; kickoff 7 amendment C, E1): one line, "N client items overdue", its
 *    icon and words in red, hidden at zero, opening the cross-client list grouped by Admin; no item
 *    approvals (issue #56 Q1: the client's Admin's) and no progress line (not an exception).
 * 5. **Overdue and risks** (decisions 6, 23): one status signal per row, the kind's icon and the
 *    meta line in red (overdue) or amber.
 * 6. **This week** (the detailed layout, the owner's final note 2026-10-09): a block per day with
 *    something in it, its rows a time on the left and the words on the right (a holiday, a
 *    person's consecutive leave as one row, each event opening its task, the deadlines as a
 *    count), at most five days and eight rows, then "See the week"; "Calendar ›" in the header.
 *
 * Sections 3–6 are drawn only with something in them (decision 24: exceptions only); when none
 * is, one muted line: "Nothing else needs you today." Not shown until their data exists
 * (decision 4): the revenue snapshot. The rule for every later addition (decision 24): exceptions
 * only, a count rather than a list where possible, one tap to the list, hidden when empty.
 */
export async function OwnerToday({ viewer }: { viewer: CurrentMember }) {
  const today = todayIST();
  const last = addISTDays(today, STRIP_DAYS - 1);
  const [
    people,
    open,
    directory,
    approvals,
    notNoted,
    unreachable,
    held,
    leaveDays,
    events,
    holidays,
    unended,
    types,
    overdueItems,
  ] = await Promise.all([
    getTodayPeople(),
    readOpenTasks(),
    readDirectory(),
    readApprovals(),
    // Each risk read only for whoever holds its key (PERMISSIONS "Screens (phase 6)"), so a
    // changed role setting hides a row instead of breaking the screen.
    readNotNoted(),
    can(viewer.role, "notifications.reachability") ? readUnreachable() : Promise.resolve([]),
    can(viewer.role, "settings.manage") ? readHeldEmails() : Promise.resolve(null),
    readDirectory().then((members) => readLeaveDays(today, last, teamIds(members))),
    readEventTasks(today, eventsHorizon(today)),
    readHolidays(),
    // Yesterday's End day not recorded, from the cutoff on (decision 24, amended 2026-10-08).
    getUnendedYesterday(),
    // Which task types show on the calendar: This week counts as the calendar's month view does.
    readTaskTypes(),
    // Client work (kickoff 7 amendment C E1, decision 24): one count line, hidden at zero.
    can(viewer.role, "items.tick") ? readOverdueItems(today) : Promise.resolve(0),
  ]);
  const [days, requests, notes, claims, toDecide] = approvals;
  const now = systemClock();
  const summary = summariseToday(people.people, people.isDayOff, unended);
  const names = new Map(directory.map((member) => [member.id, member]));
  const nameOf = (id: string) => names.get(id)?.fullName ?? "Someone";
  const nameRecord = Object.fromEntries(directory.map((member) => [member.id, member.fullName]));

  const total = days.length + requests.length + notes.length + claims.length + toDecide.length;
  const shown = firstInGroupOrder(
    { days, requests, notes, claims, toDecide },
    ["days", "requests", "notes", "claims", "toDecide"],
    OWNER_APPROVALS_SHOWN,
  );
  const shownCount =
    shown.days.length +
    shown.requests.length +
    shown.notes.length +
    shown.claims.length +
    shown.toDecide.length;
  // The task rows' unread comments (Kickoff 4 decision 28), for the rows shown only (A-S4).
  const unread = await listUnreadCounts(shown.toDecide.map((item) => item.row.id));
  const tasks = shown.toDecide.map((item) => ({
    ...taskItem(item, nameRecord, true),
    unread: unread[item.row.id] ?? 0,
  }));
  // How long each has waited for the Owner: from the hand-in, or the approving Admin's approval
  // when that came later (a task); a day's submission, or the 23:59 job's proposal; a request's,
  // note's or claim's sending.
  const waited = (since: string | null): Waiting | null => (since ? waitingFor(since, now) : null);
  const waiting = {
    days: waitingMap(shown.days, (day) => waited(day.submittedAt ?? day.updatedAt)),
    requests: waitingMap(shown.requests, (request) => waited(request.createdAt)),
    notes: waitingMap(shown.notes, (note) => waited(note.createdAt)),
    claims: waitingMap(shown.claims, (claim) => waited(claim.createdAt)),
    tasks: waitingMap(
      shown.toDecide.map((item) => ({ ...item, id: item.row.id })),
      (item) =>
        waited(reachedAt(item.submission?.at ?? item.row.submittedAt, item.adminApprovedAt)),
    ),
  };

  const dueToday = todaysTasks(open, today);

  const riskTasks = open.map(toRiskTask);
  const titles = new Map(open.map((row) => [row.id, row.title]));
  const risks: Risk[] = sortRisks([
    ...overdueRisks(riskTasks, now),
    ...notNotedRisks(notNoted, titles),
    ...leaveRisks(riskTasks, leaveDays, {
      from: today,
      to: addISTDays(today, 1),
      eventDays: false,
    }),
    ...unreachable.map((person): Risk => ({
      kind: "unreachable",
      memberId: person.memberId,
      name: person.name,
      openTasks: person.openTasks,
    })),
  ]);

  const week = weekBlocks({
    days: calendarWeek({ today, last, viewerId: viewer.id, events, open, types, holidays }),
    leave: leaveDays,
    nameOf,
    today,
  });
  // Exceptions only (decision 24): a section after the card with nothing in it is not drawn.
  const sections = {
    tasks: dueToday.due > 0,
    risks: risks.length > 0 || (held !== null && heldEmailsLine(held) !== null),
    clientWork: overdueItems > 0,
    week: week.blocks.length > 0,
  };
  const nothing = !Object.values(sections).some(Boolean);

  return (
    <>
      <PageHeader title="Today" description={ownerGreeting(viewer.name)} />
      <div className="flex max-w-3xl min-w-0 flex-col gap-6" data-slot="owner-today">
        <DashSection title="Needs you" slot="today-approvals" count={total}>
          {total === 0 ? (
            <QuietText slot="today-approvals-empty">{OWNER_NEEDS_YOU_EMPTY}</QuietText>
          ) : (
            <div className="flex min-w-0 flex-col gap-2" data-slot="today-approvals-preview">
              <ul
                aria-label="Waiting for you"
                data-slot="today-approval-rows"
                className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
              >
                {shown.days.length > 0 ? (
                  <PreviewDays days={shown.days} today={today} waiting={waiting.days} preview />
                ) : null}
                {shown.requests.length > 0 ? (
                  <PreviewLeave requests={shown.requests} waiting={waiting.requests} preview />
                ) : null}
                {shown.notes.length > 0 ? (
                  <PreviewNotes notes={shown.notes} waiting={waiting.notes} preview />
                ) : null}
                {shown.claims.length > 0 ? (
                  <PreviewClaims claims={shown.claims} waiting={waiting.claims} preview />
                ) : null}
                {tasks.length > 0 ? (
                  <PreviewTasks tasks={tasks} heading="Tasks" waiting={waiting.tasks} preview />
                ) : null}
              </ul>
              {/* "See all N" only when the list is cut (owner 2026-10-09). */}
              {total > shownCount ? (
                <RowList label="All approvals" slot="today-approvals-all">
                  <LinkRow
                    href="/approvals"
                    slot="today-see-all-approvals"
                    title={`See all ${total}`}
                    tab
                  />
                </RowList>
              ) : null}
            </div>
          )}
        </DashSection>

        <TodayAttendanceCard summary={summary} />

        {sections.tasks ? (
          <DashSection title="Today's tasks" slot="today-tasks">
            <RowList label="Today's tasks" slot="today-tasks-line">
              <LinkRow
                href="/tasks/all?overdue=today"
                slot="today-tasks-due"
                icon={<ListChecksIcon className="size-4" aria-hidden />}
                title={todaysTasksLine(dueToday)}
                tab
              />
            </RowList>
          </DashSection>
        ) : null}

        {/* Client work (7.4), after Today's tasks (owner 2026-10-09): one line, red for overdue,
            its icon and words in the one tone (the row's one status signal, as the risk rows). */}
        {sections.clientWork ? (
          <DashSection title="Client work" slot="today-client-work">
            <RowList label="Client work" slot="today-client-work-line">
              <LinkRow
                href="/clients/items?filter=overdue"
                slot="today-items-overdue"
                icon={
                  <FolderClockIcon
                    data-slot="today-items-overdue-icon"
                    className="text-danger size-4"
                    aria-hidden
                  />
                }
                title={
                  <span
                    data-slot="today-items-overdue-signal"
                    data-tone="danger"
                    className="text-danger"
                  >
                    {overdueItems === 1
                      ? "1 client item overdue"
                      : `${overdueItems} client items overdue`}
                  </span>
                }
                detail="Grouped by Admin"
              />
            </RowList>
          </DashSection>
        ) : null}

        {sections.risks ? (
          <DashSection title="Overdue and risks" slot="today-risks" count={risks.length}>
            <RiskRows
              risks={risks}
              held={held}
              empty={null}
              label="Overdue and risks"
              slot="today-risk-rows"
              nameOf={nameOf}
              today={today}
              now={now}
            />
          </DashSection>
        ) : null}

        {sections.week ? (
          <DashSection title="This week" slot="today-events" action={<CalendarHeaderLink />}>
            <WeekBlocks blocks={week.blocks} hidden={week.hidden} />
          </DashSection>
        ) : null}

        {nothing ? <QuietText slot="today-nothing-else">{OWNER_TODAY_EMPTY}</QuietText> : null}
      </div>
    </>
  );
}

/** Each shown item's waiting words, by its id (the rows read them on the client). */
function waitingMap<T extends { id: string }>(
  items: readonly T[],
  words: (item: T) => Waiting | null,
): Record<string, Waiting> {
  const map: Record<string, Waiting> = {};
  for (const item of items) {
    const value = words(item);
    if (value) map[item.id] = value;
  }
  return map;
}

/**
 * The week's days as the calendar's month view has them (`buildCalendar`, the Owner's scope, no
 * filter): a holiday, the events (the task types shown on the calendar), and "N due" (every other
 * open task due that day), from the reads Today already makes. Leave is This week's own (approved,
 * by name), so none goes in here.
 */
function calendarWeek(input: {
  today: ISODate;
  last: ISODate;
  viewerId: string;
  events: Parameters<typeof buildCalendar>[0]["events"];
  open: readonly TaskListRow[];
  types: readonly { id: string; name: string; showsOnCalendar: boolean; color: string | null }[];
  holidays: readonly { date: ISODate; name: string }[];
}) {
  const days = buildCalendar({
    range: { from: input.today, to: input.last },
    scope: "owner",
    viewerId: input.viewerId,
    query: parseCalendarQuery({}, input.today),
    events: input.events,
    openTasks: input.open.map((task) => ({
      id: task.id,
      title: task.title,
      dueAt: task.dueAt,
      clientId: task.clientId,
      taskTypeId: task.taskTypeId,
      primaryOwnerId: task.primaryOwnerId,
      assigneeIds: activeAssignees(task.assignees).map((a) => a.memberId),
    })),
    types: input.types.map((type) => ({
      id: type.id,
      name: type.name,
      showsOnCalendar: type.showsOnCalendar,
      color: taskTypeColor(type.color),
    })),
    clients: [],
    people: [],
    holidays: input.holidays,
    weeklyOffDays: [],
    leave: [],
    availability: null,
  });
  return days.map((day) => ({
    date: day.date,
    holiday: day.holiday,
    due: day.due.length,
    events: day.events.map((event) => ({
      id: event.id,
      title: event.title,
      startAt: event.startAt,
    })),
  }));
}

/** Everyone whose leave the Owner's Today reads: active employees, never the Owner. */
function teamIds(
  members: readonly { id: string; role: string; status: string; engagement: string }[],
): string[] {
  return members
    .filter((m) => m.status === "active" && m.engagement === "permanent" && m.role !== "owner")
    .map((m) => m.id);
}

function toRiskTask(row: TaskListRow) {
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    dueAt: row.dueAt,
    primaryOwnerId: row.primaryOwnerId,
    createdBy: row.createdBy,
    approvingAdminId: row.approvingAdminId,
    assigneeIds: activeAssignees(row.assignees).map((a) => a.memberId),
  };
}
