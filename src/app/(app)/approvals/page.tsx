import { ClipboardListIcon } from "lucide-react";
import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  await requirePermission(["tasks.approve_final", "tasks.approve_admin"]);
  return (
    <PlaceholderPage
      title="Approvals"
      description="Tasks and client items waiting for your decision, with bulk approve and reject."
      task="4.5 (tasks) and 7.4 (items)"
      icon={ClipboardListIcon}
    />
  );
}
