import { InfoIcon } from "lucide-react";
import { type ReactNode, Suspense } from "react";

import { checkThenRead } from "@/core/lib/start-early";
import { HistorySheet } from "@/core/ui/composites/history-sheet";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { CLIENT_STATE_LABELS, CLIENT_STATE_NOTES } from "@/modules/clients";
import { ClientMenu } from "@/modules/clients/components/client-menu";
import { RecordReadReceipt } from "@/modules/notifications-center";

import { ClientHistory, ClientHistorySkeleton } from "../client-history";
import { ClientTabs } from "../client-nav";
import { loadClient, loadPeople } from "../client";

/** The old Activity tab's path redirects with this: the History sheet opens on arrival. */
const HISTORY_ARRIVAL = { history: "1" };

/** Clients is the parent; Today opens a client too, and back returns there (§14.2 k, 6b.12). */
const BACK = { href: "/clients", label: "Clients", from: [{ path: "/today", label: "Today" }] };

/**
 * A client's page (3.4): one header over its views (Overview, Projects, Brand) with History in it, with the state,
 * the ⋯ menu (Edit details for whoever edits it; the Admin and the lifecycle for the Owner) and,
 * for a Draft, Paused or Inactive client, a banner that names the state and who can change it
 * (kickoff 3 decision 17: those clients stay fully editable). **The header and tabs live here**
 * (2.7b), so a tab switch swaps only the view; the tabs need nothing but the id, so they paint
 * at once, and the header streams in behind a skeleton of itself.
 */
export default async function ClientLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <Suspense fallback={null}>
        <RecordReadReceipt entity="clients" id={id} />
      </Suspense>
      <Suspense
        fallback={
          <PageHeader
            title={<Skeleton className="h-5 w-40" />}
            back={BACK}
            className="flex-wrap"
            // History, always there; the ⋯ follows only for whoever edits the client.
            menu={<Skeleton aria-hidden className="size-11 rounded-lg" />}
          />
        }
      >
        <ClientHeader id={id} />
      </Suspense>
      <ClientTabs clientId={id} />
      {/* Under the tabs, so it never moves them when it streams in. */}
      <Suspense fallback={null}>
        <StateBanner id={id} />
      </Suspense>
      {children}
    </>
  );
}

async function ClientHeader({ id }: { id: string }) {
  const [{ client, canManage, canEdit }, { admins }] = await checkThenRead(
    loadClient(id),
    loadPeople(),
  );
  return (
    <PageHeader
      title={client.name}
      description={<StatusBadge status={client.state} label={CLIENT_STATE_LABELS[client.state]} />}
      back={BACK}
      // History, then ⋯: the one detail-header anatomy (v1.8 consistency sweep); the old
      // Activity tab's path opens the sheet (`?history=1`).
      className="flex-wrap"
      menu={
        <>
          <HistorySheet arrival={HISTORY_ARRIVAL} description="Changes to this client">
            <Suspense fallback={<ClientHistorySkeleton />}>
              <ClientHistory id={client.id} />
            </Suspense>
          </HistorySheet>
          {canEdit ? (
            <ClientMenu
              client={{
                id: client.id,
                name: client.name,
                state: client.state,
                adminId: client.adminId,
              }}
              canManage={canManage}
              admins={admins}
            />
          ) : null}
        </>
      }
    />
  );
}

async function StateBanner({ id }: { id: string }) {
  const { client, canManage } = await loadClient(id);
  const note = CLIENT_STATE_NOTES[client.state];
  if (!note) return null;
  return (
    <p
      role="status"
      data-slot="client-state-banner"
      data-state={client.state}
      className="border-border bg-muted/50 mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
    >
      <InfoIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {note}{" "}
        <span className="text-muted-foreground">
          {canManage ? "Change it from ⋯." : "Only the Owner can change this."}
        </span>
      </span>
    </p>
  );
}
