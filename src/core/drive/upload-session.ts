import "server-only";

import type { ServiceSupabase } from "@/core/db/service";

import { ensureTaskFolder } from "./ensure";
import { readDriveEnv } from "./env";
import { type TaskFolderInput, ROOT_FOLDER } from "./folders";
import { createFolder, type Fetch, renameFolder } from "./google";
import {
  ensureSubfolders,
  type FileFacts,
  fileFacts,
  openResumableSession,
  type SubfolderStore,
} from "./resumable";
import { type AccountRow, folderStore, withDrive } from "./server";
import { decryptToken, encryptToken } from "./token-crypto";

/**
 * The Worker's side of one browser-to-Drive upload (ADR-0010 amendments 2026-11-19 and
 * 2026-11-25), for any feature that files uploads under a task's folder: v5.0's hand-in versions
 * (`‹task›/v‹n›/…`) and, later, v4.5's uploader folders (`‹task›/‹name›/…`). The caller has
 * already passed its own permission and state checks in the database; this makes the folders,
 * opens the session on the connected account, and seals its address for storage. The browser is
 * given the address only, never a token.
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

export type OpenedSession = {
  sessionUri: string;
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
  /** The first folder under the task's ("v2", or an uploader's name). */
  top: string;
  relativePath: string;
  subfolders: SubfolderStore;
  file: { name: string; sizeBytes: number; mimeType: string | null };
  description: string;
  origin: string;
  fetchImpl: Fetch;
  now: Date;
}): Promise<OpenedSession> {
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
      const sessionUri = await openResumableSession(input.fetchImpl, connection.accessToken, {
        name: input.file.name,
        parentId,
        sizeBytes: input.file.sizeBytes,
        mimeType: input.file.mimeType,
        description: input.description,
        origin: input.origin,
      });
      return { sessionUri, parentId, accountId: connection.accountId };
    },
  );
  if (!opened) throw new DriveUnavailableError();
  return { ...opened, sealedSession: await encryptToken(opened.sessionUri, env.tokenKey) };
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
