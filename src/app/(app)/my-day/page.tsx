import { SunriseIcon } from "lucide-react";
import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "My Day" };

export default async function MyDayPage() {
  const viewer = await requireMember();
  return (
    <PlaceholderPage
      greet={viewer.name}
      title="My Day"
      description="Attendance, tasks to acknowledge, today, upcoming, overdue and changes requested."
      task="6.1"
      icon={SunriseIcon}
    />
  );
}
