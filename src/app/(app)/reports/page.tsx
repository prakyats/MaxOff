import { FileBarChart2Icon } from "lucide-react";
import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Reports" };

/** Owner reports (task 9.3) and the Admin's scoped operational reports share this route. */
export default async function ReportsPage() {
  await requirePermission(["reports.all", "reports.scoped"]);
  return (
    <PlaceholderPage
      title="Reports"
      description="End-of-day reports, week and month views and exports."
      task="6.5 (end of day) and 9.3 (reports)"
      icon={FileBarChart2Icon}
    />
  );
}
