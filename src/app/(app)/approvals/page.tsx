import { ClipboardListIcon } from "lucide-react";
import type { Metadata } from "next";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return (
    <PlaceholderPage
      title="Approvals"
      description="Tasks and client items waiting for your decision, with bulk approve and reject."
      task="4.5 (tasks) and 7.4 (items)"
      icon={ClipboardListIcon}
    />
  );
}
