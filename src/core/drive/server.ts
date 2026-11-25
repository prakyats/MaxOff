import "server-only";

import { createServiceSupabase, type ServiceSupabase } from "@/core/db/service";
import type { Clock } from "@/core/time";

import { type CachedFolder, type FolderStore } from "./ensure";
import { readDriveEnv } from "./env";
import type { FolderStep } from "./folders";
import { about, DriveAuthError, type Fetch, refreshAccess } from "./google";
import { filesSeen } from "./resumable";
import { decryptToken, encryptToken } from "./token-crypto";

/**
 * The Worker's side of the connected Drive (v4.0, ADR-0010), service role only: the tokens are
 * read and refreshed here and never leave the server; the Owner's screens read
 * `drive_status()`, which holds no token. A refused grant moves the account to
 * `needs_reconnect` (the Owner is told once by the database) instead of failing every call.
 */

/** An access token is renewed this long before Google says it ends. */
const RENEW_BEFORE_MS = 5 * 60_000;

export type DriveConnection = {
  orgId: string;
  accountId: string;
  accessToken: string;
  rootFolderId: string | null;
};

export type AccountRow = {
  org_id: string;
  google_sub: string;
  refresh_token_encrypted: string | null;
  access_token_encrypted: string | null;
  token_expires_at: string | null;
  root_folder_id: string | null;
};

const ACCOUNT_COLUMNS =
  "org_id, google_sub, refresh_token_encrypted, access_token_encrypted, token_expires_at, root_folder_id";

/** The error the database keeps for the Owner: short, and never a token. */
function errorWords(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 300);
}

/** The words kept for the Owner when the sealing key changed and the stored grant is unreadable. */
const KEY_CHANGED =
  "MaxOff's Drive key changed on this server, so the stored access can't be read. Reconnect.";

/**
 * A usable access token for one connected account: the stored one while it is fresh (unless
 * `forceRefresh`), otherwise a refresh (stored again, sealed). `null` when Drive is not set up
 * here or the account is not connected. A refused refresh, or a stored grant this server can no
 * longer open (`DRIVE_TOKEN_KEY` changed), marks the account `needs_reconnect` and returns `null`.
 * Every write names the sealed refresh token this read saw, so nothing lands on a connection the
 * Owner has replaced in the meantime (review S4).
 */
export async function connectionFor(input: {
  service: ServiceSupabase;
  row: AccountRow;
  fetchImpl: Fetch;
  now: Date;
  forceRefresh?: boolean;
}): Promise<DriveConnection | null> {
  const env = readDriveEnv();
  const sealedRefresh = input.row.refresh_token_encrypted;
  if (env.mode === "off" || !sealedRefresh) return null;
  const base = {
    orgId: input.row.org_id,
    accountId: input.row.google_sub,
    rootFolderId: input.row.root_folder_id,
  };

  const expiresAt = input.row.token_expires_at ? Date.parse(input.row.token_expires_at) : 0;
  const fresh = expiresAt - RENEW_BEFORE_MS > input.now.getTime();
  if (!input.forceRefresh && input.row.access_token_encrypted && fresh) {
    try {
      const accessToken = await decryptToken(input.row.access_token_encrypted, env.tokenKey);
      return { ...base, accessToken };
    } catch {
      // Sealed under another key: fall through to the refresh, which says so if it fails too.
    }
  }

  let refreshToken: string;
  try {
    refreshToken = await decryptToken(sealedRefresh, env.tokenKey);
  } catch {
    await markNeedsReconnect(input.service, input.row, KEY_CHANGED);
    return null;
  }
  try {
    const grant = await refreshAccess(
      input.fetchImpl,
      { refreshToken, clientId: env.clientId, clientSecret: env.clientSecret },
      input.now,
    );
    const { error } = await input.service.rpc("drive_store_access_token", {
      p_org: input.row.org_id,
      p_read_refresh_enc: sealedRefresh,
      p_access_enc: await encryptToken(grant.accessToken, env.tokenKey),
      p_expires_at: grant.expiresAt.toISOString(),
    });
    if (error) throw new Error(`drive_store_access_token: ${error.message}`);
    return { ...base, accessToken: grant.accessToken };
  } catch (error) {
    if (!(error instanceof DriveAuthError)) throw error;
    await markNeedsReconnect(input.service, input.row, errorWords(error));
    return null;
  }
}

async function markNeedsReconnect(service: ServiceSupabase, row: AccountRow, words: string) {
  const { error } = await service.rpc("drive_mark_needs_reconnect", {
    p_org: row.org_id,
    p_read_refresh_enc: row.refresh_token_encrypted ?? "",
    p_error: words,
  });
  if (error) throw new Error(`drive_mark_needs_reconnect: ${error.message}`);
}

/**
 * Runs one Drive call with the account's access token. Google may drop an access token before
 * its expiry: a 401 on a stored token is answered with one forced refresh and a retry, and only
 * a refused refresh means "reconnect" (review S2). `null` when there is no usable connection.
 */
export async function withDrive<T>(
  input: { service: ServiceSupabase; row: AccountRow; fetchImpl: Fetch; now: Date },
  call: (connection: DriveConnection) => Promise<T>,
): Promise<T | null> {
  const connection = await connectionFor(input);
  if (!connection) return null;
  try {
    return await call(connection);
  } catch (error) {
    if (!(error instanceof DriveAuthError)) throw error;
    const renewed = await connectionFor({ ...input, forceRefresh: true });
    if (!renewed) return null;
    try {
      return await call(renewed);
    } catch (again) {
      if (!(again instanceof DriveAuthError)) throw again;
      await markNeedsReconnect(input.service, input.row, errorWords(again));
      return null;
    }
  }
}

export type SpaceCheckReport = {
  checked: number;
  alerts: number;
  needsReconnect: number;
  failed: { orgId: string; error: string }[];
  /** v4.5 "Removed in Drive": received upload-link files checked, found gone, found back. */
  uploads: { checked: number; removed: number; restored: number };
};

/**
 * One organisation's quota, read again now (v4.5 C8, WORKFLOWS §5B.6: the upload space guard's
 * reading is refreshed when older than 5 minutes). The same read and record as the daily check;
 * no usable connection, or an account with no limit, changes nothing.
 */
export async function refreshDriveQuota(input: {
  service: ServiceSupabase;
  orgId: string;
  fetchImpl: Fetch;
  now: Date;
}): Promise<void> {
  if (readDriveEnv().mode === "off") return;
  const { data: row, error } = await input.service
    .from("drive_account")
    .select(ACCOUNT_COLUMNS)
    .eq("org_id", input.orgId)
    .eq("state", "connected")
    .maybeSingle();
  if (error) throw new Error(`drive_account: ${error.message}`);
  if (!row) return;
  const space = await withDrive({ ...input, row }, (connection) =>
    about(input.fetchImpl, connection.accessToken),
  );
  if (!space || space.totalBytes === null) return;
  const { error: dbError } = await input.service.rpc("drive_record_quota", {
    p_org: row.org_id,
    p_read_refresh_enc: row.refresh_token_encrypted ?? "",
    p_total: space.totalBytes,
    p_used: space.usedBytes,
  });
  if (dbError) throw new Error(`drive_record_quota: ${dbError.message}`);
}

/**
 * `drive_space_check` (WORKFLOWS §8, daily): reads each connected account's used and total
 * space and stores it; the database tells the Owner once at 80 % and once at 90 %. An account
 * with no limit is read but not stored (nothing to alert on). Nothing to do without the Google
 * settings. A failure on one account is reported and leaves the others alone.
 */
export async function runDriveSpaceCheck(input: {
  service: ServiceSupabase;
  fetchImpl: Fetch;
  now: Date;
}): Promise<SpaceCheckReport> {
  const report: SpaceCheckReport = {
    checked: 0,
    alerts: 0,
    needsReconnect: 0,
    failed: [],
    uploads: { checked: 0, removed: 0, restored: 0 },
  };
  if (readDriveEnv().mode === "off") return report;

  const { data, error } = await input.service
    .from("drive_account")
    .select(ACCOUNT_COLUMNS)
    .eq("state", "connected");
  if (error) throw new Error(`drive_account: ${error.message}`);

  for (const row of data ?? []) {
    try {
      const space = await withDrive({ ...input, row }, (connection) =>
        about(input.fetchImpl, connection.accessToken),
      );
      if (!space) {
        report.needsReconnect += 1;
        continue;
      }
      report.checked += 1;
      if (space.totalBytes === null) continue;
      const { data: level, error: dbError } = await input.service.rpc("drive_record_quota", {
        p_org: row.org_id,
        p_read_refresh_enc: row.refresh_token_encrypted ?? "",
        p_total: space.totalBytes,
        p_used: space.usedBytes,
      });
      if (dbError) throw new Error(`drive_record_quota: ${dbError.message}`);
      if (level && level > 0) report.alerts += 1;
    } catch (error) {
      report.failed.push({ orgId: row.org_id, error: errorWords(error) });
    }
  }

  try {
    report.uploads = await checkUploadedFilesInDrive({ ...input, rows: data ?? [] });
  } catch (error) {
    report.failed.push({ orgId: "uploads", error: errorWords(error) });
  }
  return report;
}

/** Files claimed per call of `upload_drive_check_daily`, and calls per run (5,000 files a day). */
const DRIVE_CHECK_BATCH = 200;
const DRIVE_CHECK_BATCHES = 25;

/**
 * The daily "Removed in Drive" pass (v4.5, Q7; WORKFLOWS §8 `drive_space_check`): the received
 * files of upload links active in the last 30 days, and the files found removed in the last 30
 * days (a file restored from the bin comes back), each read from Drive by metadata only
 * (`files.get`, `id,trashed`), on its organisation's connected account. `upload_drive_check_daily`
 * stamps what it hands out, so a file that could not be read waits for the next day; only a 404
 * or the bin marks a file, and nobody is notified (DATA-MODEL §8a). MaxOff never deletes, moves
 * or trashes a file.
 */
async function checkUploadedFilesInDrive(input: {
  service: ServiceSupabase;
  fetchImpl: Fetch;
  now: Date;
  rows: readonly AccountRow[];
}): Promise<SpaceCheckReport["uploads"]> {
  const tally = { checked: 0, removed: 0, restored: 0 };
  const accounts = new Map(input.rows.map((row) => [row.org_id, row]));
  for (let batch = 0; batch < DRIVE_CHECK_BATCHES; batch += 1) {
    const { data: due, error } = await input.service.rpc("upload_drive_check_daily", {
      p_now: input.now.toISOString(),
      p_limit: DRIVE_CHECK_BATCH,
    });
    if (error) throw new Error(`upload_drive_check_daily: ${error.message}`);
    if (!due || due.length === 0) break;

    const { data: owners, error: ownersError } = await input.service
      .from("upload_files")
      .select("id, org_id")
      .in(
        "id",
        due.map((file) => file.file_id),
      );
    if (ownersError) throw new Error(`upload_files: ${ownersError.message}`);
    const orgOf = new Map((owners ?? []).map((file) => [file.id, file.org_id]));

    const byOrg = new Map<string, typeof due>();
    for (const file of due) {
      const orgId = orgOf.get(file.file_id);
      if (orgId) byOrg.set(orgId, [...(byOrg.get(orgId) ?? []), file]);
    }
    for (const [orgId, files] of byOrg) {
      const row = accounts.get(orgId);
      if (!row) continue;
      const seen = await withDrive({ ...input, row }, (connection) =>
        filesSeen(
          input.fetchImpl,
          connection.accessToken,
          files.map((file) => file.drive_file_id),
        ),
      );
      if (!seen) continue;
      for (const file of files) {
        const outcome = seen.get(file.drive_file_id);
        if (!outcome) continue;
        tally.checked += 1;
        const { data: state, error: seenError } = await input.service.rpc("upload_drive_seen", {
          p_file_id: file.file_id,
          p_outcome: outcome,
          p_at: input.now.toISOString(),
        });
        if (seenError) throw new Error(`upload_drive_seen: ${seenError.message}`);
        if (file.state === "done" && state === "missing_in_drive") tally.removed += 1;
        if (file.state === "missing_in_drive" && state === "done") tally.restored += 1;
      }
    }
    if (due.length < DRIVE_CHECK_BATCH) break;
  }
  return tally;
}

export function driveSpaceCheckJob(clock: Clock): Promise<SpaceCheckReport> {
  return runDriveSpaceCheck({ service: createServiceSupabase(), fetchImpl: fetch, now: clock() });
}

/** The folder cache (`drive_folders`) for one organisation, through its service-role functions. */
export function folderStore(service: ServiceSupabase, orgId: string): FolderStore {
  const key = (step: FolderStep, accountId: string) => ({
    p_org: orgId,
    p_account_sub: accountId,
    p_kind: step.kind,
    // The generated types mark a function's arguments not-null; null is "not keyed by this".
    p_client: step.clientId as string,
    p_month: step.month as string,
    p_task: step.taskId as string,
  });
  const toCached = (
    row: { id: string | null; drive_folder_id: string | null; name: string | null } | null,
  ) =>
    row?.id && row.drive_folder_id && row.name
      ? { id: row.id, driveFolderId: row.drive_folder_id, name: row.name }
      : null;

  return {
    async find(step, accountId) {
      const { data, error } = await service.rpc("drive_folder_find", key(step, accountId));
      if (error) throw new Error(`drive_folder_find: ${error.message}`);
      return toCached(data);
    },
    async put(step, accountId, parent: CachedFolder | null, driveFolderId) {
      const { data, error } = await service.rpc("drive_folder_put", {
        ...key(step, accountId),
        p_parent: (parent?.id ?? null) as string,
        p_drive_folder_id: driveFolderId,
        p_name: step.name,
      });
      if (error) throw new Error(`drive_folder_put: ${error.message}`);
      const cached = toCached(data);
      if (!cached) throw new Error("drive_folder_put returned no folder");
      return cached;
    },
    async replace(folder, driveFolderId) {
      const { data, error } = await service.rpc("drive_folder_replace", {
        p_org: orgId,
        p_id: folder.id,
        p_drive_folder_id: driveFolderId,
      });
      if (error) throw new Error(`drive_folder_replace: ${error.message}`);
      const cached = toCached(data);
      if (!cached) throw new Error("drive_folder_replace returned no folder");
      return cached;
    },
    async rename(folder, name) {
      const { data, error } = await service.rpc("drive_folder_rename", {
        p_org: orgId,
        p_id: folder.id,
        p_name: name,
      });
      if (error) throw new Error(`drive_folder_rename: ${error.message}`);
      const cached = toCached(data);
      if (!cached) throw new Error("drive_folder_rename returned no folder");
      return cached;
    },
  };
}
