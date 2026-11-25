import "server-only";

import { headers } from "next/headers";

import { createServerSupabase } from "@/core/db/server";
import { createServiceSupabase } from "@/core/db/service";
import { driveFileFacts, openUploadSession, unsealSession } from "@/core/drive/upload-session";
import { finishedFileProblem, type SubfolderStore } from "@/core/drive/resumable";
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

export type StartAnswer =
  | { outcome: "already_added"; fileId: string; version: number }
  | { outcome: "wait"; seconds: number; version: number }
  | { outcome: "space_full"; version: number }
  | { outcome: "upload"; fileId: string; version: number; sessionUri: string; fresh: boolean };

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
  if (raw.outcome === "wait")
    return { outcome: "wait", seconds: raw.seconds ?? 5, version: raw.version };
  if (raw.outcome === "space_full") return { outcome: "space_full", version: raw.version };
  const fileId = raw.file_id;
  if (!fileId) throw new AppError("INTERNAL");
  if (raw.outcome === "already_added")
    return { outcome: "already_added", fileId, version: raw.version };

  const service = createServiceSupabase();
  if (raw.outcome === "resume" && raw.has_session) {
    const { data: rows, error: readError } = await service.rpc("handin_session_get", {
      p_file_id: fileId,
    });
    if (readError) throw readError;
    const sealed = rows?.[0]?.session_uri_encrypted;
    if (sealed) {
      return {
        outcome: "upload",
        fileId,
        version: raw.version,
        sessionUri: await unsealSession(sealed),
        fresh: false,
      };
    }
  }

  const { data: fileRows, error: fileError } = await service.rpc("handin_session_get", {
    p_file_id: fileId,
  });
  if (fileError) throw fileError;
  const file = fileRows?.[0];
  if (!file) throw new AppError("NOT_FOUND");
  const task = await taskForFolder(input.taskId);
  const origin = await appOrigin();
  const opened = await openUploadSession({
    service,
    orgId: task.orgId,
    accountId: file.account_sub,
    task: task.folder,
    top: versionFolderName(file.version),
    relativePath: file.relative_path,
    subfolders: versionFolders(input.taskId, file.version, file.account_sub),
    file: { name: file.name, sizeBytes: Number(file.size_bytes), mimeType: input.mimeType },
    description: `Handed in on MaxOff: ${origin}/tasks/${input.taskId} (v${file.version})`,
    origin,
    fetchImpl: fetch,
    now: systemClock(),
  });
  const { error: setError } = await service.rpc("handin_session_set", {
    p_file_id: fileId,
    p_account_sub: opened.accountId,
    p_drive_parent_id: opened.parentId,
    p_session_uri_encrypted: opened.sealedSession,
  });
  if (setError) throw setError;
  return {
    outcome: "upload",
    fileId,
    version: raw.version,
    sessionUri: opened.sessionUri,
    fresh: true,
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
 * The browser says Google finished a file. Only the file's adder may say so (their own
 * `handin_progress` refuses anyone else: FORBIDDEN / NOT_FOUND); then the Worker asks Google
 * itself and records what Google says, never what the browser claims (v4.5 F1).
 */
export async function finishFile(input: {
  fileId: string;
  driveFileId: string;
  md5: string | null;
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
  const problem = finishedFileProblem(facts, {
    sizeBytes: Number(file.size_bytes),
    parentId: file.drive_parent_id ?? "",
  });
  if (problem === "missing" || !facts) {
    // Google holds no such file in reach: the browser's claim is wrong; the file is retried.
    await markFailed(input.fileId, "unreadable");
    return "failed";
  }
  const { data: outcome, error: doneError } = await service.rpc("handin_file_done", {
    p_file_id: input.fileId,
    p_drive_file_id: facts.id,
    p_size: facts.sizeBytes,
    p_md5_drive: facts.md5 ?? "",
    p_parent_id: facts.parents.includes(file.drive_parent_id ?? "")
      ? (file.drive_parent_id ?? "")
      : (facts.parents[0] ?? ""),
    ...(input.md5 ? { p_md5_page: input.md5 } : {}),
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
