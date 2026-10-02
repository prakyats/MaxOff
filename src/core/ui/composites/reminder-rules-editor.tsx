"use client";

import { BellIcon, ChevronDownIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useId, useState } from "react";

import {
  describeReminders,
  type ReminderDraft,
  type ReminderRule,
  rulesFromDraft,
} from "@/core/lib/reminder-rules";
import { cn } from "@/core/lib/utils";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";
import { closeOverlaysThen, useOverlayHistory } from "@/core/ui/overlay/overlay-history";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The rows (inputs, the unit select) load on the first tap of the line: a screen that only shows
 * the line never carries them (5.3 budget watch; ARCHITECTURE §19). Until then, one row's bar.
 */
const ReminderRows = dynamic(
  () => import("./reminder-rules-rows").then((module) => module.ReminderRows),
  {
    ssr: false,
    loading: () => (
      <div aria-hidden className="flex flex-col gap-2" data-slot="reminder-rows-loading">
        <Skeleton className="h-11 w-full" />
      </div>
    ),
  },
);

/**
 * The reminder editor (5.3, owner 2026-10-02), the same at every level: a task (its dialog), a
 * task type and a template (Settings), the organisation (Settings → Thresholds). **One collapsed
 * line** ("Reminders: 2 days before, 1 day before, when due", and "Using the default" while the
 * level's own list is empty) that opens on a tap into up to 5 rows "N minutes / hours / days
 * before" (0 reads "when due"), each with Remove, then "Add a reminder" and "Use the default".
 * Each row's message shows under it as it is typed (`reminderRowErrors`).
 *
 * **The open section is a layer (owner, 2026-10-02):** back closes it first, then the dialog
 * around it (ARCHITECTURE §14.2 a, as an edit mode in place: `useOverlayHistory`); closing it by a
 * tap on the line backs its entry out (`closeOverlaysThen`), so no spent entry is left behind. Controlled: `draft` is the level's list being edited,
 * `null` while it uses the default (`fallback`, the next level's list as it resolves). Opening
 * changes nothing; the first edit gives the level its own list, starting from what it showed.
 */
export function ReminderRulesEditor({
  draft,
  onChange,
  fallback,
  disabled = false,
  error,
}: {
  draft: ReminderDraft;
  onChange: (draft: ReminderDraft) => void;
  /** What the level follows while its own list is empty. */
  fallback: readonly ReminderRule[];
  disabled?: boolean;
  /** A message from the server about the list as a whole. */
  error?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  useOverlayHistory(open, () => setOpen(false));
  const toggle = () => {
    if (!open) {
      setOpen(true);
      return;
    }
    const close = () => setOpen(false);
    if (!closeOverlaysThen(close)) close();
  };
  const usingDefault = draft === null || draft.length === 0;
  const own = rulesFromDraft(draft);
  const shown = usingDefault ? fallback : own;
  const summaryText = `Reminders: ${shown ? describeReminders(shown) : "a reminder needs fixing"}${usingDefault ? " · Using the default" : ""}`;

  return (
    <div className="flex min-w-0 flex-col gap-2" data-slot="reminder-editor">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
        // One line, always (owner 2026-10-02: it never adds height): a long description is cut
        // with "…" and read in full by its accessible name and on opening.
        className="border-border h-auto min-h-11 w-full justify-between gap-2 rounded-lg border px-3 py-0 text-left font-normal"
        data-slot="reminder-summary"
        data-default={usingDefault ? "" : undefined}
        title={summaryText}
      >
        <BellIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
        {/* Two plain boxes, no inline spans inside the cut one: nothing reaches past it. */}
        <span className="shrink-0 text-sm font-medium">Reminders: </span>
        <span
          className={cn("min-w-0 flex-1 truncate text-sm", shown ? undefined : "text-destructive")}
          data-slot="reminder-summary-text"
        >
          {shown ? describeReminders(shown) : "a reminder needs fixing"}
          {usingDefault ? " · Using the default" : ""}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
        />
      </Button>

      {open ? (
        <ReminderRows
          id={panelId}
          draft={draft}
          onChange={onChange}
          fallback={fallback}
          disabled={disabled}
        />
      ) : null}
      {error ? <ErrorText slot="field-error">{error}</ErrorText> : null}
    </div>
  );
}
