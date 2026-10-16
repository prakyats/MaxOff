import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";

import { cn } from "@/core/lib/utils";
import { requirePermission } from "@/core/permissions/server";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Badge } from "@/core/ui/primitives/badge";
import { settingsSectionsFor } from "@/core/ui/shell/nav";

import {
  HELP_LIST_CLASS,
  HELP_ROW_CLASS,
  SECTION_DESCRIPTION_CLASS,
  SECTION_LINE_CLASS,
  SECTION_READY_LINE_CLASS,
  SECTION_SHELL_CLASS,
  SECTION_SOON_LINE_CLASS,
  SETTINGS_LIST_CLASS,
  settingsDescription,
} from "./list";

export const metadata: Metadata = { title: "Settings" };

/**
 * The Owner's control centre (PRODUCT §4.16). Admins see only the lists they may edit
 * (PERMISSIONS §1). A section that is not built yet stays a row marked "Coming soon", never a
 * link into an empty page (and never a task number: kickoff 3c amendment (3e)).
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
    "notifications.reachability",
  ]);
  const sections = settingsSectionsFor(viewer.role);

  const description = settingsDescription(viewer.role);

  return (
    <>
      <PageHeader title="Settings" description={description} help={description} />

      <ul data-slot="settings-list" className={SETTINGS_LIST_CLASS}>
        {sections.map((section) => {
          // The tappable line (`SECTION_LINE_CLASS`). The description stays *outside* it so the
          // link is named "Company", not "Company, the company name and the timezone…"; on
          // desktop `after:inset-0` hands the rest of the card back to the same link.
          return (
            <li
              key={section.key}
              className={cn(SECTION_SHELL_CLASS, section.ready && "md:hover:border-ring")}
            >
              {section.ready ? (
                <DrillLink
                  href={section.href}
                  data-slot="settings-section"
                  className={cn(
                    SECTION_LINE_CLASS,
                    SECTION_READY_LINE_CLASS,
                    "active:bg-muted/60 md:active:bg-transparent",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {section.label}
                  </span>
                  <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                </DrillLink>
              ) : (
                <div className={cn(SECTION_LINE_CLASS, SECTION_SOON_LINE_CLASS)}>
                  {/* The label keeps at least 8rem and the row wraps, so at large system text
                      "Coming soon" drops under the label instead of squeezing it: beside the
                      badge the label kept 47px at 200% and broke mid-word (3cB review, §14.2 i). */}
                  <span className="text-muted-foreground flex-[1_1_8rem] text-sm">
                    {section.label}
                  </span>
                  <Badge variant="outline" className="text-muted-foreground shrink-0 font-normal">
                    Coming soon
                  </Badge>
                </div>
              )}
              <p className={SECTION_DESCRIPTION_CLASS}>{section.description}</p>
            </li>
          );
        })}
      </ul>

      {/* Help and troubleshooting (ROADMAP 6b.14): the in-app guide, for the reader's role. */}
      <ul data-slot="settings-help" className={HELP_LIST_CLASS}>
        <li>
          <DrillLink
            href="/me/guide"
            data-slot="settings-guide-link"
            className={cn(
              HELP_ROW_CLASS,
              "focus-visible:ring-ring active:bg-muted/60 group/guide hover:bg-muted/50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset",
            )}
          >
            {/* Says what opens (unit U): the guide, step-by-step help for the reader's role. */}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">Help and troubleshooting</span>
              <span className="text-muted-foreground truncate text-sm">
                Opens How MaxOff works, for your role
              </span>
            </span>
            <ChevronRightIcon
              className="text-muted-foreground group-hover/guide:text-foreground size-4 shrink-0"
              aria-hidden
            />
          </DrillLink>
        </li>
      </ul>
    </>
  );
}
