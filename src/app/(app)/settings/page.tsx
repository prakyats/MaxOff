import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";

import { cn } from "@/core/lib/utils";
import { requirePermission } from "@/core/permissions/server";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Badge } from "@/core/ui/primitives/badge";
import { settingsSectionsFor } from "@/core/ui/shell/nav";

export const metadata: Metadata = { title: "Settings" };

/**
 * The Owner's control centre (PRODUCT §4.16). Admins see only the lists they may edit
 * (PERMISSIONS §1). A section that is not built yet stays a row with the task that brings it.
 *
 * One list, two shapes (ARCHITECTURE §14.1): on a phone it is a list of 56px rows — the label,
 * where it goes, nothing between you and the next tap — and from `md` up the same items become
 * a grid of cards where a line of description is worth reading. Each section is a single
 * element either way, so nothing is rendered twice.
 */
export default async function SettingsPage() {
  const viewer = await requirePermission([
    "settings.manage",
    "lists.manage",
    "templates.manage",
    "drive.manage",
  ]);
  const sections = settingsSectionsFor(viewer.role);

  const description =
    viewer.role === "owner"
      ? "Everything configurable lives here: company, days off, thresholds, lists, fields, templates and integrations."
      : "The lists and templates you may edit. Company settings, days off, thresholds and the team are the Owner's.";

  return (
    <>
      <PageHeader title="Settings" description={description} help={description} />

      <ul
        data-slot="settings-list"
        className="border-border divide-border divide-y overflow-hidden rounded-lg border md:grid md:grid-cols-2 md:gap-3 md:divide-y-0 md:overflow-visible md:rounded-none md:border-0 lg:grid-cols-3"
      >
        {sections.map((section) => {
          // The row itself on a phone; the card from `md` up.
          const shell =
            "relative h-full md:rounded-xl md:border md:border-border md:bg-card md:transition-colors";
          // The tappable line. The description stays *outside* it so the link is named
          // "Company", not "Company, the company name and the timezone…"; on desktop
          // `after:inset-0` hands the rest of the card back to the same link.
          const line =
            "flex min-h-14 items-center gap-2 px-4 outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

          return (
            <li key={section.key} className={cn(shell, section.ready && "md:hover:border-ring")}>
              {section.ready ? (
                <DrillLink
                  href={section.href}
                  data-slot="settings-section"
                  className={cn(
                    line,
                    "active:bg-muted/60 md:min-h-0 md:pt-4 md:active:bg-transparent",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {section.label}
                  </span>
                  <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                </DrillLink>
              ) : (
                <div className={cn(line, "after:hidden md:min-h-0 md:pt-4")}>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                    {section.label}
                  </span>
                  <Badge variant="outline" className="text-muted-foreground shrink-0 font-normal">
                    task {section.arrivesIn}
                  </Badge>
                </div>
              )}
              <p className="text-muted-foreground hidden px-4 pt-1.5 pb-4 text-sm md:block">
                {section.ready ? section.description : `Filled in task ${section.arrivesIn}.`}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
