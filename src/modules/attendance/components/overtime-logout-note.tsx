"use client";

import { useId, useState } from "react";

import { useBeforeLogout } from "@/core/auth/components";
import { Button } from "@/core/ui/primitives/button";
import { Label } from "@/core/ui/primitives/label";
import { Textarea } from "@/core/ui/primitives/textarea";

import { flagOvertimeToday } from "../actions/attendance";
import { ATTENDANCE_REASON_MAX_LENGTH, flagOvertimeTodaySchema } from "../domain/schemas";

/**
 * "Worked late today? Add an overtime note", inside the Log out confirmation (2.3 polish): the
 * moment someone leaves late is the moment they remember it. Optional; when a note is written
 * it is flagged first (`attendance_flag_overtime`, reason still required), and the sign-out
 * only happens once that worked. A problem keeps the confirmation open with the message.
 */
export function OvertimeLogoutNote() {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  useBeforeLogout(async () => {
    if (!open || note.trim() === "") return true;
    const parsed = flagOvertimeTodaySchema.safeParse({ reason: note });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the note.");
      return false;
    }
    const result = await flagOvertimeToday({ reason: note });
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    return true;
  });

  if (!open) {
    return (
      <Button
        type="button"
        variant="link"
        className="self-start px-0"
        onClick={() => setOpen(true)}
        data-slot="overtime-note-toggle"
      >
        Worked late today? Add an overtime note
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-slot="overtime-note">
      <Label htmlFor={noteId}>Overtime note</Label>
      <Textarea
        id={noteId}
        rows={3}
        autoFocus
        maxLength={ATTENDANCE_REASON_MAX_LENGTH}
        placeholder="What kept you"
        value={note}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          setNote(event.target.value);
          setError(null);
        }}
      />
      {error ? (
        <p data-slot="field-error" role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          A note for the Owner, flagged with today&apos;s logout. Nothing needs approving.
        </p>
      )}
    </div>
  );
}
