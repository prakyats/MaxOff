import { BriefcaseIcon, ClipboardCheckIcon, InboxIcon } from "lucide-react";

import type { CurrentMember } from "@/core/auth/server";
import { systemClock, todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { TodayAttendanceStrip } from "@/modules/attendance";
import {
  ADMIN_NEEDS_YOU_EMPTY,
  adminScope,
  clientCounts,
  clientCountsLine,
  DashSection,
  EventsStrip,
  eventsStrip,
  LinkRow,
  leaveRisks,
  leaveWindow,
  QuietText,
  RiskRows,
  RowList,
  sortRisks,
  type Risk,
} from "@/modules/dashboards";
import { getClaimSetup } from "@/modules/expenses";
import { EndDayClaims } from "@/modules/expenses/components/end-day-claims";
import {
  activeAssignees,
  countTasks,
  listUnreadCounts,
  MY_GROUP_TITLES,
  myTaskGroups,
  needsYou,
  rowMeta,
  stateLabel,
  TaskRow,
  TaskRowList,
  waitedLabel,
  type NeedsYouItem,
  type TaskListRow,
} from "@/modules/tasks";

import { rowFlag } from "../my-day/words";
import { readClientLabels, readDirectory, readOpenTasks, readOwnFreelancers } from "../tasks/reads";

import {
  readClients,
  readEventTasks,
  readHolidays,
  readLeaveDays,
  readRequestsToDecide,
  readSettings,
  readUnreachable,
  eventsHorizon,
} from "./reads";
import { adminGreeting } from "./words";

/** The Admin's own exception groups under "My tasks" (decision 9), in the Tasks tab's order. */
const OWN_GROUPS = ["not_noted", "changes_requested", "overdue", "due_today"] as const;

/**
 * The Admin's Today (6.3; Kickoff 6 decisions 9, 10, 12, 22): **the attendance strip → Needs you
 * (the Tasks tab's definition: tasks to approve, suggestions to decide, overdue and not noted past
 * the escalation on the tasks they manage) → My tasks (their own assigned work, exception rows
 * only) → My clients (each assigned client's open and overdue labelled tasks; cycle progress in
 * 7.3) → the calendar strip → Issues** (an assignee on approved leave on an open task's deadline or
 * event day, or who can't be reached, on the tasks they created or approve; hidden when empty).
 * Never money, attendance decisions or anyone's leave beyond `member_availability()` (PERMISSIONS
 * §2); never a client record for Crew (this screen is the Admin's).
 */
export async function AdminToday({ viewer }: { viewer: CurrentMember }) {
  const today = todayIST();
  const [
    rows,
    directory,
    labels,
    own,
    counts,
    requests,
    settings,
    clients,
    unreachable,
    events,
    holidays,
  ] = await Promise.all([
    readOpenTasks(),
    readDirectory(),
    readClientLabels(),
    readOwnFreelancers(),
    countTasks(),
    readRequestsToDecide(),
    readSettings(),
    readClients(),
    readUnreachable(),
    readEventTasks(today, eventsHorizon(today)),
    readHolidays(),
  ]);
  const now = systemClock();
  const names = new Map(directory.map((member) => [member.id, member]));
  const clientNames = new Map(labels.map((label) => [label.id, label.name]));
  const context = {
    viewerId: viewer.id,
    nameOf: (id: string) => (id === viewer.id ? "you" : (names.get(id)?.fullName ?? "Someone")),
    engagementOf: (id: string) => names.get(id)?.engagement,
    clientName: (id: string) => clientNames.get(id) ?? null,
  };
  const listViewer = { id: viewer.id, role: viewer.role, coordinates: own };

  // Needs you: what they answer for on the tasks they manage; their own notes and fixes are below.
  const needs = needsYou(rows, listViewer, now, settings).filter(
    (item) => item.reason === "overdue" || item.reason === "not_noted",
  );
  const inNeeds = new Set(needs.map((item) => item.row.id));
  const groups = myTaskGroups(rows, listViewer, now, today);
  const mine = OWN_GROUPS.flatMap((group) =>
    groups[group].filter((item) => !inNeeds.has(item.row.id)).map((item) => ({ ...item, group })),
  );
  const unread = await listUnreadCounts([
    ...needs.map((i) => i.row.id),
    ...mine.map((i) => i.row.id),
  ]);
  const nothingNeeded = needs.length === 0 && counts.toDecide === 0 && requests === 0;

  // My clients: the clients they run (not closed), each with its labelled tasks' counts.
  const runs = clients.filter(
    (client) => client.adminId === viewer.id && client.state !== "inactive",
  );
  const perClient = clientCounts(runs, rows, now);

  // Issues: on the open tasks they created or approve (5.4's Admin scope).
  const scoped = adminScope(rows.map(toRiskTask), viewer.id);
  const eventDays = new Map(events.map((event) => [event.id, event.eventDate]));
  const scopedEvents = scoped.map((task) => ({
    ...task,
    eventDate: eventDays.get(task.id) ?? null,
  }));
  const window = leaveWindow(scopedEvents, today);
  const assignees = [...new Set(scoped.flatMap((task) => task.assigneeIds))];
  const leave = await readLeaveDays(window.from, window.to, assignees);
  const issues: Risk[] = sortRisks([
    ...leaveRisks(scopedEvents, leave, { ...window, eventDays: true }),
    ...unreachable.map((person): Risk => ({
      kind: "unreachable",
      memberId: person.memberId,
      name: person.name,
      openTasks: person.openTasks,
    })),
  ]);
  const strip = eventsStrip({ events, holidays, leave: null, today });

  return (
    <>
      <PageHeader title="Today" description={adminGreeting(viewer.name)} />
      <TodayAttendanceStrip
        endDayFollowUp={<EndDayClaims today={today} setup={getClaimSetup().catch(() => null)} />}
      />
      <div className="flex max-w-3xl min-w-0 flex-col gap-6" data-slot="admin-today">
        <DashSection title="Needs you" slot="today-needs-you" count={needs.length}>
          {nothingNeeded ? (
            <QuietText slot="today-needs-you-empty">{ADMIN_NEEDS_YOU_EMPTY}</QuietText>
          ) : (
            <div className="flex min-w-0 flex-col gap-2">
              {counts.toDecide > 0 || requests > 0 ? (
                <RowList label="Waiting for you" slot="today-waiting">
                  {counts.toDecide > 0 ? (
                    <LinkRow
                      href="/approvals"
                      slot="today-to-approve"
                      icon={<ClipboardCheckIcon className="size-4" aria-hidden />}
                      title={
                        counts.toDecide === 1
                          ? "1 task waiting for your check"
                          : `${counts.toDecide} tasks waiting for your check`
                      }
                      tab
                    />
                  ) : null}
                  {requests > 0 ? (
                    <LinkRow
                      href="/tasks/requests"
                      slot="today-requests"
                      icon={<InboxIcon className="size-4" aria-hidden />}
                      title={
                        requests === 1
                          ? "1 suggested task to decide"
                          : `${requests} suggested tasks to decide`
                      }
                    />
                  ) : null}
                </RowList>
              ) : null}
              {needs.length > 0 ? (
                <TaskRowList label="Needs you" slot="today-needs-rows">
                  {needs.map((item) => (
                    <TaskRow
                      key={item.row.id}
                      id={item.row.id}
                      title={item.row.title}
                      meta={rowMeta(item.row, context)}
                      status={item.row.state}
                      statusLabel={stateLabel(item.row)}
                      flag={
                        item.reason === "overdue"
                          ? { label: "Overdue", tone: "danger" }
                          : { label: "Not noted", tone: "attention" }
                      }
                      note={needsNote(item, context.nameOf)}
                      unread={unread[item.row.id] ?? 0}
                    />
                  ))}
                </TaskRowList>
              ) : null}
            </div>
          )}
        </DashSection>

        {mine.length > 0 ? (
          <DashSection title="My tasks" slot="today-my-tasks" count={mine.length}>
            <TaskRowList label="My tasks">
              {mine.map(({ row, group }) => (
                <TaskRow
                  key={row.id}
                  id={row.id}
                  title={row.title}
                  meta={rowMeta(row, context)}
                  status={row.state}
                  statusLabel={stateLabel(row)}
                  flag={
                    group === "not_noted" || group === "changes_requested"
                      ? { label: MY_GROUP_TITLES[group], tone: "attention" }
                      : rowFlag(row, now)
                  }
                  unread={unread[row.id] ?? 0}
                />
              ))}
            </TaskRowList>
          </DashSection>
        ) : null}

        {perClient.length > 0 ? (
          <DashSection title="My clients" slot="today-my-clients" count={perClient.length}>
            <RowList label="My clients" slot="today-client-rows">
              {perClient.map(({ client, open, overdue }) => (
                <LinkRow
                  key={client.id}
                  href={`/clients/${client.id}`}
                  slot="today-client-row"
                  icon={<BriefcaseIcon className="size-4" aria-hidden />}
                  title={client.name}
                  detail={clientCountsLine({ open, overdue })}
                />
              ))}
            </RowList>
          </DashSection>
        ) : null}

        <DashSection title="This week" slot="today-events">
          <EventsStrip days={strip.days} hidden={strip.hidden} today={today} />
        </DashSection>

        {issues.length > 0 ? (
          <DashSection title="Issues" slot="today-issues" count={issues.length}>
            <RiskRows
              risks={issues}
              held={null}
              empty={null}
              label="Issues"
              slot="today-issue-rows"
              nameOf={(id) => names.get(id)?.fullName ?? "Someone"}
              today={today}
              now={now}
            />
          </DashSection>
        ) : null}
      </div>
    </>
  );
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

function needsNote(item: NeedsYouItem, nameOf: (id: string) => string): string | null {
  if (item.reason === "overdue") return "Past its deadline";
  const first = item.waitingOn[0];
  if (!first) return null;
  const who = nameOf(first.memberId);
  const more = item.waitingOn.length > 1 ? ` and ${item.waitingOn.length - 1} more` : "";
  return `${who.charAt(0).toUpperCase()}${who.slice(1)}${more} hasn't noted it · ${waitedLabel(first.hours)}`;
}
