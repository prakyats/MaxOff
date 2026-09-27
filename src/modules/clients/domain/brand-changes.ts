import type { BrandColor, BrandFont } from "./schemas";

/**
 * The brand's colours and fonts as the edit pattern holds them (3B review, owner decision
 * 2026-09-27): a swatch list and a font list, each row keyed so an edit, a removal and a move
 * are told apart, and every change named in the save confirmation ("Sharma Weddings' colour
 * Primary will change from #E11D48 to #BE123C."). Pure, so the wording is unit tested; the
 * caller passes the possessive (`core/ui/edit` makes it, ADR-0011 keeps the domain free of it).
 */

export type ColorRow = { key: string; name: string; hex: string };
export type FontRow = { key: string; family: string; usage: string };
export type BrandDraft = { colors: ColorRow[]; fonts: FontRow[] };

export function brandDraft(colors: readonly BrandColor[], fonts: readonly BrandFont[]): BrandDraft {
  return {
    colors: colors.map((color, index) => ({ key: `c${index}`, name: color.name, hex: color.hex })),
    fonts: fonts.map((font, index) => ({
      key: `f${index}`,
      family: font.family,
      usage: font.usage ?? "",
    })),
  };
}

/** What the action receives: the rows in order, trimmed, without their keys. */
export function brandPayload(draft: BrandDraft): {
  colors: { name: string; hex: string }[];
  fonts: { family: string; usage: string }[];
} {
  return {
    colors: draft.colors.map((row) => ({ name: row.name.trim(), hex: row.hex.trim() })),
    fonts: draft.fonts.map((row) => ({ family: row.family.trim(), usage: row.usage.trim() })),
  };
}

/**
 * What a hex field holds while it is typed: "#" and up to six hex digits, upper case, whatever
 * was typed or pasted ("e11d48", "#E11D48", "E1 1D 48").
 */
export function hexInput(text: string): string {
  return `#${text
    .replace(/[^0-9a-fA-F]/g, "")
    .slice(0, 6)
    .toUpperCase()}`;
}

export function isHex(text: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(text.trim());
}

/** Moves the row at `from` by `by` places (−1 up, +1 down); out of range leaves the list as it is. */
export function moveRow<T>(rows: readonly T[], from: number, by: number): T[] {
  const to = from + by;
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return [...rows];
  const next = [...rows];
  const [row] = next.splice(from, 1);
  if (row !== undefined) next.splice(to, 0, row);
  return next;
}

function colorText(row: ColorRow): string {
  const name = row.name.trim();
  const hex = row.hex.trim().toUpperCase();
  return name ? `${name} ${hex}` : hex;
}

function fontText(row: FontRow): string {
  const family = row.family.trim();
  const usage = row.usage.trim();
  return usage ? `${family} (${usage})` : family;
}

function listChanges<R extends { key: string }>(
  before: readonly R[],
  after: readonly R[],
  {
    whose,
    singular,
    plural,
    text,
  }: {
    whose: string;
    singular: string;
    plural: string;
    text: (row: R) => string;
  },
): string[] {
  const lines: string[] = [];
  const beforeByKey = new Map(before.map((row) => [row.key, row]));
  const afterKeys = new Set(after.map((row) => row.key));
  for (const row of before) {
    if (!afterKeys.has(row.key)) lines.push(`${whose} ${singular} ${text(row)} will be removed.`);
  }
  for (const row of after) {
    const was = beforeByKey.get(row.key);
    if (!was) {
      lines.push(`${whose} ${singular} ${text(row)} will be added.`);
    } else if (text(was) !== text(row)) {
      lines.push(`${whose} ${singular} ${text(was)} will change to ${text(row)}.`);
    }
  }
  const keptBefore = before.filter((row) => afterKeys.has(row.key)).map((row) => row.key);
  const keptAfter = after.filter((row) => beforeByKey.has(row.key)).map((row) => row.key);
  if (keptBefore.join(" ") !== keptAfter.join(" ")) {
    lines.push(`${whose} ${plural} will be put in a new order.`);
  }
  return lines;
}

/** Every difference between two drafts as a sentence for the confirmation; none when equal. */
export function brandChanges(whose: string, before: BrandDraft, after: BrandDraft): string[] {
  return [
    ...listChanges(before.colors, after.colors, {
      whose,
      singular: "colour",
      plural: "colours",
      text: colorText,
    }),
    ...listChanges(before.fonts, after.fonts, {
      whose,
      singular: "font",
      plural: "fonts",
      text: fontText,
    }),
  ];
}
