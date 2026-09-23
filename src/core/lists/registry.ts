/**
 * The editable lists (ADR-0002, DATA-MODEL §2). A list is a `list_key` in `list_items`; code
 * knows the keys it renders a picker for and nothing about the entries, which the Owner edits
 * in Settings (1.4). New keys are added here and nowhere else.
 */
export const LIST_KEYS = ["job_title"] as const;

export type ListKey = (typeof LIST_KEYS)[number];

export const LIST_LABELS: Record<ListKey, { singular: string; plural: string }> = {
  job_title: { singular: "Job title", plural: "Job titles" },
};

export function isListKey(value: string): value is ListKey {
  return (LIST_KEYS as readonly string[]).includes(value);
}
