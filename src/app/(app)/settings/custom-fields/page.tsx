import type { Metadata } from "next";

import { isSettingsEntity, SETTINGS_ENTITIES, type SettingsEntity } from "@/core/custom-fields";
import { listAllDefinitions } from "@/core/custom-fields/server";
import { startEarly } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { listClients, sortClients } from "@/modules/clients";
import { listTaskTypes } from "@/modules/tasks";
import { CustomFieldEntityTabs } from "@/modules/settings/components/custom-field-entity-tabs";
import {
  AddFieldButton,
  FieldDefinitionsManager,
} from "@/modules/settings/components/field-definitions-manager";

import { SETTINGS_HEADERS } from "../headers";

export const metadata: Metadata = { title: "Custom fields" };

/**
 * The entities an Admin may define fields for: client and contact fields scoped to one of their
 * clients (PERMISSIONS ²), and task fields (`lists.manage`, PERMISSIONS ³; 4B).
 */
const ADMIN_ENTITIES: readonly SettingsEntity[] = ["client", "contact", "task"];

/**
 * Settings → Custom fields (task 3.2, PRODUCT §4.16, WORKFLOWS §4a). The entity is a view
 * control (`?entity=`); the Owner defines global fields and project / item fields, an Admin
 * only fields scoped to one of their own clients. Task fields (4B) are open to everyone with
 * `lists.manage`, the Owner and the Admins alike, for every task or for one task type (4C).
 */
export default async function CustomFieldsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The clients list does not depend on the role: read together with the check (§19). Which
  // entities the viewer may pick does, so the definitions follow it.
  const clientsRead = listClients();
  const typesRead = listTaskTypes();
  startEarly(clientsRead, typesRead);
  const [viewer, { entity: requested }] = await Promise.all([
    requirePermission("lists.manage"),
    searchParams,
  ]);
  const isOwner = viewer.role === "owner";
  const entities = isOwner ? SETTINGS_ENTITIES : ADMIN_ENTITIES;
  const entity: SettingsEntity =
    isSettingsEntity(requested) && entities.includes(requested) ? requested : "client";

  const [definitions, clients, types] = await Promise.all([
    listAllDefinitions(entity),
    clientsRead,
    typesRead,
  ]);
  // A task field's scope is a task type, in the Owner's order; an archived type still names its
  // fields but is not offered for a new one (4C).
  const scopes =
    entity === "task"
      ? types.map((type) => ({ id: type.id, name: type.name, archived: type.archived }))
      : sortClients(clients).map((client) => ({ id: client.id, name: client.name }));
  // Task fields are company-wide and `lists.manage`'s (4B); the other global rows are the Owner's.
  const canGlobal = isOwner || entity === "task";

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Custom fields"
        {...SETTINGS_HEADERS.customFields}
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
