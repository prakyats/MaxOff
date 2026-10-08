import {
  BriefcaseIcon,
  ClipboardCheckIcon,
  FolderClockIcon,
  InboxIcon,
  Undo2Icon,
} from "lucide-react";

import type { CurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { systemClock, todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { TodayAttendanceStrip } from "@/modules/attendance";
import { clientProgressLine, dueThisWeek, itemView, progressByClient } from "@/modules/client-work";
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
  readAdminClientWork,
  readClientProgress,
  readClients,
  readEventTasks,
  readItemDetails,
  readHolidays,
  readLeaveDays,
  readRequestsToDecide,
  readSettings,
  readUnreachable,
  eventsHorizon,
} from "./reads";
import { TodayClientWorkLazy } from "./client-work-lazy";
import { adminGreeting } from "./words";

/** How many client items the Client work section lists before "See all N" (decision 19). */
const CLIENT_WORK_SHOWN = 5;

/** The Admin's own exception groups under "My tasks" (decision 9), in the Tasks tab's order. */
const OWN_GROUPS = ["not_noted", "changes_requested", "overdue", "due_today"] as const;

/**
 * The Admin's Today (6.3; Kickoff 6 decisions 9, 10, 12, 22): **the attendance strip → Needs you
 * (the Tasks tab's definition: tasks to approve, suggestions to decide, overdue and not noted past
 * the escalation on the tasks they manage; since kickoff 7 the client items sent back to them, "N
 * client items to approve" and "N unfinished items to decide") → **Client work** (7.3: items
 * overdue or due this week, oldest first, five then "See all N", each with Mark done and its Undo;
 * loaded after the page) → My tasks (their own assigned work, exception rows only) → My clients
 * (each assigned client's open and overdue labelled tasks and its current cycles' progress) → the
 * calendar strip → Issues** (an assignee on approved leave on an open task's deadline or
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
    work,
    progress,
  ] = await Promise.all([
    readOpenTasks(),
    readDirectory(),
    readClientLabels(),
    readOwnFreelancers(),
    countTasks(),
    readRequestsToDecide(),
    readSettings(),
    readClients(),
    // Each risk read only for whoever holds its key (PERMISSIONS "Screens (phase 6)").
    can(viewer.role, "notifications.reachability") ? readUnreachable() : Promise.resolve([]),
    readEventTasks(today, eventsHorizon(today)),
    readHolidays(),
    // Client work (kickoff 7 decision 19, amendment C): only for whoever ticks items.
    can(viewer.role, "items.tick") ? readAdminClientWork(today, viewer.id) : Promise.resolve(null),
    can(viewer.role, "items.tick") ? readClientProgress(today) : Promise.resolve(null),
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
  // Client work in Needs you (decision 19, amendment C): sent back, to approve, to decide.
  const sentBack = work?.sentBack ?? [];
  const itemsToApprove = can(viewer.role, "items.approve") ? (work?.toApprove ?? 0) : 0;
  const itemsToDecide = can(viewer.role, "cycles.carry_decide") ? (work?.toDecide ?? 0) : 0;
  const nothingNeeded =
    needs.length === 0 &&
    counts.toDecide === 0 &&
    requests === 0 &&
    sentBack.length === 0 &&
    itemsToApprove === 0 &&
    itemsToDecide === 0;
  // The Client work section: overdue or due this week, oldest first, five then "See all N".
  const due = work ? dueThisWeek(work.due, today) : [];
  const shownItems = due.slice(0, CLIENT_WORK_SHOWN);

  // My clients: the clients they run (not closed), each with its labelled tasks' counts.
  const runs = clients.filter(
    (client) => client.adminId === viewer.id && client.state !== "inactive",
  );
  const perClient = clientCounts(runs, rows, now);
  const clientProgress = progress ? progressByClient(progress) : new Map();

  // Issues: on the open tasks they created or approve (5.4's Admin scope).
  const scoped = adminScope(rows.map(toRiskTask), viewer.id);
  const eventDays = new Map(events.map((event) => [event.id, event.eventDate]));
  const scopedEvents = scoped.map((task) => ({
    ...task,
    eventDate: eventDays.get(task.id) ?? null,
  }));
  const window = leaveWindow(scopedEvents, today);
  const assignees = [...new Set(scoped.flatMap((task) => task.assigneeIds))];
  // The rows' unread comments (for the rows shown only, A-S4) and the leave check, in one wave.
  const [unread, leave, details] = await Promise.all([
    listUnreadCounts([...needs.map((i) => i.row.id), ...mine.map((i) => i.row.id)]),
    can(viewer.role, "availability.view")
      ? readLeaveDays(window.from, window.to, assignees)
      : Promise.resolve([]),
    readItemDetails(
      shownItems.map((row) => row.projectId),
      shownItems.map((row) => row.id),
    ),
  ]);
  const clientWork = shownItems.map((row) => ({
    view: itemView(row, {
      today,
      names: Object.fromEntries(directory.map((member) => [member.id, member.fullName])),
      ticks: details.ticks,
      reviews: details.reviews,
      cycleLabels: {},
      cycleLabel: row.cycleLabel,
    }),
    where: `${row.projectName} · ${row.clientName}`,
    href: `/clients/${row.clientId}/projects/${row.projectId}?cycle=${row.cycleId}`,
    stages: details.stages
      .filter((stage) => stage.projectId === row.projectId && !stage.archived)
      .sort((a, b) => (a.position < b.position ? -1 : 1))
      .map((stage) => ({ id: stage.id, name: stage.name })),
  }));
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
              {counts.toDecide > 0 || requests > 0 || itemsToApprove > 0 || itemsToDecide > 0 ? (
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
                  {itemsToApprove > 0 ? (
                    <LinkRow
                      href="/approvals"
                      slot="today-items-to-approve"
                      icon={<ClipboardCheckIcon className="size-4" aria-hidden />}
                      title={
                        itemsToApprove === 1
                          ? "1 client item to approve"
                          : `${itemsToApprove} client items to approve`
                      }
                      tab
                    />
                  ) : null}
                  {itemsToDecide > 0 ? (
                    <LinkRow
                      href="/clients/items/decide"
                      slot="today-items-to-decide"
                      icon={<FolderClockIcon className="size-4" aria-hidden />}
                      title={
                        itemsToDecide === 1
                          ? "1 unfinished item to decide"
                          : `${itemsToDecide} unfinished items to decide`
                      }
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
              {sentBack.length > 0 ? (
                <RowList label="Client items sent back" slot="today-sent-back">
                  {sentBack.map((row) => (
                    <LinkRow
                      key={row.id}
                      href={`/clients/${row.clientId}/projects/${row.projectId}?cycle=${row.cycleId}`}
                      slot="today-sent-back-row"
                      icon={<Undo2Icon className="size-4" aria-hidden />}
                      title={row.title}
                      detail={`Sent back by ${names.get(row.reviewerId)?.fullName ?? "Someone"}: ${row.reason ?? ""} · ${row.projectName}`}
                    />
                  ))}
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

        {work !== null ? (
          <DashSection title="Client work" slot="today-client-work" count={due.length}>
            {due.length === 0 ? (
              <QuietText slot="today-client-work-empty">Nothing due this week.</QuietText>
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                <TodayClientWorkLazy
                  items={clientWork}
                  permissions={{
                    manage: can(viewer.role, "projects.manage"),
                    tick: can(viewer.role, "items.tick"),
                    approve: can(viewer.role, "items.approve"),
                  }}
                />
                {due.length > CLIENT_WORK_SHOWN ? (
                  <RowList label="All client items" slot="today-client-work-all">
                    <LinkRow
                      href="/clients/items"
                      slot="today-see-all-items"
                      title={`See all ${due.length}`}
                    />
                  </RowList>
                ) : null}
              </div>
            )}
          </DashSection>
        ) : null}

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
                  detail={[
                    clientCountsLine({ open, overdue }),
                    clientProgressLine(clientProgress.get(client.id)),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
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
