import "server-only";

import type { ServiceSupabase } from "@/core/db/service";

import { ensureTaskFolder } from "./ensure";
import { readDriveEnv } from "./env";
import { ROOT_FOLDER, type TaskFolderInput } from "./folders";
import { createFolder, DriveApiError, DriveAuthError, type Fetch, renameFolder } from "./google";
import { openResumableSession, type UploadPolicy } from "./resumable";
import { type AccountRow, folderStore, withDrive } from "./server";
import { decryptToken, encryptToken } from "./token-crypto";

/**
 * The Worker's side of one upload filed under a task's folder (ADR-0010 amendments 2026-11-19
 * and 2026-11-25), on top of the shared session protocol (`./resumable`, owned by v4.5). Used by
 * v5.0's hand-in versions (`‹task›/v‹n›/…`). The caller's database function has already said who
 * may upload what; this makes the folders, opens the session on the connected account and seals
 * its address for storage. The browser is given the address only, never a token.
 *
 * TEMPORARY (advisor, 25 Nov): the v4.5 integrator takes this file into `phase-v45` with the same
 * exported names (#89 7162679961); v5.0 drops this copy, and its `fileFacts` /
 * `finishedFileProblem` (which move to `./resumable`), when that push lands.
 */

const ACCOUNT_COLUMNS =
  "org_id, google_sub, refresh_token_encrypted, access_token_encrypted, token_expires_at, root_folder_id";

export class DriveUnavailableError extends Error {
  constructor() {
    super("Google Drive is not connected.");
    this.name = "DriveUnavailableError";
  }
}

async function connectedAccount(service: ServiceSupabase, orgId: string): Promise<AccountRow> {
  if (readDriveEnv().mode === "off") throw new DriveUnavailableError();
  const { data, error } = await service
    .from("drive_account")
    .select(ACCOUNT_COLUMNS)
    .eq("org_id", orgId)
    .eq("state", "connected")
    .maybeSingle();
  if (error) throw new Error(`drive_account: ${error.message}`);
  if (!data) throw new DriveUnavailableError();
  return data;
}

/** A store of folders under one task folder, keyed by a path ('' = the first folder itself). */
export type SubfolderStore = {
  find(relativePath: string): Promise<string | null>;
  /** Insert or return: the folder that won a race is the one kept. */
  put(relativePath: string, driveFolderId: string): Promise<string>;
};

/**
 * Makes `‹parent›/‹top›/‹a›/‹b›…` for a relative path, each folder once: the cache first, then
 * Google, recording each before making the next, so a stopped run resumes where it stopped.
 * Returns the Drive id of the deepest folder.
 */
export async function ensureSubfolders(input: {
  parentDriveId: string;
  top: string;
  relativePath: string;
  store: SubfolderStore;
  make: (folder: { name: string; parentId: string }) => Promise<{ id: string }>;
}): Promise<string> {
  const parts = input.relativePath === "" ? [] : input.relativePath.split("/");
  const keys = ["", ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))];
  const names = [input.top, ...parts];
  let parent = input.parentDriveId;
  for (const [i, key] of keys.entries()) {
    const cached = await input.store.find(key);
    if (cached) {
      parent = cached;
      continue;
    }
    const made = await input.make({ name: names[i] ?? "", parentId: parent });
    parent = await input.store.put(key, made.id);
  }
  return parent;
}

export type OpenedUpload = {
  sessionUrl: string;
  sealedSession: string;
  parentId: string;
  accountId: string;
};

export async function openUploadSession(input: {
  service: ServiceSupabase;
  orgId: string;
  /** The account the database recorded for this file: a switch in between refuses the upload. */
  accountId: string;
  task: TaskFolderInput;
  /** The first folder under the task's ("v2"). */
  top: string;
  relativePath: string;
  subfolders: SubfolderStore;
  file: { name: string; size: number; mimeType: string; description?: string };
  policy: UploadPolicy;
  origin: string;
  fetchImpl: Fetch;
  now: Date;
}): Promise<OpenedUpload> {
  const row = await connectedAccount(input.service, input.orgId);
  if (row.google_sub !== input.accountId) throw new DriveUnavailableError();
  const env = readDriveEnv();
  if (env.mode === "off") throw new DriveUnavailableError();
  const store = folderStore(input.service, input.orgId);

  const opened = await withDrive(
    { service: input.service, row, fetchImpl: input.fetchImpl, now: input.now },
    async (connection) => {
      const root = await store.find(
        { kind: "root", name: ROOT_FOLDER, clientId: null, month: null, taskId: null },
        connection.accountId,
      );
      if (!root) throw new DriveUnavailableError();
      const taskFolder = await ensureTaskFolder({
        store,
        make: (folder) => createFolder(input.fetchImpl, connection.accessToken, folder),
        rename: (folder) => renameFolder(input.fetchImpl, connection.accessToken, folder),
        accountId: connection.accountId,
        root,
        folder: input.task,
      });
      const parentId = await ensureSubfolders({
        parentDriveId: taskFolder.driveFolderId,
        top: input.top,
        relativePath: input.relativePath,
        store: input.subfolders,
        make: (folder) => createFolder(input.fetchImpl, connection.accessToken, folder),
      });
      const { sessionUrl } = await openResumableSession(input.fetchImpl, connection.accessToken, {
        target: {
          folderId: parentId,
          name: input.file.name,
          size: input.file.size,
          mimeType: input.file.mimeType,
          ...(input.file.description ? { description: input.file.description } : {}),
        },
        policy: input.policy,
        origin: input.origin,
      });
      return { sessionUrl, parentId, accountId: connection.accountId };
    },
  );
  if (!opened) throw new DriveUnavailableError();
  return { ...opened, sealedSession: await encryptToken(opened.sessionUrl, env.tokenKey) };
}

/** A stored session address, opened again (to hand back to the browser, or to ask Google). */
export async function unsealSession(sealed: string): Promise<string> {
  const env = readDriveEnv();
  if (env.mode === "off") throw new DriveUnavailableError();
  return decryptToken(sealed, env.tokenKey);
}

/** What Google holds for a file MaxOff's session made (`drive.file` sees it). */
export type FileFacts = {
  id: string;
  sizeBytes: number;
  md5: string | null;
  parents: string[];
  trashed: boolean;
};

async function fileFacts(fetchImpl: Fetch, accessToken: string, fileId: string) {
  const response = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,size,md5Checksum,parents,trashed`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 404) return null;
  if (response.status === 401) throw new DriveAuthError("Google refused the access token");
  const answer = (await response.json().catch(() => ({}))) as {
    id?: string;
    size?: string;
    md5Checksum?: string;
    parents?: string[];
    trashed?: boolean;
  };
  if (!response.ok || !answer.id) {
    throw new DriveApiError(`Drive call failed (${response.status})`, response.status);
  }
  return {
    id: answer.id,
    sizeBytes: Number(answer.size ?? 0),
    md5: answer.md5Checksum ? answer.md5Checksum.toLowerCase() : null,
    parents: answer.parents ?? [],
    trashed: answer.trashed === true,
  } satisfies FileFacts;
}

/** The check before a finished file is recorded (v4.5 F1): Google's answer against what was set. */
export function finishedFileProblem(
  facts: FileFacts | null,
  expected: { sizeBytes: number; parentId: string; md5?: string | null },
): "missing" | "size_mismatch" | "wrong_folder" | "checksum_mismatch" | null {
  if (!facts || facts.trashed) return "missing";
  if (facts.sizeBytes !== expected.sizeBytes) return "size_mismatch";
  if (!facts.parents.includes(expected.parentId)) return "wrong_folder";
  if (expected.md5 && facts.md5 && expected.md5.toLowerCase() !== facts.md5) {
    return "checksum_mismatch";
  }
  return null;
}

/** What Google holds for a file (`null` = 404), asked by the Worker itself (v4.5 F1). */
export async function driveFileFacts(input: {
  service: ServiceSupabase;
  orgId: string;
  driveFileId: string;
  fetchImpl: Fetch;
  now: Date;
}): Promise<FileFacts | null> {
  const row = await connectedAccount(input.service, input.orgId);
  // Wrapped, so Google's 404 (null facts) is told apart from no usable connection (null).
  const read = await withDrive(
    { service: input.service, row, fetchImpl: input.fetchImpl, now: input.now },
    async (connection) => ({
      facts: await fileFacts(input.fetchImpl, connection.accessToken, input.driveFileId),
    }),
  );
  if (!read) throw new DriveUnavailableError();
  return read.facts;
}
