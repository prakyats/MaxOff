import { ChevronRightIcon, ClipboardCheckIcon, InboxIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { checkThenRead } from "@/core/lib/start-early";
import { cn } from "@/core/lib/utils";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { systemClock, todayIST } from "@/core/time";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getSettings } from "@/modules/settings";
import {
  countPendingRequests,
  countTasks,
  forLabel,
  isOverdue,
  MY_GROUP_TITLES,
  myTaskGroups,
  needsYou,
  type NeedsYouItem,
  openByDeadline,
  PRIORITY_LABELS,
  rowMeta,
  stateLabel,
  type TaskListRow,
  TaskRow,
  TaskRowList,
  waitedLabel,
} from "@/modules/tasks";
import { NewTaskButton } from "@/modules/tasks/components/new-task-button";

import { loadTaskFormSetup } from "../task-form-setup";
import { readClientLabels, readDirectory, readOpenTasks, readOwnFreelancers } from "../reads";

export const metadata: Metadata = { title: "Tasks" };

/** The open tasks shown on the first screen before "See all tasks" (PRODUCT §2: depth one tap). */
const OPEN_ON_FIRST_SCREEN = 15;

/**
 * The Tasks tab (4.5; PRODUCT §4.6 "Tasks tab, first glance", Kickoff 4 decision 17). **The
 * Owner and Admins:** "Needs you" first (their own "Task Noted" and change requests, overdue work
 * on the tasks they run, anyone who has not noted past the escalation time, the tasks waiting for
 * their approval as one row into Approvals, the suggested tasks to decide), then the open tasks by
 * deadline, the full filtered list one tap deeper (`/tasks/all`). **Staff, "My tasks":** Not noted ·
 * Changes requested · Due today · Upcoming · Overdue, a coordinator's freelancers mixed in "for
 * Asha" (ADR-0013), the tasks with the reviewers as one count. Every row opens the task (a
 * drill-down); a tab root, so pull-to-refresh fetches it again (§14.2 i). In the `(list)` group so
 * its skeleton never wraps a task (the 2.9 rule).
 */
export default async function TasksPage() {
  // Every read starts with the session read (ARCHITECTURE §19); RLS decides what each returns,
  // and the ones only managers use are cheap for Staff (their own rows, a count).
  const [viewer, [rows, directory, labels, own, counts, requests, settings]] = await checkThenRead(
    requirePermission("tasks.work"),
    Promise.all([
      readOpenTasks(),
      readDirectory(),
      readClientLabels(),
      readOwnFreelancers(),
      countTasks(),
      countPendingRequests(),
      getSettings(),
    ]),
  );
  const names = new Map(directory.map((member) => [member.id, member]));
  const clients = new Map(labels.map((label) => [label.id, label.name]));
  const context = {
    viewerId: viewer.id,
    nameOf: (id: string) => (id === viewer.id ? "you" : (names.get(id)?.fullName ?? "Someone")),
    engagementOf: (id: string) => names.get(id)?.engagement,
    clientName: (id: string) => clients.get(id) ?? null,
  };
  const listViewer = { id: viewer.id, role: viewer.role, coordinates: own };
  const now = systemClock();

  if (!can(viewer.role, "tasks.create")) {
    return <MyTasks rows={rows} viewer={listViewer} context={context} now={now} />;
  }

  const needs = needsYou(rows, listViewer, now, settings);
  const shown = new Set(needs.map((item) => item.row.id));
  const open = openByDeadline(rows, shown);
  const nothingNeeded = needs.length === 0 && counts.toDecide === 0 && requests === 0;

  return (
    <>
      <PageHeader
        title="Tasks"
        description="What needs you, then every open task by deadline."
        actions={<NewTaskButton setup={loadTaskFormSetup(viewer).catch(() => null)} />}
      />
      <div className="flex max-w-3xl min-w-0 flex-col gap-6" data-slot="tasks-team">
        <Section title="Needs you" slot="tasks-needs-you" count={needs.length}>
          {nothingNeeded ? (
            <p className="text-muted-foreground text-sm" data-slot="tasks-needs-nothing">
              Nothing needs you right now.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {counts.toDecide > 0 || requests > 0 ? (
                <ul className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border">
                  {counts.toDecide > 0 ? (
                    <CountRow
                      href="/approvals"
                      slot="tasks-to-approve"
                      icon={<ClipboardCheckIcon aria-hidden className="size-4" />}
                      label={
                        counts.toDecide === 1
                          ? "1 task waiting for your approval"
                          : `${counts.toDecide} tasks waiting for your approval`
                      }
                      tab
                    />
                  ) : null}
                  {requests > 0 ? (
                    <CountRow
                      href="/tasks/requests"
                      slot="tasks-requests-waiting"
                      icon={<InboxIcon aria-hidden className="size-4" />}
                      label={
                        requests === 1
                          ? "1 suggested task to decide"
                          : `${requests} suggested tasks to decide`
                      }
                    />
                  ) : null}
                </ul>
              ) : null}
              {needs.length > 0 ? (
                <TaskRowList label="Needs you" slot="tasks-needs-rows">
                  {needs.map((item) => (
                    <TaskRow
                      key={item.row.id}
                      id={item.row.id}
                      title={item.row.title}
                      meta={rowMeta(item.row, context)}
                      status={item.row.state}
                      statusLabel={stateLabel(item.row)}
                      flag={reasonFlag(item)}
                      note={needsNote(item, viewer.id, context.nameOf)}
                    />
                  ))}
                </TaskRowList>
              ) : null}
            </div>
          )}
        </Section>

        <Section title="Open tasks" slot="tasks-open" count={open.length}>
          {open.length === 0 && needs.length === 0 ? (
            <EmptyState
              title="No open tasks"
              description="Give out work with New task. Each one opens on its own page, where people note it and you approve it."
              size="compact"
            />
          ) : open.length === 0 ? (
            <p className="text-muted-foreground text-sm">Every open task is under Needs you.</p>
          ) : (
            <TaskRowList label="Open tasks by deadline">
              {open.slice(0, OPEN_ON_FIRST_SCREEN).map((row) => (
                <TaskRow
                  key={row.id}
                  id={row.id}
                  title={row.title}
                  meta={rowMeta(row, context)}
                  status={row.state}
                  statusLabel={stateLabel(row)}
                  flag={rowFlag(row, now)}
                />
              ))}
            </TaskRowList>
          )}
        </Section>

        <nav aria-label="More tasks" className="flex flex-col gap-2" data-slot="tasks-more">
          <MoreLink href="/tasks/all" slot="tasks-see-all">
            {open.length > OPEN_ON_FIRST_SCREEN
              ? `See all ${open.length + needs.length} open tasks, and finished ones`
              : "All tasks, with filters"}
          </MoreLink>
          <MoreLink href="/tasks/requests" slot="tasks-requests">
            Suggested tasks
          </MoreLink>
        </nav>
      </div>
    </>
  );
}

/** Staff "My tasks" (decision 17), a coordinator's freelancers mixed in "for Asha". */
function MyTasks({
  rows,
  viewer,
  context,
  now,
}: {
  rows: TaskListRow[];
  viewer: { id: string; role: "owner" | "admin" | "staff"; coordinates: string[] };
  context: Parameters<typeof rowMeta>[1];
  now: Date;
}) {
  const groups = myTaskGroups(rows, viewer, now, todayIST());
  const order = ["not_noted", "changes_requested", "due_today", "upcoming", "overdue"] as const;
  const empty = order.every((group) => groups[group].length === 0);
  const reviewing = groups.with_reviewers.length;

  return (
    <>
      <PageHeader title="My tasks" description="The work given to you, and what's due next." />
      <div className="flex max-w-3xl min-w-0 flex-col gap-6" data-slot="tasks-mine">
        {empty ? (
          <EmptyState
            title={reviewing > 0 ? "Nothing to do right now" : "Nothing on your list"}
            description="Tasks given to you appear here. Note each one when you see it."
            size="compact"
          />
        ) : (
          order.map((group) =>
            groups[group].length > 0 ? (
              <Section
                key={group}
                title={MY_GROUP_TITLES[group]}
                slot={`tasks-group-${group}`}
                count={groups[group].length}
              >
                <TaskRowList label={MY_GROUP_TITLES[group]}>
                  {groups[group].map(({ row, part }) => {
                    const note =
                      group === "not_noted"
                        ? forNote(part.notNoted, viewer.id, context.nameOf)
                        : forNote(
                            [...(part.self ? [viewer.id] : []), ...part.forIds],
                            viewer.id,
                            context.nameOf,
                          );
                    return (
                      <TaskRow
                        key={row.id}
                        id={row.id}
                        title={row.title}
                        meta={rowMeta(row, context)}
                        status={row.state}
                        statusLabel={stateLabel(row)}
                        flag={rowFlag(row, now)}
                        note={note}
                      />
                    );
                  })}
                </TaskRowList>
              </Section>
            ) : null,
          )
        )}
        <nav aria-label="More tasks" className="flex flex-col gap-2" data-slot="tasks-more">
          {reviewing > 0 ? (
            // view-link: navigation (the full list is another page, opened on this filter)
            <MoreLink href="/tasks/all?state=review" slot="tasks-with-reviewers">
              {reviewing === 1
                ? "1 task with the reviewers"
                : `${reviewing} tasks with the reviewers`}
            </MoreLink>
          ) : null}
          <MoreLink href="/tasks/all" slot="tasks-see-all">
            All my tasks
          </MoreLink>
          <MoreLink href="/tasks/requests" slot="tasks-requests">
            Your suggestions
          </MoreLink>
        </nav>
      </div>
    </>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Whose work a row is, when it is not only the viewer's (ADR-0013): "For Asha", or "You, and for
 * Asha" when both are on it. `ids` are the people concerned (for "Not noted": whose note is
 * missing).
 */
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

function rowFlag(
  row: TaskListRow,
  now: Date,
): { label: string; tone: "danger" | "attention" } | null {
  if (isOverdue(row, now)) return { label: "Overdue", tone: "danger" };
  if (row.priority === "urgent" || row.priority === "high") {
    return {
      label: PRIORITY_LABELS[row.priority],
      tone: row.priority === "urgent" ? "danger" : "attention",
    };
  }
  return null;
}

function reasonFlag(item: NeedsYouItem): { label: string; tone: "danger" | "attention" } {
  switch (item.reason) {
    case "overdue":
      return { label: "Overdue", tone: "danger" };
    case "changes_requested":
      return { label: "Changes requested", tone: "attention" };
    case "your_note":
    case "not_noted":
      return { label: "Not noted", tone: "attention" };
  }
}

function needsNote(
  item: NeedsYouItem,
  viewerId: string,
  nameOf: (id: string) => string,
): string | null {
  switch (item.reason) {
    case "your_note":
      return forNote(item.part.notNoted, viewerId, nameOf) ?? "Yours to note";
    case "changes_requested":
      return "Back with you to fix";
    case "overdue":
      return "Past its deadline";
    case "not_noted": {
      const first = item.waitingOn[0];
      if (!first) return null;
      const who = nameOf(first.memberId);
      const more = item.waitingOn.length > 1 ? ` and ${item.waitingOn.length - 1} more` : "";
      return `${capitalise(who)}${more} hasn't noted it · ${waitedLabel(first.hours)}`;
    }
  }
}

function Section({
  title,
  slot,
  count,
  children,
}: {
  title: string;
  slot: string;
  count: number;
  children: ReactNode;
}) {
  const id = `${slot}-title`;
  return (
    <section aria-labelledby={id} data-slot={slot} className="flex min-w-0 flex-col gap-2">
      <h2 id={id} className="text-sm font-semibold">
        {title}
        {count > 0 ? <span className="text-muted-foreground font-normal"> · {count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** A row that stands for a count and opens what it counts (PRODUCT §2: every count is tappable). */
function CountRow({
  href,
  slot,
  icon,
  label,
  tab = false,
}: {
  href: string;
  slot: string;
  icon: ReactNode;
  label: string;
  /** Another tab's screen (Approvals): a plain link, as the Owner's Today card does. */
  tab?: boolean;
}) {
  const className =
    "focus-visible:ring-ring flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset";
  const content = (
    <>
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 break-words">{label}</span>
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </>
  );
  return (
    <li data-slot={slot}>
      {tab ? (
        <Link href={href} className={cn("pressable-row", className)}>
          {content}
        </Link>
      ) : (
        <DrillLink href={href} className={className}>
          {content}
        </DrillLink>
      )}
    </li>
  );
}

function MoreLink({ href, slot, children }: { href: string; slot: string; children: ReactNode }) {
  return (
    <DrillLink
      href={href}
      data-slot={slot}
      className="border-border bg-card focus-visible:ring-ring flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium outline-none focus-visible:ring-2"
    >
      <span className="min-w-0 break-words">{children}</span>
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </DrillLink>
  );
}
