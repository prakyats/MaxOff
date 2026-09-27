import type { Metadata } from "next";

import { isSettingsEntity, SETTINGS_ENTITIES, type SettingsEntity } from "@/core/custom-fields";
import { listAllDefinitions } from "@/core/custom-fields/server";
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
  "Extra fields on clients and contacts: for every client, or for one client only. Project and item fields are the Owner's.";

/** The entities an Admin may define fields for (client-scoped rows only, PERMISSIONS ²). */
const ADMIN_ENTITIES: readonly SettingsEntity[] = ["client", "contact"];

/**
 * Settings → Custom fields (task 3.2, PRODUCT §4.16, WORKFLOWS §4a). The entity is a view
 * control (`?entity=`); the Owner defines global fields and project / item fields, an Admin
 * only fields scoped to one of their own clients. Task fields arrive with 4.1.
 */
export default async function CustomFieldsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requirePermission("lists.manage");
  const isOwner = viewer.role === "owner";
  const entities = isOwner ? SETTINGS_ENTITIES : ADMIN_ENTITIES;
  const { entity: requested } = await searchParams;
  const entity: SettingsEntity =
    isSettingsEntity(requested) && entities.includes(requested) ? requested : "client";

  const [definitions, clients] = await Promise.all([listAllDefinitions(entity), listClients()]);
  const scopes = sortClients(clients).map((client) => ({ id: client.id, name: client.name }));

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Custom fields"
        description={DESCRIPTION}
        help={DESCRIPTION}
        actions={<AddFieldButton entity={entity} scopes={scopes} canGlobal={isOwner} />}
      />
      <CustomFieldEntityTabs entities={entities} current={entity} />
      <div className="max-w-2xl">
        <FieldDefinitionsManager
          key={entity}
          entity={entity}
          definitions={definitions}
          scopes={scopes}
          canGlobal={isOwner}
        />
      </div>
    </>
  );
}
