import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { listTaskTypeSettings } from "@/modules/tasks";
import { AddTaskTypeButton, TaskTypesManager } from "@/modules/tasks/components/task-types-manager";

import { SETTINGS_HEADERS } from "../headers";

export const metadata: Metadata = { title: "Task types" };

/**
 * Settings → Task types (4C; PRODUCT §4.6, Kickoff 4 decisions 14, 15): the Owner's list
 * (`settings.manage`; Admins pick from it). Add, edit, reorder, archive and restore; the kind is
 * fixed once a type exists; no reminder editor (5.3's). Per-type task fields are in Settings →
 * Custom fields → Tasks.
 */
export default async function TaskTypesSettingsPage() {
  // Read together with the permission check, not after it (ARCHITECTURE §19).
  const [, types] = await checkThenRead(
    requirePermission("settings.manage"),
    listTaskTypeSettings(),
  );

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Task types"
        {...SETTINGS_HEADERS.taskTypes}
        actions={<AddTaskTypeButton />}
      />
      <div className="max-w-2xl">
        <TaskTypesManager types={types} />
      </div>
    </>
  );
}
