import "server-only";

import type { ServiceSupabase } from "@/core/db/service";

import { ensureTaskFolder } from "./ensure";
import { readDriveEnv } from "./env";
import { ROOT_FOLDER, type TaskFolderInput } from "./folders";
import { createFolder, type Fetch, renameFolder } from "./google";
import {
  ensureSubfolders,
  type FileFacts,
  fileFacts,
  openResumableSession,
  type SubfolderStore,
  type UploadPolicy,
} from "./resumable";
import { type AccountRow, folderStore, withDrive } from "./server";
import { decryptToken, encryptToken } from "./token-crypto";

/**
 * The Worker's side of one browser-to-Drive upload (shared: v4.5 upload links, v5.0 hand-ins;
 * ADR-0010 amendment 2026-11-19, accepted 25 Nov 2026; adapted from v5.0's aeff0d5). The caller has
 * already passed its own permission, scope and state checks in the database; this makes the task's
 * folder and the caller's subfolders (`‹task›/‹top›/‹relative path›`: an uploader's name, or a
 * hand-in's `v2`), opens the session under the caller's policy, and seals its address for storage.
 * The browser is given the address only, never a token.
 */

const ACCOUNT_COLUMNS =
  "org_id, google_sub, refresh_token_encrypted, access_token_encrypted, token_expires_at, root_folder_id";

/** Drive is not set up, not connected, needs reconnecting, or was switched to another account. */
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

export type UploadSession = {
  /** Google's session address, for the browser that sends this file. */
  sessionUrl: string;
  /** The same, sealed (`encryptToken`), for the caller's row. */
  sealedSession: string;
  /** The Drive folder the file goes into (for the finished-file check). */
  parentId: string;
  /** The Google account the session lives in. */
  accountId: string;
};

export async function openUploadSession(input: {
  service: ServiceSupabase;
  orgId: string;
  /** The account the caller recorded for this upload: a switch in between refuses it. */
  accountId: string | null;
  task: TaskFolderInput;
  /** The first folder under the task's ("v2", or an uploader's name). */
  top: string;
  /** The folder path inside what the person chose, as the browser reported it (cleaned here). */
  relativePath: string;
  subfolders: SubfolderStore;
  file: { name: string; size: number; mimeType: string; description?: string };
  policy: UploadPolicy;
  origin: string;
  fetchImpl: Fetch;
  now: Date;
}): Promise<UploadSession> {
  const row = await connectedAccount(input.service, input.orgId);
  if (input.accountId && row.google_sub !== input.accountId) throw new DriveUnavailableError();
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

/** A stored session address, opened again to hand back to the browser that resumes it. */
export async function unsealSession(sealed: string): Promise<string> {
  const env = readDriveEnv();
  if (env.mode === "off") throw new DriveUnavailableError();
  return decryptToken(sealed, env.tokenKey);
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
