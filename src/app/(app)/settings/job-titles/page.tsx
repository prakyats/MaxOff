import type { Metadata } from "next";

import { LIST_LABELS } from "@/core/lists";
import { listItems } from "@/core/lists/server";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { ListManager } from "@/modules/settings";

export const metadata: Metadata = { title: "Job titles" };

/**
 * Settings → Job titles (PRODUCT §7: seeded with Video Editor and Graphic Designer). Editable
 * by `lists.manage`, so Admins too (PERMISSIONS §1). A title is data, never a permission
 * (CLAUDE.md invariant 1).
 */
export default async function JobTitlesSettingsPage() {
  await requirePermission("lists.manage");
  const items = await listItems("job_title", { includeArchived: true });

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Job titles"
        description="What people do, shown next to their name. A job title carries no permissions: roles do that."
        help="What people do, shown next to their name. A job title carries no permissions: roles do that."
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
