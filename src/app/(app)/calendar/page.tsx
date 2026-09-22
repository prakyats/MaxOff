import { CalendarDaysIcon } from "lucide-react";
import type { Metadata } from "next";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <PlaceholderPage
      title="Calendar"
      description="Events, approved leave, holidays and planned client items by day, week and month."
      task="6.4"
      icon={CalendarDaysIcon}
    />
  );
}
