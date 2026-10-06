import type { Metadata } from "next";

import { listAllDefinitions } from "@/core/custom-fields/server";
import { checkThenRead } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getSettings } from "@/modules/settings";
import { listTaskTemplates, listTaskTypes } from "@/modules/tasks";
import { AddTemplateButton, TemplateManager } from "@/modules/tasks/components/template-manager";
import { listDirectory } from "@/modules/team";

import { SETTINGS_HEADERS } from "../headers";

export const metadata: Metadata = { title: "Templates" };

/**
 * Settings → Templates (4.6; PRODUCT §4.6, WORKFLOWS §3.5, Kickoff 4 decision 19): task templates,
 * shared company-wide (`templates.manage`: the Owner and Admins). An Admin edits and archives
 * their own, the Owner any; RLS decides again. Project templates come with client work (phase 7).
 */
export default async function TemplatesSettingsPage() {
  // Read together with the permission check, not after it (ARCHITECTURE §19).
  const [viewer, [templates, types, definitions, directory, settings]] = await checkThenRead(
    requirePermission("templates.manage"),
    Promise.all([
      listTaskTemplates(),
      listTaskTypes(),
      listAllDefinitions("task"),
      listDirectory(),
      getSettings(),
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
    // 5.3: under a template's reminders, its type's, then the organisation's.
    orgReminders: settings.defaultTaskReminders,
  };

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Templates"
        {...SETTINGS_HEADERS.templates}
        actions={<AddTemplateButton {...context} />}
      />
      <div className="max-w-2xl">
        <TemplateManager templates={templates} {...context} />
      </div>
    </>
  );
}
