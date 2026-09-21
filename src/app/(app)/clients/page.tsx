import { BriefcaseIcon } from "lucide-react";
import type { Metadata } from "next";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage() {
  return (
    <PlaceholderPage
      title="Clients"
      description="Client records, contacts, brand and projects. Admins see their assigned clients."
      task="3.4"
      icon={BriefcaseIcon}
    />
  );
}
