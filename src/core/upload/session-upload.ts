/**
 * Sends one file to a Google resumable session the Worker opened (ADR-0010 amendments
 * 2026-11-19 and 2026-11-25), shared by v4.5's upload page and v5.0's hand-in. Chunked, so a
 * lost network costs one chunk at most; resumable, by asking the session how far it got
 * (`Content-Range: bytes *\/size` → 308 with `Range`); and checked, with an MD5 of the bytes as
 * sent when the file went up in one pass from the start. No database, no MaxOff server: the
 * bytes go browser → Google.
 */
import { Md5 } from "./md5";

/** Google wants every chunk but the last to be a multiple of 256 KiB. */
export const CHUNK_UNIT = 256 * 1024;
export const DEFAULT_CHUNK = 32 * CHUNK_UNIT; // 8 MiB
const RETRIES = 6;

export type UploadFetch = (url: string, init: RequestInit) => Promise<Response>;

export type SessionUploadInput = {
  file: Blob;
  sessionUri: string;
  fetchImpl: UploadFetch;
  chunkSize?: number;
  /** Bytes Google holds so far, as the engine learns it. */
  onProgress?: (bytes: number) => void;
  signal?: AbortSignal;
  /** Waits between retries; the tests pass one that does not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** A fresh session has nothing yet, so the first question can be skipped. */
  fresh?: boolean;
};

export type SessionUploadResult = {
  fileId: string;
  /** Null when the file was resumed or Google kept fewer bytes than were hashed. */
  md5: string | null;
};

export class SessionGoneError extends Error {
  constructor() {
    super("Google no longer has this upload; it starts again.");
    this.name = "SessionGoneError";
  }
}

export class UploadAbortedError extends Error {
  constructor() {
    super("The upload was stopped.");
    this.name = "UploadAbortedError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function nextByte(range: string | null): number {
  const match = range ? /^bytes=0-(\d+)$/.exec(range.trim()) : null;
  return match ? Number(match[1]) + 1 : 0;
}

async function finishedId(response: Response): Promise<string> {
  const answer = (await response.json().catch(() => ({}))) as { id?: string };
  if (!answer.id) throw new Error("Google finished the upload but named no file.");
  return answer.id;
}

/** A network failure or a reply worth trying again (Google: 5xx, 429, 408). */
function retryable(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

export async function uploadToSession(input: SessionUploadInput): Promise<SessionUploadResult> {
  const size = input.file.size;
  const chunk = Math.max(
    CHUNK_UNIT,
    Math.floor((input.chunkSize ?? DEFAULT_CHUNK) / CHUNK_UNIT) * CHUNK_UNIT,
  );
  const sleep = input.sleep ?? defaultSleep;
  const md5 = new Md5();
  let hashed = 0;
  let md5Valid = true;

  const guard = () => {
    if (input.signal?.aborted) throw new UploadAbortedError();
  };

  // One request with retries. A thrown fetch (offline) counts like a 5xx.
  async function send(init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      guard();
      try {
        const response = await input.fetchImpl(input.sessionUri, {
          ...init,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        if (!retryable(response.status) || attempt >= RETRIES) return response;
      } catch (error) {
        if (input.signal?.aborted) throw new UploadAbortedError();
        if (attempt >= RETRIES) throw error;
      }
      await sleep(Math.min(30_000, 500 * 2 ** attempt));
    }
  }

  async function ask(): Promise<{ done: string } | { offset: number }> {
    const response = await send({ method: "PUT", headers: { "content-range": `bytes */${size}` } });
    if (response.status === 200 || response.status === 201)
      return { done: await finishedId(response) };
    if (response.status === 308) return { offset: nextByte(response.headers.get("range")) };
    if (response.status === 404 || response.status === 410) throw new SessionGoneError();
    throw new Error(`Google answered ${response.status}.`);
  }

  let offset = 0;
  if (!input.fresh) {
    const state = await ask();
    if ("done" in state) return { fileId: state.done, md5: null };
    offset = state.offset;
  }
  if (offset > 0) md5Valid = false;
  input.onProgress?.(offset);

  // An empty file is one request with no body.
  if (size === 0) {
    const response = await send({ method: "PUT", headers: { "content-range": "bytes */0" } });
    if (response.status === 200 || response.status === 201) {
      return { fileId: await finishedId(response), md5: md5.hex() };
    }
    if (response.status === 404 || response.status === 410) throw new SessionGoneError();
    throw new Error(`Google answered ${response.status}.`);
  }

  for (;;) {
    guard();
    const end = Math.min(offset + chunk, size);
    const body = new Uint8Array(await input.file.slice(offset, end).arrayBuffer());
    if (md5Valid && offset === hashed) {
      md5.update(body);
      hashed = end;
    }
    const response = await send({
      method: "PUT",
      headers: { "content-range": `bytes ${offset}-${end - 1}/${size}` },
      body,
    });
    if (response.status === 200 || response.status === 201) {
      input.onProgress?.(size);
      return {
        fileId: await finishedId(response),
        md5: md5Valid && hashed === size ? md5.hex() : null,
      };
    }
    if (response.status === 308) {
      const kept = nextByte(response.headers.get("range"));
      // Google kept less than was hashed: the hash can't be rewound, so the check is size only.
      if (kept < hashed) md5Valid = false;
      offset = kept;
      input.onProgress?.(offset);
      continue;
    }
    if (response.status === 404 || response.status === 410) throw new SessionGoneError();
    if (retryable(response.status)) {
      // Retries ran out on this chunk: ask the session where it stands and carry on from there.
      const state = await ask();
      if ("done" in state) return { fileId: state.done, md5: null };
      if (state.offset < hashed) md5Valid = false;
      offset = state.offset;
      continue;
    }
    throw new Error(`Google answered ${response.status}.`);
  }
}
