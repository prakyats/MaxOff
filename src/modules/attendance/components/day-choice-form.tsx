"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useId } from "react";

import type { Result } from "@/core/errors";
import { cn } from "@/core/lib/utils";
import { StickyActions } from "@/core/ui/composites/sticky-actions";
import { Button } from "@/core/ui/primitives/button";
import { Label } from "@/core/ui/primitives/label";
import { Textarea } from "@/core/ui/primitives/textarea";

import { submitDayChoice } from "../actions/attendance";
import { ATTENDANCE_CHOICES, CHOICE_COPY } from "../domain/choices";
import { ATTENDANCE_REASON_MAX_LENGTH } from "../domain/limits";
import type { SubmitChoiceInput } from "../domain/schemas";

/**
 * The gate's four answers (WORKFLOWS §1), laid out for a thumb: one tall option per line, an
 * optional reason, and Submit in the sticky bar. `workDate` is the IST date the server opened
 * the day for; it travels with the answer, so a screen left open over midnight is refused
 * ("The day changed") and the gate reloads for the new day instead of recording yesterday.
 * Any refusal of that kind (`INVALID_STATE`, e.g. a second tab already answered) reloads too.
 */
export function DayChoiceForm({ workDate, next }: { workDate: string; next: string }) {
  const router = useRouter();
  const reasonId = useId();
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<null> | null, formData: FormData) => {
      const result = await submitDayChoice({
        // Unchecked sends nothing; zod answers "Choose one." for anything but the four values.
        choice: String(formData.get("choice") ?? "") as SubmitChoiceInput["choice"],
        reason: String(formData.get("reason") ?? ""),
        forDate: String(formData.get("forDate") ?? ""),
        next,
      });
      // The day changed, or another tab already answered: reload, so the gate either asks for
      // the new day or lets the member through, instead of leaving them stuck on a stale form.
      if (!result.ok && result.error.code === "INVALID_STATE") router.refresh();
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : null;
  const choiceError = error?.fieldErrors?.choice?.[0];
  const reasonError = error?.fieldErrors?.reason?.[0];

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="forDate" value={workDate} readOnly />
      {error && !error.fieldErrors ? (
        <p role="alert" data-slot="form-alert" className="text-destructive text-sm">
          {error.message}
        </p>
      ) : null}
      <fieldset
        className="flex flex-col gap-2"
        aria-invalid={choiceError ? true : undefined}
        aria-describedby={choiceError ? `${reasonId}-choice-error` : undefined}
      >
        <legend className="mb-2 text-sm font-medium">Today I am</legend>
        {ATTENDANCE_CHOICES.map((choice) => (
          <label
            key={choice}
            data-slot="choice-option"
            className={cn(
              "border-border bg-card flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3",
              "has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3",
            )}
          >
            <input
              type="radio"
              name="choice"
              value={choice}
              className="accent-primary size-5 shrink-0"
            />
            <span className="flex flex-col">
              <span className="font-medium">{CHOICE_COPY[choice].label}</span>
              <span className="text-muted-foreground text-sm">{CHOICE_COPY[choice].hint}</span>
            </span>
          </label>
        ))}
        {choiceError ? (
          <p
            id={`${reasonId}-choice-error`}
            data-slot="field-error"
            className="text-destructive text-sm"
          >
            {choiceError}
          </p>
        ) : null}
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor={reasonId}>Reason (optional)</Label>
        <Textarea
          id={reasonId}
          name="reason"
          rows={3}
          maxLength={ATTENDANCE_REASON_MAX_LENGTH}
          placeholder="Anything the Owner should know."
          aria-invalid={reasonError ? true : undefined}
        />
        {reasonError ? (
          <p data-slot="field-error" className="text-destructive text-sm">
            {reasonError}
          </p>
        ) : null}
      </div>
      <StickyActions>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
          Submit
        </Button>
      </StickyActions>
    </form>
  );
}
