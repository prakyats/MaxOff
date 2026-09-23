import { z } from "zod";

export const LIST_ITEM_NAME_MAX = 80;
export const LIST_ITEM_DESCRIPTION_MAX = 500;

/** What the Owner types for an entry (the table's own CHECKs say the same, DATA-MODEL §2). */
export const listItemInputSchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(LIST_ITEM_NAME_MAX),
  description: z.string().trim().max(LIST_ITEM_DESCRIPTION_MAX).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #AD5009.")
    .optional(),
  icon: z.string().trim().max(64).optional(),
});

export type ListItemInput = z.infer<typeof listItemInputSchema>;

export type MoveDirection = "up" | "down";

const POSITION_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * The next `position` key after `last` (null = the list is empty): a string that sorts after
 * every existing one. Keys are base-36-ish (`a0` … `a9`, `aa` … `az`, `b0` …); once the two
 * leading characters are exhausted a digit is appended (`zz` → `zz0`), which still sorts after.
 */
export function nextPosition(last: string | null): string {
  if (!last) return "a0";
  const lastChar = last.at(-1) ?? "0";
  const index = POSITION_DIGITS.indexOf(lastChar);
  if (index >= 0 && index < POSITION_DIGITS.length - 1) {
    return `${last.slice(0, -1)}${POSITION_DIGITS[index + 1]}`;
  }
  if (last.length === 2 && last[0] !== "z") {
    const head = POSITION_DIGITS.indexOf(last[0] ?? "a");
    return `${POSITION_DIGITS[head + 1]}0`;
  }
  return `${last}0`;
}

/**
 * The columns an edit actually names, so a name-only rename leaves `description`, `color` and
 * `icon` as they are (the rename dialog sends `{ name }`; 4.1's task types will send more).
 * Writing `?? null` for the absent keys would wipe them and the audit row would look deliberate.
 */
export function listItemUpdatePatch(values: ListItemInput): {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
} {
  return {
    name: values.name,
    ...(values.description !== undefined ? { description: values.description } : {}),
    ...(values.color !== undefined ? { color: values.color } : {}),
    ...(values.icon !== undefined ? { icon: values.icon } : {}),
  };
}
