"use client";

import { ICONS } from "@/core/ui/icons";
import { Button } from "@/core/ui/primitives/button";

const History = ICONS.history;

/**
 * **History, the one pattern** (v1.8 consistency sweep, owner 2026-10-21; docs/DESIGN.md
 * "Patterns"): the clock icon labelled "History", 44 px, in a detail page's header just before
 * its ⋯. `HistoryButton` is the trigger alone (a caller that reads its own history when it
 * opens: the project page, the client page, whose layout must never read it); `HistorySheet` is
 * the trigger with the history the page already rendered (the task), shown in the same sheet: a bottom sheet on a phone, a side panel from `md` up
 * (`ReviewSheet`), an overlay layer that back closes (§14.2 a).
 */
export function HistoryButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="History"
      title="History"
      data-slot="history-open"
      className="size-11"
      onClick={onOpen}
    >
      <History aria-hidden />
    </Button>
  );
}
