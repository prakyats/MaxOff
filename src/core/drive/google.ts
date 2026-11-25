/**
 * The few Google calls v4.0 makes (ADR-0010), over `fetch`, with the narrow `drive.file` scope
 * only: MaxOff sees and manages the files and folders it created, nothing else in the account.
 * `about.get` gives the account's address, its stable id (`permissionId`) and the storage quota
 * under that scope, so no other Google scope is asked for. Every call takes its `fetch`, so the
 * tests run against a fake Drive.
 */
import { googleOrigins } from "./endpoints";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenUrl = () => `${googleOrigins().oauth}/token`;
const driveApi = () => `${googleOrigins().api}/drive/v3`;
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type Fetch = typeof fetch;

/** Google refused the stored grant (revoked, expired, password changed): the Owner reconnects. */
export class DriveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveAuthError";
  }
}

/** Any other refusal from Google, with its HTTP status. */
export class DriveApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DriveApiError";
  }
}

export function consentUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: DRIVE_FILE_SCOPE,
    // A refresh token on every connect, also on a reconnect of the same account; the account
    // chooser every time, so "Use another account" can switch.
    access_type: "offline",
    prompt: "select_account consent",
    include_granted_scopes: "false",
    state: input.state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type Grant = {
  accessToken: string;
  /** Present on a connect (`prompt=consent`); a refresh keeps the stored one. */
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
};

type TokenAnswer = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenCall(
  fetchImpl: Fetch,
  body: Record<string, string>,
  now: Date,
): Promise<Grant> {
  const response = await fetchImpl(tokenUrl(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const answer = (await response.json().catch(() => ({}))) as TokenAnswer;
  if (!response.ok || !answer.access_token) {
    // Only a refused grant is the Owner's to fix (Reconnect). A wrong client id or secret
    // (`invalid_client`), a redirect mismatch or an outage is ours: reported, never "reconnect".
    if (answer.error === "invalid_grant") {
      throw new DriveAuthError(
        answer.error_description ?? answer.error ?? "Google refused the grant",
      );
    }
    throw new DriveApiError(answer.error ?? "Google token call failed", response.status);
  }
  return {
    accessToken: answer.access_token,
    refreshToken: answer.refresh_token ?? null,
    expiresAt: new Date(now.getTime() + (answer.expires_in ?? 3600) * 1000),
    scopes: (answer.scope ?? "").split(" ").filter(Boolean),
  };
}

export function exchangeCode(
  fetchImpl: Fetch,
  input: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  now: Date,
): Promise<Grant> {
  return tokenCall(
    fetchImpl,
    {
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    },
    now,
  );
}

export function refreshAccess(
  fetchImpl: Fetch,
  input: { refreshToken: string; clientId: string; clientSecret: string },
  now: Date,
): Promise<Grant> {
  return tokenCall(
    fetchImpl,
    {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    now,
  );
}

async function driveCall<T>(
  fetchImpl: Fetch,
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(`${driveApi()}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401) throw new DriveAuthError("Google refused the access token");
  const answer = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new DriveApiError(
      answer.error?.message ?? `Drive call failed (${response.status})`,
      response.status,
    );
  }
  return answer;
}

export type DriveAbout = {
  email: string;
  /** Stable for the account: what tells one connected account from another. */
  accountId: string;
  /** Null when the account has no limit (Google answers without one). */
  totalBytes: number | null;
  usedBytes: number;
};

export async function about(fetchImpl: Fetch, accessToken: string): Promise<DriveAbout> {
  const answer = await driveCall<{
    user?: { emailAddress?: string; permissionId?: string };
    storageQuota?: { limit?: string; usage?: string };
  }>(
    fetchImpl,
    accessToken,
    "/about?fields=user(emailAddress,permissionId),storageQuota(limit,usage)",
  );
  if (!answer.user?.emailAddress || !answer.user.permissionId) {
    throw new DriveApiError("Google did not say which account this is", 502);
  }
  return {
    email: answer.user.emailAddress,
    accountId: answer.user.permissionId,
    totalBytes: answer.storageQuota?.limit ? Number(answer.storageQuota.limit) : null,
    usedBytes: Number(answer.storageQuota?.usage ?? 0),
  };
}

export async function createFolder(
  fetchImpl: Fetch,
  accessToken: string,
  input: { name: string; parentId: string | null; description?: string },
): Promise<{ id: string }> {
  const answer = await driveCall<{ id?: string }>(fetchImpl, accessToken, "/files?fields=id", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      mimeType: FOLDER_MIME,
      ...(input.parentId ? { parents: [input.parentId] } : {}),
      ...(input.description ? { description: input.description } : {}),
    }),
  });
  if (!answer.id) throw new DriveApiError("Google made no folder", 502);
  return { id: answer.id };
}

export async function renameFolder(
  fetchImpl: Fetch,
  accessToken: string,
  input: { folderId: string; name: string },
): Promise<void> {
  await driveCall(
    fetchImpl,
    accessToken,
    `/files/${encodeURIComponent(input.folderId)}?fields=id`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: input.name }),
    },
  );
}

/**
 * Is a folder MaxOff made still usable: there, and not in the bin? Under `drive.file` Google
 * answers 404 for a file that is gone (or that MaxOff no longer may see).
 */
export async function folderUsable(
  fetchImpl: Fetch,
  accessToken: string,
  folderId: string,
): Promise<boolean> {
  try {
    const answer = await driveCall<{ trashed?: boolean }>(
      fetchImpl,
      accessToken,
      `/files/${encodeURIComponent(folderId)}?fields=id,trashed`,
    );
    return answer.trashed !== true;
  } catch (error) {
    if (error instanceof DriveApiError && error.status === 404) return false;
    throw error;
  }
}
