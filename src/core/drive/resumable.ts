/**
 * The Google half of a browser-to-Drive upload (ADR-0010 amendments 2026-11-19 and 2026-11-25),
 * shared by v4.5's upload link and v5.0's hand-in. The Worker opens a resumable session on the
 * connected account (`drive.file`) with the file's name, parent and size fixed, and hands the
 * browser only the session address; the bytes then go browser → Google, never through MaxOff.
 * When the browser says a file finished, the Worker asks Google itself (`fileFacts`) and checks
 * size and parent before anything is recorded (v4.5 plan F1). Every call takes its `fetch`, so the
 * tests run against a fake Google.
 */
import { DriveApiError, DriveAuthError, type Fetch } from "./google";

const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

export type SessionInput = {
  name: string;
  parentId: string;
  sizeBytes: number;
  /** The browser's claim, or a neutral type: Drive decides what the file is. */
  mimeType: string | null;
  /** Shown in Drive's details: a link back to the task. */
  description: string;
  /**
   * The page's origin. Google lets a browser on this origin use the session address across
   * origins (the v4.5 E0 gate), so it must be the app's own origin, never one the browser sent.
   */
  origin: string;
};

/** Opens a resumable session and returns its address (Google's `Location`). */
export async function openResumableSession(
  fetchImpl: Fetch,
  accessToken: string,
  input: SessionInput,
): Promise<string> {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new RangeError("A file's size is a whole number of bytes.");
  }
  const mime =
    input.mimeType && input.mimeType.length <= 100 ? input.mimeType : "application/octet-stream";
  const response = await fetchImpl(
    `${UPLOAD_API}?uploadType=resumable&fields=id,size,md5Checksum,parents`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": mime,
        "x-upload-content-length": String(input.sizeBytes),
        origin: input.origin,
      },
      body: JSON.stringify({
        name: input.name,
        parents: [input.parentId],
        description: input.description,
      }),
    },
  );
  if (response.status === 401) throw new DriveAuthError("Google refused the access token");
  if (!response.ok) {
    const answer = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new DriveApiError(
      answer.error?.message ?? `Google opened no upload (${response.status})`,
      response.status,
    );
  }
  const location = response.headers.get("location");
  if (!location || !location.startsWith(`${UPLOAD_API}?`)) {
    throw new DriveApiError("Google gave no upload address", 502);
  }
  return location;
}

export type FileFacts = {
  id: string;
  sizeBytes: number;
  /** Absent for Google's own document types; a binary upload always has one. */
  md5: string | null;
  parents: string[];
  trashed: boolean;
};

/**
 * What Google holds for a file MaxOff's session made (`drive.file` sees it), or null when
 * Google answers 404 (gone, or never made). Any other refusal throws, so a passing outage is
 * never read as "removed".
 */
export async function fileFacts(
  fetchImpl: Fetch,
  accessToken: string,
  fileId: string,
): Promise<FileFacts | null> {
  const response = await fetchImpl(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,size,md5Checksum,parents,trashed`,
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

/** What a session says when asked how far it got (`Content-Range: bytes *\/size`). */
export type SessionState =
  { kind: "partial"; bytes: number } | { kind: "complete"; fileId: string } | { kind: "gone" };

/**
 * Asks a session how many bytes Google holds. The Worker uses it to watch a file whose browser
 * went quiet (v4.5 §5B.4 "stuck"); the browser asks the same way to resume.
 */
export async function sessionState(
  fetchImpl: Fetch,
  sessionUri: string,
  sizeBytes: number,
): Promise<SessionState> {
  const response = await fetchImpl(sessionUri, {
    method: "PUT",
    headers: { "content-range": `bytes */${sizeBytes}` },
  });
  if (response.status === 308)
    return { kind: "partial", bytes: bytesFromRange(response.headers.get("range")) };
  if (response.status === 200 || response.status === 201) {
    const answer = (await response.json().catch(() => ({}))) as { id?: string };
    if (answer.id) return { kind: "complete", fileId: answer.id };
    throw new DriveApiError("Google finished the upload but named no file", 502);
  }
  if (response.status === 404 || response.status === 410) return { kind: "gone" };
  throw new DriveApiError(`Google answered ${response.status} about an upload`, response.status);
}

/** `Range: bytes=0-1048575` → 1048576 (the next byte to send); no header → 0. */
export function bytesFromRange(range: string | null): number {
  const match = range ? /^bytes=0-(\d+)$/.exec(range.trim()) : null;
  return match ? Number(match[1]) + 1 : 0;
}

/** The check before a finished file is recorded (v4.5 F1): Google's answer against what was set. */
export function finishedFileProblem(
  facts: FileFacts | null,
  expected: { sizeBytes: number; parentId: string },
): "missing" | "size_mismatch" | "wrong_folder" | null {
  if (!facts || facts.trashed) return "missing";
  if (facts.sizeBytes !== expected.sizeBytes) return "size_mismatch";
  if (!facts.parents.includes(expected.parentId)) return "wrong_folder";
  return null;
}

/** A store of folders under one parent, keyed by a path ('' = the parent's own child folder). */
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
