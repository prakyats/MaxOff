import { LayoutDashboardIcon } from "lucide-react";
import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Today" };

/** Owner Today (task 6.2) and the Admin dashboard (task 6.3) share this route. */
export default async function TodayPage() {
  const viewer = await requireMember();
  return (
    <PlaceholderPage
      greet={viewer.name}
      title="Today"
      description="What needs to happen next: approvals, people, today's tasks and risks."
      task="6.2 (Owner) and 6.3 (Admin)"
      icon={LayoutDashboardIcon}
    />
  );
}
