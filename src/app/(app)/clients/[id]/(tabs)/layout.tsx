import { InfoIcon } from "lucide-react";
import { type ReactNode, Suspense } from "react";

import { checkThenRead } from "@/core/lib/start-early";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { PageHeader } from "@/core/ui/composites/page-header";
import { CLIENT_STATE_LABELS, CLIENT_STATE_NOTES } from "@/modules/clients";
import { ClientMenu } from "@/modules/clients/components/client-menu";
import { RecordReadReceipt } from "@/modules/notifications-center";

import { CLIENT_BACK } from "../back";
import { ClientHeaderSkeleton } from "../client-header-skeleton";
import { ClientHistoryButton } from "../client-history";
import { ClientTabs } from "../client-nav";
import { loadClient, loadPeople } from "../client";

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
        <ClientReadReceipt id={id} />
      </Suspense>
      <Suspense fallback={<ClientHeaderSkeleton />}>
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

/**
 * The client's unread alerts marked read (`RecordReadReceipt`), once the client has come back
 * (v7.0): its count is never in the first wave (ARCHITECTURE §19 "Six connections"; a client's
 * Projects tab had ten), and nothing is marked for a client the viewer may not open.
 */
async function ClientReadReceipt({ id }: { id: string }) {
  await loadClient(id);
  return <RecordReadReceipt entity="clients" id={id} />;
}

async function ClientHeader({ id }: { id: string }) {
  const [{ viewer, client, canManage, canEdit }, { admins }] = await checkThenRead(
    loadClient(id),
    loadPeople(),
  );
  return (
    <PageHeader
      title={client.name}
      description={<StatusBadge status={client.state} label={CLIENT_STATE_LABELS[client.state]} />}
      back={CLIENT_BACK}
      // History, then ⋯: the one detail-header anatomy (v1.8 consistency sweep); the old
      // Activity tab's path opens the sheet (`?history=1`).
      className="flex-wrap"
      menu={
        <>
          {/* Reads the history only when it opens, never with this layout (P2 item 6). */}
          <ClientHistoryButton clientId={client.id} />
          {canEdit ? (
            <ClientMenu
              client={{
                id: client.id,
                name: client.name,
                state: client.state,
                adminId: client.adminId,
              }}
              canManage={canManage}
              canDelete={viewer.role === "owner"}
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
