import { lateLabel, PRIORITY_LABELS, type TaskListRow } from "@/modules/tasks";

/** A row's second marker, as the Tasks tab draws it: "3 h late" (PP-tasks-2), else Urgent or High. */
export function rowFlag(
  row: TaskListRow,
  now: Date,
): { label: string; tone: "danger" | "attention" } | null {
  const late = lateLabel(row, now);
  if (late) return { label: late, tone: "danger" };
  if (row.priority === "urgent" || row.priority === "high") {
    return {
      label: PRIORITY_LABELS[row.priority],
      tone: row.priority === "urgent" ? "danger" : "attention",
    };
  }
  return null;
}
