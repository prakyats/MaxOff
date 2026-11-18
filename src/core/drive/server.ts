import "server-only";

import { createServiceSupabase, type ServiceSupabase } from "@/core/db/service";
import type { Clock } from "@/core/time";

import { type CachedFolder, type FolderStore } from "./ensure";
import { readDriveEnv } from "./env";
import type { FolderStep } from "./folders";
import { about, DriveAuthError, type Fetch, refreshAccess } from "./google";
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

type AccountRow = {
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

/**
 * A usable access token for one connected account: the stored one while it is fresh, otherwise
 * a refresh (stored again, sealed). `null` when Drive is not set up here or the account is not
 * connected; a refused refresh marks the account `needs_reconnect` and returns `null`.
 */
export async function connectionFor(input: {
  service: ServiceSupabase;
  row: AccountRow;
  fetchImpl: Fetch;
  now: Date;
}): Promise<DriveConnection | null> {
  const env = readDriveEnv();
  if (env.mode === "off" || !input.row.refresh_token_encrypted) return null;
  const base = {
    orgId: input.row.org_id,
    accountId: input.row.google_sub,
    rootFolderId: input.row.root_folder_id,
  };

  const expiresAt = input.row.token_expires_at ? Date.parse(input.row.token_expires_at) : 0;
  if (input.row.access_token_encrypted && expiresAt - RENEW_BEFORE_MS > input.now.getTime()) {
    const accessToken = await decryptToken(input.row.access_token_encrypted, env.tokenKey);
    return { ...base, accessToken };
  }

  try {
    const refreshToken = await decryptToken(input.row.refresh_token_encrypted, env.tokenKey);
    const grant = await refreshAccess(
      input.fetchImpl,
      { refreshToken, clientId: env.clientId, clientSecret: env.clientSecret },
      input.now,
    );
    const { error } = await input.service.rpc("drive_store_access_token", {
      p_org: input.row.org_id,
      p_access_enc: await encryptToken(grant.accessToken, env.tokenKey),
      p_expires_at: grant.expiresAt.toISOString(),
    });
    if (error) throw new Error(`drive_store_access_token: ${error.message}`);
    return { ...base, accessToken: grant.accessToken };
  } catch (error) {
    if (!(error instanceof DriveAuthError)) throw error;
    await markNeedsReconnect(input.service, input.row.org_id, error);
    return null;
  }
}

async function markNeedsReconnect(service: ServiceSupabase, orgId: string, error: unknown) {
  const { error: dbError } = await service.rpc("drive_mark_needs_reconnect", {
    p_org: orgId,
    p_error: errorWords(error),
  });
  if (dbError) throw new Error(`drive_mark_needs_reconnect: ${dbError.message}`);
}

export type SpaceCheckReport = {
  checked: number;
  alerts: number;
  needsReconnect: number;
  failed: { orgId: string; error: string }[];
};

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
  const report: SpaceCheckReport = { checked: 0, alerts: 0, needsReconnect: 0, failed: [] };
  if (readDriveEnv().mode === "off") return report;

  const { data, error } = await input.service
    .from("drive_account")
    .select(ACCOUNT_COLUMNS)
    .eq("state", "connected");
  if (error) throw new Error(`drive_account: ${error.message}`);

  for (const row of data ?? []) {
    try {
      const connection = await connectionFor({ ...input, row });
      if (!connection) {
        report.needsReconnect += 1;
        continue;
      }
      const space = await about(input.fetchImpl, connection.accessToken);
      report.checked += 1;
      if (space.totalBytes === null) continue;
      const { data: level, error: dbError } = await input.service.rpc("drive_record_quota", {
        p_org: row.org_id,
        p_total: space.totalBytes,
        p_used: space.usedBytes,
      });
      if (dbError) throw new Error(`drive_record_quota: ${dbError.message}`);
      if (level && level > 0) report.alerts += 1;
    } catch (error) {
      if (error instanceof DriveAuthError) {
        await markNeedsReconnect(input.service, row.org_id, error);
        report.needsReconnect += 1;
        continue;
      }
      report.failed.push({ orgId: row.org_id, error: errorWords(error) });
    }
  }
  return report;
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
