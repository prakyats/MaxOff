import { formatIST, formatWallTime, type ISODate, isISODate, isISTTime, istDayStart } from "./ist";

/**
 * How a chosen date or time **reads in a form field** (V5b major change 6, option C: labelling
 * only; DESIGN.md §Decisions). The native picker and keyboard entry stay; only the words shown
 * over the field change. Pure (ADR-0011); `today` comes from the caller (`todayIST()`), so the
 * year rule is IST like every business date.
 */

/** What an empty field says. */
export const FIELD_PLACEHOLDER = {
  date: "Choose a date",
  time: "Choose a time",
  datetime: "Choose a date and time",
} as const;

/** `Thu 22 Oct`; the year only when it is not the current year (`Mon 4 Jan 2027`). */
export function formatDateField(date: ISODate, today: ISODate): string {
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return formatIST(istDayStart(date), sameYear ? "EEE d MMM" : "EEE d MMM yyyy");
}

/** What a screen reader hears for a date field: `Thursday 22 October 2026`, always in full. */
export function spokenDateField(date: ISODate): string {
  return formatIST(istDayStart(date), "EEEE d MMMM yyyy");
}

/** `6:00 pm` (the B1 formatter) from a native time value, `18:00` or `18:00:30`. */
export function formatTimeField(time: string): string {
  return formatWallTime(time.length > 5 ? time.slice(0, 5) : time);
}

export type FieldKind = keyof typeof FIELD_PLACEHOLDER;

/**
 * The field's label and its spoken words from the native value (`2026-10-22`, `18:00`,
 * `2026-10-22T18:00`). `null` when the value is empty or not (yet) a whole value, so a field
 * half-typed on a keyboard shows the native text instead of a wrong label.
 */
export function fieldLabel(
  kind: FieldKind,
  value: string,
  today: ISODate,
): { shown: string; spoken: string } | null {
  if (value === "") return null;
  if (kind === "date") {
    if (!isISODate(value)) return null;
    return { shown: formatDateField(value, today), spoken: spokenDateField(value) };
  }
  if (kind === "time") {
    const time = value.slice(0, 5);
    if (!isISTTime(time)) return null;
    const shown = formatTimeField(time);
    return { shown, spoken: shown };
  }
  const [date = "", rest = ""] = value.split("T");
  const time = rest.slice(0, 5);
  if (!isISODate(date) || !isISTTime(time)) return null;
  const clock = formatTimeField(time);
  return {
    shown: `${formatDateField(date, today)}, ${clock}`,
    spoken: `${spokenDateField(date)}, ${clock}`,
  };
}
