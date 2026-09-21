import { CheckSquareIcon } from "lucide-react";
import type { Metadata } from "next";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Tasks" };

/** Staff "My tasks" and the management task list share this route (task 4.5). */
export default function TasksPage() {
  return (
    <PlaceholderPage
      title="Tasks"
      description="Staff tasks with acknowledgement, stages, comments and the approval route."
      task="4.5"
      icon={CheckSquareIcon}
    />
  );
}
