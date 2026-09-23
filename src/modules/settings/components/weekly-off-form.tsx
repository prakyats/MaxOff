"use client";

import { useState, useTransition } from "react";

import type { ResultError } from "@/core/errors";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import { Label } from "@/core/ui/primitives/label";
import { toastResult } from "@/core/ui/toast";

import { updateWeeklyOffDays } from "../actions/settings";
import { weeklyOffChoices } from "../domain/settings";
import { FormError } from "./form-error";

/**
 * The company's weekly off days (PRODUCT §7: Sunday at launch). A day off means no absent
 * check; people may still log in and mark attendance, and the day shows as "Worked on a day
 * off" (WORKFLOWS §1). The selection is held in state rather than posted as form data: the
 * action takes the weekday numbers, not seven checkbox names.
 */
export function WeeklyOffForm({ weeklyOffDays }: { weeklyOffDays: readonly number[] }) {
  const [selected, setSelected] = useState<number[]>([...weeklyOffDays]);
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(day: number, checked: boolean): void {
    setSelected((days) =>
      checked ? [...days, day].sort((a, b) => a - b) : days.filter((value) => value !== day),
    );
  }

  function save(): void {
    startTransition(async () => {
      const result = await updateWeeklyOffDays({ weeklyOffDays: selected });
      setError(result.ok ? null : result.error);
      toastResult(result, { success: "Weekly off days saved" });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError error={error} />
      {error?.fieldErrors?.weeklyOffDays ? (
        <p data-slot="field-error" role="alert" className="text-destructive text-sm">
          {error.fieldErrors.weeklyOffDays[0]}
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Weekly off days</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {weeklyOffChoices(selected).map((choice) => (
            <Label
              key={choice.value}
              // 44px tall on a phone: the whole label is the target, not the 16px box.
              className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-normal md:min-h-0"
            >
              <Checkbox
                checked={choice.checked}
                onCheckedChange={(checked) => toggle(choice.value, checked === true)}
                disabled={pending}
              />
              {choice.label}
            </Label>
          ))}
        </div>
      </fieldset>
      <Button
        type="button"
        onClick={save}
        disabled={pending}
        className="w-full md:w-auto md:self-start"
      >
        {pending ? "Saving…" : "Save days off"}
      </Button>
    </div>
  );
}
