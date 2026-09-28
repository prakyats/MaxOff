import { ClockIcon } from "lucide-react";

import { EmptyState } from "@/core/ui/composites/empty-state";
import {
  CARD_ROW_MIN_H,
  CARD_ROW_PADDING,
  CARD_ROW_TITLE,
  CARD_ROW_TRAILING,
} from "@/core/ui/composites/row-metrics";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { cn } from "@/core/lib/utils";

import { type ExtraWorkNote, noteOutcome, noteTitle } from "../domain/notes";

/**
 * The member's extra work notes, newest day first (the Extra work tab, 3b.2): what the day was,
 * what they worked on, and the outcome in their words ("Waiting for the Owner", "1 comp leave
 * granted · use by 31 Oct", "Reviewed by the Owner"). Cards at every width: a note is a sentence,
 * not a table row.
 */
export function ExtraWorkNotesList({ notes }: { notes: ExtraWorkNote[] }) {
  if (notes.length === 0) {
    return (
      <EmptyState
        icon={ClockIcon}
        title="No extra work noted yet"
        description="Worked late, or on a day off? Add a note and the Owner decides whether it earns comp leave."
      />
    );
  }
  return (
    <ul
      data-slot="extra-work-notes"
      className="border-border divide-border bg-card divide-y rounded-lg border"
    >
      {notes.map((note) => {
        const outcome = noteOutcome(note);
        return (
          <li
            key={note.id}
            data-slot="extra-work-note"
            className={cn("flex flex-wrap items-start gap-3", CARD_ROW_MIN_H, CARD_ROW_PADDING)}
          >
            <div className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
              <span className="font-medium">{noteTitle(note)}</span>
              <span className="text-muted-foreground text-sm break-words">{note.note}</span>
            </div>
            <StatusDot
              status={outcome.status}
              label={outcome.text}
              className={cn(CARD_ROW_TRAILING, "text-sm")}
            />
          </li>
        );
      })}
    </ul>
  );
}
