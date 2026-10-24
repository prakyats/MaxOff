import type { Metadata } from "next";

import { listAllDefinitions } from "@/core/custom-fields/server";
import { checkThenRead } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getSettings } from "@/modules/settings";
import { listStagePresets } from "@/modules/settings";
import { listTaskTemplates, listTaskTypes } from "@/modules/tasks";
import { listDeliverableTemplates, listProjectTemplates } from "@/modules/templates";
import { listDirectory } from "@/modules/team";

import { SETTINGS_HEADERS } from "../headers";

import { TemplatesLibrary } from "./templates-library";

export const metadata: Metadata = { title: "Templates" };

/**
 * Settings → Templates, the one Templates page (6b.6 owner note, 2026-10-16; 4.6, 7.4, 6b Release
 * 2): Stage presets → Deliverable templates → Project templates, a divider, then Task templates,
 * with one search across all four (`TemplatesLibrary`). `templates.manage` opens it (the Owner and
 * Admins); Stage presets show for `lists.manage`. An Admin edits and deletes (archives, D6) their
 * own, the Owner any; RLS decides again.
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
  const names = Object.fromEntries(directory.map((member) => [member.id, member.fullName]));
  const viewerRef = { id: viewer.id, role: viewer.role };

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Templates"
        {...SETTINGS_HEADERS.templates}
      />
      <TemplatesLibrary
        presets={presets}
        deliverableTemplates={deliverableTemplates}
        projectTemplates={projectTemplates}
        taskTemplates={templates}
        taskContext={{
          viewer: viewerRef,
          types,
          definitions,
          members: directory
            .filter((member) => member.status === "active")
            .map((member) => ({ id: member.id, name: member.fullName })),
          names,
          // 5.3: under a template's reminders, its type's, then the organisation's.
          orgReminders: settings.defaultTaskReminders,
        }}
        viewer={viewerRef}
        names={names}
        projectFields={projectFields.filter((definition) => definition.archivedAt === null)}
        showPresets={can(viewer.role, "lists.manage")}
      />
    </>
  );
}
