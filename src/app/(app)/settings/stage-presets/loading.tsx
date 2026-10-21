import { ListHeadingSkeleton, ListRowsSkeleton } from "@/core/ui/composites/list-rows-skeleton";
import { PageHeader } from "@/core/ui/composites/page-header";

import { SETTINGS_HEADERS } from "../headers";

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1): the list's heading with "Add preset" (C4), then one
 * bordered list of presets, each a 56px row with the name over its stages line and its actions
 * (the ⋯ on a phone; Edit and Archive from `md` up).
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Stage presets"
        {...SETTINGS_HEADERS.stagePresets}
        back={{ href: "/settings", label: "Settings" }}
      />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Stage presets"
        data-slot="loading-stage-presets"
        className="flex max-w-2xl flex-col gap-3"
      >
        <ListHeadingSkeleton titleWidth="w-20" addWidth="w-32" />
        <ListRowsSkeleton rows={3} icons={2} subtitle />
        <span className="sr-only">Loading Stage presets</span>
      </div>
    </>
  );
}
