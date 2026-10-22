/**
 * A person's photo, when there is none (v1.8 V5b-D, the approved pull-in sample): their initials
 * on one of four calm colours, always the same colour for the same person, so nobody looks
 * "missing". Pure: the shared `PersonAvatar` draws what these pick.
 */

/** The four initials colours (`--avatar-1` … `--avatar-4` in `globals.css`). */
export const AVATAR_TONES = [1, 2, 3, 4] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

/**
 * The initials: the first and last word's first letters ("Prishit Shetty" → "PS"), or a one-word
 * name's first two letters ("Prakyat" → "PR"); punctuation is skipped; "?" for an empty name.
 */
export function avatarInitials(name: string): string {
  // Words of letters only: "Asha (freelancer)" reads "AF", never "A(".
  const parts = name
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const first = parts[0] ?? "";
  if (parts.length === 1) return Array.from(first).slice(0, 2).join("").toUpperCase() || "?";
  const last = parts[parts.length - 1] ?? "";
  return (Array.from(first)[0] ?? "").concat(Array.from(last)[0] ?? "").toUpperCase() || "?";
}

/**
 * The person's colour: a stable hash (FNV-1a) of their id, so it never changes with a rename or
 * between screens, devices and sessions.
 */
export function avatarTone(seed: string): AvatarTone {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return AVATAR_TONES[(hash >>> 0) % AVATAR_TONES.length] as AvatarTone;
}

/** The four sizes, fixed: 20 list rows, 28 chat and Alerts, 40 People and headers, 64 person page and Me. */
export const AVATAR_SIZES = [20, 28, 40, 64] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

/** Which file a size loads: lists only ever the 96 px thumbnail; 64 px the 512 px preview. */
export function avatarVariant(size: AvatarSize): "thumb" | "preview" {
  return size === 64 ? "preview" : "thumb";
}

/** An overlap stack: at most `max` faces, then "+n" for the rest (none when they all fit). */
export function avatarStack<T>(people: readonly T[], max = 3): { shown: T[]; more: number } {
  if (people.length <= max) return { shown: [...people], more: 0 };
  return { shown: people.slice(0, max), more: people.length - max };
}
