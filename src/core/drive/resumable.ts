/**
 * Google resumable upload sessions into a Drive folder (shared: v4.5 upload links, v5.0 hand-ins;
 * ADR-0010 amendment 2026-11-19). The Worker opens a session on the connected account (`drive.file`)
 * for one file into one folder, under the caller's policy, and hands **only the session address**
 * to the browser. The browser then sends the bytes straight to Google (`core/upload`), so they
 * never pass through MaxOff and the browser never holds a Drive credential. The session address is
 * itself a credential for that one file: keep it out of logs and history, store it sealed.
 *
 * What lives here is Google's protocol only. Who may upload where, and what a file must be, is the
 * caller's: a module passes an `UploadPolicy` and the folder id it has already authorised.
 */
import { folderName } from "./folders";
import { DriveApiError, DriveAuthError, type Fetch } from "./google";

const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
/** What Google answers about the finished file: enough to verify it and to link to it. */
const FILE_FIELDS = "id,name,size,md5Checksum,mimeType,parents";

/** The caller's rules for one session. Checked here, before Google is asked. */
export type UploadPolicy = {
  /** Largest file accepted, in bytes; none = Google's own limit. */
  maxBytes?: number;
  /** MIME types accepted (exact, or a `type/*` family); none = any. */
  allowedTypes?: readonly string[];
};

export type ResumableTarget = {
  /** The Drive folder the file goes into (already authorised by the caller). */
  folderId: string;
  /** The file's name in Drive, as the caller decided it (cleaned by the caller). */
  name: string;
  /** The file's size in bytes, as the browser reported it. */
  size: number;
  /** MIME type as the browser reported it; "" becomes application/octet-stream. */
  mimeType: string;
  /** Shown in Drive's details pane, e.g. "Sent by Sam through MaxOff for Brand reel". */
  description?: string;
};

export type PolicyRefusal = "too_big" | "type_not_allowed" | "empty" | "bad_name";

export class UploadPolicyError extends Error {
  constructor(readonly reason: PolicyRefusal) {
    super(`Upload refused: ${reason}`);
    this.name = "UploadPolicyError";
  }
}

/** The finished file, as Google reports it. */
export type DriveFileInfo = {
  id: string;
  name: string;
  size: number;
  md5Checksum: string | null;
  mimeType: string;
};

/** Where a session stands: bytes Google holds so far, or the finished file. */
export type SessionStatus =
  | { state: "incomplete"; received: number }
  | { state: "complete"; file: DriveFileInfo }
  | { state: "gone" };

function typeAllowed(mime: string, allowed: readonly string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.some((rule) =>
    rule.endsWith("/*") ? mime.startsWith(rule.slice(0, -1)) : mime === rule,
  );
}

/** The policy check alone, for a caller that wants to refuse before anything else. */
export function checkPolicy(target: ResumableTarget, policy: UploadPolicy): PolicyRefusal | null {
  if (!target.name || target.name.length > 255 || /[\u0000-\u001f]/.test(target.name)) {
    return "bad_name";
  }
  if (!Number.isSafeInteger(target.size) || target.size <= 0) return "empty";
  if (policy.maxBytes !== undefined && target.size > policy.maxBytes) return "too_big";
  if (!typeAllowed(target.mimeType || "application/octet-stream", policy.allowedTypes)) {
    return "type_not_allowed";
  }
  return null;
}

/**
 * Opens a session for one file. `origin` is the page's origin (the app's own): Google ties the
 * session's CORS answers to it, so the browser on that origin may PUT the bytes. Returns the
 * session address, to hand to that browser only.
 */
export async function openResumableSession(
  fetchImpl: Fetch,
  accessToken: string,
  input: { target: ResumableTarget; policy: UploadPolicy; origin: string },
): Promise<{ sessionUrl: string }> {
  const refusal = checkPolicy(input.target, input.policy);
  if (refusal) throw new UploadPolicyError(refusal);
  const mime = input.target.mimeType || "application/octet-stream";
  const response = await fetchImpl(
    `${UPLOAD_URL}?uploadType=resumable&supportsAllDrives=false&fields=${FILE_FIELDS}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": mime,
        "x-upload-content-length": String(input.target.size),
        origin: input.origin,
      },
      body: JSON.stringify({
        name: input.target.name,
        parents: [input.target.folderId],
        ...(input.target.description ? { description: input.target.description } : {}),
      }),
    },
  );
  if (response.status === 401) throw new DriveAuthError("Google refused the access token");
  if (!response.ok) {
    const answer = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new DriveApiError(
      answer.error?.message ?? `Opening an upload failed (${response.status})`,
      response.status,
    );
  }
  const sessionUrl = response.headers.get("location");
  if (!sessionUrl?.startsWith(UPLOAD_URL)) {
    throw new DriveApiError("Google gave no upload address", response.status);
  }
  return { sessionUrl };
}

function toFileInfo(answer: Record<string, unknown>): DriveFileInfo {
  return {
    id: String(answer.id ?? ""),
    name: String(answer.name ?? ""),
    size: Number(answer.size ?? 0),
    md5Checksum: typeof answer.md5Checksum === "string" ? answer.md5Checksum : null,
    mimeType: String(answer.mimeType ?? ""),
  };
}

/**
 * Asks Google where a session stands (an empty PUT with `Content-Range: bytes * /<size>`), from
 * the server: to verify a file the browser says is done, or to tell a stalled one from a finished
 * one. A session Google no longer knows (404, 410) is `gone`: the caller opens a new one.
 */
export async function sessionStatus(
  fetchImpl: Fetch,
  input: { sessionUrl: string; size: number },
): Promise<SessionStatus> {
  const response = await fetchImpl(input.sessionUrl, {
    method: "PUT",
    headers: { "content-range": `bytes */${input.size}` },
  });
  if (response.status === 308) {
    const range = response.headers.get("range");
    const match = range ? /bytes=0-(\d+)/.exec(range) : null;
    return { state: "incomplete", received: match ? Number(match[1]) + 1 : 0 };
  }
  if (response.status === 200 || response.status === 201) {
    return {
      state: "complete",
      file: toFileInfo((await response.json()) as Record<string, unknown>),
    };
  }
  if (response.status === 404 || response.status === 410) return { state: "gone" };
  throw new DriveApiError(`Upload status failed (${response.status})`, response.status);
}

/** What Drive says of a file MaxOff made (v4.5 "Removed in Drive", Q7): there, gone, or in the bin. */
export type FileSeen = "present" | "not_found" | "trashed";

/**
 * Drive's own metadata for a file MaxOff made (`files.get`, fields `id,trashed`; `drive.file`
 * sees it): never the bytes. A 404 is `not_found`; any other refusal throws, so a passing outage
 * is never read as "removed" (DATA-MODEL §8a).
 */
export async function fileSeen(
  fetchImpl: Fetch,
  accessToken: string,
  fileId: string,
): Promise<FileSeen> {
  const response = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 404) return "not_found";
  if (response.status === 401) throw new DriveAuthError("Google refused the access token");
  if (!response.ok)
    throw new DriveApiError(`File check failed (${response.status})`, response.status);
  const answer = (await response.json()) as { trashed?: boolean };
  return answer.trashed ? "trashed" : "present";
}

/** Drive's own metadata for a file MaxOff made: whether it is still there and not in the bin. */
export async function fileStillThere(
  fetchImpl: Fetch,
  accessToken: string,
  fileId: string,
): Promise<"there" | "removed"> {
  return (await fileSeen(fetchImpl, accessToken, fileId)) === "present" ? "there" : "removed";
}

/**
 * `fileSeen` for several files on one connection. A file whose check fails for any reason but
 * the token (a 403, 429, 5xx, a timeout) is left out: it is marked nothing and checked again
 * later. A refused token throws, so `withDrive` can renew it and run the batch again.
 */
export async function filesSeen(
  fetchImpl: Fetch,
  accessToken: string,
  fileIds: readonly string[],
): Promise<Map<string, FileSeen>> {
  const seen = new Map<string, FileSeen>();
  for (const fileId of fileIds) {
    try {
      seen.set(fileId, await fileSeen(fetchImpl, accessToken, fileId));
    } catch (error) {
      if (error instanceof DriveAuthError) throw error;
    }
  }
  return seen;
}

/** Google's own record of a file a MaxOff session made (`drive.file` sees it). */
export type FileFacts = {
  id: string;
  sizeBytes: number;
  /** Absent for Google's own document types; a binary upload always has one. Lower case. */
  md5: string | null;
  parents: string[];
  trashed: boolean;
};

/**
 * What Google holds for a file, or null when Google answers 404 (gone, or never made). Any other
 * refusal throws, so a passing outage is never read as "removed". (From v5.0's 4411041.)
 */
export async function fileFacts(
  fetchImpl: Fetch,
  accessToken: string,
  fileId: string,
): Promise<FileFacts | null> {
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
    error?: { message?: string };
  };
  if (!response.ok || !answer.id) {
    throw new DriveApiError(
      answer.error?.message ?? `Drive call failed (${response.status})`,
      response.status,
    );
  }
  return {
    id: answer.id,
    sizeBytes: Number(answer.size ?? 0),
    md5: answer.md5Checksum ? answer.md5Checksum.toLowerCase() : null,
    parents: answer.parents ?? [],
    trashed: answer.trashed === true,
  };
}

/**
 * The check before a finished file is recorded (v4.5 plan F1/F2): Google's answer against what
 * the session was opened for and, when the browser computed one, its MD5.
 */
export function finishedFileProblem(
  facts: FileFacts | null,
  expected: { sizeBytes: number; parentId: string; md5?: string | null },
): "missing" | "size_mismatch" | "wrong_folder" | "checksum_mismatch" | null {
  if (!facts || facts.trashed) return "missing";
  if (facts.sizeBytes !== expected.sizeBytes) return "size_mismatch";
  if (!facts.parents.includes(expected.parentId)) return "wrong_folder";
  if (expected.md5 && facts.md5 && facts.md5 !== expected.md5.toLowerCase()) {
    return "checksum_mismatch";
  }
  return null;
}

/** A store of folders under one parent, keyed by a path ('' = the top folder itself). */
export type SubfolderStore = {
  find(relativePath: string): Promise<string | null>;
  /** Insert or return: the folder that won a race is the one kept. */
  put(relativePath: string, driveFolderId: string): Promise<string>;
};

/**
 * The folder path a browser reported ("Day 1/CAM A"), cleaned: each part a safe folder name
 * (`folderName`), empty, "." and ".." parts dropped, at most 8 levels. Never trusted as given.
 */
export function cleanRelativePath(relativePath: string): string {
  return relativePath
    .split(/[/\\]/)
    .map((part) => part.trim())
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .slice(0, 8)
    .map(folderName)
    .join("/");
}

/**
 * Makes `‹parent›/‹top›/‹a›/‹b›…` for a cleaned relative path, each folder once: the cache
 * first, then Google, recording each before making the next, so a stopped run resumes where it
 * stopped. Returns the Drive id of the deepest folder. (From v5.0's 4411041.)
 */
export async function ensureSubfolders(input: {
  parentDriveId: string;
  top: string;
  relativePath: string;
  store: SubfolderStore;
  make: (folder: { name: string; parentId: string }) => Promise<{ id: string }>;
}): Promise<string> {
  const clean = cleanRelativePath(input.relativePath);
  const parts = clean === "" ? [] : clean.split("/");
  const keys = ["", ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))];
  const names = [folderName(input.top), ...parts];
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
