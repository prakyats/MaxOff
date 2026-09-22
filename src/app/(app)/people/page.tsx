import { UsersIcon } from "lucide-react";
import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage() {
  await requirePermission("team.view");
  return (
    <PlaceholderPage
      title="People"
      description="The team: invites, roles, job titles and each person's attendance and leave."
      task="1.3"
      icon={UsersIcon}
    />
  );
}
