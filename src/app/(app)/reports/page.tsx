import { FileBarChart2Icon } from "lucide-react";
import type { Metadata } from "next";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Reports" };

/** CEO reports (task 9.3) and the Admin's scoped operational reports share this route. */
export default function ReportsPage() {
  return (
    <PlaceholderPage
      title="Reports"
      description="End-of-day reports, week and month views and exports."
      task="6.5 (end of day) and 9.3 (reports)"
      icon={FileBarChart2Icon}
    />
  );
}
