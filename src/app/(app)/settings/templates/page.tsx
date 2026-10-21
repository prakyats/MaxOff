import type { Metadata } from "next";

import { listAllDefinitions } from "@/core/custom-fields/server";
import { checkThenRead } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getSettings } from "@/modules/settings";
import { listStagePresets } from "@/modules/settings";
import { listTaskTemplates, listTaskTypes } from "@/modules/tasks";
import { listDeliverableTemplates, listProjectTemplates } from "@/modules/templates";
import { ClientWorkTemplates } from "@/modules/templates/components/client-work-templates";
import { TemplateManager } from "@/modules/tasks/components/template-manager";
import { listDirectory } from "@/modules/team";

import { SETTINGS_HEADERS } from "../headers";

export const metadata: Metadata = { title: "Templates" };

/**
 * Settings → Templates (4.6; PRODUCT §4.6, WORKFLOWS §3.5, Kickoff 4 decision 19): task templates,
 * shared company-wide (`templates.manage`: the Owner and Admins). An Admin edits and archives
 * their own, the Owner any; RLS decides again. **Two groups** (kickoff 7 decision 23, 7.4): project
 * templates (a repeat, stages, an item list, field defaults; no billing category, amendment C) and
 * task templates; "Add template" in the header adds a task template, each group its own. **6b
 * Release 2:** a third group, **Deliverable templates**, and one search with a Preview on every
 * client-work template (ROADMAP 6b.16 (f)).
 */
export default async function TemplatesSettingsPage() {
  // Read together with the permission check, not after it (ARCHITECTURE §19).
  const [
    viewer,
    [
      templates,
      types,
      definitions,
      directory,
      settings,
      projectTemplates,
      presets,
      projectFields,
      deliverableTemplates,
    ],
  ] = await checkThenRead(
    requirePermission("templates.manage"),
    Promise.all([
      listTaskTemplates(),
      listTaskTypes(),
      listAllDefinitions("task"),
      listDirectory(),
      getSettings(),
      listProjectTemplates(),
      listStagePresets(),
      listAllDefinitions("project"),
      listDeliverableTemplates(),
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
      />
      <div className="flex max-w-2xl flex-col gap-8">
        <TemplateManager templates={templates} {...context} />
        <ClientWorkTemplates
          projectTemplates={projectTemplates}
          deliverableTemplates={deliverableTemplates}
          viewer={context.viewer}
          names={context.names}
          presets={presets
            .filter((preset) => !preset.archived)
            .map((preset) => ({ id: preset.id, name: preset.name, stages: preset.stages }))}
          definitions={projectFields.filter((definition) => definition.archivedAt === null)}
        />
      </div>
    </>
  );
}
