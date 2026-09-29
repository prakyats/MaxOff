import { CheckSquareIcon } from "lucide-react";
import type { Metadata } from "next";

import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { NewTaskButton } from "@/modules/tasks/components/new-task-button";

import { PlaceholderPage } from "../../_placeholder/placeholder-page";
import { STAND_INS } from "../../_placeholder/stand-ins";
import { loadTaskFormSetup } from "../task-form-setup";

export const metadata: Metadata = { title: "Tasks" };

/**
 * Staff "My tasks" and the management task list share this route (task 4.5). Until then it is a
 * stand-in worded for who is looking: the work given to you, or the work you give out. Since 4.3
 * the Owner and Admins create tasks from here ("New task"); a new task opens on its own page,
 * `/tasks/[id]` (4.4). In the `(list)` route group so its skeleton never wraps a task (the 2.9
 * rule).
 */
export default async function TasksPage() {
  const viewer = await requirePermission("tasks.work");
  const creates = can(viewer.role, "tasks.create");
  return (
    <PlaceholderPage
      title="Tasks"
      copy={creates ? STAND_INS.tasksTeam : STAND_INS.tasksMine}
      icon={CheckSquareIcon}
      actions={
        creates ? <NewTaskButton setup={loadTaskFormSetup(viewer).catch(() => null)} /> : undefined
      }
    />
  );
}
