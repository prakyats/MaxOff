"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";

import type { JobTitleOption } from "../domain/job-titles";

export type { JobTitleOption } from "../domain/job-titles";

const NONE = "__none__";

/**
 * The job-title picker (a `list_items` list, PRODUCT §3). "" means none, offered as "None" (never
 * "No job title", owner 2026-10-01).
 */
export function JobTitleSelect({
  id,
  value,
  onChange,
  options,
  describedBy,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly JobTitleOption[];
  describedBy?: string | undefined;
  invalid?: true | undefined;
}) {
  return (
    <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? "" : next)}>
      <SelectTrigger
        id={id}
        className="w-full"
        aria-describedby={describedBy}
        aria-invalid={invalid}
      >
        <SelectValue placeholder="Choose" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>None</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.archived ? `${option.name} (archived)` : option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
