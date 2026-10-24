"use client";

import { ChevronDownIcon } from "lucide-react";

import { BulkBar } from "@/core/ui/composites/bulk-bar";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import type { BulkEditKind } from "./bulk-edit-sheet";

/** One "Tick ‹stage› on N" choice (amendment D2): the stage name and the selected rows' stages. */
export type TickChoice = { key: string; name: string; stageIds: string[] };

const EDITS: readonly { kind: BulkEditKind; label: string }[] = [
  { kind: "plan", label: "Set planned date…" },
  { kind: "shift", label: "Move planned dates…" },
  { kind: "groups", label: "Add a stage group…" },
  { kind: "rename", label: "Rename…" },
];

/**
 * The action bar of Select mode (ROADMAP 6b.16 (e)), shown while rows are selected: **Mark N
 * done** and **Tick ‹stage› on N** (`items.tick`, folded in from the list's earlier selection: it
 * asks first, its red button naming it), and **Edit N** (`projects.manage`, the open ones only):
 * set or move planned dates, add a stage group, rename by a pattern. Each edit opens its own sheet
 * (`BulkEditSheet`); the bar itself holds no state of its own.
 */
export function BulkEditBar({
  count,
  onClear,
  markable,
  marking,
  onMarkDone,
  choices,
  onTick,
  editable,
  onEdit,
  onHeight,
}: {
  /** The bar's height in px (0 once gone): the list reserves it while selecting. */
  onHeight?: (height: number) => void;
  /** How many rows are selected (the bar hides at 0). */
  count: number;
  onClear: () => void;
  /** How many selected rows Mark done may take (0: not offered). */
  markable: number;
  marking: boolean;
  onMarkDone: () => void;
  /** "Tick ‹stage› on N" (empty: not offered). */
  choices: readonly TickChoice[];
  onTick: (choice: TickChoice) => void;
  /** How many selected rows the edits take (0: not offered). */
  editable: number;
  onEdit: (kind: BulkEditKind) => void;
}) {
  return (
    <BulkBar count={count} onClear={onClear} noun="selected" onHeight={onHeight}>
      {markable > 0 ? (
        // A trigger that opens a confirmation: the Forest green of Mark done (colour plan); the
        // commit names it (§14.1).
        <Button
          variant="approve"
          opens
          size="sm"
          pending={marking}
          pendingLabel="Marking done…"
          data-slot="bulk-mark-done"
          onClick={onMarkDone}
        >
          Mark {markable} done
        </Button>
      ) : null}
      {choices.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" data-slot="bulk-tick">
              Tick a stage
              <ChevronDownIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {choices.map((choice) => (
              <DropdownMenuItem key={choice.key} onSelect={() => onTick(choice)}>
                Tick {choice.name} on {choice.stageIds.length}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {editable > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" data-slot="bulk-edit">
              Edit {editable}
              <ChevronDownIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {EDITS.map((edit) => (
              <DropdownMenuItem key={edit.kind} onSelect={() => onEdit(edit.kind)}>
                {edit.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </BulkBar>
  );
}
