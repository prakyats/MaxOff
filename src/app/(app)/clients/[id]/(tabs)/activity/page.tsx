import { HistoryIcon } from "lucide-react";
import type { Metadata } from "next";

import { ACTIVITY_LIMIT } from "@/core/activity";
import { can } from "@/core/permissions";
import { formatIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { describeClientActivity, listClientActivity, listContacts } from "@/modules/clients";

import { loadClient, loadPeople } from "../../client";

export const metadata: Metadata = { title: "Activity" };

/**
 * A client's history (3.4, PRODUCT §4.4 "Activity"): the latest changes to the client, its
 * brand, its contacts and (for the Owner) its private notes, newest first, one sentence each,
 * read from the audit log under RLS. The close reason shows to the Owner only until the open
 * question on its visibility is settled (PROGRESS "Open questions").
 */
export default async function ClientActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, client, canManage } = await loadClient(id);
  const [people, contacts] = await Promise.all([loadPeople(canManage), listContacts(client.id)]);
  const entries = await listClientActivity(
    client.id,
    contacts.map((contact) => contact.id),
  );
  const context = {
    names: people.names,
    contacts: Object.fromEntries(contacts.map((contact) => [contact.id, contact.name])),
    showCloseReason: can(viewer.role, "clients.manage"),
  };
  const lines = entries.flatMap((entry) => {
    const line = describeClientActivity(entry, context);
    return line ? [line] : [];
  });

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
      {entries.length >= ACTIVITY_LIMIT ? (
        <p className="text-muted-foreground text-xs">The latest {ACTIVITY_LIMIT} changes.</p>
      ) : null}
    </div>
  );
}
