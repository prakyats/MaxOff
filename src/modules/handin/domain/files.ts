/**
 * v5.0 "Hand in work" (WORKFLOWS §5C, DATA-MODEL §8b; plan docs/handoff/v50-hand-in-plan.md):
 * the pure rules a hand-in shares between the browser and the server. The database repeats the
 * cleaning and the limits (`handin_file_start`), so these are the screen's early answer, never
 * the authority. No React, Next or DOM here (ADR-0011).
 */

/** A file's name is at most this long once cleaned (Drive accepts longer; this keeps it sane). */
export const NAME_MAX = 255;
/** A laptop's folder path under v‹n›: at most this many levels, each at most this long. */
export const PATH_DEPTH_MAX = 8;
export const PATH_PART_MAX = 120;
/** Safety limits (plan §4), not product caps: any type, any size. */
export const FILES_PER_VERSION_MAX = 2000;
export const UPLOADING_PER_PERSON_MAX = 6;

/** C0 / C1 controls, zero-width characters and bidi overrides (the v4.5 B2 rule). */
const INVISIBLE = /[\p{Cc}\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;

function cleanPart(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(/[/\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keeps the extension when a name is cut to `max` characters. */
function cut(name: string, max: number): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : "";
  const extLength = Array.from(ext).length;
  return chars.slice(0, max - extLength).join("") + ext;
}

/** The file's name as MaxOff stores it and Drive shows it; null when nothing is left. */
export function cleanFileName(raw: string): string | null {
  const cleaned = cleanPart(raw);
  if (cleaned === "" || cleaned === "." || cleaned === "..") return null;
  return cut(cleaned, NAME_MAX);
}

export type PathResult = { ok: true; path: string } | { ok: false; reason: "too_deep" };

/**
 * A laptop's folders under v‹n› ('' on a phone), '/'-joined. Empty, "." and ".." parts are
 * dropped (a path never climbs out of the version folder); each part is cleaned and cut.
 */
export function cleanRelativePath(raw: string): PathResult {
  const parts = raw
    .split(/[/\\]/)
    .map((part) => cleanPart(part))
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .map((part) => cut(part, PATH_PART_MAX));
  if (parts.length > PATH_DEPTH_MAX) return { ok: false, reason: "too_deep" };
  return { ok: true, path: parts.join("/") };
}

/** The folder of a hand-in version inside the task's Drive folder (owner, 25 Nov: v1, v2…). */
export function versionFolderName(version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new RangeError("A version starts at 1.");
  return `v${version}`;
}

/** The version the next Mark done writes: one after the last handed-in version. */
export function openVersion(handedInVersions: readonly number[]): number {
  return handedInVersions.reduce((max, v) => Math.max(max, v), 0) + 1;
}

/**
 * Programs, scripts and web pages (v4.5 Q13, the hand-in's Q4): shown with a grey "Check before
 * opening" chip, never blocked. A double name like "clip.mp4.exe" is caught by its last part.
 */
const RISKY_EXTENSIONS = new Set([
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "scr",
  "pif",
  "cpl",
  "vbs",
  "vbe",
  "js",
  "jse",
  "wsf",
  "wsh",
  "ps1",
  "psm1",
  "sh",
  "bash",
  "command",
  "app",
  "dmg",
  "pkg",
  "apk",
  "aab",
  "ipa",
  "jar",
  "html",
  "htm",
  "xhtml",
  "svg",
  "svgz",
  "hta",
  "lnk",
  "url",
  "webloc",
  "reg",
  "dll",
  "so",
  "dylib",
  "docm",
  "xlsm",
  "pptm",
  "iso",
  "img",
]);

export function isRiskyName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return false;
  return RISKY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** What "already added" compares (any adder): the same folder, name and size in one version. */
export function sameFileKey(file: { relativePath: string; name: string; size: number }): string {
  return `${file.relativePath}\u0000${file.name}\u0000${file.size}`;
}

/** The short type label on a file's square ("MP4", "HEIC"); "FILE" without an extension. */
export function typeLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return ext && ext.length <= 5 ? ext.toUpperCase() : "FILE";
}
