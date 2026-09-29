import { CheckSquareIcon } from "lucide-react";
import type { Metadata } from "next";

import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";

import { PlaceholderPage } from "../_placeholder/placeholder-page";
import { STAND_INS } from "../_placeholder/stand-ins";

export const metadata: Metadata = { title: "Tasks" };

/**
 * Staff "My tasks" and the management task list share this route (task 4.5). Until then it is a
 * stand-in worded for who is looking: the work given to you, or the work you give out.
 */
export default async function TasksPage() {
  const viewer = await requirePermission("tasks.work");
  return (
    <PlaceholderPage
      title="Tasks"
      copy={can(viewer.role, "tasks.create") ? STAND_INS.tasksTeam : STAND_INS.tasksMine}
      icon={CheckSquareIcon}
    />
  );
}
