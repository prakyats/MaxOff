/**
 * What the Owner and the task's Admin read (v4.5, WORKFLOWS §5B.3; DATA-MODEL §8a `upload_card`,
 * `upload_uploader_files`): the Uploads card and one uploader's sheet, in the app's words. Pure:
 * the database answers JSON and these shape it. No token, hash, salt or session address is ever
 * in either answer; an IP and browser only for `uploads.network` (the Owner, Q12).
 */
import type { UploadFileState } from "./signals";

export type UploadCardState = "none" | "active" | "looks_finished" | "stopped";
export type StopReason = "stopped" | "files_received" | "task_done" | "task_cancelled" | "renewed";
export type DriveState = "connected" | "needs_reconnect" | "disconnected";

export type UploadCardLink = {
  id: string;
  /** An active link that is not sealed works for nobody: the card offers Make a new link. */
  sealed: boolean;
  createdAt: string;
  createdByName: string | null;
  ageDays: number;
  renewedFromId: string | null;
  stoppedAt: string | null;
  stoppedByName: string | null;
  stopReason: StopReason | null;
  filesReceivedAt: string | null;
  filesReceivedByName: string | null;
  /** Google's daily limit, while the pause lasts. */
  pausedUntil: string | null;
};

export type UploadCardUploader = {
  id: string;
  linkId: string;
  /** The uploader came through the link the card shows. */
  currentLink: boolean;
  name: string;
  onTask: boolean;
  filesDone: number;
  filesUploading: number;
  filesHeld: number;
  filesFailed: number;
  filesRemoved: number;
  bytesDone: number;
  bytesTotal: number;
  lastActivityAt: string;
  saidDoneAt: string | null;
  stuckSince: string | null;
  looksFinished: boolean;
};

export type UploadCard = {
  taskId: string;
  state: UploadCardState;
  driveState: DriveState;
  /** The task folder's Drive id, for "Open the folder in Drive". */
  taskFolderId: string | null;
  link: UploadCardLink | null;
  files: number;
  bytes: number;
  people: number;
  uploading: number;
  uploaders: UploadCardUploader[];
};

export type UploaderSheetFile = {
  id: string;
  name: string;
  relativePath: string;
  sizeBytes: number;
  state: UploadFileState;
  failedReason: string | null;
  bytesAtGoogle: number;
  bytesReported: number;
  doneAt: string | null;
  checkKind: "md5" | "size_only" | null;
  afterStop: boolean;
  driveFileId: string | null;
  missingSeenAt: string | null;
  /** False after an account switch: the file is in the old account (plan E8). */
  inCurrentAccount: boolean;
  createdAt: string;
  /** The Owner only (`uploads.network`). */
  ip?: string | null;
  userAgent?: string | null;
};

export type UploaderSheet = {
  uploader: {
    id: string;
    linkId: string;
    name: string;
    onTask: boolean;
    folderName: string;
    deviceLabel: string | null;
    firstFileAt: string | null;
    lastActivityAt: string;
    saidDoneAt: string | null;
    networkErasedAt: string | null;
    ip?: string | null;
    userAgent?: string | null;
  };
  files: UploaderSheetFile[];
};

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}
const text = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));
const maybeText = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number => Number(value ?? 0);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function network(row: Json): { ip?: string | null; userAgent?: string | null } {
  return "ip" in row || "user_agent" in row
    ? { ip: maybeText(row.ip), userAgent: maybeText(row.user_agent) }
    : {};
}

export function toUploadCard(raw: unknown): UploadCard {
  const card = record(raw);
  const link = card.link ? record(card.link) : null;
  return {
    taskId: text(card.task_id),
    state: text(card.state) as UploadCardState,
    driveState: text(card.drive_state) as DriveState,
    taskFolderId: maybeText(card.task_folder_id),
    link: link
      ? {
          id: text(link.id),
          sealed: link.sealed === true,
          createdAt: text(link.created_at),
          createdByName: maybeText(link.created_by_name),
          ageDays: count(link.age_days),
          renewedFromId: maybeText(link.renewed_from_id),
          stoppedAt: maybeText(link.stopped_at),
          stoppedByName: maybeText(link.stopped_by_name),
          stopReason: maybeText(link.stop_reason) as StopReason | null,
          filesReceivedAt: maybeText(link.files_received_at),
          filesReceivedByName: maybeText(link.files_received_by_name),
          pausedUntil: maybeText(link.paused_until),
        }
      : null,
    files: count(card.files),
    bytes: count(card.bytes),
    people: count(card.people),
    uploading: count(card.uploading),
    uploaders: list(card.uploaders).map((value) => {
      const row = record(value);
      return {
        id: text(row.id),
        linkId: text(row.link_id),
        currentLink: row.current_link === true,
        name: text(row.name),
        onTask: row.on_task === true,
        filesDone: count(row.files_done),
        filesUploading: count(row.files_uploading),
        filesHeld: count(row.files_held),
        filesFailed: count(row.files_failed),
        filesRemoved: count(row.files_removed),
        bytesDone: count(row.bytes_done),
        bytesTotal: count(row.bytes_total),
        lastActivityAt: text(row.last_activity_at),
        saidDoneAt: maybeText(row.said_done_at),
        stuckSince: maybeText(row.stuck_since),
        looksFinished: row.looks_finished === true,
      };
    }),
  };
}

export function toUploaderSheet(raw: unknown): UploaderSheet {
  const sheet = record(raw);
  const up = record(sheet.uploader);
  return {
    uploader: {
      id: text(up.id),
      linkId: text(up.link_id),
      name: text(up.name),
      onTask: up.on_task === true,
      folderName: text(up.folder_name),
      deviceLabel: maybeText(up.device_label),
      firstFileAt: maybeText(up.first_file_at),
      lastActivityAt: text(up.last_activity_at),
      saidDoneAt: maybeText(up.said_done_at),
      networkErasedAt: maybeText(up.network_erased_at),
      ...network(up),
    },
    files: list(sheet.files).map((value) => {
      const row = record(value);
      return {
        id: text(row.id),
        name: text(row.name),
        relativePath: text(row.relative_path),
        sizeBytes: count(row.size_bytes),
        state: text(row.state) as UploadFileState,
        failedReason: maybeText(row.failed_reason),
        bytesAtGoogle: count(row.bytes_at_google),
        bytesReported: count(row.bytes_reported),
        doneAt: maybeText(row.done_at),
        checkKind: maybeText(row.check_kind) as "md5" | "size_only" | null,
        afterStop: row.after_stop === true,
        driveFileId: maybeText(row.drive_file_id),
        missingSeenAt: maybeText(row.missing_seen_at),
        inCurrentAccount: row.in_current_account === true,
        createdAt: text(row.created_at),
        ...network(row),
      };
    }),
  };
}
