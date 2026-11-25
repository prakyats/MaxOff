/**
 * The name an uploader types (v4.5, security plan B1–B2; DATA-MODEL §8a `upload_uploaders`). A
 * typed name is a claim, never an identity: it labels the uploader's files and their folder,
 * and decides only the "not on this task" flag. Platform-free and pure.
 */

export const NAME_MAX = 60;

/** Control characters, zero-width characters and bidi controls: removed, never shown. */
const HIDDEN = /[\p{Cc}​-‏‪-‮⁠-⁤⁦-⁩﻿]/gu;

export type NameCheck = { ok: true; name: string } | { ok: false; reason: "empty" | "too_long" };

/** NFC, hidden characters removed, spaces collapsed, trimmed, then 1–60 characters. */
export function cleanUploaderName(typed: string): NameCheck {
  const name = typed.normalize("NFC").replace(HIDDEN, "").replace(/\s+/g, " ").trim();
  if (name.length === 0) return { ok: false, reason: "empty" };
  if ([...name].length > NAME_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, name };
}

/** The folded form used for matching only: lower case, accents and extra spaces removed. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is this the name of someone on the task? Case- and accent-insensitive, on an active
 * assignee's full name or first name, freelancers included (advisor, 19 Nov). Returns the
 * matched assignee's id, or null.
 */
export function matchAssignee(
  name: string,
  assignees: readonly { id: string; fullName: string }[],
): string | null {
  const key = nameKey(name);
  for (const assignee of assignees) {
    const full = nameKey(assignee.fullName);
    if (key === full || key === full.split(" ")[0]) return assignee.id;
  }
  return null;
}

/**
 * The uploader's folder name inside the task folder: their name, or "Sam (2)" when another
 * uploader on the same link already has that folder (owner, 19 Nov: separate folders).
 */
export function uploaderFolderName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map(nameKey));
  if (!used.has(nameKey(name))) return name;
  for (let n = 2; ; n += 1) {
    const candidate = `${name} (${n})`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}
