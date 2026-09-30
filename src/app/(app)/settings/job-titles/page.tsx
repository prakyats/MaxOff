import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { LIST_LABELS } from "@/core/lists";
import { listItems } from "@/core/lists/server";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { ListManager } from "@/modules/settings/components/list-manager";

import { SETTINGS_HEADERS } from "../headers";

export const metadata: Metadata = { title: "Job titles" };

/**
 * Settings → Job titles (PRODUCT §7: seeded with Video Editor and Graphic Designer). Editable
 * by `lists.manage`, so Admins too (PERMISSIONS §1). A title is data, never a permission
 * (CLAUDE.md invariant 1).
 */
export default async function JobTitlesSettingsPage() {
  // Read together with the permission check, not after it (ARCHITECTURE §19).
  const [, items] = await checkThenRead(
    requirePermission("lists.manage"),
    listItems("job_title", { includeArchived: true }),
  );

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Job titles"
        {...SETTINGS_HEADERS.jobTitles}
      />
      <div className="max-w-2xl">
        <ListManager
          listKey="job_title"
          labels={LIST_LABELS.job_title}
          items={items.map((item) => ({
            id: item.id,
            name: item.name,
            archivedAt: item.archived_at,
          }))}
        />
      </div>
    </>
  );
}
