import { BriefcaseIcon } from "lucide-react";
import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  await requirePermission(["clients.manage", "clients.edit_assigned"]);
  return (
    <PlaceholderPage
      title="Clients"
      description="Client records, contacts, brand and projects. Admins see their assigned clients."
      task="3.4"
      icon={BriefcaseIcon}
    />
  );
}
