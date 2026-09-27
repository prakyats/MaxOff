import type { Metadata } from "next";

import { listDefinitions } from "@/core/custom-fields/server";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { listClientSummaries } from "@/modules/clients";
import { ClientList } from "@/modules/clients/components/client-list";
import { NewClientDialog } from "@/modules/clients/components/new-client-dialog";

import { loadPeople } from "../[id]/client";

export const metadata: Metadata = { title: "Clients" };

/**
 * The client list (3.4, PRODUCT §4.4), opening on Active for everyone: the Owner sees every
 * client, with "New client" and the lifecycle behind ⋯; an Admin sees their assigned clients. Staff never
 * reach it. In the `(list)` route group so its skeleton never wraps a client (the 2.9 rule).
 */
export default async function ClientsPage() {
  const viewer = await requirePermission(["clients.manage", "clients.edit_assigned"]);
  const canManage = can(viewer.role, "clients.manage");
  const [clients, people, definitions] = await Promise.all([
    listClientSummaries(),
    loadPeople(canManage),
    canManage ? listDefinitions("client") : Promise.resolve([]),
  ]);

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
          canManage ? (
            <NewClientDialog admins={people.admins} definitions={definitions} />
          ) : undefined
        }
      />
      <ClientList
        clients={clients}
        admins={people.admins}
        adminNames={people.names}
        canManage={canManage}
      />
    </>
  );
}
