"use client";

import { CheckCheckIcon, ListChecksIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { useOverlayHistory } from "@/core/ui/overlay/overlay-history";
import { Button } from "@/core/ui/primitives/button";

/**
 * Select mode on a cycle's deliverable list (ROADMAP 6b.16 (e)): the checkboxes show only while
 * it is on. It is **view state**: no address and no drill-down, so it never adds a page to the
 * history; like a layer, the back gesture (and Escape's twin, the browser back) closes it first
 * (ARCHITECTURE §14.2 a), through `useOverlayHistory`'s marker entry (no URL). Leaving it clears
 * the selection. A row consumes `selectMode`, `selected` and `onToggle`; the action bar
 * (`BulkEditBar`) consumes the same state.
 */
export type SelectMode = {
  selectMode: boolean;
  selected: ReadonlySet<string>;
  enter: () => void;
  exit: () => void;
  onToggle: (id: string) => void;
  /** Replace the selection (a bulk call keeps the ones that failed selected). */
  setSelected: (next: ReadonlySet<string>) => void;
};

export function useSelectMode(): SelectMode {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const exit = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);
  useOverlayHistory(selectMode, exit);
  const enter = useCallback(() => setSelectMode(true), []);
  const onToggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  return { selectMode, selected, enter, exit, onToggle, setSelected };
}

/**
 * The list's "Select" control, and while selecting "Select all" and "Done" (which leaves Select
 * mode). Neutral, never red (§14.1): it changes the view, not the data.
 */
export function SelectToggle({
  mode,
  selectableIds,
}: {
  mode: SelectMode;
  /** The rows that can be selected now, in the list's order. */
  selectableIds: readonly string[];
}) {
  if (!mode.selectMode) {
    return (
      <Button
        variant="ghost"
        data-slot="select-mode"
        disabled={selectableIds.length === 0}
        onClick={mode.enter}
      >
        <ListChecksIcon aria-hidden />
        Select
      </Button>
    );
  }
  const all = selectableIds.length > 0 && selectableIds.every((id) => mode.selected.has(id));
  return (
    <span className="flex flex-wrap items-center gap-1" data-slot="select-mode-on">
      <Button
        variant="ghost"
        data-slot="select-all"
        disabled={selectableIds.length === 0}
        onClick={() => mode.setSelected(all ? new Set() : new Set(selectableIds))}
      >
        <CheckCheckIcon aria-hidden />
        {all ? "Select none" : "Select all"}
      </Button>
      <Button variant="secondary" data-slot="select-done" onClick={mode.exit}>
        Done
      </Button>
    </span>
  );
}
