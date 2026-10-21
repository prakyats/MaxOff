import { ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";

import { cn } from "@/core/lib/utils";
import { requirePermission } from "@/core/permissions/server";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Badge } from "@/core/ui/primitives/badge";

import {
  GROUP_HEADING_CLASS,
  GROUP_LIST_CLASS,
  HELP_LIST_CLASS,
  HELP_ROW_CLASS,
  SECTION_LABEL_CLASS,
  SECTION_LINE_CLASS,
  SECTION_ROW_CLASS,
  SETTINGS_LIST_CLASS,
  settingsDescription,
  settingsGroupsFor,
} from "./list";

export const metadata: Metadata = { title: "Settings" };

/**
 * The Owner's control centre (PRODUCT §4.16). Admins see only the lists they may edit
 * (PERMISSIONS §1). A section that is not built yet stays a row marked "Coming soon", never a
 * link into an empty page (and never a task number: kickoff 3c amendment (3e)).
 *
 * N3 (v1.8 V4): the sections sit in groups, each row its name and one line saying what it holds,
 * the same on a phone and a laptop (DESIGN §6). The row's link is named by the section alone; its
 * `after:` covers the whole row.
 */
export default async function SettingsPage() {
  const viewer = await requirePermission([
    "settings.manage",
    "lists.manage",
    "templates.manage",
    "drive.manage",
    "notifications.reachability",
  ]);
  const groups = settingsGroupsFor(viewer.role);
  const description = settingsDescription(viewer.role);

  return (
    <>
      <PageHeader title="Settings" description={description} help={description} />

      <div data-slot="settings-list" className={SETTINGS_LIST_CLASS}>
        {groups.map((group) => (
          <section
            key={group.key}
            data-slot="settings-group"
            aria-labelledby={`settings-group-${group.key}`}
          >
            <h2 id={`settings-group-${group.key}`} className={GROUP_HEADING_CLASS}>
              {group.label}
            </h2>
            <ul className={GROUP_LIST_CLASS}>
              {group.sections.map((section) => (
                <li key={section.key} data-slot="settings-row" className="relative">
                  {section.ready ? (
                    // The whole row is the link (44px+ at every size), named by the section alone;
                    // its one line describes it.
                    <DrillLink
                      href={section.href}
                      data-slot="settings-section"
                      aria-label={section.label}
                      aria-describedby={`settings-line-${section.key}`}
                      className={cn(
                        SECTION_ROW_CLASS,
                        "hover:bg-muted/50 active:bg-muted/60 focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset",
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={SECTION_LABEL_CLASS}>{section.label}</span>
                        <span id={`settings-line-${section.key}`} className={SECTION_LINE_CLASS}>
                          {section.description}
                        </span>
                      </span>
                      <ChevronRightIcon
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden
                      />
                    </DrillLink>
                  ) : (
                    <div className={SECTION_ROW_CLASS}>
                      <span className="flex min-w-0 flex-1 flex-col">
                        {/* The label keeps at least 8rem and the line wraps, so at large system
                            text "Coming soon" drops under the label instead of squeezing it. */}
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-muted-foreground flex-[1_1_8rem] text-sm font-medium">
                            {section.label}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-muted-foreground shrink-0 font-normal"
                          >
                            Coming soon
                          </Badge>
                        </span>
                        <span className={SECTION_LINE_CLASS}>{section.description}</span>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

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
