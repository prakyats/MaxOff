import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/core/ui/composites/page-header";
import { Forbidden } from "@/core/ui/composites/forbidden";
import { Badge } from "@/core/ui/primitives/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/core/ui/primitives/card";
import { settingsSectionsFor } from "@/core/ui/shell/nav";
import { getPreviewViewer } from "@/core/ui/shell/preview-viewer";

export const metadata: Metadata = { title: "Settings" };

/**
 * The CEO's control centre (PRODUCT §4.16). Admins see only the lists they may edit
 * (PERMISSIONS §1). Each section is filled in by the task shown on its card.
 */
export default async function SettingsPage() {
  const viewer = await getPreviewViewer();
  if (!viewer) notFound();

  const sections = settingsSectionsFor(viewer.role);
  if (sections.length === 0) return <Forbidden homeHref="/my-day" />;

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          viewer.role === "ceo"
            ? "Everything configurable lives here: company, days off, thresholds, lists, fields, templates and integrations."
            : "The lists and templates you may edit. Company settings, days off, thresholds and the team are the CEO's."
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
