import { CheckCheckIcon, ListChecksIcon, UsersIcon } from "lucide-react";

import type { CurrentMember } from "@/core/auth/server";
import { ROLE_LABELS } from "@/core/lib/role-labels";
import { addISTDays, systemClock, todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  getTodayPeople,
  PeopleNeedingYou,
  summariseToday,
  TodayAttendanceCard,
} from "@/modules/attendance";
import {
  boardSize,
  DashSection,
  EventsStrip,
  eventsStrip,
  LinkRow,
  leaveRisks,
  NEEDS_YOU_PEOPLE_EMPTY,
  notNotedRisks,
  overdueRisks,
  peopleNeedingYou,
  QuietText,
  RiskRows,
  RISKS_EMPTY,
  RowList,
  sortRisks,
  STRIP_DAYS,
  todaysTasks,
  todaysTasksLine,
  type Risk,
} from "@/modules/dashboards";
import { activeAssignees, listUnreadCounts, type TaskListRow } from "@/modules/tasks";

import { firstInGroupOrder, taskItem } from "../approvals/items";
import { readDirectory, readOpenTasks } from "../tasks/reads";

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
  readUnreachable,
  eventsHorizon,
} from "./reads";
import { ownerGreeting } from "./words";

/** How many waiting items the preview shows (Kickoff 6 decision 5). */
const APPROVALS_SHOWN = 5;

/**
 * The Owner's Today (6.2; PRODUCT §2 principle 11, its first application; Kickoff 6 decisions 4–8,
 * 12, 22, 23): **counts → approvals → Needs you → the rest.** The attendance counts (each tappable:
 * Waiting opens Approvals, the others the full board on that group); the approvals preview (the
 * oldest five in the Approvals group order, Approve with Undo and Review, "See all N", no bulk);
 * "Needs you", the people who need attention today ("Everyone's in." when nobody does) with "See
 * all N people" one tap deeper; today's tasks as one line; Overdue and risks (five rows, then "See
 * all"; the emails the daily limit held back today); the next seven days' events. Not shown until
 * their data exists (decision 4): item approvals, client work progress, the revenue snapshot.
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
  ] = await Promise.all([
    getTodayPeople(),
    readOpenTasks(),
    readDirectory(),
    readApprovals(),
    readNotNoted(),
    readUnreachable(),
    readHeldEmails(),
    readDirectory().then((members) => readLeaveDays(today, last, teamIds(members))),
    readEventTasks(today, eventsHorizon(today)),
    readHolidays(),
  ]);
  const [days, requests, notes, claims, toDecide] = approvals;
  const now = systemClock();
  const summary = summariseToday(people.people, people.isDayOff);
  const names = new Map(directory.map((member) => [member.id, member]));
  const nameOf = (id: string) => names.get(id)?.fullName ?? "Someone";
  const nameRecord = Object.fromEntries(directory.map((member) => [member.id, member.fullName]));

  const total = days.length + requests.length + notes.length + claims.length + toDecide.length;
  const shown = firstInGroupOrder(
    { days, requests, notes, claims, toDecide },
    ["days", "requests", "notes", "claims", "toDecide"],
    APPROVALS_SHOWN,
  );
  // The task rows' unread comments (Kickoff 4 decision 28), for the rows shown only (A-S4).
  const unread = await listUnreadCounts(shown.toDecide.map((item) => item.row.id));
  const tasks = shown.toDecide.map((item) => ({
    ...taskItem(item, nameRecord, true),
    unread: unread[item.row.id] ?? 0,
  }));

  const needing = peopleNeedingYou(summary.board);
  const everyone = boardSize(summary.board);
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
  const strip = eventsStrip({ events, holidays, leave: leaveDays, today });

  return (
    <>
      <PageHeader title="Today" description={ownerGreeting(viewer.name)} />
      <TodayAttendanceCard summary={summary} />
      <div className="flex max-w-3xl min-w-0 flex-col gap-6" data-slot="owner-today">
        <DashSection title="Approvals" slot="today-approvals" count={total}>
          {total === 0 ? (
            <QuietText slot="today-approvals-empty">
              <CheckCheckIcon className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
              Nothing waiting. You&apos;re clear.
            </QuietText>
          ) : (
            <div className="flex min-w-0 flex-col gap-4" data-slot="today-approvals-preview">
              {shown.days.length > 0 ? (
                <PreviewDays days={shown.days} today={today} preview />
              ) : null}
              {shown.requests.length > 0 ? (
                <PreviewLeave requests={shown.requests} preview />
              ) : null}
              {shown.notes.length > 0 ? <PreviewNotes notes={shown.notes} /> : null}
              {shown.claims.length > 0 ? <PreviewClaims claims={shown.claims} /> : null}
              {tasks.length > 0 ? (
                <PreviewTasks tasks={tasks} heading={`${ROLE_LABELS.staff} tasks`} preview />
              ) : null}
              <RowList label="All approvals" slot="today-approvals-all">
                <LinkRow
                  href="/approvals"
                  slot="today-see-all-approvals"
                  title={`See all ${total}`}
                  tab
                />
              </RowList>
            </div>
          )}
        </DashSection>

        <DashSection title="Needs you" slot="today-needs-you" count={needing.length}>
          <PeopleNeedingYou
            rows={needing}
            empty={<QuietText slot="today-needs-you-empty">{NEEDS_YOU_PEOPLE_EMPTY}</QuietText>}
          />
          {everyone > 0 ? (
            <RowList label="Everyone today" slot="today-people-all">
              <LinkRow
                href="/today/people"
                slot="today-see-all-people"
                icon={<UsersIcon className="size-4" aria-hidden />}
                title={everyone === 1 ? "See all 1 person" : `See all ${everyone} people`}
              />
            </RowList>
          ) : null}
        </DashSection>

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

        <DashSection title="Overdue and risks" slot="today-risks" count={risks.length}>
          <RiskRows
            risks={risks}
            held={held}
            empty={<QuietText slot="today-risks-empty">{RISKS_EMPTY}</QuietText>}
            label="Overdue and risks"
            slot="today-risk-rows"
            nameOf={nameOf}
            today={today}
            now={now}
          />
        </DashSection>

        <DashSection title="This week" slot="today-events">
          <EventsStrip days={strip.days} hidden={strip.hidden} today={today} />
        </DashSection>
      </div>
    </>
  );
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
