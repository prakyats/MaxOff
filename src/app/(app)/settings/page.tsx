import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Badge } from "@/core/ui/primitives/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/core/ui/primitives/card";
import { settingsSectionsFor } from "@/core/ui/shell/nav";

export const metadata: Metadata = { title: "Settings" };

/**
 * The Owner's control centre (PRODUCT §4.16). Admins see only the lists they may edit
 * (PERMISSIONS §1). A section that is not built yet stays a card with the task that brings it.
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
            <Card
              size="sm"
              className={
                section.ready
                  ? "hover:border-ring relative h-full transition-colors"
                  : "relative h-full"
              }
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {section.ready ? (
                    <Link
                      href={section.href}
                      data-slot="settings-section"
                      className="after:absolute after:inset-0 hover:underline"
                    >
                      {section.label}
                    </Link>
                  ) : (
                    section.label
                  )}
                  {section.ready ? (
                    <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground font-normal">
                      task {section.arrivesIn}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {section.ready ? section.description : `Filled in task ${section.arrivesIn}.`}
                </CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
