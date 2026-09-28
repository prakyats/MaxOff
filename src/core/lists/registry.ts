/**
 * The editable lists (ADR-0002, DATA-MODEL §2). A list is a `list_key` in `list_items`; code
 * knows the keys it renders a picker for and nothing about the entries, which the Owner edits
 * in Settings (1.4). New keys are added here and nowhere else.
 */
export const LIST_KEYS = ["job_title", "expense_category"] as const;

export type ListKey = (typeof LIST_KEYS)[number];

export const LIST_LABELS: Record<ListKey, { singular: string; plural: string }> = {
  job_title: { singular: "Job title", plural: "Job titles" },
  expense_category: { singular: "Category", plural: "Expense categories" },
};

/**
 * Who edits a list: `lists.manage` (Admins too) for most, the Owner alone for the expense
 * categories (PRODUCT §4.18; `app.list_items_owner_guard()` holds the same line in the database).
 */
export const LIST_EDIT_PERMISSION: Record<ListKey, "lists.manage" | "expenses.decide"> = {
  job_title: "lists.manage",
  expense_category: "expenses.decide",
};

export function isListKey(value: string): value is ListKey {
  return (LIST_KEYS as readonly string[]).includes(value);
}
