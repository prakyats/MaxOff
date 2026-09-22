import { LayoutDashboardIcon } from "lucide-react";
import type { Metadata } from "next";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Today" };

/** CEO Today (task 6.2) and the Admin dashboard (task 6.3) share this route. */
export default function TodayPage() {
  return (
    <PlaceholderPage
      title="Today"
      description="What needs to happen next: approvals, people, today's tasks and risks."
      task="6.2 (CEO) and 6.3 (Admin)"
      icon={LayoutDashboardIcon}
    />
  );
}
