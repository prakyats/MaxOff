import "server-only";

import { headers } from "next/headers";

import { createServerSupabase } from "@/core/db/server";
import { createServiceSupabase } from "@/core/db/service";
import {
  finishedFileProblem,
  type SubfolderStore,
  UploadPolicyError,
} from "@/core/drive/resumable";
import { driveFileFacts, openUploadSession, unsealSession } from "@/core/drive/upload-session";
import { AppError } from "@/core/errors";
import { resolveAppOrigin } from "@/core/lib/app-url";
import { systemClock, todayIST } from "@/core/time";

import { versionFolderName } from "../domain/files";
import type { FileState } from "../domain/summary";

/**
 * v5.0 hand-in, the data layer (DATA-MODEL §8b): the member functions run as the caller
 * (`createServerSupabase`, so the database checks who they are and what they may do); the
 * Worker's half (folders, the Google session, the finished-file check) runs as the service role
 * only after the caller's own function said yes, through `core/drive` (ADR-0010 amendment).
 */

export type HandinFile = {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  state: FileState;
  failedReason: string | null;
  bytes: number;
  addedBy: string;
  onBehalfOf: string | null;
  mine: boolean;
  doneAt: string | null;
  leftOutAt: string | null;
  leftOutBy: string | null;
  checkKind: "md5" | "size_only" | null;
  afterHandin: boolean;
  /** Only for the Owner and the task's Admins (Q6); null for everyone else. */
  driveFileId: string | null;
};

export type HandinVersion = {
  version: number;
  handedIn: boolean;
  submissionId: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  onBehalfOf: string | null;
  folderId: string | null;
  files: HandinFile[];
};

export type HandinRead = {
  openVersion: number;
  taskOpen: boolean;
  canAdd: boolean;
  drive: "connected" | "needs_reconnect" | "disconnected" | "never";
  reviewer: boolean;
  versions: HandinVersion[];
};

type RawFile = {
  id: string;
  name: string;
  relative_path: string;
  size: number;
  state: FileState;
  failed_reason: string | null;
  bytes: number;
  added_by: string;
  on_behalf_of: string | null;
  mine: boolean;
  done_at: string | null;
  left_out_at: string | null;
  left_out_by: string | null;
  check_kind: "md5" | "size_only" | null;
  after_handin: boolean;
  drive_file_id: string | null;
};

type RawVersion = {
  version: number;
  handed_in: boolean;
  submission_id: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  on_behalf_of: string | null;
  folder_id: string | null;
  files: RawFile[];
};

type RawRead = {
  open_version: number;
  task_open: boolean;
  can_add: boolean;
  drive: HandinRead["drive"];
  reviewer: boolean;
  versions: RawVersion[];
};

function toFile(raw: RawFile): HandinFile {
  return {
    id: raw.id,
    name: raw.name,
    relativePath: raw.relative_path,
    size: Number(raw.size),
    state: raw.state,
    failedReason: raw.failed_reason,
    bytes: Number(raw.bytes),
    addedBy: raw.added_by,
    onBehalfOf: raw.on_behalf_of,
    mine: raw.mine,
    doneAt: raw.done_at,
    leftOutAt: raw.left_out_at,
    leftOutBy: raw.left_out_by,
    checkKind: raw.check_kind,
    afterHandin: raw.after_handin,
    driveFileId: raw.drive_file_id,
  };
}

export async function readHandin(taskId: string): Promise<HandinRead> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("handin_versions", { p_task_id: taskId });
  if (error) throw error;
  const raw = data as unknown as RawRead;
  return {
    openVersion: raw.open_version,
    taskOpen: raw.task_open,
    canAdd: raw.can_add,
    drive: raw.drive,
    reviewer: raw.reviewer,
    versions: raw.versions.map((v) => ({
      version: v.version,
      handedIn: v.handed_in,
      submissionId: v.submission_id,
      submittedAt: v.submitted_at,
      submittedBy: v.submitted_by,
      onBehalfOf: v.on_behalf_of,
      folderId: v.folder_id,
      files: v.files.map(toFile),
    })),
  };
}

/**
 * What starting one file gives the browser: a session (new, or the caller's own earlier one,
 * `resumed`), a refusal the row shows, or "already added" (the same file is in Drive for this
 * version). The shape follows the shared engine's contract (`core/upload/types.ts`).
 */
export type StartAnswer =
  | { kind: "open"; fileId: string; sessionUrl: string; resumed: boolean; version: number }
  | { kind: "already_added"; fileId: string; version: number }
  | {
      kind: "refused";
      refused: "limit" | "no_space" | "empty" | "bad_name" | "too_big" | "type_not_allowed";
    };

type RawStart = {
  outcome: "already_added" | "resume" | "wait" | "space_full" | "start";
  file_id?: string;
  version: number;
  seconds?: number;
  has_session?: boolean;
  name?: string;
  relative_path?: string;
  size?: number;
};

/** The task's folder facts the Worker needs (service role: the caller's function already said yes). */
async function taskForFolder(taskId: string) {
  const service = createServiceSupabase();
  const { data, error } = await service
    .from("tasks")
    .select("id, org_id, title, client_id, clients(id, name)")
    .eq("id", taskId)
    .single();
  if (error) throw error;
  const client = Array.isArray(data.clients) ? data.clients[0] : data.clients;
  return {
    orgId: data.org_id,
    folder: {
      client: client ? { id: client.id, name: client.name } : null,
      // A task already filed stays in its month (v4.0 Q2); this is used only the first time.
      month: todayIST(systemClock).slice(0, 7),
      task: { id: data.id, title: data.title },
    },
  };
}

function versionFolders(taskId: string, version: number, accountId: string): SubfolderStore {
  const service = createServiceSupabase();
  return {
    async find(relativePath) {
      const { data, error } = await service.rpc("handin_folder_find", {
        p_task_id: taskId,
        p_version: version,
        p_account_sub: accountId,
        p_relative_path: relativePath,
      });
      if (error) throw error;
      return data ?? null;
    },
    async put(relativePath, driveFolderId) {
      const { data, error } = await service.rpc("handin_folder_put", {
        p_task_id: taskId,
        p_version: version,
        p_account_sub: accountId,
        p_relative_path: relativePath,
        p_drive_folder_id: driveFolderId,
      });
      if (error) throw error;
      if (!data) throw new Error("handin_folder_put returned no folder");
      return data;
    },
  };
}

async function appOrigin(): Promise<string> {
  const head = await headers();
  return resolveAppOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    head.get("host"),
    head.get("x-forwarded-proto"),
    process.env.NEXT_PUBLIC_APP_ENV,
  );
}

/**
 * One file added to the open version: the caller's own `handin_file_start` decides (who, the
 * task's state, Drive, limits); then, for a new file, the Worker makes the folders and opens the
 * session; for a resumed one it hands the stored session back.
 */
export async function startFile(input: {
  taskId: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string | null;
  onBehalfOf: string | null;
}): Promise<StartAnswer> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("handin_file_start", {
    p_task_id: input.taskId,
    p_name: input.name,
    p_relative_path: input.relativePath,
    p_size_bytes: input.size,
    ...(input.mimeType ? { p_mime_hint: input.mimeType } : {}),
    ...(input.onBehalfOf ? { p_on_behalf_of: input.onBehalfOf } : {}),
  });
  if (error) throw error;
  const raw = data as unknown as RawStart;
  if (raw.outcome === "wait") return { kind: "refused", refused: "limit" };
  if (raw.outcome === "space_full") return { kind: "refused", refused: "no_space" };
  const fileId = raw.file_id;
  if (!fileId) throw new AppError("INTERNAL");
  if (raw.outcome === "already_added")
    return { kind: "already_added", fileId, version: raw.version };

  const service = createServiceSupabase();
  const { data: rows, error: readError } = await service.rpc("handin_session_get", {
    p_file_id: fileId,
  });
  if (readError) throw readError;
  const file = rows?.[0];
  if (!file) throw new AppError("NOT_FOUND");
  if (raw.outcome === "resume" && file.session_uri_encrypted) {
    return {
      kind: "open",
      fileId,
      version: raw.version,
      sessionUrl: await unsealSession(file.session_uri_encrypted),
      resumed: true,
    };
  }

  const task = await taskForFolder(input.taskId);
  const origin = await appOrigin();
  let opened;
  try {
    opened = await openUploadSession({
      service,
      orgId: task.orgId,
      accountId: file.account_sub,
      task: task.folder,
      top: versionFolderName(file.version),
      relativePath: file.relative_path,
      subfolders: versionFolders(input.taskId, file.version, file.account_sub),
      file: {
        name: file.name,
        size: Number(file.size_bytes),
        mimeType: input.mimeType ?? "",
        description: `Handed in on MaxOff: ${origin}/tasks/${input.taskId} (v${file.version})`,
      },
      // Q4 (autopilot 25 Nov): any type, any size.
      policy: {},
      origin,
      fetchImpl: fetch,
      now: systemClock(),
    });
  } catch (error) {
    if (error instanceof UploadPolicyError) {
      await markFailed(fileId, "unreadable");
      return { kind: "refused", refused: error.reason };
    }
    throw error;
  }
  const { error: setError } = await service.rpc("handin_session_set", {
    p_file_id: fileId,
    p_account_sub: opened.accountId,
    p_drive_parent_id: opened.parentId,
    p_session_uri_encrypted: opened.sealedSession,
  });
  if (setError) throw setError;
  return {
    kind: "open",
    fileId,
    version: raw.version,
    sessionUrl: opened.sessionUrl,
    resumed: false,
  };
}

export async function reportProgress(fileId: string, bytes: number): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("handin_progress", { p_file_id: fileId, p_bytes: bytes });
  if (error) throw error;
}

export async function markFailed(
  fileId: string,
  reason: "damaged" | "gave_up" | "unreadable",
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("handin_file_failed", {
    p_file_id: fileId,
    p_reason: reason,
  });
  if (error) throw error;
}

/**
 * The browser says Google finished a file (the engine's `done` report: Google's id for it and the
 * engine's own MD5 of the bytes Google confirmed). Only the file's adder may say so (their own
 * `handin_progress` refuses anyone else: FORBIDDEN / NOT_FOUND). The Worker then asks Google
 * itself and records Google's answer, checked against the size and folder the session was opened
 * with (v4.5 F1); a checksum that differs fails the file as damaged.
 */
export async function finishFile(input: {
  fileId: string;
  driveFileId: string;
  localMd5: string | null;
}): Promise<"done" | "failed"> {
  const supabase = await createServerSupabase();
  const { error: ownError } = await supabase.rpc("handin_progress", {
    p_file_id: input.fileId,
    p_bytes: 0,
  });
  if (ownError) throw ownError;

  const service = createServiceSupabase();
  const { data: rows, error } = await service.rpc("handin_session_get", {
    p_file_id: input.fileId,
  });
  if (error) throw error;
  const file = rows?.[0];
  if (!file) throw new AppError("NOT_FOUND");
  if (file.state === "done") return "done";
  const { data: task, error: taskError } = await service
    .from("tasks")
    .select("org_id")
    .eq("id", file.task_id)
    .single();
  if (taskError) throw taskError;
  const facts = await driveFileFacts({
    service,
    orgId: task.org_id,
    driveFileId: input.driveFileId,
    fetchImpl: fetch,
    now: systemClock(),
  });
  const parentId = file.drive_parent_id ?? "";
  const problem = finishedFileProblem(facts, { sizeBytes: Number(file.size_bytes), parentId });
  if (problem === "missing" || !facts) {
    // Google holds no such file in reach: the browser's claim is wrong; the file can be retried.
    await markFailed(input.fileId, "unreadable");
    return "failed";
  }
  // The database repeats the checks (size, folder, MD5) and records the failure reason itself.
  const { data: outcome, error: doneError } = await service.rpc("handin_file_done", {
    p_file_id: input.fileId,
    p_drive_file_id: facts.id,
    p_size: facts.sizeBytes,
    p_md5_drive: facts.md5 ?? "",
    p_parent_id: facts.parents.includes(parentId) ? parentId : (facts.parents[0] ?? ""),
    ...(input.localMd5 ? { p_md5_page: input.localMd5 } : {}),
  });
  if (doneError) throw doneError;
  return outcome === "done" ? "done" : "failed";
}

export async function leaveOut(fileId: string, onBehalfOf: string | null): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("handin_file_left_out", {
    p_file_id: fileId,
    ...(onBehalfOf ? { p_on_behalf_of: onBehalfOf } : {}),
  });
  if (error) throw error;
}

/** Approvals' "v2 · 14 files": per handed-in version id, its files in Drive (tasks the caller sees). */
export async function countHandinFiles(
  submissionIds: readonly string[],
): Promise<Record<string, number>> {
  if (submissionIds.length === 0) return {};
  const supabase = await createServerSupabase();
  const counts: Record<string, number> = {};
  for (let i = 0; i < submissionIds.length; i += 500) {
    const { data, error } = await supabase.rpc("handin_counts", {
      p_submission_ids: submissionIds.slice(i, i + 500),
    });
    if (error) throw error;
    for (const row of data ?? []) counts[row.submission_id] = row.files;
  }
  return counts;
}

/**
 * "Removed in Drive" (WORKFLOWS §5C, as §5B): for a reviewer with the card on screen, the
 * handed-in files of this task not checked in the last 10 minutes are claimed (one Drive read
 * for two reviewers opening at once), then asked of Google by metadata only. Only 404 or the bin
 * counts as removed; any other answer records nothing. Never on the page's first render.
 */
/** Returns how many files Google answered for (the card re-reads when any were). */
export async function checkHandinFiles(taskId: string): Promise<number> {
  const read = await readHandin(taskId);
  if (!read.reviewer) throw new AppError("FORBIDDEN");
  const ids = read.versions
    .filter((version) => version.handedIn)
    .flatMap((version) => version.files)
    .filter((file) => file.state === "done" || file.state === "missing_in_drive")
    .map((file) => file.id);
  if (ids.length === 0) return 0;
  const service = createServiceSupabase();
  const { data: claimed, error } = await service.rpc("handin_drive_check_claim", {
    p_file_ids: ids,
  });
  if (error) throw error;
  if (!claimed || claimed.length === 0) return 0;
  const { data: task, error: taskError } = await service
    .from("tasks")
    .select("org_id")
    .eq("id", taskId)
    .single();
  if (taskError) throw taskError;
  let checked = 0;
  for (const file of claimed) {
    if (!file.drive_file_id) continue;
    let facts;
    try {
      facts = await driveFileFacts({
        service,
        orgId: task.org_id,
        driveFileId: file.drive_file_id,
        fetchImpl: fetch,
        now: systemClock(),
      });
    } catch {
      continue; // Reconnect needed, an outage, a refusal: nothing is recorded.
    }
    const seen = facts === null ? "not_found" : facts.trashed ? "trashed" : "present";
    const { error: seenError } = await service.rpc("handin_drive_seen", {
      p_file_id: file.file_id,
      p_seen: seen,
    });
    if (seenError) throw seenError;
    checked += 1;
  }
  return checked;
}

export type HandinDailyReport = { checked: number; skipped: number };

/**
 * The daily "Removed in Drive" pass (WORKFLOWS §5C), run after `drive_space_check`: handed-in
 * files of the last 30 days, each at most every 10 minutes, claimed by the database so two runs
 * never read Drive twice. Metadata only; only 404 or the bin marks a file removed, and a file
 * restored from the bin comes back. Anything else (a reconnect needed, an outage) records nothing.
 */
export async function runHandinDailyCheck(now: Date): Promise<HandinDailyReport> {
  const service = createServiceSupabase();
  const { data: due, error } = await service.rpc("handin_drive_check_daily", {
    p_now: now.toISOString(),
  });
  if (error) throw error;
  const report: HandinDailyReport = { checked: 0, skipped: 0 };
  for (const file of due ?? []) {
    if (!file.drive_file_id) continue;
    let facts;
    try {
      facts = await driveFileFacts({
        service,
        orgId: file.org_id,
        driveFileId: file.drive_file_id,
        fetchImpl: fetch,
        now,
      });
    } catch {
      report.skipped += 1;
      continue;
    }
    const seen = facts === null ? "not_found" : facts.trashed ? "trashed" : "present";
    const { error: seenError } = await service.rpc("handin_drive_seen", {
      p_file_id: file.file_id,
      p_seen: seen,
    });
    if (seenError) throw seenError;
    report.checked += 1;
  }
  return report;
}
