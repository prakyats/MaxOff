/**
 * The words and numbers of a hand-in (WORKFLOWS §5C; the approved sample's wording): a file's
 * status, a version's "14 files · 6.1 GB", the overall progress, and Mark done's wait rule.
 */

export const FILE_STATES = ["uploading", "done", "failed", "left_out", "missing_in_drive"] as const;
export type FileState = (typeof FILE_STATES)[number];

/** A browser-side status the database never holds: a chosen file not started yet, or paused. */
export type LocalState = "waiting" | "paused" | "already_added";

export type StatusTone = "info" | "success" | "danger" | "neutral";

export function statusOf(state: FileState | LocalState): { label: string; tone: StatusTone } {
  switch (state) {
    case "uploading":
      return { label: "Uploading", tone: "info" };
    case "done":
      return { label: "In Drive", tone: "success" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "left_out":
      return { label: "Left out", tone: "neutral" };
    case "missing_in_drive":
      return { label: "Removed in Drive", tone: "neutral" };
    case "waiting":
      return { label: "Waiting", tone: "neutral" };
    case "paused":
      return { label: "Paused", tone: "neutral" };
    case "already_added":
      return { label: "Already added", tone: "neutral" };
  }
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 1024-based, one decimal from MB up: "940 MB", "5.4 GB" (Drive's own way of counting). */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit <= 1) return `${Math.round(value)} ${UNITS[unit]}`;
  return `${Number(value.toFixed(1))} ${UNITS[unit]}`;
}

export function filesWord(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

/** "14 files · 6.1 GB"; "note only" for a version handed in with no files. */
export function versionSummary(files: number, bytes: number): string {
  return files === 0 ? "note only" : `${filesWord(files)} · ${formatSize(bytes)}`;
}

/** What notifications and Approvals add after a version: "v2 · 14 files", or "" with none. */
export function handInTag(version: number, files: number): string {
  return files === 0 ? "" : `v${version} · ${filesWord(files)}`;
}

/** Mark done waits while a file of the open version is still on its way (plan §3). */
export function markDoneBlock(uploading: number): string | null {
  if (uploading <= 0) return null;
  return uploading === 1
    ? "1 file is still uploading. Wait for it, or leave it out."
    : `${uploading} files are still uploading. Wait for them, or leave them out.`;
}

export type Progress = {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
};

/** About how long is left at the recent speed; null when it can't be told yet. */
export function minutesLeft(progress: Progress, bytesPerSecond: number): number | null {
  if (bytesPerSecond <= 0) return null;
  const left = Math.max(0, progress.bytesTotal - progress.bytesDone);
  return Math.max(1, Math.ceil(left / bytesPerSecond / 60));
}

/** "8 of 12 in Drive" and "3.1 of 5.4 GB · about 6 min left". */
export function progressLines(
  progress: Progress,
  bytesPerSecond: number,
  paused: boolean,
): { headline: string; detail: string } {
  const headline = `${progress.done} of ${progress.total} in Drive`;
  const doneSize = formatSize(progress.bytesDone);
  const totalSize = formatSize(progress.bytesTotal);
  const [doneNumber, doneUnit] = doneSize.split(" ");
  const bytes =
    doneUnit === totalSize.split(" ")[1]
      ? `${doneNumber} of ${totalSize}`
      : `${doneSize} of ${totalSize}`;
  if (paused) return { headline, detail: `${bytes} · paused` };
  if (progress.done >= progress.total) return { headline, detail: bytes };
  const minutes = minutesLeft(progress, bytesPerSecond);
  return {
    headline,
    detail: minutes === null ? bytes : `${bytes} · about ${minutes} min left`,
  };
}
