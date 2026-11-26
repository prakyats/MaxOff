"use client";

import { cn } from "@/core/lib/utils";
import { ErrorText } from "@/core/ui/composites/error-text";

import type { LeaveHalf } from "../domain/requests";

export type HalfOption = { value: LeaveHalf; label: string; hint?: string };

/**
 * A choice of half, as radio cards (v1.9 W4's "Which half?", the working-hours sample §4): each
 * card is a 44 px+ target with its label and an optional hint; the checked one carries the strong
 * border. The leave form's "Which half?" and "Comp half" and the Owner's edit use it; `value` may
 * be null (nothing chosen yet), and `note` is one muted line under the cards.
 */
export function HalfChoice({
  legend,
  name,
  options,
  value,
  onChange,
  error,
  note,
  slot = "half-choice",
}: {
  legend: string;
  name: string;
  options: readonly HalfOption[];
  value: LeaveHalf | null;
  onChange: (value: LeaveHalf) => void;
  error?: string | undefined;
  note?: string | null;
  slot?: string;
}) {
  return (
    <fieldset
      className="flex flex-col gap-2"
      data-slot={slot}
      aria-invalid={error ? true : undefined}
    >
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          data-slot="half-option"
          className={cn(
            "border-border bg-card flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border px-4 py-2.5",
            "has-[:checked]:border-strong has-[:checked]:bg-strong/5 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="accent-strong mt-0.5 size-5 shrink-0"
          />
          <span className="flex flex-col">
            <span className="font-medium">{option.label}</span>
            {option.hint ? (
              <span className="text-muted-foreground text-sm">{option.hint}</span>
            ) : null}
          </span>
        </label>
      ))}
      {note ? (
        <p data-slot={`${slot}-note`} aria-live="polite" className="text-muted-foreground text-sm">
          {note}
        </p>
      ) : null}
      {error ? <ErrorText alert={false}>{error}</ErrorText> : null}
    </fieldset>
  );
}
