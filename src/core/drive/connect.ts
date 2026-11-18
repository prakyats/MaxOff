import "server-only";

import { cookies, headers } from "next/headers";

import { getCurrentMember } from "@/core/auth/server";
import { createServerSupabase } from "@/core/db/server";
import { createServiceSupabase } from "@/core/db/service";
import { resolveAppOrigin } from "@/core/lib/app-url";
import { captureException } from "@/core/observability/capture";
import { can } from "@/core/permissions/can";
import { systemClock } from "@/core/time";

import { readDriveEnv } from "./env";
import { ROOT_FOLDER } from "./folders";
import {
  about,
  consentUrl,
  createFolder,
  DRIVE_FILE_SCOPE,
  DriveAuthError,
  exchangeCode,
  type Fetch,
  folderUsable,
} from "./google";
import { folderStore } from "./server";
import { decryptToken, encryptToken } from "./token-crypto";

/**
 * The Owner's Google sign-in for Drive (v4.0, ADR-0010): start → Google's consent screen →
 * callback. The `state` is random, kept in a short-lived httpOnly cookie on `/api/drive` and
 * tied to the member who started, so a callback from another person or another tab's start is
 * refused. Only `drive.file` is asked for. The tokens are sealed before they reach the
 * database, and the account's address is stored there only (never logged, never in the repo).
 */

export const DRIVE_CALLBACK_PATH = "/api/drive/callback";
export const DRIVE_SETTINGS_PATH = "/settings/drive";
const STATE_COOKIE = "maxoff_drive_state";
const STATE_MAX_AGE_SECONDS = 600;

/** What the settings screen says after the round trip (`?drive=`). */
export type ConnectOutcome =
  | "connected"
  | "reconnected"
  | "account_switched"
  | "cancelled"
  | "expired"
  | "no_access"
  | "failed"
  | "off";

export function settingsUrl(outcome: ConnectOutcome): string {
  return `${DRIVE_SETTINGS_PATH}?drive=${outcome}`;
}

async function redirectUri(): Promise<string> {
  const head = await headers();
  const origin = resolveAppOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    head.get("host"),
    head.get("x-forwarded-proto"),
    process.env.NEXT_PUBLIC_APP_ENV,
  );
  return `${origin}${DRIVE_CALLBACK_PATH}`;
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Secure on staging, production and any https origin (a preview); plain http only on a laptop. */
async function secureCookies(): Promise<boolean> {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  if (appEnv === "staging" || appEnv === "production") return true;
  return (await redirectUri()).startsWith("https://");
}

/** Where the start route sends the Owner: Google's consent screen, or back with why not. */
export async function startDriveConnect(): Promise<string> {
  const member = await getCurrentMember();
  if (!member) return "/login";
  if (!can(member.role, "drive.manage")) return "/forbidden?for=drive.manage";
  const env = readDriveEnv();
  if (env.mode === "off") return settingsUrl("off");

  const state = randomState();
  (await cookies()).set(STATE_COOKIE, `${state}.${member.id}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: await secureCookies(),
    path: "/api/drive",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return consentUrl({ clientId: env.clientId, redirectUri: await redirectUri(), state });
}

/** The callback: checks the state, takes the grant, prepares the top folder, stores it all. */
export async function completeDriveConnect(
  params: URLSearchParams,
  fetchImpl: Fetch = fetch,
): Promise<string> {
  const member = await getCurrentMember();
  if (!member) return "/login";
  if (!can(member.role, "drive.manage")) return "/forbidden?for=drive.manage";

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: "/api/drive" });
  const state = params.get("state");
  if (!expected || !state || expected !== `${state}.${member.id}`) return settingsUrl("expired");
  if (params.get("error")) return settingsUrl("cancelled");
  const code = params.get("code");
  if (!code) return settingsUrl("failed");

  const env = readDriveEnv();
  if (env.mode === "off") return settingsUrl("off");

  try {
    const now = systemClock();
    const grant = await exchangeCode(
      fetchImpl,
      {
        code,
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        redirectUri: await redirectUri(),
      },
      now,
    );
    if (!grant.refreshToken || !grant.scopes.includes(DRIVE_FILE_SCOPE)) {
      return settingsUrl("no_access");
    }
    const account = await about(fetchImpl, grant.accessToken);
    const orgId = await orgOf(member.id);
    const rootFolderId = await prepareRoot(orgId, account.accountId, {
      make: (input) => createFolder(fetchImpl, grant.accessToken, input),
      usable: (folderId) => folderUsable(fetchImpl, grant.accessToken, folderId),
    });
    const previous = await storedConnection(orgId);
    const sealedRefresh = await encryptToken(grant.refreshToken, env.tokenKey);

    const supabase = await createServerSupabase();
    const { data: action, error } = await supabase.rpc("drive_connect_complete", {
      p_email: account.email,
      p_sub: account.accountId,
      p_refresh_enc: sealedRefresh,
      p_access_enc: await encryptToken(grant.accessToken, env.tokenKey),
      p_expires_at: grant.expiresAt.toISOString(),
      p_scopes: grant.scopes,
      p_root_folder_id: rootFolderId,
    });
    if (error) throw new Error(`drive_connect_complete: ${error.message}`);
    // Connected from here on: what follows is best effort and never turns the answer into
    // "failed" (review S5).
    if (action === "account_switched" && previous && previous.accountId !== account.accountId) {
      // The old account forgets MaxOff. Never on a reconnect of the same account: revoking
      // that grant would revoke the one just stored.
      await revokeGrant(previous.refreshToken, fetchImpl);
    }
    await recordFirstReading(orgId, sealedRefresh, account.totalBytes, account.usedBytes);
    return settingsUrl(
      action === "reconnected" || action === "account_switched" ? action : "connected",
    );
  } catch (error) {
    if (error instanceof DriveAuthError) return settingsUrl("no_access");
    throw error;
  }
}

async function orgOf(memberId: string): Promise<string> {
  const service = createServiceSupabase();
  const { data, error } = await service
    .from("members")
    .select("org_id")
    .eq("id", memberId)
    .single();
  if (error) throw new Error(`members: ${error.message}`);
  return data.org_id;
}

/**
 * MaxOff's top folder in this account: the one already made for it (a reconnect) while it is
 * still there and not in the bin, otherwise a new "MaxOff" folder in My Drive, which the cached
 * key then points at (review S6). Kept in the folder cache under the account, so switching to
 * another account makes that account its own and never reuses (or deletes) the first's.
 */
async function prepareRoot(
  orgId: string,
  accountId: string,
  drive: {
    make: (input: { name: string; parentId: null; description: string }) => Promise<{ id: string }>;
    usable: (folderId: string) => Promise<boolean>;
  },
): Promise<string> {
  const store = folderStore(createServiceSupabase(), orgId);
  const step = {
    kind: "root",
    name: ROOT_FOLDER,
    clientId: null,
    month: null,
    taskId: null,
  } as const;
  const cached = await store.find(step, accountId);
  if (cached && (await drive.usable(cached.driveFolderId))) return cached.driveFolderId;
  const made = await drive.make({
    name: ROOT_FOLDER,
    parentId: null,
    description: "Made by MaxOff for the studio's client work, by client and month.",
  });
  if (cached) return (await store.replace(cached, made.id)).driveFolderId;
  return (await store.put(step, accountId, null, made.id)).driveFolderId;
}

/** The connection stored before this sign-in: its account and its grant, when still readable. */
async function storedConnection(
  orgId: string,
): Promise<{ accountId: string; refreshToken: string | null } | null> {
  const env = readDriveEnv();
  if (env.mode === "off") return null;
  const { data, error } = await createServiceSupabase()
    .from("drive_account")
    .select("google_sub, refresh_token_encrypted")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`drive_account: ${error.message}`);
  if (!data) return null;
  let refreshToken: string | null = null;
  if (data.refresh_token_encrypted) {
    refreshToken = await decryptToken(data.refresh_token_encrypted, env.tokenKey).catch(() => null);
  }
  return { accountId: data.google_sub, refreshToken };
}

/**
 * The space Google reported at sign-in, so Settings shows it at once (alerts as the daily
 * check). Best effort: the connection is already stored, so a failure here is reported and the
 * Owner still hears "connected"; the morning check fills it in.
 */
async function recordFirstReading(
  orgId: string,
  sealedRefresh: string,
  total: number | null,
  used: number,
) {
  if (total === null || total <= 0) return;
  const { error } = await createServiceSupabase().rpc("drive_record_quota", {
    p_org: orgId,
    p_read_refresh_enc: sealedRefresh,
    p_total: total,
    p_used: used,
  });
  if (error) captureException(new Error(`drive_record_quota at connect: ${error.message}`));
}

/**
 * Disconnect, in two halves around `drive_disconnect()`: the stored grant is read first (the
 * database drops it), and Google is asked to forget it after (best effort: the Owner may already
 * have removed MaxOff in their Google account). Revoking only after the database has
 * disconnected means a failed disconnect never leaves a "connected" account with a dead grant.
 */
export async function storedGrant(memberId: string): Promise<string | null> {
  const env = readDriveEnv();
  if (env.mode === "off") return null;
  const { data, error } = await createServiceSupabase()
    .from("drive_account")
    .select("refresh_token_encrypted")
    .eq("org_id", await orgOf(memberId))
    .maybeSingle();
  if (error) throw new Error(`drive_account: ${error.message}`);
  if (!data?.refresh_token_encrypted) return null;
  try {
    return await decryptToken(data.refresh_token_encrypted, env.tokenKey);
  } catch {
    // Sealed with an older key: nothing to revoke from here; disconnecting still works.
    return null;
  }
}

export async function revokeGrant(token: string | null, fetchImpl: Fetch = fetch) {
  if (!token) return;
  try {
    await fetchImpl("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // Best effort: the database has already disconnected.
  }
}
