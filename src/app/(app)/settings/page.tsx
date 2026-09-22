import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Badge } from "@/core/ui/primitives/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/core/ui/primitives/card";
import { settingsSectionsFor } from "@/core/ui/shell/nav";

export const metadata: Metadata = { title: "Settings" };

/**
 * The Owner's control centre (PRODUCT §4.16). Admins see only the lists they may edit
 * (PERMISSIONS §1). Each section is filled in by the task shown on its card.
 */
export default async function SettingsPage() {
  const viewer = await requirePermission([
    "settings.manage",
    "lists.manage",
    "templates.manage",
    "drive.manage",
  ]);
  const sections = settingsSectionsFor(viewer.role);

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          viewer.role === "owner"
            ? "Everything configurable lives here: company, days off, thresholds, lists, fields, templates and integrations."
            : "The lists and templates you may edit. Company settings, days off, thresholds and the team are the Owner's."
        }
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <li key={section.key}>
            <Card size="sm" className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {section.label}
                  <Badge variant="outline" className="text-muted-foreground font-normal">
                    task {section.arrivesIn}
                  </Badge>
                </CardTitle>
                <CardDescription>Filled in task {section.arrivesIn}.</CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
