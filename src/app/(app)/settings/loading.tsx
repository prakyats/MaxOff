import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";

import { getCurrentMember } from "@/core/auth/server";
import { cn } from "@/core/lib/utils";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
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
 * the role's header line, then the role's sections (the same list as the page's, drawn for the
 * role as `me/loading.tsx` reads it), each a 56px row on a phone and a card from `md` up whose
 * description is its own words, unseen, each line a bar, so a card wraps to exactly the page's
 * lines and the grid's rows keep their heights; a section not built yet keeps its "Coming soon"
 * pill. Then Help and troubleshooting: the bordered row, `mt-6`, two lines beside a chevron.
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
        <ul aria-hidden className={SETTINGS_LIST_CLASS}>
          {settingsSectionsFor(role).map((section) => (
            <li key={section.key} className={SECTION_SHELL_CLASS}>
              {section.ready ? (
                <div className={cn(SECTION_LINE_CLASS, SECTION_READY_LINE_CLASS)}>
                  <Line width="w-28" className="flex-1" />
                  <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                </div>
              ) : (
                <div className={cn(SECTION_LINE_CLASS, SECTION_SOON_LINE_CLASS)}>
                  <Line width="w-28" className="flex-[1_1_8rem]" />
                  <Skeleton className="h-5 w-[5.5rem] shrink-0 rounded-full" />
                </div>
              )}
              <p className={SECTION_DESCRIPTION_CLASS}>
                {/* The description's own words, unseen, each line a bar: it wraps to exactly the
                    page's lines at every width and text size. */}
                <span className="bg-muted rounded-md box-decoration-clone text-transparent select-none motion-safe:animate-pulse">
                  {section.description}
                </span>
              </p>
            </li>
          ))}
        </ul>
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
