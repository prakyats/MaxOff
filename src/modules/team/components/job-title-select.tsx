"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";

export type JobTitleOption = { id: string; name: string };

const NONE = "__none__";

/** The job-title picker (a `list_items` list, PRODUCT §3). "" means none. */
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
        <SelectValue placeholder="No job title" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No job title</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
