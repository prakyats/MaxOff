/**
 * The Uploads card and an uploader's sheet in words (v4.5, WORKFLOWS §5B.3, §5B.5; the approved
 * sample `docs/design/v45-upload-link-sample.html` §1, §5, §6). Pure: the screens and their tests
 * read the same lines. Names are text only (plan D2): nothing here builds markup.
 */
import { sizeWords } from "@/core/lib/size-words";
import { clockWords, dayClockWords, dayKeyWords } from "@/core/time/clock-words";
import { spanWords } from "@/core/time/span";

import type {
  StopReason,
  UploadCard,
  UploadCardUploader,
  UploaderSheet,
  UploaderSheetFile,
} from "./card";

/** The tones a chip may take (DESIGN §4): never red for anything but a real problem. */
export type ChipTone = "info" | "success" | "attention" | "danger" | "neutral";
export type Chip = { label: string; tone: ChipTone };

/** The task states a link may be made in (WORKFLOWS §5B.1). */
const LINK_STATES = new Set(["todo", "in_progress", "changes_requested"]);

/** The database also refuses an archived task (`app.upload_can_make_link`); its card says so. */
export function canMakeLink(taskState: string): boolean {
  return LINK_STATES.has(taskState);
}

/**
 * Whether the card is drawn at all: always once the task has had a link (its history stays), and
 * before that only where "Get upload link" can work (a live task, the Drive connected or waiting
 * to be reconnected).
 */
export function cardShown(card: UploadCard, taskState: string): boolean {
  if (card.state !== "none") return true;
  return canMakeLink(taskState) && card.driveState !== "disconnected";
}

/** "5.4 GB"; "3.1 of 5.4 GB" when both share a unit, else "640 MB of 1.2 GB". */
export function bytesOf(done: number, total: number): string {
  const a = sizeWords(done);
  const b = sizeWords(total);
  const unitA = a.split(" ")[1];
  const unitB = b.split(" ")[1];
  return unitA === unitB ? `${a.split(" ")[0]} of ${b}` : `${a} of ${b}`;
}

export const sizeOf = sizeWords;

/** "just now", "18 min ago", then the time today ("2:14 pm"), else "18 Nov, 2:14 pm". */
export function activityWords(at: string, now: Date): string {
  const ms = now.getTime() - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${spanWords(ms)} ago`;
  return whenWords(at, now);
}

/** The time today ("2:14 pm"), else the day and time ("18 Nov, 2:14 pm"), in IST. */
export function whenWords(at: string, now: Date): string {
  const when = new Date(at);
  return dayKeyWords(when) === dayKeyWords(now) ? clockWords(when) : dayClockWords(when);
}

/** People, files and data on the link the card shows: "3 people · 43 of 52 files · 51.9 GB". */
export function cardSummary(card: UploadCard): string | null {
  const current = card.uploaders.filter((u) => u.currentLink);
  if (current.length === 0) return null;
  const total = current.reduce((n, u) => n + filesOf(u), 0);
  const people = `${current.length} ${current.length === 1 ? "person" : "people"}`;
  const files = `${card.files} of ${total} ${total === 1 ? "file" : "files"}`;
  return `${people} · ${files} · ${sizeWords(card.bytes)}`;
}

function filesOf(u: UploadCardUploader): number {
  return u.filesDone + u.filesUploading + u.filesHeld + u.filesFailed + u.filesRemoved;
}

/** "8 of 12 done · 2 in progress · 1 failed" (a file removed in Drive counts as received). */
export function uploaderFilesLine(u: UploadCardUploader): string {
  const received = u.filesDone + u.filesRemoved;
  const parts = [`${received} of ${filesOf(u)} done`];
  if (u.filesUploading > 0) parts.push(`${u.filesUploading} in progress`);
  if (u.filesHeld > 0) parts.push(`${u.filesHeld} waiting for space`);
  if (u.filesFailed > 0) parts.push(`${u.filesFailed} failed`);
  return parts.join(" · ");
}

/** The row's chips, in the sample's order: what is happening, who it is, what needs you. */
export function uploaderChips(u: UploadCardUploader, now: Date): Chip[] {
  const chips: Chip[] = [];
  if (u.stuckSince) {
    chips.push({
      label: `Stuck ${spanWords(now.getTime() - Date.parse(u.stuckSince))}`,
      tone: "danger",
    });
  } else if (u.filesUploading > 0) {
    chips.push({ label: "Uploading", tone: "info" });
  }
  if (!u.onTask) chips.push({ label: "Not on this task · new name", tone: "neutral" });
  if (u.saidDoneAt) chips.push({ label: 'Said "I\'m done"', tone: "success" });
  else if (u.looksFinished) chips.push({ label: "Looks finished", tone: "attention" });
  return chips;
}

/** The card header's chip. */
export function cardChip(card: UploadCard): Chip | null {
  switch (card.state) {
    case "active":
      return { label: "Link active", tone: "info" };
    case "looks_finished":
      return { label: "Looks finished", tone: "attention" };
    case "stopped":
      return card.link?.stopReason === "files_received"
        ? { label: "All files received", tone: "success" }
        : { label: "Link stopped", tone: "neutral" };
    case "none":
      return null;
  }
}

const STOP_WORDS: Record<StopReason, string> = {
  stopped: "Stopped",
  files_received: "Closed",
  task_done: "Stopped when the task was marked done",
  task_cancelled: "Stopped when the task was cancelled",
  renewed: "Replaced by a new link",
};

/** "Closed by Asha, 18 Nov, 5:40 pm. The link no longer works." */
export function stoppedLine(card: UploadCard, viewerName: string | null): string | null {
  const link = card.link;
  if (!link || !link.stoppedAt) return null;
  const reason = link.stopReason ?? "stopped";
  const by = link.stopReason === "files_received" ? link.filesReceivedByName : link.stoppedByName;
  const who =
    reason === "task_done" || reason === "task_cancelled" || !by
      ? ""
      : ` by ${viewerName !== null && by === viewerName ? "you" : by}`;
  return `${STOP_WORDS[reason]}${who}, ${dayClockWords(new Date(link.stoppedAt))}. The link no longer works.`;
}

/** The Drive folder or file, opened in Google's own pages (plan D1: MaxOff never serves a file). */
export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}
export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

/** Plan D3 (Q13): programs and web pages, by their last extension. */
const RISKY = new Set(
  "exe msi bat cmd com scr ps1 vbs js jar apk dmg pkg lnk html htm svg xhtml hta".split(" "),
);
/** Ordinary media and document endings: one of these before another ending is a double name. */
const COMMON = new Set(
  "mp4 mov m4v avi mkv mts mxf jpg jpeg png heic heif gif webp tif tiff raw cr2 cr3 nef arw dng wav mp3 aac m4a pdf doc docx xls xlsx ppt pptx txt zip".split(
    " ",
  ),
);

/** "Check before opening" (grey): a program or web page, or a double name like `.mp4.exe`. */
export function checkBeforeOpening(name: string): boolean {
  const parts = name.toLowerCase().split(".");
  if (parts.length < 2) return false;
  const last = parts[parts.length - 1] ?? "";
  if (RISKY.has(last)) return true;
  const before = parts.length >= 3 ? (parts[parts.length - 2] ?? "") : "";
  return before !== "" && COMMON.has(before) && before !== last;
}

/** The short tag in a file's icon: its last extension, up to four letters ("MOV", "HEIC"). */
export function fileTag(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return ext.length > 0 && ext.length <= 4 ? ext.toUpperCase() : "FILE";
}

const FAILED_WORDS: Record<string, string> = {
  damaged: "Damaged on the way",
  size_mismatch: "The size in Drive didn't match",
  wrong_folder: "Arrived in the wrong folder",
  unreadable: "The uploader's device couldn't read it",
};

/** A file's chip on the sheet (WORKFLOWS §5B.2 "In MaxOff a file row is…"). */
export function fileChip(file: UploaderSheetFile): Chip {
  switch (file.state) {
    case "done":
      return { label: "Done", tone: "success" };
    case "missing_in_drive":
      return { label: "Removed in Drive", tone: "neutral" };
    case "uploading":
      return { label: "Uploading", tone: "info" };
    case "held":
      return { label: "Held", tone: "neutral" };
    case "failed":
      return { label: "Failed", tone: "danger" };
  }
}

/** The line under a file's name: its size and time, or how far it got. */
export function fileLine(file: UploaderSheetFile, now: Date): string {
  switch (file.state) {
    case "done":
    case "missing_in_drive":
      return file.doneAt
        ? `${sizeWords(file.sizeBytes)} · ${whenWords(file.doneAt, now)}`
        : sizeWords(file.sizeBytes);
    case "uploading": {
      const sent = Math.max(file.bytesAtGoogle, file.bytesReported);
      return bytesOf(sent, file.sizeBytes);
    }
    case "held":
      return `${sizeWords(file.sizeBytes)} · waiting for space in the studio's Drive`;
    case "failed": {
      const words = file.failedReason ? FAILED_WORDS[file.failedReason] : undefined;
      const sent = Math.max(file.bytesAtGoogle, file.bytesReported);
      return words ?? (sent > 0 ? `Failed at ${sizeWords(sent)}` : "Failed before it started");
    }
  }
}

/** The quieter notes a file may carry, each one line. */
export function fileNotes(file: UploaderSheetFile): string[] {
  const notes: string[] = [];
  if (file.afterStop) notes.push("Arrived after the link stopped");
  if (file.state === "done" && file.checkKind === "size_only") notes.push("Checked by size only");
  if (!file.inCurrentAccount && file.driveFileId)
    notes.push("In the studio's previous Google account");
  return notes;
}

/** "First file 1:02 pm · phone · Android. Name typed by the uploader, not checked." */
export function uploaderLine(sheet: UploaderSheet, now: Date): string {
  const u = sheet.uploader;
  const first = u.firstFileAt ? `First file ${whenWords(u.firstFileAt, now)}` : "No file yet";
  const device = u.deviceLabel ? ` · ${u.deviceLabel}` : "";
  return `${first}${device}. Name typed by the uploader, not checked.`;
}

/** "Sam, Alex and Jordan", or "3 people" past three. */
export function peopleWords(names: readonly string[]): string {
  if (names.length === 0) return "nobody yet";
  if (names.length > 3) return `${names.length} people`;
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The "All files received" sheet (sample §6). */
export function receivedCopy(input: {
  card: UploadCard;
  taskTitle: string;
  /** The viewer may mark the task Done (they are the primary, or its freelancer's coordinator). */
  markDoneFor: string | null;
  primaryName: string;
  /** The Owner is the primary: their Done completes the task, nobody approves it. */
  completes?: boolean;
}): { description: string; facts: string; stillUploading: string | null; confirm: string } {
  const current = input.card.uploaders.filter((u) => u.currentLink);
  const facts = `${input.card.files} ${input.card.files === 1 ? "file" : "files"} · ${sizeWords(
    input.card.bytes,
  )} from ${peopleWords(current.filter((u) => u.filesDone + u.filesRemoved > 0).map((u) => u.name))}`;
  const uploading = current.filter((u) => u.filesUploading > 0);
  const count = uploading.reduce((n, u) => n + u.filesUploading, 0);
  const stillUploading =
    count === 0
      ? null
      : `${count} ${count === 1 ? "file is" : "files are"} still uploading from ${peopleWords(
          uploading.map((u) => u.name),
        )}. If ${count === 1 ? "it finishes, it's" : "they finish, they're"} kept and marked "arrived after the link stopped".`;
  return input.markDoneFor !== null
    ? {
        description: input.completes
          ? `This stops the upload link and completes ${input.taskTitle}.`
          : `This stops the upload link and marks ${input.taskTitle} Done${
              input.markDoneFor ? ` for ${input.markDoneFor}` : ""
            }. It then goes for approval as usual.`,
        facts,
        stillUploading,
        confirm: "Received, mark Done",
      }
    : {
        description: `This stops the upload link. ${input.primaryName} (the task's primary) gets "Files received for ${input.taskTitle}: mark it done".`,
        facts,
        stillUploading,
        confirm: "Files received",
      };
}

/** The card re-reads itself only while something is uploading (WORKFLOWS §5B.3, §10a exception). */
export function cardIsMoving(card: UploadCard): boolean {
  return card.uploading > 0 || card.uploaders.some((u) => u.filesUploading > 0);
}

/** How often the card re-reads itself while something moves. */
export const CARD_POLL_MS = 5000;
