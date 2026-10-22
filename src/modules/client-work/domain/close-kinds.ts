import type { Recurrence } from "./types";

/**
 * Two kinds of Close (v1.9 W1-db, ROADMAP 6b.4 D5; DATA-MODEL §5b "Close kinds"): why a deliverable was
 * closed, stored as `project_items.close_kind`. "Not needed this ‹month/week›" = the scope changed;
 * "Not delivered" = we missed it. Null = a close made before W1 (or by a project cancel), which the
 * Owner may set later (`item_set_close_kind`). Never money. Pure; the SQL check and the server's notice
 * words (migration `w1_close_kinds`) say the same.
 */
export const CLOSE_KINDS = ["not_needed", "not_delivered"] as const;

export type CloseKind = (typeof CLOSE_KINDS)[number];

export function isCloseKind(value: unknown): value is CloseKind {
  return typeof value === "string" && (CLOSE_KINDS as readonly string[]).includes(value);
}

/**
 * The kind as a choice reads: "Not needed this month" / "this week" for a repeating project, "Not
 * needed" for a one-time one (it has no period), "Not delivered".
 */
export function closeKindLabel(kind: CloseKind, recurrence: Recurrence): string {
  if (kind === "not_delivered") return "Not delivered";
  if (recurrence === "monthly") return "Not needed this month";
  if (recurrence === "weekly") return "Not needed this week";
  return "Not needed";
}

/** The kind inside a history sentence: "not needed" / "not delivered". */
export function closeKindWords(kind: CloseKind): string {
  return kind === "not_needed" ? "not needed" : "not delivered";
}
