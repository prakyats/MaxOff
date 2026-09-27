import { InfoIcon } from "lucide-react";
import { type ReactNode, Suspense } from "react";

import { StatusBadge } from "@/core/ui/composites/status-badge";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { CLIENT_STATE_LABELS, CLIENT_STATE_NOTES } from "@/modules/clients";
import { ClientMenu } from "@/modules/clients/components/client-menu";

import { ClientTabs } from "../client-nav";
import { loadClient, loadPeople } from "../client";

const BACK = { href: "/clients", label: "Clients" };

/**
 * A client's page (3.4): one header over its views (Overview, Brand, Activity), with the state,
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
      <Suspense fallback={<PageHeader title={<Skeleton className="h-5 w-40" />} back={BACK} />}>
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
  const { client, canManage, canEdit } = await loadClient(id);
  const { admins } = await loadPeople(canManage);
  return (
    <PageHeader
      title={client.name}
      description={<StatusBadge status={client.state} label={CLIENT_STATE_LABELS[client.state]} />}
      back={BACK}
      menu={
        canEdit ? (
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
        ) : undefined
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
