/**
 * Bulk edits on selected deliverables (ROADMAP 6b.16 (e)): the rename pattern's preview and the
 * limits the sheets check before sending. Pure, unit-tested. The SQL `items_rename` applies the
 * same rule (migration `client_work_bulk_and_rounds`): `{n}` is the number (from `start`, in the
 * list's order), `{title}` the current title, `{n}` replaced first; the result trimmed, 1 to 200
 * characters; more than one deliverable needs `{n}` or `{title}` so they do not all get one name.
 */

export const RENAME_MAX = 200;
export const START_MAX = 9999;
export const SHIFT_MAX = 365;

export type RenamePreview =
  { ok: true; rows: { id: string; from: string; to: string }[] } | { ok: false; issue: string };

export function renamePreview(
  pattern: string,
  items: readonly { id: string; title: string }[],
  start = 1,
): RenamePreview {
  const text = pattern.trim();
  if (text === "")
    return { ok: false, issue: "Type the new name, with {n} where its number goes." };
  if (!Number.isInteger(start) || start < 0 || start > START_MAX) {
    return { ok: false, issue: `Start the numbers between 0 and ${START_MAX}.` };
  }
  if (items.length > 1 && !text.includes("{n}") && !text.includes("{title}")) {
    return { ok: false, issue: "Add {n} so each deliverable gets its own number." };
  }
  const rows = items.map((item, index) => ({
    id: item.id,
    from: item.title,
    to: text
      .replaceAll("{n}", String(start + index))
      .replaceAll("{title}", item.title)
      .trim(),
  }));
  const bad = rows.find((row) => row.to === "" || row.to.length > RENAME_MAX);
  if (bad) {
    return { ok: false, issue: `The new name of ${bad.from} needs 1 to ${RENAME_MAX} characters.` };
  }
  return { ok: true, rows };
}

/** A shift in days as typed ("-3", "7"), or the reason it is refused. */
export function shiftDays(
  value: string,
): { ok: true; days: number } | { ok: false; issue: string } {
  const days = Number(value.trim());
  if (value.trim() === "" || !Number.isInteger(days) || days === 0 || Math.abs(days) > SHIFT_MAX) {
    return { ok: false, issue: `Move the dates by 1 to ${SHIFT_MAX} days, earlier or later.` };
  }
  return { ok: true, days };
}

/** "Moved 3 deliverables 2 days later" / "… 1 day earlier". */
export function shiftWords(count: number, days: number): string {
  const what = count === 1 ? "1 deliverable" : `${count} deliverables`;
  const span = Math.abs(days) === 1 ? "1 day" : `${Math.abs(days)} days`;
  return `Moved ${what} ${span} ${days > 0 ? "later" : "earlier"}`;
}
