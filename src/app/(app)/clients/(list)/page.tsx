import { ChevronRightIcon, ListChecksIcon } from "lucide-react";
import type { Metadata } from "next";

import { listDefinitions } from "@/core/custom-fields/server";
import { startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";
import { listClientSummaries } from "@/modules/clients";
import { ClientList } from "@/modules/clients/components/client-list";
import { NewClientDialog } from "@/modules/clients/components/new-client-dialog";

import { loadPeople } from "../[id]/client";

export const metadata: Metadata = { title: "Clients" };

/**
 * The client list (3.4, PRODUCT §4.4), opening on Active for everyone: the Owner sees every
 * client, with "New client" and the lifecycle behind ⋯; an Admin sees their assigned clients and,
 * since kickoff 7 amendment B, adds their own. "Client items" opens the cross-client item list
 * (7.3). Staff never
 * reach it. In the `(list)` route group so its skeleton never wraps a client (the 2.9 rule).
 */
export default async function ClientsPage() {
  // The reads start with the session read (ARCHITECTURE §19); an Admin's field definitions
  // are dropped.
  const reads = Promise.all([listClientSummaries(), loadPeople(), listDefinitions("client")]);
  startEarly(reads);
  const viewer = await requirePermission(["clients.manage", "clients.edit_assigned"]);
  const canManage = can(viewer.role, "clients.manage");
  // Kickoff 7 amendment B: an Admin adds a client too (theirs, Active from the start).
  const canCreate = can(viewer.role, "clients.create");
  const [clients, people, allDefinitions] = await reads;
  const definitions = canCreate ? allDefinitions : [];

  const description = canManage
    ? "Every client, its Admin and state. New clients start as drafts."
    : "The clients you run.";

  return (
    <>
      <PageHeader
        title="Clients"
        description={description}
        help={description}
        actions={
          canCreate ? (
            <NewClientDialog admins={people.admins} definitions={definitions} own={!canManage} />
          ) : undefined
        }
      />
      <DrillLink
        href="/clients/items"
        data-slot="client-items-link"
        className="border-border bg-card mb-3 flex min-h-11 items-center gap-3 rounded-lg border px-4 py-2 text-sm"
      >
        <ListChecksIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 font-medium">Client items</span>
        <span className="text-muted-foreground hidden text-xs sm:inline">Across every client</span>
        <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      </DrillLink>
      <ClientList
        clients={clients}
        admins={people.admins}
        adminNames={people.names}
        canManage={canManage}
      />
    </>
  );
}
