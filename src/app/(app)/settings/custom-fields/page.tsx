import type { Metadata } from "next";

import { isSettingsEntity, SETTINGS_ENTITIES, type SettingsEntity } from "@/core/custom-fields";
import { listAllDefinitions } from "@/core/custom-fields/server";
import { startEarly } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { listClients, sortClients } from "@/modules/clients";
import { CustomFieldEntityTabs } from "@/modules/settings/components/custom-field-entity-tabs";
import {
  AddFieldButton,
  FieldDefinitionsManager,
} from "@/modules/settings/components/field-definitions-manager";

export const metadata: Metadata = { title: "Custom fields" };

const DESCRIPTION =
  "Extra fields on clients, contacts and tasks. Client and contact fields apply to every client or one client only; project and item fields are the Owner's.";

/**
 * The entities an Admin may define fields for: client and contact fields scoped to one of their
 * clients (PERMISSIONS ²), and task fields (`lists.manage`, PERMISSIONS ³; 4B).
 */
const ADMIN_ENTITIES: readonly SettingsEntity[] = ["client", "contact", "task"];

/**
 * Settings → Custom fields (task 3.2, PRODUCT §4.16, WORKFLOWS §4a). The entity is a view
 * control (`?entity=`); the Owner defines global fields and project / item fields, an Admin
 * only fields scoped to one of their own clients. Task fields (4B) are company-wide and open to
 * everyone with `lists.manage`, the Owner and the Admins alike.
 */
export default async function CustomFieldsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The clients list does not depend on the role: read together with the check (§19). Which
  // entities the viewer may pick does, so the definitions follow it.
  const clientsRead = listClients();
  startEarly(clientsRead);
  const [viewer, { entity: requested }] = await Promise.all([
    requirePermission("lists.manage"),
    searchParams,
  ]);
  const isOwner = viewer.role === "owner";
  const entities = isOwner ? SETTINGS_ENTITIES : ADMIN_ENTITIES;
  const entity: SettingsEntity =
    isSettingsEntity(requested) && entities.includes(requested) ? requested : "client";

  const [definitions, clients] = await Promise.all([listAllDefinitions(entity), clientsRead]);
  const scopes = sortClients(clients).map((client) => ({ id: client.id, name: client.name }));
  // Task fields are company-wide and `lists.manage`'s (4B); the other global rows are the Owner's.
  const canGlobal = isOwner || entity === "task";

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Custom fields"
        description={DESCRIPTION}
        help={DESCRIPTION}
        actions={<AddFieldButton entity={entity} scopes={scopes} canGlobal={canGlobal} />}
      />
      <CustomFieldEntityTabs entities={entities} current={entity} />
      <div className="max-w-2xl">
        <FieldDefinitionsManager
          key={entity}
          entity={entity}
          definitions={definitions}
          scopes={scopes}
          canGlobal={canGlobal}
        />
      </div>
    </>
  );
}
