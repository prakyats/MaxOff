import { ChevronRightIcon } from "lucide-react";

import { getCurrentMember } from "@/core/auth/server";
import { cn } from "@/core/lib/utils";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Badge } from "@/core/ui/primitives/badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";

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

/** Text kept in the layout but not shown: a pulsing bar the size of the words. */
function Unseen({ children }: { children: string }) {
  return (
    <span className="bg-muted inline-block max-w-full truncate rounded-md align-top text-transparent select-none motion-safe:animate-pulse">
      {children}
    </span>
  );
}

/** One `text-sm` line of the page (20px): a bar in a line box of the same height. */
function Line({ width, className }: { width: string; className?: string }) {
  return (
    <span className={cn("flex h-5 min-w-0 items-center", className)}>
      <Skeleton className={cn("h-3.5", width)} />
    </span>
  );
}

/**
 * Traces `page.tsx` row for row (ARCHITECTURE §14.1), from the classes the two share (`list.ts`):
 * the role's header line, then the role's groups (N3: the heading in its own words, unseen, then
 * the bordered list), each row two lines beside the chevron or the "Coming soon" pill, then Help
 * and troubleshooting: the bordered row, `mt-6`, two lines beside a chevron.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const role = member?.role ?? "admin";
  const description = settingsDescription(role);

  return (
    <>
      <PageHeader title="Settings" description={description} help={description} />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Settings"
        data-slot="loading-settings"
      >
        <div aria-hidden className={SETTINGS_LIST_CLASS}>
          {settingsGroupsFor(role).map((group) => (
            <section key={group.key}>
              <h2 className={GROUP_HEADING_CLASS}>
                <span className="bg-muted rounded-md text-transparent select-none motion-safe:animate-pulse">
                  {group.label}
                </span>
              </h2>
              <ul className={GROUP_LIST_CLASS}>
                {group.sections.map((section) => (
                  <li key={section.key}>
                    {/* The row inside the list item, as the page's link is: the item's divider
                        sits above the 64px row, not inside it. */}
                    <div className={SECTION_ROW_CLASS}>
                      {/* The row's own words, unseen, each a bar: the same lines as the page's at
                        every width and text size. */}
                      <span className="flex min-w-0 flex-1 flex-col">
                        {section.ready ? (
                          <span className={SECTION_LABEL_CLASS}>
                            <Unseen>{section.label}</Unseen>
                          </span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="flex-[1_1_8rem] text-sm leading-5 font-medium">
                              <Unseen>{section.label}</Unseen>
                            </span>
                            <Badge variant="outline" className="shrink-0 font-normal">
                              <Unseen>Coming soon</Unseen>
                            </Badge>
                          </span>
                        )}
                        <span className={SECTION_LINE_CLASS}>
                          <Unseen>{section.description}</Unseen>
                        </span>
                      </span>
                      {section.ready ? (
                        <ChevronRightIcon
                          className="text-muted-foreground size-4 shrink-0"
                          aria-hidden
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <ul aria-hidden className={HELP_LIST_CLASS}>
          <li className={HELP_ROW_CLASS}>
            <span className="flex min-w-0 flex-1 flex-col">
              <Line width="w-44" />
              <Line width="w-56" />
            </span>
            <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          </li>
        </ul>
        <span className="sr-only">Loading Settings</span>
      </div>
    </>
  );
}
