"use client";

import { PlusIcon, XIcon } from "lucide-react";

import {
  describeReminders,
  nextReminderRow,
  REMINDER_UNITS,
  type ReminderDraft,
  type ReminderRow,
  type ReminderRule,
  reminderRowErrors,
  REMINDERS_MAX,
  reminderUnitLabel,
  type ReminderUnit,
  rowsFromRules,
} from "@/core/lib/reminder-rules";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";

/**
 * The reminder editor's opened panel (`reminder-rules-editor.tsx`): up to 5 rows "N minutes /
 * hours / days before" (0 reads "when due"), each with Remove and its own message, then "Add a
 * reminder" and "Use the default". Loaded on the first tap of the collapsed line, so a screen
 * that only shows the line never carries the select and the rows (5.3 budget watch).
 */
export function ReminderRows({
  id,
  draft,
  onChange,
  fallback,
  disabled,
}: {
  id: string;
  draft: ReminderDraft;
  onChange: (draft: ReminderDraft) => void;
  fallback: readonly ReminderRule[];
  disabled: boolean;
}) {
  const rows: ReminderRow[] = draft ?? rowsFromRules(fallback);
  const errors = draft === null ? rows.map(() => null) : reminderRowErrors(rows);

  function edit(next: ReminderRow[]) {
    onChange(next);
  }

  function change(index: number, patch: Partial<ReminderRow>) {
    edit(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }

  return (
    <div id={id} className="flex min-w-0 flex-col gap-2" data-slot="reminder-rows">
      {draft === null ? (
        <p className="text-muted-foreground text-xs">
          The default. Change any of these to set this one&apos;s own.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          None of its own: the default applies ({describeReminders(fallback)}).
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="flex min-w-0 flex-col gap-2">
          {rows.map((row, index) => {
            const message = errors[index] ?? null;
            const label = `Reminder ${index + 1}`;
            return (
              <li
                key={index}
                className="flex min-w-0 flex-col gap-1"
                data-slot="reminder-row"
                data-index={index}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <Input
                    aria-label={`${label}: how many`}
                    aria-invalid={message ? true : undefined}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={5}
                    value={row.before}
                    disabled={disabled}
                    onChange={(event) => change(index, { before: event.target.value })}
                    className="w-20"
                  />
                  <Select
                    value={row.unit}
                    disabled={disabled}
                    onValueChange={(unit) => change(index, { unit: unit as ReminderUnit })}
                  >
                    <SelectTrigger aria-label={`${label}: unit`} className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REMINDER_UNITS.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {reminderUnitLabel(unit, row.before)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-sm">
                    {row.before.trim() !== "" && Number(row.before) === 0 ? "when due" : "before"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-11 shrink-0"
                    aria-label={`Remove reminder ${index + 1}`}
                    disabled={disabled}
                    onClick={() => edit(rows.filter((_, at) => at !== index))}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </div>
                {message ? <ErrorText slot="field-error">{message}</ErrorText> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-11"
          disabled={disabled || rows.length >= REMINDERS_MAX}
          onClick={() => edit([...rows, nextReminderRow(rows)])}
        >
          <PlusIcon aria-hidden />
          Add a reminder
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          disabled={disabled || draft === null}
          onClick={() => onChange(null)}
        >
          Use the default
        </Button>
      </div>
      {rows.length >= REMINDERS_MAX ? (
        <p className="text-muted-foreground text-xs">Up to {REMINDERS_MAX} reminders.</p>
      ) : null}
    </div>
  );
}
