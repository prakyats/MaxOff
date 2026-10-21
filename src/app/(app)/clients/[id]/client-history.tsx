import { ACTIVITY_LIMIT } from "@/core/activity";
import { checkThenRead } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { formatDateTime } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ICONS } from "@/core/ui/icons";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import {
  describeProjectActivity,
  listClientProjects,
  listProjectsActivity,
} from "@/modules/client-work";
import { describeClientActivity, listClientActivity, listContacts } from "@/modules/clients";

import { loadClient, loadPeople } from "./client";

/**
 * A client's history (3.4, PRODUCT §4.4 "Activity"; since the v1.8 consistency sweep the header's
 * History sheet, as on every detail page, instead of an Activity tab): the latest changes to the
 * client, its brand, its contacts, (for the Owner) its private notes and its projects, newest
 * first, one sentence each, read from the audit log under RLS. The close reason is the Owner's: it
 * lives in an Owner-only table, and the view shows it to clients.manage only. Streamed into the
 * sheet behind `ClientHistorySkeleton`, so the page never waits for it.
 */
export async function ClientHistory({ id }: { id: string }) {
  // Keyed by the client id: read together with the client (ARCHITECTURE §19).
  const [{ viewer, client }, [people, contacts, projects]] = await checkThenRead(
    loadClient(id),
    Promise.all([loadPeople(), listContacts(id), listClientProjects(id)]),
  );
  // The client's projects' own entries (7.3): created, started, completed, cancelled, reopened,
  // their details; an item's history lives on its project's page. Merged newest first.
  const [clientEntries, projectEntries] = await Promise.all([
    listClientActivity(
      client.id,
      contacts.map((contact) => contact.id),
    ),
    listProjectsActivity(projects.map((project) => project.id)),
  ]);
  const projectNames = Object.fromEntries(projects.map((project) => [project.id, project.name]));
  const context = {
    names: people.names,
    contacts: Object.fromEntries(contacts.map((contact) => [contact.id, contact.name])),
    showCloseReason: can(viewer.role, "clients.manage"),
  };
  const lines = [
    ...clientEntries.flatMap((entry) => {
      const line = describeClientActivity(entry, context);
      return line ? [line] : [];
    }),
    ...projectEntries.flatMap((entry) => {
      const line = describeProjectActivity(entry, {
        names: people.names,
        items: {},
        stages: {},
        projects: projectNames,
      });
      return line ? [line] : [];
    }),
  ]
    .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
    .slice(0, ACTIVITY_LIMIT);

  if (lines.length === 0) {
    return (
      <EmptyState
        icon={ICONS.history}
        title="Nothing recorded yet"
        description="Changes to this client, its brand and its contacts show here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2" data-slot="client-activity">
      <ol aria-label="History" className="divide-border divide-y">
        {lines.map((line) => (
          <li key={line.id} data-slot="activity-row" className="flex flex-col gap-0.5 py-3">
            <p className="text-sm">
              <span className="font-medium">{line.actor}</span> {line.text}
            </p>
            {line.note ? (
              <p className="text-muted-foreground text-sm break-words">&ldquo;{line.note}&rdquo;</p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              <time dateTime={line.at}>{formatDateTime(line.at, "d MMM yyyy")}</time>
            </p>
          </li>
        ))}
      </ol>
      {clientEntries.length + projectEntries.length >= ACTIVITY_LIMIT ? (
        <p className="text-muted-foreground text-xs">The latest {ACTIVITY_LIMIT} changes.</p>
      ) : null}
    </div>
  );
}

/** The history while it streams in: rows of one sentence over a date line. */
export function ClientHistorySkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the history"
      data-slot="loading-client-activity"
    >
      <ul aria-hidden className="divide-border divide-y">
        {[0, 1, 2, 3, 4].map((row) => (
          <li key={row} className="flex flex-col gap-1.5 py-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-28" />
          </li>
        ))}
      </ul>
      <span className="sr-only">Loading the history</span>
    </div>
  );
}
