import { cn } from "@/core/lib/utils";
import { ListHeadingSkeleton, ListRowsSkeleton } from "@/core/ui/composites/list-rows-skeleton";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SETTINGS_HEADERS } from "../headers";

import { TEMPLATE_SECTIONS } from "./sections";

/** Each section's heading and Add widths, and whether its rows have Preview. */
const SHAPES = {
  presets: { title: "w-24", add: "w-32", preview: false },
  deliverables: { title: "w-40", add: "w-52", preview: true },
  projects: { title: "w-32", add: "w-48", preview: true },
  tasks: { title: "w-28", add: "w-44", preview: false },
} as const;

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1), the one Templates page (6b.6 owner note): the 44 px
 * search, the phone's segmented control (four 44 px segments in a muted track, `md:hidden`), then
 * the four sections in build order, each its heading with "Add …" and a bordered list of 56 px rows
 * (the name over its line; Preview where the row has one, then the actions), the divider before
 * Task templates from `md` up. On a phone only the first section shows, as on the page.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Templates"
        {...SETTINGS_HEADERS.templates}
        back={{ href: "/settings", label: "Settings" }}
      />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Templates"
        data-slot="loading-templates"
        className="flex flex-col gap-6"
      >
        <Skeleton aria-hidden className="h-11 w-full rounded-lg md:h-8" />
        <div aria-hidden className="bg-muted rounded-control grid grid-cols-4 gap-1 p-1 md:hidden">
          {TEMPLATE_SECTIONS.map((section) => (
            <span key={section.key} className="flex min-h-11 items-center justify-center">
              <Skeleton className="h-3 w-12" />
            </span>
          ))}
        </div>
        {TEMPLATE_SECTIONS.map((section, index) => {
          const shape = SHAPES[section.key];
          return (
            <div key={section.key} className="contents">
              {section.key === "tasks" ? (
                <hr aria-hidden className="border-border hidden md:block" />
              ) : null}
              <div className={cn("flex-col gap-3", index === 0 ? "flex" : "hidden md:flex")}>
                <ListHeadingSkeleton titleWidth={shape.title} addWidth={shape.add} />
                <ListRowsSkeleton rows={2} icons={2} subtitle preview={shape.preview} />
              </div>
            </div>
          );
        })}
        <span className="sr-only">Loading Templates</span>
      </div>
    </>
  );
}
