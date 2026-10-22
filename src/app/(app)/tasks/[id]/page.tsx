import { CalendarClockIcon, ChevronRightIcon, CircleAlertIcon, FlagIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";

import { ACTIVITY_LIMIT } from "@/core/activity";
import { CustomFieldsView } from "@/core/custom-fields/components/custom-fields-view";
import { displayName } from "@/core/lib/display-name";
import { startEarly } from "@/core/lib/start-early";
import { cn } from "@/core/lib/utils";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { formatDateTime, systemClock, todayIST } from "@/core/time";
import { HistorySheet } from "@/core/ui/composites/history-sheet";
import { DetailHeader } from "@/core/ui/composites/page-header";
import { AvatarStack, type AvatarPerson, PersonAvatar } from "@/core/ui/composites/person-avatar";
import { StatusBadge, StatusDot } from "@/core/ui/composites/status-badge";
import {
  activeAssignees,
  chatEvents,
  chatMessages,
  collapseTicks,
  describeTaskActivity,
  eventLabel,
  earlierHandInLabel,
  firstUnreadId,
  handInFirst,
  HISTORY_ARRIVAL,
  reopenAfterHandIn,
  isFinal,
  isLocked,
  latestChangeRequest,
  listUnreadCounts,
  LinkedText,
  moreSteps,
  neededLine,
  newestCommentAt,
  nextStep,
  pairName,
  PRIORITY_LABELS,
  relativeDeadline,
  remindAgainAt,
  remindAgainLabel,
  remindWho,
  reviewerName,
  routeLine,
  stateLabel,
  taskActions,
  unreadCount,
  type PeopleIndex,
} from "@/modules/tasks";
import { TaskActivityList } from "@/modules/tasks/components/task-activity-list";
import { TaskChat } from "@/modules/tasks/components/task-chat";
import { TaskMenu } from "@/modules/tasks/components/task-menu";
import { TaskNextStep } from "@/modules/tasks/components/task-next-step";
import { TaskRemind } from "@/modules/tasks/components/task-remind";
import { TaskStages } from "@/modules/tasks/components/task-stages";
import { TaskTabs, TaskViewPanel, TaskViewProvider } from "@/modules/tasks/components/task-view";
import { RecordReadReceipt } from "@/modules/notifications-center";

import { loadTaskFormSetup } from "../task-form-setup";

import { loadNames, loadTask, TASK_BACK, UUID } from "./task";

/** The tab names the task ("Test 4 · MaxOff"), from the page's own cached read (`loadTask`). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Task" };
  const { task } = await loadTask(id);
  return { title: task?.title ?? "Task" };
}

/**
 * A task's page (4.4, reworked to the owner's review, Kickoff 4 decisions 26–32; PRODUCT §4.6,
 * WORKFLOWS §3, ADR-0013), a drill-down from Tasks. **The first glance** answers "what do I do
 * with this task now?" (PRODUCT §2): the title, one line with the state, the priority and the
 * deadline relative to now (red once it has passed), what is needed from the viewer, and **only
 * the next step** (a sticky bar on a phone); everything else is under ⋯. **The views below** are
 * a view control (replaced, never history): **Work** (the brief, the stages and the hand-in),
 * **Chat** (the comments; a full-height sheet on a phone), **Activity** (the newest five changes,
 * then Show all) and **Details** (the people and their Task Noted, the client, the type, the
 * approval route, who created it, the task's fields; the right panel on a desktop). A task lands
 * on Work; the hand-in leads it once the task is handed in, so a reviewer lands on it. RLS decides
 * who sees it: anyone else gets the not-found screen. Wherever a freelancer's coordinator acted,
 * both are named ("Ravi for Asha"), each by their full name (decision 30).
 */
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  // The task's reads are keyed by the URL, so they start with the session check and are awaited
  // after it (ARCHITECTURE §19, `startEarly`). The names wait for the role and the task's reads (a
  // genuine dependency): the Owner and Admins read the whole directory, anyone else only the people
  // the task names (PROGRESS "4B mechanics" (1)).
  const reads = loadTask(id);
  startEarly(reads);
  const viewer = await requirePermission("tasks.work");
  const namesRead = loadNames(can(viewer.role, "team.view"), reads);
  startEarly(namesRead);
  const data = await reads;
  const { task } = data;
  if (!task) notFound();
  const directory = await namesRead;

  const names: Record<string, string> = Object.fromEntries(
    directory.map((member) => [member.id, displayName(member.fullName)]),
  );
  // Each person's photo comes with their name, in the same directory read (V5b-D).
  const faces: Record<string, AvatarPerson> = Object.fromEntries(
    directory.map((member) => [
      member.id,
      { id: member.id, name: displayName(member.fullName), avatarFileId: member.avatarFileId },
    ]),
  );
  const name = (memberId: string | null) => (memberId ? (names[memberId] ?? "Someone") : "Someone");
  const nameOrYou = (memberId: string) => (memberId === viewer.id ? "you" : name(memberId));
  const people: PeopleIndex = Object.fromEntries(
    directory.map((member) => [
      member.id,
      {
        name: displayName(member.fullName),
        engagement: member.engagement,
        coordinatorId:
          data.coordinators[member.id] ??
          (data.ownFreelancers.includes(member.id) ? viewer.id : null),
      },
    ]),
  );
  const actions = taskActions(task, data.assignees, people, {
    id: viewer.id,
    role: viewer.role,
    coordinates: data.ownFreelancers,
  });
  const next = nextStep(actions);
  const more = moreSteps(actions, next);
  const deadline = relativeDeadline(task, systemClock());
  const needed = neededLine({ task, assignees: data.assignees, next, nameOf: nameOrYou });
  const active = activeAssignees(data.assignees).sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary),
  );
  const type = data.types.find((option) => option.id === task.taskTypeId) ?? null;
  const client = task.clientId
    ? (data.labels.find((label) => label.id === task.clientId) ?? null)
    : null;
  const definitions = data.definitions.filter(
    (definition) => definition.taskTypeId === null || definition.taskTypeId === task.taskTypeId,
  );
  const changeRequest =
    task.state === "changes_requested" ? latestChangeRequest(data.reviews) : null;
  const pair = (actorId: string | null, onBehalfOf: string | null) =>
    pairName(names, actorId, onBehalfOf);
  const admins = directory
    .filter(
      (member) =>
        member.role === "admin" && member.status === "active" && member.engagement === "permanent",
    )
    .map((member) => ({ id: member.id, name: displayName(member.fullName) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const doneFor = actions.done?.onBehalfOf ? name(actions.done.onBehalfOf) : null;
  const doneLabel = `${actions.done?.again ? "Mark done again" : "Mark done"}${doneFor ? ` for ${doneFor}` : ""}`;
  const commentFor = actions.commentFor.map((memberId) => ({ id: memberId, name: name(memberId) }));
  const selfOnTask = active.some((assignee) => assignee.memberId === viewer.id);
  // 6b.2: the Owner's own task (the route line) and Remind's hour, from what the page read.
  const ownerId = directory.find((member) => member.role === "owner")?.id ?? null;
  const remindAt = actions.remind ? remindAgainAt(data.activity, systemClock()) : null;
  // Whom Remind reaches (the others on the task), named on the button; unnamed, "everyone".
  const remindNames = active
    .filter((assignee) => assignee.memberId !== viewer.id)
    .map((assignee) => names[assignee.memberId]);
  const remindTo = remindWho(
    remindNames.every((one) => one !== undefined) ? (remindNames as string[]) : [],
  );

  const state = (
    <StatusBadge
      status={task.state}
      label={stateLabel(task, { finalApprover: can(viewer.role, "tasks.approve_final") })}
    />
  );
  // PP-crew-8: the one next step is the header's primary action on a laptop and the sticky bar
  // at a phone's foot: one element (`primaryOwnBar`), so its dialogs mount once.
  const stepBar = (
    <TaskNextStep
      taskId={task.id}
      dueAt={task.dueAt}
      next={next}
      done={actions.done}
      review={actions.review}
      names={names}
      approverName={task.approvingAdminId ? name(task.approvingAdminId) : null}
      primaryName={name(task.primaryOwnerId)}
    />
  );

  const work = workPanel({ data, task, actions, pair });
  const chat = await chatData({ data, viewerId: viewer.id, names, faces, active });
  const activity = activityPanel({ data, names, viewerId: viewer.id });
  const details = detailsPanel({
    data,
    task,
    active,
    people,
    viewerId: viewer.id,
    name,
    pair,
    typeName: type?.name ?? null,
    clientName: client?.name ?? null,
    definitions,
    ownerId,
    faces,
  });

  return (
    <TaskViewProvider unread={chat.unread} newestAt={newestCommentAt(data.comments)}>
      <Suspense fallback={null}>
        <RecordReadReceipt entity="tasks" id={task.id} />
      </Suspense>
      <div
        data-slot="task-page"
        className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:gap-8"
      >
        {/* The main column; on a phone its parts sit straight in the page, so the title bar and
            the views' bar stick for the whole page. */}
        <div className="max-md:contents md:flex md:min-w-0 md:flex-1 md:flex-col md:gap-4">
          <DetailHeader
            back={TASK_BACK}
            title={task.title}
            status={state}
            primary={stepBar}
            primaryOwnBar
            menu={
              <>
                {/* History, then ⋯: the one detail-header anatomy (v1.8 consistency sweep). */}
                <HistorySheet arrival={HISTORY_ARRIVAL} description="Every change to this task">
                  {activity}
                </HistorySheet>
                <TaskMenu
                  task={task}
                  assignees={data.assignees}
                  clientName={client?.name ?? null}
                  setup={actions.manage.edit ? loadTaskFormSetup(viewer).catch(() => null) : null}
                  admins={admins}
                  manage={actions.manage}
                  changeApprover={actions.changeApprover}
                  more={more}
                  doneLabel={doneLabel}
                />
              </>
            }
            // Two header buttons (History and ⋯) beside the bell: at very large text the bell
            // wraps to a second row rather than pushing the bar past the screen's edge.
            className="mb-0 flex-wrap md:mb-0"
          />
          <section
            aria-label="Where the task stands"
            data-slot="task-summary"
            className="flex min-w-0 flex-col gap-2"
          >
            {/* PP-task-1: the state as a chip (in the header on a laptop), the priority a quiet
                label, and the deadline on a line of its own, red once it has passed. */}
            <p
              data-slot="task-glance"
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
            >
              <span className="md:hidden">{state}</span>
              <span
                data-slot="task-priority"
                className="text-muted-foreground inline-flex items-center gap-1 text-xs"
              >
                <FlagIcon aria-hidden className="size-3.5 shrink-0" />
                {PRIORITY_LABELS[task.priority]} priority
              </span>
            </p>
            <p
              data-slot="task-deadline"
              data-overdue={deadline.overdue ? "true" : "false"}
              className={cn(
                "flex min-w-0 items-center gap-1.5 text-sm break-words",
                deadline.overdue ? "text-destructive font-medium" : "text-foreground",
              )}
            >
              {deadline.overdue ? (
                <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
              ) : (
                <CalendarClockIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
              )}
              <span className="min-w-0">
                {deadline.label}
                {deadline.relative ? ` · ${deadline.relative}` : ""}
              </span>
            </p>
            {/* PP-task-2: what is needed now, as a calm callout above the actions. */}
            <p
              data-slot="task-needed"
              className="border-border bg-muted/50 rounded-lg border px-3 py-2.5 text-sm font-medium break-words"
            >
              {needed}
            </p>
            {actions.remind ? (
              <TaskRemind
                taskId={task.id}
                againAt={remindAt}
                againLabel={remindAt ? remindAgainLabel(remindAt) : null}
                who={remindTo}
              />
            ) : null}
            {changeRequest?.reason ? (
              <div
                data-slot="task-change-request"
                className="bg-attention-soft flex flex-col gap-1 rounded-lg px-3 py-2 text-sm"
              >
                <span className="text-attention text-xs font-medium">
                  {reviewerName(changeRequest, names)} asked for changes
                </span>
                <LinkedText text={changeRequest.reason} />
              </div>
            ) : null}
            {task.state === "cancelled" && task.cancelledReason ? (
              <p
                className="text-muted-foreground text-sm break-words"
                data-slot="task-cancel-reason"
              >
                Cancelled: {task.cancelledReason}
              </p>
            ) : null}
          </section>
          <TaskTabs />
          <TaskViewPanel name="work">{work}</TaskViewPanel>
          <TaskChat
            taskId={task.id}
            taskTitle={task.title}
            messages={chat.messages}
            events={chat.events}
            more={data.earlierComments}
            firstUnread={chat.firstUnread}
            newestAt={newestCommentAt(data.comments)}
            people={chat.people}
            // One solid commit a screen: Send is solid on a laptop only without a next step.
            solidSend={next === null}
            placeholder={chat.placeholder}
            forOptions={commentFor}
            defaultFor={selfOnTask ? null : (commentFor[0]?.id ?? null)}
          />
        </div>
        <TaskViewPanel
          name="details"
          className="md:sticky md:top-6 md:w-64 md:shrink-0 md:self-start lg:w-80"
        >
          {details}
        </TaskViewPanel>
      </div>
    </TaskViewProvider>
  );
}

type TaskReads = Awaited<ReturnType<typeof loadTask>>;
type LoadedTask = NonNullable<TaskReads["task"]>;
type Pair = (actorId: string | null, onBehalfOf: string | null) => string;

/**
 * Work (decision 27): the brief (the description, the event, the purpose), the stages and the
 * hand-in with its links (phase 8's uploads join it). The hand-in leads once the task is handed in
 * and locked, so a reviewer lands on it (decision 32); before that the stages lead.
 */
function workPanel({
  data,
  task,
  actions,
  pair,
}: {
  data: TaskReads;
  task: LoadedTask;
  actions: ReturnType<typeof taskActions>;
  pair: Pair;
}): ReactNode {
  const latest = data.submissions[0] ?? null;
  const locked = isLocked(task.state);
  const lockedNote = isFinal(task.state)
    ? task.state === "completed"
      ? "The task is complete."
      : "The task is cancelled."
    : locked
      ? "Locked while it's with the reviewers. Chat stays open."
      : actions.tick
        ? null
        : "The people on the task tick its stages.";
  const event = eventLabel(task);

  const brief =
    task.description || event || task.purpose ? (
      <Section key="brief" title="Brief" slot="task-brief">
        <dl className="flex min-w-0 flex-col gap-3 text-sm">
          {task.description ? (
            <Fact label="Description" stacked>
              <LinkedText text={task.description} />
            </Fact>
          ) : null}
          {event ? (
            <Fact label="Event" stacked>
              {event}
              {task.location ? ` · ${task.location}` : ""}
            </Fact>
          ) : null}
          {task.purpose ? (
            <Fact label="Purpose" stacked>
              <LinkedText text={task.purpose} />
            </Fact>
          ) : null}
        </dl>
      </Section>
    ) : null;

  const stages =
    data.stages.length > 0 || actions.manage.stages ? (
      <TaskStages
        key="stages"
        taskId={task.id}
        stages={data.stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          done: stage.doneAt !== null,
          doneLine: stage.doneAt
            ? `Ticked by ${pair(stage.doneBy, stage.onBehalfOf)}, ${formatDateTime(stage.doneAt)}`
            : null,
        }))}
        tick={actions.tick}
        canManage={actions.manage.stages}
        lockedNote={lockedNote}
      />
    ) : null;

  // B5: reopened after its hand-in, the old hand-in is earlier work, collapsed, never the state.
  const reopened = reopenAfterHandIn(latest, data.activity);
  const handInBody = latest ? (
    <>
      <div className="border-border bg-card flex min-w-0 flex-col gap-2 rounded-lg border p-3">
        <p className="text-muted-foreground text-xs">
          {latest.version > 1 ? `Version ${latest.version} · ` : ""}
          Marked done by {pair(latest.submittedBy, latest.onBehalfOf)}, {formatDateTime(latest.at)}
        </p>
        {latest.note ? (
          <LinkedText text={latest.note} className="text-sm" slot="task-hand-in-note" />
        ) : (
          <p className="text-muted-foreground text-sm">No note.</p>
        )}
        {task.lateReason ? (
          <p className="text-sm break-words" data-slot="task-late-reason">
            <span className="text-muted-foreground">Late: </span>
            {task.lateReason}
          </p>
        ) : null}
      </div>
      {data.submissions.length > 1 ? (
        <ol className="flex flex-col gap-2" aria-label="Earlier hand-ins">
          {data.submissions.slice(1).map((submission) => (
            <li key={submission.id} className="text-sm">
              <p className="text-muted-foreground text-xs">
                Version {submission.version} · {pair(submission.submittedBy, submission.onBehalfOf)}
                , {formatDateTime(submission.at)}
              </p>
              {submission.note ? <LinkedText text={submission.note} /> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </>
  ) : null;
  const handIn = latest ? (
    <Section key="hand-in" title="Hand-in" slot="task-hand-in">
      {reopened ? (
        <details data-slot="task-hand-in-earlier" className="group min-w-0">
          <summary className="text-muted-foreground focus-visible:ring-ring flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-sm break-words outline-none focus-visible:ring-2">
            <ChevronRightIcon
              aria-hidden
              className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            <span className="min-w-0">{earlierHandInLabel(reopened)}</span>
          </summary>
          <div className="mt-2 flex min-w-0 flex-col gap-2">{handInBody}</div>
        </details>
      ) : (
        handInBody
      )}
    </Section>
  ) : null;

  const parts = handInFirst(task.state) ? [handIn, brief, stages] : [brief, stages, handIn];
  if (parts.every((part) => part === null)) {
    return (
      <p className="text-muted-foreground text-sm" data-slot="task-work-empty">
        No brief or stages on this task.
      </p>
    );
  }
  return parts;
}

/**
 * Chat's feed (decision 28; v1.8 V5b E): the latest page of messages and the task's small events,
 * worded for the reader ("You" for their own), the first unread one, the people on the task for
 * the panel's head, and the unread count. When every message held is unread and earlier ones
 * remain, the count is the database's own (`task_unread_counts`; 50+ unread, rare).
 */
async function chatData({
  data,
  viewerId,
  names,
  faces,
  active,
}: {
  data: TaskReads;
  viewerId: string;
  names: Record<string, string>;
  /** Each person's photo, from the same directory read as the names (V5b-D). */
  faces: Record<string, AvatarPerson>;
  active: { memberId: string }[];
}) {
  const today = todayIST();
  const messages = chatMessages(data.comments, { viewerId, names, faces, today });
  const events = chatEvents(data.activity, { viewerId, names, today });
  const firstUnread = firstUnreadId(data.comments, data.lastRead, viewerId);
  let unread = unreadCount(data.comments, data.lastRead, viewerId);
  if (data.earlierComments && firstUnread !== null && firstUnread === data.comments[0]?.id) {
    unread = (await listUnreadCounts([data.task?.id ?? ""]))[data.task?.id ?? ""] ?? unread;
  }
  // The others first, then the reader: "Asha, You".
  const people = [...active]
    .sort((a, b) => Number(a.memberId === viewerId) - Number(b.memberId === viewerId))
    .map((assignee) => {
      const name = assignee.memberId === viewerId ? "You" : (names[assignee.memberId] ?? "Someone");
      return {
        id: assignee.memberId,
        name,
        face: faces[assignee.memberId] ?? { id: assignee.memberId, name, avatarFileId: null },
      };
    });
  const others = people.filter((person) => person.id !== viewerId).map((person) => person.name);
  const placeholder = others.length === 1 ? `Message ${others[0]}…` : "Message…";
  return { messages, events, firstUnread, unread, people, placeholder };
}

/** Activity (decision 29): every change as a sentence, ticks collapsed, the newest five first. */
function activityPanel({
  data,
  names,
  viewerId,
}: {
  data: TaskReads;
  names: Record<string, string>;
  viewerId: string;
}): ReactNode {
  const tickedStages = Object.fromEntries(
    data.stages.flatMap((stage) =>
      stage.doneAt ? [[Date.parse(stage.doneAt), stage.name] as const] : [],
    ),
  );
  const described = data.activity.flatMap((entry) => {
    const line = describeTaskActivity(entry, {
      names,
      types: Object.fromEntries(data.types.map((option) => [option.id, option.name])),
      clients: Object.fromEntries(data.labels.map((label) => [label.id, label.name])),
      tickedStages,
      viewerId,
    });
    return line ? [line] : [];
  });
  const lines = collapseTicks(described).map((line) => ({
    id: line.id,
    actor: line.actor,
    text: line.text,
    ...(line.note ? { note: line.note } : {}),
    at: line.at,
    atLabel: formatDateTime(line.at, "d MMM yyyy"),
  }));
  if (lines.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-slot="task-history-empty">
        No changes to show yet.
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <TaskActivityList lines={lines} />
      {/* The read stops at ACTIVITY_LIMIT entries; the note counts the changes they make. */}
      {data.activity.length >= ACTIVITY_LIMIT ? (
        <p className="text-muted-foreground text-xs" data-slot="task-history-limit">
          The latest {described.length} changes.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Details (decision 27): the people with their Task Noted, the client, the type, the approval
 * route, who created it and the task's own fields. The desktop's right panel (decision 32).
 */
function detailsPanel({
  data,
  task,
  active,
  people,
  viewerId,
  name,
  pair,
  typeName,
  clientName,
  definitions,
  ownerId,
  faces,
}: {
  data: TaskReads;
  task: LoadedTask;
  active: readonly TaskReads["assignees"][number][];
  people: PeopleIndex;
  faces: Record<string, AvatarPerson>;
  viewerId: string;
  name: (memberId: string | null) => string;
  pair: Pair;
  typeName: string | null;
  clientName: string | null;
  definitions: TaskReads["definitions"];
  ownerId: string | null;
}): ReactNode {
  // PP-task-3: People and About the task sit on one subtle surface card (no card in a card: the
  // people are divided rows inside it), the facts as aligned label and value pairs.
  return (
    <div
      data-slot="task-about-card"
      className="border-border bg-card shadow-raised flex min-w-0 flex-col gap-5 rounded-lg border p-4"
    >
      <Section title="People" slot="task-people">
        <ul className="divide-border -mx-1 divide-y">
          {active.length > 0 ? (
            <PeopleSummary active={active} faces={faces} viewerId={viewerId} name={name} />
          ) : null}
          {active.map((assignee) => {
            const person = people[assignee.memberId];
            const freelancer = person?.engagement === "freelance";
            const noted = assignee.acknowledgedAt !== null;
            const notedBy =
              assignee.acknowledgedBy && assignee.acknowledgedBy !== assignee.memberId
                ? pair(assignee.acknowledgedBy, assignee.memberId)
                : null;
            return (
              <li
                key={assignee.memberId}
                data-slot="task-person"
                data-member={assignee.memberId}
                className="flex min-w-0 flex-col gap-0.5 px-1 py-2.5"
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium break-words">
                    <PersonAvatar
                      person={
                        faces[assignee.memberId] ?? {
                          id: assignee.memberId,
                          name: name(assignee.memberId),
                          avatarFileId: null,
                        }
                      }
                      size={20}
                    />
                    <span className="min-w-0">
                      {name(assignee.memberId)}
                      {assignee.memberId === viewerId ? " (you)" : ""}
                    </span>
                  </span>
                  <StatusDot
                    status={noted ? "noted" : "not_noted"}
                    tone={noted ? "success" : "attention"}
                    label={noted ? "Noted" : "Not noted"}
                  />
                </div>
                <span className="text-muted-foreground pl-7 text-xs break-words">
                  {[
                    assignee.isPrimary ? "Primary owner" : null,
                    freelancer
                      ? person?.coordinatorId
                        ? `Freelancer · with ${person.coordinatorId === viewerId ? "you" : name(person.coordinatorId)}`
                        : "Freelancer"
                      : null,
                    noted && assignee.acknowledgedAt
                      ? `${notedBy ? `Noted by ${notedBy}` : "Noted"} ${formatDateTime(assignee.acknowledgedAt)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="About the task" slot="task-details">
        <dl
          data-slot="task-facts"
          className="grid min-w-0 grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm"
        >
          {clientName ? <Fact label="Client">{clientName}</Fact> : null}
          {typeName ? (
            <Fact label="Type">
              <span data-slot="task-type">{typeName}</span>
            </Fact>
          ) : null}
          <Fact label="Approval">
            <span data-slot="task-route">{routeLine(task, data.assignees, name, ownerId)}</span>
          </Fact>
          <Fact label="Created by">
            {name(task.createdBy)}, {formatDateTime(task.createdAt)}
          </Fact>
        </dl>
        <CustomFieldsView definitions={definitions} values={task.customFields} />
      </Section>
    </div>
  );
}

/**
 * The task's people at a glance (the approved pull-in sample, V5b-D): up to three overlapping
 * photos then "+n", the first names, how many have noted it and who marks it done (the primary
 * owner, invariant 6). The rows under it keep each person's Task Noted.
 */
function PeopleSummary({
  active,
  faces,
  viewerId,
  name,
}: {
  active: readonly TaskReads["assignees"][number][];
  faces: Record<string, AvatarPerson>;
  viewerId: string;
  name: (memberId: string | null) => string;
}) {
  const people = active.map(
    (assignee) =>
      faces[assignee.memberId] ?? {
        id: assignee.memberId,
        name: name(assignee.memberId),
        avatarFileId: null,
      },
  );
  const noted = active.filter((assignee) => assignee.acknowledgedAt !== null).length;
  const primary = active.find((assignee) => assignee.isPrimary) ?? null;
  const names = people.slice(0, 3).map((person) => (person.id === viewerId ? "You" : person.name));
  const more = people.length - names.length;
  const notedLine = noted === active.length ? "All noted" : `${noted} of ${active.length} noted`;
  const doneLine = primary
    ? primary.memberId === viewerId
      ? "You mark it done"
      : `${name(primary.memberId)} marks it done`
    : null;
  return (
    <li data-slot="task-people-summary" className="flex min-w-0 items-center gap-2.5 px-1 py-2.5">
      <AvatarStack people={people} size={28} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold break-words">
          {names.join(", ")}
          {more > 0 ? ` +${more}` : ""}
        </span>
        <span className="text-muted-foreground text-xs break-words">
          {[notedLine, doneLine].filter(Boolean).join(" · ")}
        </span>
      </span>
    </li>
  );
}

function Section({ title, slot, children }: { title: string; slot: string; children: ReactNode }) {
  const id = `${slot}-title`;
  return (
    <section aria-labelledby={id} data-slot={slot} className="flex min-w-0 flex-col gap-2">
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A label and its value. `stacked`: the label over its value (the brief's long texts); otherwise
 * a row of the parent `dl`'s two-column grid, so the labels and values line up (PP-task-3).
 */
function Fact({
  label,
  children,
  stacked = false,
}: {
  label: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  if (!stacked) {
    return (
      <>
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="min-w-0 break-words">{children}</dd>
      </>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
