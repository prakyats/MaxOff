import { HistoryIcon } from "lucide-react";
import type { Metadata } from "next";

import { ACTIVITY_LIMIT } from "@/core/activity";
import { checkThenRead } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { formatIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import {
  describeProjectActivity,
  listClientProjects,
  listProjectsActivity,
} from "@/modules/client-work";
import { describeClientActivity, listClientActivity, listContacts } from "@/modules/clients";

import { assertClientId, loadClient, loadPeople } from "../../client";

export const metadata: Metadata = { title: "Activity" };

/**
 * A client's history (3.4, PRODUCT §4.4 "Activity"): the latest changes to the client, its
 * brand, its contacts, (for the Owner) its private notes and, since 7.3, its projects, newest first, one sentence each,
 * read from the audit log under RLS. The close reason is the Owner's: it lives in an Owner-only
 * table, and the view shows it to clients.manage only.
 */
export default async function ClientActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed by the client id in the URL: read together with the client (ARCHITECTURE §19).
  assertClientId(id);
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
        icon={HistoryIcon}
        title="Nothing recorded yet"
        description="Changes to this client, its brand and its contacts show here."
      />
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-2" data-slot="client-activity">
      <ol
        aria-label="Activity"
        className="border-border divide-border bg-card divide-y rounded-lg border"
      >
        {lines.map((line) => (
          <li key={line.id} data-slot="activity-row" className="flex flex-col gap-0.5 px-4 py-3">
            <p className="text-sm">
              <span className="font-medium">{line.actor}</span> {line.text}
            </p>
            {line.note ? (
              <p className="text-muted-foreground text-sm break-words">&ldquo;{line.note}&rdquo;</p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              <time dateTime={line.at}>{formatIST(line.at, "d MMM yyyy, h:mm a")}</time>
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
