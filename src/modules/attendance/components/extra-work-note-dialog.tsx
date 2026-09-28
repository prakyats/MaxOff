"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ResultError } from "@/core/errors";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import { submitExtraWorkNote } from "../actions/notes";
import { ATTENDANCE_REASON_MAX_LENGTH } from "../domain/limits";
import { DURATION_OPTIONS, durationLabel, KIND_LABELS, type NoteDay } from "../domain/notes";

/**
 * An extra work note (PRODUCT §4.3a, 3b.2): which day (today or up to 7 days back; the calendar
 * says whether that day takes an overtime note or an "I worked today" note), roughly how long
 * (overtime only, optional) and what they worked on (required). The Owner reviews it in Approvals.
 * A bottom sheet on a phone (`Dialog`), one layer (ARCHITECTURE §14.2 a).
 */
export function ExtraWorkNoteDialog({
  days,
  initialDate,
  onClose,
}: {
  /** The selectable days, today first (`noteDays()`). */
  days: NoteDay[];
  /** The day to start from (a history row, the strip's day off), else today. */
  initialDate?: string | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState(initialDate ?? days[0]?.date ?? "");
  const [duration, setDuration] = useState<string>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();
  const day = days.find((option) => option.date === date) ?? days[0];
  const kind = day?.kind ?? "overtime";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await submitExtraWorkNote({
        kind,
        workDate: date,
        durationMinutes:
          kind === "overtime" && duration
            ? (Number(duration) as (typeof DURATION_OPTIONS)[number])
            : null,
        note,
      });
      if (result.ok) {
        toastResult(result, { success: "Note sent to the Owner" });
        router.refresh();
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent data-slot="extra-work-note-dialog">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {kind === "day_off" ? "I worked on a day off" : "Overtime note"}
            </DialogTitle>
            <DialogDescription>
              The Owner decides whether it earns comp leave
              {kind === "day_off" ? " and whether the day counts as worked" : ""}. Nothing is
              automatic.
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}
          <FormField label="Day" error={fieldErrors.workDate ?? fieldErrors.kind}>
            {(control) => (
              <Select value={date} onValueChange={setDate}>
                <SelectTrigger
                  id={control.id}
                  className="w-full"
                  aria-describedby={control["aria-describedby"]}
                  aria-invalid={control["aria-invalid"]}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {days.map((option) => (
                    <SelectItem key={option.date} value={option.date}>
                      {option.label} · {KIND_LABELS[option.kind].toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          {kind === "overtime" ? (
            <FormField
              label="Roughly how long (optional)"
              error={fieldErrors.durationMinutes}
              hint="A rough figure is enough."
            >
              {(control) => (
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger
                    id={control.id}
                    className="w-full"
                    aria-describedby={control["aria-describedby"]}
                    aria-invalid={control["aria-invalid"]}
                  >
                    <SelectValue placeholder="Not sure" />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_OPTIONS.map((minutes) => (
                      <SelectItem key={minutes} value={String(minutes)}>
                        {durationLabel(minutes)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          ) : null}
          <FormField label="What you worked on" error={fieldErrors.note}>
            {(control) => (
              <Textarea
                {...control}
                name="note"
                rows={3}
                maxLength={ATTENDANCE_REASON_MAX_LENGTH}
                placeholder="The shoot, the edit, the client…"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Send note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
