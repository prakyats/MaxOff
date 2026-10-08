import { isOverdue, PRIORITY_LABELS, type TaskListRow } from "@/modules/tasks";

/**
 * My Day's header line (6.1): the greeting the page writes and its loading screen repeats, so the
 * header does not change when the page arrives (4C review S7, ARCHITECTURE §14.1). A phone shows
 * the title only.
 */
export function myDayGreeting(name: string | null | undefined): string {
  const line = "Your working day and what's next.";
  return name ? `Hello, ${name}. ${line}` : line;
}

/** A row's second marker, as the Tasks tab draws it: Overdue, else Urgent or High. */
export function rowFlag(
  row: TaskListRow,
  now: Date,
): { label: string; tone: "danger" | "attention" } | null {
  if (isOverdue(row, now)) return { label: "Overdue", tone: "danger" };
  if (row.priority === "urgent" || row.priority === "high") {
    return {
      label: PRIORITY_LABELS[row.priority],
      tone: row.priority === "urgent" ? "danger" : "attention",
    };
  }
  return null;
}
