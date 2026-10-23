import {
  BriefcaseIcon,
  ClipboardCheckIcon,
  FolderClockIcon,
  InboxIcon,
  Undo2Icon,
} from "lucide-react";

import type { CurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { addISTDays, systemClock, todayIST } from "@/core/time";
import { EmptyRow } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { TodayAttendanceStrip } from "@/modules/attendance";
import { CLIENT_STATE_LABELS } from "@/modules/clients";
import {
  clientProgressLine,
  dueThisWeek,
  itemView,
  lastChangeOf,
  progressByClient,
} from "@/modules/client-work";
import {
  ADMIN_NEEDS_YOU_EMPTY,
  adminScope,
  clientCounts,
  clientCountsLine,
  DashSection,
  dateLine,
  DayColumns,
  dayContext,
  LinkRow,
  leaveRisks,
  leaveWindow,
  ownLeaveDays,
  ownWeekDays,
  PhoneDateLine,
  RiskRows,
  RowList,
  sortRisks,
  STRIP_DAYS,
  ThisWeek,
  weekBlocks,
  type Risk,
} from "@/modules/dashboards";
import { listApprovedLeaveBetween } from "@/modules/leave";
import { getClaimSetup } from "@/modules/expenses";
import { EndDayClaims } from "@/modules/expenses/components/end-day-claims";
import {
  activeAssignees,
  countTasks,
  listUnreadCounts,
  MY_GROUP_TITLES,
  myTaskGroups,
  needsYou,
  needsYouSummary,
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

/** How many client items the Client work section lists before "See all N" (decision 19). */
const CLIENT_WORK_SHOWN = 5;

/** The Admin's own exception groups under "My tasks" (decision 9), in the Tasks tab's order. */
const OWN_GROUPS = ["not_noted", "changes_requested", "overdue", "due_today"] as const;

/**
 * The Admin's Today (6.3; Kickoff 6 decisions 9, 10, 12, 22): **the attendance strip → Needs you
 * (the Tasks tab's definition: tasks to approve, suggestions to decide, overdue and not noted past
 * the escalation on the tasks they manage; since kickoff 7 the client items sent back to them and
 * "N unfinished items to decide"; amendment D3 took "to approve" away) → **Client work** (7.3: items
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
    ownLeave,
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
    // This week's own leave (FINAL 8): the reader's approved requests in the next seven days.
    listApprovedLeaveBetween(viewer.id, today, addISTDays(today, STRIP_DAYS - 1)),
  ]);
  const now = systemClock();
  const names = new Map(directory.map((member) => [member.id, member]));
  // Each person's photo, from the directory already read (#89): no read of its own.
  const faceOf = (id: string) => {
    const member = names.get(id);
    return member
      ? { id: member.id, name: member.fullName, avatarFileId: member.avatarFileId }
      : undefined;
  };
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
  // Client work in Needs you (decision 19, amendments C and D): sent back, to decide.
  const sentBack = work?.sentBack ?? [];
  const itemsToDecide = can(viewer.role, "cycles.carry_decide") ? (work?.toDecide ?? 0) : 0;
  // B2: the heading counts the rows shown (links, deliverables sent back, task rows).
  const summary = needsYouSummary({
    needs,
    toDecide: counts.toDecide,
    links: [itemsToDecide, requests],
    otherRows: sentBack.length,
  });
  const nothingNeeded = summary.count === 0;
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
    readItemDetails(shownItems.map((row) => row.id)),
  ]);
  const fullNames = Object.fromEntries(directory.map((member) => [member.id, member.fullName]));
  const titles = Object.fromEntries(shownItems.map((row) => [row.id, row.title]));
  const lastChanges = Object.fromEntries(
    details.lastChanges.flatMap((entry) => {
      const change = lastChangeOf(entry, { names: fullNames, items: titles, stages: {} });
      return change ? [[entry.entityId, change] as const] : [];
    }),
  );
  const clientWork = shownItems.map((row) => ({
    view: itemView(row, {
      today,
      names: fullNames,
      ownerId: directory.find((member) => member.role === "owner")?.id ?? null,
      stages: details.stages,
      lastChanges,
      reviews: details.reviews,
      cycleLabels: {},
      cycleLabel: row.cycleLabel,
    }),
    where: `${row.projectName} · ${row.clientName}`,
    href: `/clients/${row.clientId}/projects/${row.projectId}?cycle=${row.cycleId}`,
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
  // This week (FINAL 8, major change 1): the holidays, the events they see (with the place), the
  // deadlines of their own open tasks by name, and their own approved leave.
  const last = addISTDays(today, STRIP_DAYS - 1);
  const ownDue = rows.filter(
    (row) =>
      row.primaryOwnerId === viewer.id ||
      activeAssignees(row.assignees).some((a) => a.memberId === viewer.id),
  );
  const week = weekBlocks({
    days: ownWeekDays({
      from: today,
      to: last,
      holidays,
      events: events.map((event) => ({ ...event, detail: event.location })),
      due: ownDue,
    }),
    leave: ownLeaveDays(viewer.id, ownLeave, { from: today, to: last }),
    nameOf: () => "You",
    today,
    selfId: viewer.id,
  });

  return (
    <>
      <PageHeader title="Today" description={dayContext(today, viewer.name)} />
      <PhoneDateLine line={dateLine(today)} />
      <TodayAttendanceStrip
        endDayFollowUp={<EndDayClaims today={today} setup={getClaimSetup().catch(() => null)} />}
      />
      <DayColumns
        slot="admin-today"
        week={<ThisWeek blocks={week.blocks} hidden={week.hidden} />}
        main={
          <>
            {/* FINAL 1: with nothing waiting, one quiet line and no heading. */}
            {nothingNeeded ? (
              <EmptyRow slot="today-needs-you-empty">{ADMIN_NEEDS_YOU_EMPTY}</EmptyRow>
            ) : (
              <DashSection title="Needs you" slot="today-needs-you" count={summary.count}>
                <div className="flex min-w-0 flex-col gap-2">
                  {counts.toDecide > 0 || requests > 0 || itemsToDecide > 0 ? (
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
                      {itemsToDecide > 0 ? (
                        <LinkRow
                          href="/clients/items/decide"
                          slot="today-items-to-decide"
                          icon={<FolderClockIcon className="size-4" aria-hidden />}
                          title={
                            itemsToDecide === 1
                              ? "1 unfinished deliverable to decide"
                              : `${itemsToDecide} unfinished deliverables to decide`
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
                    <RowList label="Deliverables sent back" slot="today-sent-back">
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
                          person={faceOf(item.row.primaryOwnerId)}
                        />
                      ))}
                    </TaskRowList>
                  ) : null}
                </div>
              </DashSection>
            )}

            {/* PP-admin-4: an empty Client work collapses into one muted line under My clients. */}
            {work !== null && due.length > 0 ? (
              <DashSection title="Client work" slot="today-client-work" count={due.length}>
                <div className="flex min-w-0 flex-col gap-2">
                  <TodayClientWorkLazy
                    items={clientWork}
                    permissions={{
                      manage: can(viewer.role, "projects.manage"),
                      tick: can(viewer.role, "items.tick"),
                      reopen: can(viewer.role, "items.approve"),
                      owner: false,
                    }}
                  />
                  {due.length > CLIENT_WORK_SHOWN ? (
                    <RowList label="All client deliverables" slot="today-client-work-all">
                      <LinkRow
                        href="/clients/items"
                        slot="today-see-all-items"
                        title={`See all ${due.length}`}
                      />
                    </RowList>
                  ) : null}
                </div>
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
                        group === "not_noted"
                          ? // PP-admin-13: their own note to give, the same chip as every row state.
                            { label: "Note it", tone: "attention" }
                          : group === "changes_requested"
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
                      title={
                        client.state === "active" ? (
                          client.name
                        ) : (
                          // B9: a non-Active client says so beside its name (Clients opens on Active).
                          <>
                            {client.name}
                            <span
                              className="text-muted-foreground font-normal"
                              data-slot="today-client-state"
                            >
                              {" "}
                              · {CLIENT_STATE_LABELS[client.state]}
                            </span>
                          </>
                        )
                      }
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
            {work !== null && due.length === 0 ? (
              <EmptyRow slot="today-client-work-empty">No client work due this week.</EmptyRow>
            ) : null}

            {issues.length > 0 ? (
              <DashSection title="Issues" slot="today-issues" count={issues.length}>
                <RiskRows
                  risks={issues}
                  held={null}
                  empty={null}
                  label="Issues"
                  slot="today-issue-rows"
                  nameOf={(id) => names.get(id)?.fullName ?? "Someone"}
                  faceOf={faceOf}
                  today={today}
                  now={now}
                />
              </DashSection>
            ) : null}
          </>
        }
      />
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
  // W5: the row's Overdue chip says it; no second line repeating it.
  if (item.reason === "overdue") return null;
  const first = item.waitingOn[0];
  if (!first) return null;
  const who = nameOf(first.memberId);
  const more = item.waitingOn.length > 1 ? ` and ${item.waitingOn.length - 1} more` : "";
  return `${who.charAt(0).toUpperCase()}${who.slice(1)}${more} hasn't noted it · ${waitedLabel(first.hours)}`;
}
