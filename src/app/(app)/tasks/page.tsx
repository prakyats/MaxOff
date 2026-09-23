import { CheckSquareIcon } from "lucide-react";
import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Tasks" };

/** Staff "My tasks" and the management task list share this route (task 4.5). */
export default async function TasksPage() {
  await requirePermission("tasks.work");
  return (
    <PlaceholderPage
      title="Tasks"
      description="Staff tasks with acknowledgement, stages, comments and the approval route."
      task="4.5"
      icon={CheckSquareIcon}
    />
  );
}
