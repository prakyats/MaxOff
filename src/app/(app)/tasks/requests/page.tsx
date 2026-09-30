import { InboxIcon } from "lucide-react";
import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  LinkedText,
  listTaskRequests,
  requestActions,
  requestByline,
  requestOutcome,
  splitRequests,
  type TaskRequest,
} from "@/modules/tasks";
import { RequestActions } from "@/modules/tasks/components/request-actions";
import { SuggestTaskButton } from "@/modules/tasks/components/suggest-task-button";

import { readClientLabels, readDirectory, readLabelClients } from "../reads";
import { loadTaskFormSetup } from "../task-form-setup";

export const metadata: Metadata = { title: "Suggested tasks" };

/** The decided suggestions the screen keeps, the latest first (the waiting ones are all there). */
const DECIDED_LIMIT = 50;

/**
 * Suggested tasks (4.6; PRODUCT §4.6, WORKFLOWS §3.4, PERMISSIONS §1/§2), one tap deeper than the
 * Tasks tab (a drill-down: back returns to Tasks). Staff and Admins suggest one (a FAB on a phone);
 * the Owner and an Admin make a waiting one a task (the create form, started from it) or decline
 * it with a reason; the suggester may withdraw it while it waits. RLS decides whose each viewer
 * sees: the Owner all, an Admin their own, those with no client and their clients', Staff their
 * own. The decided ones follow, with what happened.
 */
export default async function TaskRequestsPage() {
  const [viewer, [requests, directory, labels, labelClients]] = await checkThenRead(
    requirePermission(["task_requests.create", "task_requests.decide"]),
    Promise.all([
      listTaskRequests(DECIDED_LIMIT),
      readDirectory(),
      readClientLabels(),
      // The clients a task may carry, with their Admins (RLS: none for Staff).
      readLabelClients(),
    ]),
  );
  const decides = can(viewer.role, "task_requests.decide");
  const suggests = can(viewer.role, "task_requests.create");
  const names = new Map(directory.map((member) => [member.id, member.fullName]));
  const nameOf = (id: string) => names.get(id) ?? null;
  const clients = new Map(labels.map((label) => [label.id, label.name]));
  // The Owner's "Make it a task" pre-selects the label's Admin as the first check (decision 3).
  const adminOf = new Map(labelClients.map((client) => [client.id, client.adminId]));
  const approverFor = (clientId: string | null) =>
    viewer.role === "owner" && clientId ? (adminOf.get(clientId) ?? null) : null;
  // A suggestion names a client label the suggester can see, Active or Paused (decision 22).
  const choices = labels
    .filter((label) => label.state === "active" || label.state === "paused")
    .map((label) => ({ id: label.id, name: label.name }));
  const { waiting, decided } = splitRequests(requests);
  const setup = decides ? loadTaskFormSetup(viewer).catch(() => null) : null;
  const requestViewer = { id: viewer.id, role: viewer.role, decides };

  const description = decides
    ? "Tasks the team suggested: make one a task, or decline it with a reason."
    : "Tasks you suggested, and what became of them.";

  return (
    <>
      <PageHeader
        back={{ href: "/tasks", label: "Tasks" }}
        title="Suggested tasks"
        description={description}
        help={description}
        actions={suggests ? <SuggestTaskButton clients={choices} /> : undefined}
      />
      <div className="flex max-w-3xl min-w-0 flex-col gap-6" data-slot="task-requests">
        {requests.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="No suggestions yet"
            description={
              suggests
                ? "Suggest a task and it waits here until the Owner or an Admin decides."
                : "When someone suggests a task, it waits here for you."
            }
          />
        ) : null}
        {waiting.length > 0 ? (
          <RequestSection title="Waiting" slot="task-requests-waiting" count={waiting.length}>
            {waiting.map((request) => (
              <RequestItem
                key={request.id}
                request={request}
                byline={requestByline(request, viewer.id, (id) => nameOf(id) ?? "someone")}
                client={request.clientId ? (clients.get(request.clientId) ?? null) : null}
              >
                <RequestActions
                  request={{
                    id: request.id,
                    title: request.title,
                    details: request.details,
                    clientId: request.clientId,
                    approverId: approverFor(request.clientId),
                  }}
                  allowed={requestActions(request, requestViewer)}
                  setup={setup}
                />
              </RequestItem>
            ))}
          </RequestSection>
        ) : null}
        {decided.length > 0 ? (
          <RequestSection title="Decided" slot="task-requests-decided" count={0}>
            {decided.map((request) => (
              <RequestItem
                key={request.id}
                request={request}
                byline={requestByline(request, viewer.id, (id) => nameOf(id) ?? "someone")}
                client={request.clientId ? (clients.get(request.clientId) ?? null) : null}
              >
                <p className="text-sm font-medium" data-slot="task-request-outcome">
                  {requestOutcome(request, viewer.id, nameOf)}
                </p>
                {request.decisionReason ? (
                  <p className="text-muted-foreground text-sm break-words">
                    {request.decisionReason}
                  </p>
                ) : null}
                {request.taskId && decides ? (
                  <DrillLink
                    href={`/tasks/${request.taskId}`}
                    className="self-start text-sm font-medium underline underline-offset-4"
                  >
                    Open the task
                  </DrillLink>
                ) : null}
              </RequestItem>
            ))}
          </RequestSection>
        ) : null}
      </div>
    </>
  );
}

function RequestSection({
  title,
  slot,
  count,
  children,
}: {
  title: string;
  slot: string;
  count: number;
  children: React.ReactNode;
}) {
  const id = `${slot}-title`;
  return (
    <section aria-labelledby={id} data-slot={slot} className="flex min-w-0 flex-col gap-2">
      <h2 id={id} className="text-sm font-semibold">
        {title}
        {count > 0 ? <span className="text-muted-foreground font-normal"> · {count}</span> : null}
      </h2>
      <ul className="border-border divide-border bg-card divide-y rounded-lg border">{children}</ul>
    </section>
  );
}

/** One suggestion: what, who and when, the client label, the details (links tappable), then more. */
function RequestItem({
  request,
  byline,
  client,
  children,
}: {
  request: TaskRequest;
  byline: string;
  client: string | null;
  children: React.ReactNode;
}) {
  return (
    <li
      data-slot="task-request"
      data-state={request.state}
      className="flex min-w-0 flex-col gap-2 px-4 py-3"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium break-words">{request.title}</p>
        <p className="text-muted-foreground text-xs break-words">
          {byline}
          {client ? ` · ${client}` : ""}
        </p>
      </div>
      {request.details ? (
        <LinkedText text={request.details} className="text-muted-foreground text-sm" />
      ) : null}
      {children}
    </li>
  );
}
