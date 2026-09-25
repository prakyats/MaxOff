"use client";

import { useId, useState } from "react";

import { useBeforeLogout } from "@/core/auth/components/logout-confirm";
import { Button } from "@/core/ui/primitives/button";
import { Label } from "@/core/ui/primitives/label";
import { Textarea } from "@/core/ui/primitives/textarea";

import { flagOvertimeToday } from "../actions/attendance";
import { ATTENDANCE_REASON_MAX_LENGTH } from "../domain/limits";
import { ErrorText } from "@/core/ui/composites/error-text";

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
    // Validated by the action's schema only: this note is on every signed-in screen, and a
    // client-side parse put all of zod in their first load (task 2.8).
    const result = await flagOvertimeToday({ reason: note });
    if (!result.ok) {
      setError(result.error.fieldErrors?.reason?.[0] ?? result.error.message);
      return false;
    }
    return true;
  });

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
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
        <ErrorText>{error}</ErrorText>
      ) : (
        <p className="text-muted-foreground text-xs">
          A note for the Owner, flagged with today&apos;s logout. Nothing needs approving.
        </p>
      )}
    </div>
  );
}
