"use client";

import * as React from "react";

import { cn } from "@/core/lib/utils";
import { FIELD_PLACEHOLDER, type FieldKind, fieldLabel, todayIST } from "@/core/time";
import { Input } from "@/core/ui/primitives/input";

type NativeProps = Omit<React.ComponentProps<typeof Input>, "type">;

const NATIVE_TYPE: Record<FieldKind, "date" | "time" | "datetime-local"> = {
  date: "date",
  time: "time",
  datetime: "datetime-local",
};

/** Keys that mean "I am typing into the field": the native text shows while they edit. */
function editsByKeyboard(key: string): boolean {
  return /^[0-9]$/.test(key) || key.startsWith("Arrow") || key === "Backspace" || key === "Delete";
}

/**
 * **The date and time field** (V5b major change 6, option C: labelling only; DESIGN.md
 * §Decisions). The native `<input type="date|time|datetime-local">` stays, with its picker, its
 * keyboard entry, its `name`, `value`, `min`/`max` and form submission; only how the value reads
 * changes. Its own text ("22-10-2026", "06:00 PM", "dd-mm-yyyy") is made transparent and a label
 * is laid over it: `Thu 22 Oct` (the year only when it is not this year), `6:00 pm`, or, empty,
 * `Choose a date` / `Choose a time` in the muted placeholder colour. The label lets every tap and
 * click through to the input, so the native picker opens as before.
 *
 * - **Keyboard entry:** a digit, an arrow, Backspace or Delete shows the native text until the
 *   field loses focus, so typing reads as it always has.
 * - **Screen readers** hear the full date ("Thursday 22 October 2026") as the field's
 *   description, alongside any hint or error the field already has.
 */
function DateTimeField({
  kind,
  className,
  value,
  defaultValue,
  onChange,
  onKeyDown,
  onBlur,
  disabled,
  "aria-describedby": describedBy,
  ...props
}: NativeProps & { kind: FieldKind }) {
  const controlled = value !== undefined;
  const [own, setOwn] = React.useState(() => String(defaultValue ?? ""));
  const [editing, setEditing] = React.useState(false);
  const spokenId = React.useId();
  const current = controlled ? String(value ?? "") : own;
  // IST, like every business date (core/time); read at render, so a field open past midnight
  // still drops the year correctly on its next change.
  const label = fieldLabel(kind, current, todayIST());
  const showNative = editing || (current !== "" && label === null);

  return (
    <span data-slot="date-time-field" data-kind={kind} className="relative flex w-full min-w-0">
      <Input
        {...props}
        type={NATIVE_TYPE[kind]}
        {...(controlled ? { value } : { defaultValue })}
        disabled={disabled}
        data-labelled={showNative ? undefined : ""}
        aria-describedby={
          [label ? spokenId : null, describedBy].filter(Boolean).join(" ") || undefined
        }
        className={cn(
          // The native text gives way to the label (the picker's icon stays: it is an image).
          !showNative && "text-transparent [&::-webkit-datetime-edit]:text-transparent",
          className,
        )}
        onChange={(event) => {
          if (!controlled) setOwn(event.target.value);
          onChange?.(event);
        }}
        onKeyDown={(event) => {
          if (editsByKeyboard(event.key)) setEditing(true);
          onKeyDown?.(event);
        }}
        onBlur={(event) => {
          setEditing(false);
          onBlur?.(event);
        }}
      />
      {showNative ? null : (
        <span
          aria-hidden
          data-slot="date-time-label"
          className={cn(
            // Over the input's text box: its border (1 px) and padding (10 px) on the left, room
            // for the picker's icon on the right; one line, the input's own type size.
            "pointer-events-none absolute inset-y-0 right-9 left-px flex min-w-0 items-center truncate px-2.5 text-base md:text-sm",
            label ? "text-foreground" : "text-muted-foreground",
            disabled && "opacity-50",
          )}
        >
          {label ? label.shown : FIELD_PLACEHOLDER[kind]}
        </span>
      )}
      {label ? (
        <span id={spokenId} className="sr-only">
          {label.spoken}
        </span>
      ) : null}
    </span>
  );
}

/** A date field: `Thu 22 Oct`, empty `Choose a date`; the native date picker underneath. */
export function DateInput(props: NativeProps) {
  return <DateTimeField kind="date" {...props} />;
}

/** A time field: `6:00 pm`, empty `Choose a time`; the native time picker underneath. */
export function TimeInput(props: NativeProps) {
  return <DateTimeField kind="time" {...props} />;
}

/** A date-and-time field: `Thu 22 Oct, 6:00 pm`; the native `datetime-local` picker underneath. */
export function DateTimeInput(props: NativeProps) {
  return <DateTimeField kind="datetime" {...props} />;
}
