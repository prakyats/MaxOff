import { BellIcon } from "lucide-react";
import type { Metadata } from "next";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Alerts" };

export default function NotificationsPage() {
  return (
    <PlaceholderPage
      title="Alerts"
      description="Your notification history with links to the task, request or decision."
      task="5.1"
      icon={BellIcon}
    />
  );
}
