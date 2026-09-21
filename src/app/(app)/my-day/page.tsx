import { SunriseIcon } from "lucide-react";
import type { Metadata } from "next";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "My Day" };

export default function MyDayPage() {
  return (
    <PlaceholderPage
      title="My Day"
      description="Attendance, tasks to acknowledge, today, upcoming, overdue and changes requested."
      task="6.1"
      icon={SunriseIcon}
    />
  );
}
