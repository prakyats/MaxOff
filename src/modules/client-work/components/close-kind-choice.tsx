"use client";

import { cn } from "@/core/lib/utils";

import { type CloseKind, closeKindChoices } from "../domain/close-kinds";
import type { Recurrence } from "../domain/types";

/** "Clear the kind" in the Owner's Set close kind (owner 2026-10-22: set, change or clear). */
export const CLEAR_KIND = "clear";

export type CloseKindValue = CloseKind | typeof CLEAR_KIND;

/**
 * Which kind of Close (v1.9 W1; the approved samples of 22 and 29 Oct): "Not needed this
 * ‹month/week›" (a one-time project's reads "Not needed") or "Not delivered", each with what it
 * means, as 44 px+ radio rows (§14.1). The deliverable sheet's Close, the carry screen's Close and
 * the Owner's "Set close kind" draw it; `clearable` adds the Owner's way to clear a kind back to
 * none, as the closes before v1.9 are.
 */
export function CloseKindChoice({
  recurrence,
  value,
  onChange,
  clearable = false,
  name,
}: {
  recurrence: Recurrence;
  value: CloseKindValue;
  onChange: (value: CloseKindValue) => void;
  clearable?: boolean;
  /** The radios' group name (unique per dialog). */
  name: string;
}) {
  const options: { value: CloseKindValue; label: string; hint: string }[] = [
    ...closeKindChoices(recurrence).map((choice) => ({
      value: choice.kind,
      label: choice.label,
      hint: choice.hint,
    })),
    ...(clearable
      ? [
          {
            value: CLEAR_KIND,
            label: "No kind",
            hint: "Clear it, as older closes have none",
          } as const,
        ]
      : []),
  ];
  return (
    <fieldset className="flex flex-col gap-2" data-slot="close-kind-choice">
      <legend className="sr-only">Why it was closed</legend>
      {options.map((option) => (
        <label
          key={option.value}
          data-slot="close-kind-option"
          className={cn(
            "border-border bg-card flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2",
            "has-[:checked]:border-strong has-[:checked]:bg-strong/5 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="accent-strong size-5 shrink-0"
          />
          <span className="flex min-w-0 flex-col">
            <span className="font-medium break-words">{option.label}</span>
            <span className="text-muted-foreground text-sm break-words">{option.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
