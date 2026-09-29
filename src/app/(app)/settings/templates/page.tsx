import type { Metadata } from "next";

import { listAllDefinitions } from "@/core/custom-fields/server";
import { checkThenRead } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { listTaskTemplates, listTaskTypes } from "@/modules/tasks";
import { AddTemplateButton, TemplateManager } from "@/modules/tasks/components/template-manager";
import { listDirectory } from "@/modules/team";

export const metadata: Metadata = { title: "Templates" };

const DESCRIPTION =
  "Task templates for work that repeats: a type, a priority, stages and field defaults. New task offers them under Start from.";

/**
 * Settings → Templates (4.6; PRODUCT §4.6, WORKFLOWS §3.5, Kickoff 4 decision 19): task templates,
 * shared company-wide (`templates.manage`: the Owner and Admins). An Admin edits and archives
 * their own, the Owner any; RLS decides again. Project templates come with client work (phase 7).
 */
export default async function TemplatesSettingsPage() {
  // Read together with the permission check, not after it (ARCHITECTURE §19).
  const [viewer, [templates, types, definitions, directory]] = await checkThenRead(
    requirePermission("templates.manage"),
    Promise.all([
      listTaskTemplates(),
      listTaskTypes(),
      listAllDefinitions("task"),
      listDirectory(),
    ]),
  );
  const context = {
    viewer: { id: viewer.id, role: viewer.role },
    types,
    definitions,
    members: directory
      .filter((member) => member.status === "active")
      .map((member) => ({ id: member.id, name: member.fullName })),
    names: Object.fromEntries(directory.map((member) => [member.id, member.fullName])),
  };

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Templates"
        description={DESCRIPTION}
        help={DESCRIPTION}
        actions={<AddTemplateButton {...context} />}
      />
      <div className="max-w-2xl">
        <TemplateManager templates={templates} {...context} />
      </div>
    </>
  );
}
