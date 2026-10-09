import { CircleAlertIcon, FlagIcon } from "lucide-react";
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
import { formatIST, systemClock } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { StatusDot } from "@/core/ui/composites/status-badge";
import {
  activeAssignees,
  actorPair,
  collapseTicks,
  describeTaskActivity,
  eventLabel,
  handInFirst,
  isFinal,
  isLocked,
  latestChangeRequest,
  LinkedText,
  moreSteps,
  neededLine,
  newestCommentAt,
  nextStep,
  pairName,
  PRIORITY_LABELS,
  relativeDeadline,
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
import { TaskStages } from "@/modules/tasks/components/task-stages";
import { TaskTabs, TaskViewPanel, TaskViewProvider } from "@/modules/tasks/components/task-view";
import { RecordReadReceipt } from "@/modules/notifications-center";

import { loadTaskFormSetup } from "../task-form-setup";

import { loadNames, loadTask, UUID } from "./task";

export const metadata: Metadata = { title: "Task" };

const WHEN = "d MMM, h:mm a";

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

  const work = workPanel({ data, task, actions, pair });
  const thread = chatThread({ data, viewerId: viewer.id, pair, names });
  const activity = activityPanel({ data, names });
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
  });

  return (
    <TaskViewProvider
      unread={unreadCount(data.comments, data.lastRead, viewer.id)}
      newestAt={newestCommentAt(data.comments)}
    >
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
          <PageHeader
            className="mb-0 md:mb-0"
            back={{ href: "/tasks", label: "Tasks" }}
            title={task.title}
            menu={
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
            }
          />
          <section
            aria-label="Where the task stands"
            data-slot="task-summary"
            className="flex min-w-0 flex-col gap-2"
          >
            <p
              data-slot="task-glance"
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
            >
              <StatusDot
                status={task.state}
                label={stateLabel(task, {
                  finalApprover: can(viewer.role, "tasks.approve_final"),
                })}
              />
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <span
                data-slot="task-priority"
                className="text-muted-foreground inline-flex items-center gap-1"
              >
                <FlagIcon aria-hidden className="size-3.5 shrink-0" />
                {PRIORITY_LABELS[task.priority]}
                <span className="sr-only"> priority</span>
              </span>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <span
                data-slot="task-deadline"
                data-overdue={deadline.overdue ? "true" : "false"}
                className={cn(
                  "inline-flex min-w-0 items-center gap-1 break-words",
                  deadline.overdue ? "text-destructive font-medium" : "text-muted-foreground",
                )}
              >
                {deadline.overdue ? (
                  <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
                ) : null}
                <span className="min-w-0">
                  {deadline.label}
                  {deadline.relative ? ` · ${deadline.relative}` : ""}
                </span>
              </span>
            </p>
            <p data-slot="task-needed" className="text-sm font-medium break-words">
              {needed}
            </p>
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
          <TaskTabs />
          <TaskViewPanel name="work">{work}</TaskViewPanel>
          <TaskChat
            taskId={task.id}
            thread={thread}
            count={data.comments.length}
            newestAt={newestCommentAt(data.comments)}
            forOptions={commentFor}
            defaultFor={selfOnTask ? null : (commentFor[0]?.id ?? null)}
          />
          <TaskViewPanel name="activity">{activity}</TaskViewPanel>
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
            ? `Ticked by ${pair(stage.doneBy, stage.onBehalfOf)}, ${formatIST(stage.doneAt, WHEN)}`
            : null,
        }))}
        tick={actions.tick}
        canManage={actions.manage.stages}
        lockedNote={lockedNote}
      />
    ) : null;

  const handIn = latest ? (
    <Section key="hand-in" title="Hand-in" slot="task-hand-in">
      <div className="border-border bg-card flex min-w-0 flex-col gap-2 rounded-lg border p-3">
        <p className="text-muted-foreground text-xs">
          {latest.version > 1 ? `Version ${latest.version} · ` : ""}
          Marked done by {pair(latest.submittedBy, latest.onBehalfOf)}, {formatIST(latest.at, WHEN)}
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
                , {formatIST(submission.at, WHEN)}
              </p>
              {submission.note ? <LinkedText text={submission.note} /> : null}
            </li>
          ))}
        </ol>
      ) : null}
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
 * Chat's thread (decision 28): the comments, oldest first, the viewer's own on the right ("You",
 * or "You for Asha" when written for a freelancer), everyone else's named as the pair.
 */
function chatThread({
  data,
  viewerId,
  pair,
  names,
}: {
  data: TaskReads;
  viewerId: string;
  pair: Pair;
  names: Record<string, string>;
}): ReactNode {
  if (data.comments.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-slot="task-comments-empty">
        No comments yet. Ask a question or post an update: everyone on the task sees it.
      </p>
    );
  }
  return (
    <ol aria-label="Comments" data-slot="task-comments" className="flex min-w-0 flex-col gap-3">
      {data.comments.map((comment) => {
        const own = comment.authorId === viewerId;
        const forName = comment.onBehalfOf ? (names[comment.onBehalfOf] ?? "a freelancer") : null;
        return (
          <li
            key={comment.id}
            data-slot="task-comment"
            data-own={own ? "true" : "false"}
            className={cn(
              "flex max-w-[85%] min-w-0 flex-col gap-0.5 rounded-xl px-3 py-2",
              own ? "bg-muted self-end" : "border-border bg-card self-start border",
            )}
          >
            <p className="text-xs break-words">
              <span className="font-medium">
                {own ? actorPair("You", forName) : pair(comment.authorId, comment.onBehalfOf)}
              </span>{" "}
              <time dateTime={comment.createdAt} className="text-muted-foreground">
                {formatIST(comment.createdAt, WHEN)}
              </time>
            </p>
            <LinkedText text={comment.body} className="text-sm" />
          </li>
        );
      })}
    </ol>
  );
}

/** Activity (decision 29): every change as a sentence, ticks collapsed, the newest five first. */
function activityPanel({
  data,
  names,
}: {
  data: TaskReads;
  names: Record<string, string>;
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
    });
    return line ? [line] : [];
  });
  const lines = collapseTicks(described).map((line) => ({
    id: line.id,
    actor: line.actor,
    text: line.text,
    ...(line.note ? { note: line.note } : {}),
    at: line.at,
    atLabel: formatIST(line.at, "d MMM yyyy, h:mm a"),
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
}: {
  data: TaskReads;
  task: LoadedTask;
  active: readonly TaskReads["assignees"][number][];
  people: PeopleIndex;
  viewerId: string;
  name: (memberId: string | null) => string;
  pair: Pair;
  typeName: string | null;
  clientName: string | null;
  definitions: TaskReads["definitions"];
}): ReactNode {
  return (
    <>
      <Section title="People" slot="task-people">
        <ul className="border-border divide-border bg-card divide-y rounded-lg border">
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
                className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 text-sm font-medium break-words">
                    {name(assignee.memberId)}
                    {assignee.memberId === viewerId ? " (you)" : ""}
                  </span>
                  <StatusDot
                    status={noted ? "noted" : "not_noted"}
                    tone={noted ? "success" : "attention"}
                    label={noted ? "Noted" : "Not noted"}
                  />
                </div>
                <span className="text-muted-foreground text-xs break-words">
                  {[
                    assignee.isPrimary ? "Primary owner" : null,
                    freelancer
                      ? person?.coordinatorId
                        ? `Freelancer · with ${person.coordinatorId === viewerId ? "you" : name(person.coordinatorId)}`
                        : "Freelancer"
                      : null,
                    noted && assignee.acknowledgedAt
                      ? `${notedBy ? `Noted by ${notedBy}` : "Noted"} ${formatIST(assignee.acknowledgedAt, WHEN)}`
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
        <dl className="flex min-w-0 flex-col gap-3 text-sm">
          {clientName ? (
            <Fact label="Client" stacked>
              {clientName}
            </Fact>
          ) : null}
          {typeName ? (
            <Fact label="Type" stacked>
              <span data-slot="task-type">{typeName}</span>
            </Fact>
          ) : null}
          <Fact label="Approval" stacked>
            <span data-slot="task-route">{routeLine(task, data.assignees, name)}</span>
          </Fact>
          <Fact label="Created by" stacked>
            {name(task.createdBy)}, {formatIST(task.createdAt, WHEN)}
          </Fact>
        </dl>
        <CustomFieldsView definitions={definitions} values={task.customFields} />
      </Section>
    </>
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

/** A label and its value: side by side from `sm` up, stacked on a phone and under large text. */
function Fact({
  label,
  children,
  stacked = false,
}: {
  label: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={stacked ? "flex min-w-0 flex-col gap-0.5" : "flex min-w-0 flex-wrap gap-x-2"}>
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
