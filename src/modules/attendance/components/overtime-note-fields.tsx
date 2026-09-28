"use client";

import { ErrorText } from "@/core/ui/composites/error-text";
import { Label } from "@/core/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";

import { ATTENDANCE_REASON_MAX_LENGTH } from "../domain/limits";
import { DURATION_OPTIONS, durationLabel } from "../domain/notes";

/**
 * The End-day confirmation's optional overtime note (PRODUCT §4.2, 3b.2): roughly how long and
 * what they worked on. Controlled by `EndDayButton`, which loads this file only when asked.
 */
export function OvertimeNoteFields({
  id,
  minutes,
  onMinutes,
  note,
  onNote,
  error,
}: {
  id: string;
  minutes: string;
  onMinutes: (value: string) => void;
  note: string;
  onNote: (value: string) => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-3" data-slot="overtime-note">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-minutes`}>Roughly how long (optional)</Label>
        <Select value={minutes} onValueChange={onMinutes}>
          <SelectTrigger id={`${id}-minutes`} className="w-full">
            <SelectValue placeholder="Not sure" />
          </SelectTrigger>
          <SelectContent>
            {DURATION_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {durationLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-note`}>Overtime note</Label>
        <Textarea
          id={`${id}-note`}
          rows={3}
          autoFocus
          maxLength={ATTENDANCE_REASON_MAX_LENGTH}
          placeholder="What you worked on"
          value={note}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onNote(event.target.value)}
        />
        {error ? (
          <ErrorText>{error}</ErrorText>
        ) : (
          <p className="text-muted-foreground text-xs">
            The Owner decides whether it earns comp leave. Nothing is automatic.
          </p>
        )}
      </div>
    </div>
  );
}
