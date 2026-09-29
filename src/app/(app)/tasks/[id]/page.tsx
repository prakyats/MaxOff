import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ACTIVITY_LIMIT } from "@/core/activity";
import { CustomFieldsView } from "@/core/custom-fields/components/custom-fields-view";
import { startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { formatIST, systemClock } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { StatusBadge, StatusDot } from "@/core/ui/composites/status-badge";
import {
  activeAssignees,
  deadlineLabel,
  describeTaskActivity,
  eventLabel,
  isFinal,
  isLocked,
  isOverdue,
  latestChangeRequest,
  LinkedText,
  pairName,
  PRIORITY_LABELS,
  reviewerName,
  routeLine,
  stateLabel,
  statusLine,
  taskActions,
  type PeopleIndex,
} from "@/modules/tasks";
import { TaskCommentButton } from "@/modules/tasks/components/task-comment-button";
import { TaskMenu } from "@/modules/tasks/components/task-menu";
import { TaskStages } from "@/modules/tasks/components/task-stages";
import { TaskWorkActions } from "@/modules/tasks/components/task-work-actions";

import { loadTaskFormSetup } from "../task-form-setup";

import { loadNames, loadTask, UUID } from "./task";

export const metadata: Metadata = { title: "Task" };

const WHEN = "d MMM, h:mm a";

/**
 * A task's page (4.4; PRODUCT §4.6, WORKFLOWS §3, ADR-0013), a drill-down from Tasks. The first
 * card answers "what do I do with this task now?" (PRODUCT §2): its state, the deadline, who holds
 * it, the approval route and the viewer's one next action. Below it, in order of use: the hand-in,
 * the stages, the people and their "Task Noted", the details, the comments and the history. RLS
 * decides who sees it: anyone else gets the not-found screen (a Staff member opening another's
 * task, an Admin outside it). Wherever a freelancer's coordinator acted, both are named ("Ravi for
 * Asha").
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
    directory.map((member) => [member.id, member.fullName]),
  );
  const name = (memberId: string | null) => (memberId ? (names[memberId] ?? "Someone") : "Someone");
  const people: PeopleIndex = Object.fromEntries(
    directory.map((member) => [
      member.id,
      {
        name: member.fullName,
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
  const now = systemClock();
  const overdue = isOverdue(task, now);
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
  const latest = data.submissions[0] ?? null;
  const admins = directory
    .filter(
      (member) =>
        member.role === "admin" && member.status === "active" && member.engagement === "permanent",
    )
    .map((member) => ({ id: member.id, name: member.fullName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const locked = isLocked(task.state);
  const lockedNote = isFinal(task.state)
    ? task.state === "completed"
      ? "The task is complete."
      : "The task is cancelled."
    : locked
      ? "Locked while it's with the reviewers. Comments stay open."
      : actions.tick
        ? null
        : "The people on the task tick its stages.";
  const tickedStages = Object.fromEntries(
    data.stages.flatMap((stage) =>
      stage.doneAt ? [[Date.parse(stage.doneAt), stage.name] as const] : [],
    ),
  );
  const history = data.activity.flatMap((entry) => {
    const line = describeTaskActivity(entry, {
      names,
      types: Object.fromEntries(data.types.map((option) => [option.id, option.name])),
      clients: Object.fromEntries(data.labels.map((label) => [label.id, label.name])),
      tickedStages,
    });
    return line ? [line] : [];
  });
  const commentFor = actions.commentFor.map((memberId) => ({ id: memberId, name: name(memberId) }));
  const selfOnTask = active.some((assignee) => assignee.memberId === viewer.id);

  return (
    <>
      <PageHeader
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
          />
        }
      />
      <div className="flex max-w-3xl min-w-0 flex-col gap-6" data-slot="task-page">
        <section
          aria-label="Where the task stands"
          data-slot="task-summary"
          className="border-border bg-card flex min-w-0 flex-col gap-3 rounded-xl border p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.state} label={stateLabel(task)} />
            {overdue ? <StatusBadge status="overdue" tone="danger" label="Overdue" /> : null}
            {task.priority === "high" || task.priority === "urgent" ? (
              <StatusBadge status={task.priority} label={PRIORITY_LABELS[task.priority]} />
            ) : null}
            {type ? <span className="text-muted-foreground text-xs">{type.name}</span> : null}
          </div>
          <dl className="flex min-w-0 flex-col gap-2 text-sm">
            <Fact label="Deadline">
              <span data-slot="task-deadline">{deadlineLabel(task.dueAt)}</span>
            </Fact>
            {task.eventDate ? (
              <Fact label="Event">
                {eventLabel(task)}
                {task.location ? ` · ${task.location}` : ""}
              </Fact>
            ) : null}
            <Fact label="Primary owner">
              {name(task.primaryOwnerId)}
              {people[task.primaryOwnerId]?.engagement === "freelance" ? " · Freelancer" : ""}
              {active.length > 1 ? `, and ${active.length - 1} more` : ""}
            </Fact>
            {client ? <Fact label="Client">{client.name}</Fact> : null}
            <Fact label="Approval">{routeLine(task, data.assignees, name)}</Fact>
          </dl>
          <p className="text-sm font-medium" data-slot="task-status">
            {statusLine(task, data.assignees, (memberId) =>
              memberId === viewer.id ? "you" : name(memberId),
            )}
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
            <p className="text-muted-foreground text-sm break-words" data-slot="task-cancel-reason">
              Cancelled: {task.cancelledReason}
            </p>
          ) : null}
          <TaskWorkActions
            taskId={task.id}
            dueAt={task.dueAt}
            actions={{
              note: actions.note,
              start: actions.start,
              done: actions.done,
              review: actions.review,
              takeOver: actions.takeOver,
            }}
            names={names}
            approverName={task.approvingAdminId ? name(task.approvingAdminId) : null}
            primaryName={name(task.primaryOwnerId)}
          />
        </section>

        {latest ? (
          <Section title="Hand-in" slot="task-hand-in">
            <div className="border-border bg-card flex min-w-0 flex-col gap-2 rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">
                {latest.version > 1 ? `Version ${latest.version} · ` : ""}
                Marked done by {pair(latest.submittedBy, latest.onBehalfOf)},{" "}
                {formatIST(latest.at, WHEN)}
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
                      Version {submission.version} ·{" "}
                      {pair(submission.submittedBy, submission.onBehalfOf)},{" "}
                      {formatIST(submission.at, WHEN)}
                    </p>
                    {submission.note ? <LinkedText text={submission.note} /> : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </Section>
        ) : null}

        {data.stages.length > 0 || actions.manage.stages ? (
          <TaskStages
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
        ) : null}

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
                      {assignee.memberId === viewer.id ? " (you)" : ""}
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
                          ? `Freelancer · with ${person.coordinatorId === viewer.id ? "you" : name(person.coordinatorId)}`
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

        <Section title="Details" slot="task-details">
          <dl className="flex min-w-0 flex-col gap-3 text-sm">
            {task.description ? (
              <Fact label="Description" stacked>
                <LinkedText text={task.description} />
              </Fact>
            ) : null}
            {task.purpose ? (
              <Fact label="Purpose" stacked>
                <LinkedText text={task.purpose} />
              </Fact>
            ) : null}
            <Fact label="Created by" stacked>
              {name(task.createdBy)}, {formatIST(task.createdAt, WHEN)}
            </Fact>
          </dl>
          <CustomFieldsView definitions={definitions} values={task.customFields} />
        </Section>

        <Section title="Comments" slot="task-comments">
          {data.comments.length > 0 ? (
            <ol className="flex min-w-0 flex-col gap-3" aria-label="Comments">
              {data.comments.map((comment) => (
                <li
                  key={comment.id}
                  data-slot="task-comment"
                  className="flex min-w-0 flex-col gap-0.5"
                >
                  <p className="text-xs">
                    <span className="font-medium">
                      {pair(comment.authorId, comment.onBehalfOf)}
                    </span>{" "}
                    <time dateTime={comment.createdAt} className="text-muted-foreground">
                      {formatIST(comment.createdAt, WHEN)}
                    </time>
                  </p>
                  <LinkedText text={comment.body} className="text-sm" />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground text-sm">No comments yet.</p>
          )}
          <TaskCommentButton
            taskId={task.id}
            forOptions={commentFor}
            defaultFor={selfOnTask ? null : (commentFor[0]?.id ?? null)}
          />
        </Section>

        <Section title="History" slot="task-history">
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-slot="task-history-empty">
              No changes to show yet.
            </p>
          ) : (
            <ol
              aria-label="History"
              className="border-border divide-border bg-card divide-y rounded-lg border"
            >
              {history.map((line) => (
                <li
                  key={line.id}
                  data-slot="task-history-row"
                  className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5"
                >
                  <p className="text-sm break-words">
                    <span className="font-medium">{line.actor}</span> {line.text}
                  </p>
                  {line.note ? (
                    <p className="text-muted-foreground text-sm break-words">
                      &ldquo;{line.note}&rdquo;
                    </p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    <time dateTime={line.at}>{formatIST(line.at, "d MMM yyyy, h:mm a")}</time>
                  </p>
                </li>
              ))}
            </ol>
          )}
          {/* The read stops at ACTIVITY_LIMIT entries; the note counts the lines shown from them. */}
          {data.activity.length >= ACTIVITY_LIMIT && history.length > 0 ? (
            <p className="text-muted-foreground text-xs" data-slot="task-history-limit">
              The latest {history.length} changes.
            </p>
          ) : null}
        </Section>
      </div>
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
