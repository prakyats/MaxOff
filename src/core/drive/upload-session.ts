import "server-only";

import type { ServiceSupabase } from "@/core/db/service";

import { ensureTaskFolder } from "./ensure";
import { readDriveEnv } from "./env";
import { ROOT_FOLDER, type TaskFolderInput } from "./folders";
import { createFolder, type Fetch, renameFolder } from "./google";
import {
  fileStillThere,
  openResumableSession,
  type SessionStatus,
  sessionStatus,
  type UploadPolicy,
} from "./resumable";
import { type AccountRow, folderStore, withDrive } from "./server";
import { decryptToken, encryptToken } from "./token-crypto";

/**
 * The Worker's side of one upload filed under a task's folder (ADR-0010 amendments 2026-11-19
 * and 2026-11-25), on top of the shared session protocol (`./resumable`, owned by v4.5). Used by
 * v5.0's hand-in versions (`‹task›/v‹n›/…`). The caller's database function has already said who
 * may upload what; this makes the folders, opens the session on the connected account and seals
 * its address for storage. The browser is given the address only, never a token.
 *
 * Advisor, 25 Nov: kept here until the v4.5 integrator says whether his side covers it; nothing
 * more is added to the shared plumbing from v5.0.
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
  file: { name: string; size: number; mimeType: string };
  policy: UploadPolicy;
  description: string;
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
          description: input.description,
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

/**
 * Where a stored session stands, asked by the Worker itself (v4.5 F1): a file the browser says
 * is done is recorded from Google's own answer, never from the browser's claim.
 */
export async function storedSessionStatus(input: {
  sealedSession: string;
  size: number;
  fetchImpl: Fetch;
}): Promise<SessionStatus> {
  const sessionUrl = await unsealSession(input.sealedSession);
  return sessionStatus(input.fetchImpl, { sessionUrl, size: input.size });
}

/** "Removed in Drive": Drive's metadata for a file MaxOff made (404 or in the bin = removed). */
export async function driveFileThere(input: {
  service: ServiceSupabase;
  orgId: string;
  driveFileId: string;
  fetchImpl: Fetch;
  now: Date;
}): Promise<"there" | "removed"> {
  const row = await connectedAccount(input.service, input.orgId);
  const answer = await withDrive(
    { service: input.service, row, fetchImpl: input.fetchImpl, now: input.now },
    (connection) => fileStillThere(input.fetchImpl, connection.accessToken, input.driveFileId),
  );
  if (!answer) throw new DriveUnavailableError();
  return answer;
}
