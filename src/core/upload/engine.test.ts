import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createUploadEngine } from "./engine";
import type { EngineOptions, ItemState, OpenSession, Report, UploadItem } from "./types";

const KIB256 = 256 * 1024;
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

type FakeSession = {
  url: string;
  total: number;
  bytes: Uint8Array;
  received: number;
  done: boolean;
  /** Chunks that started before what Google already held. */
  duplicates: number;
};

type Request = { url: string; range: string; body: Uint8Array | null };

/** What a test makes Google do with one request instead of the normal answer. */
type Override =
  | { status: number }
  | { network: true }
  /** Google keeps only the first `bytes` of the chunk and answers 308. */
  | { keepOnly: number }
  /** Hold the answer until `release()`; an abort meanwhile stores the bytes and drops the answer. */
  | { hold: true };

/**
 * A fake Google resumable endpoint: keeps the bytes per session, answers 308 with Range, 200
 * with the file's id when the last byte arrives, and `bytes * /total` with where it stands.
 */
class FakeGoogle {
  sessions = new Map<string, FakeSession>();
  requests: Request[] = [];
  overrides: Array<(request: Request) => Override | undefined> = [];
  private released: Array<() => void> = [];
  private next = 1;

  open(total: number): string {
    const url = `${UPLOAD_URL}?uploadType=resumable&upload_id=s${this.next++}`;
    this.sessions.set(url, {
      url,
      total,
      bytes: new Uint8Array(total),
      received: 0,
      done: false,
      duplicates: 0,
    });
    return url;
  }

  forget(url: string): void {
    this.sessions.delete(url);
  }

  release(): void {
    this.released.splice(0).forEach((go) => go());
  }

  get holding(): number {
    return this.released.length;
  }

  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const range = headers.get("content-range") ?? "";
    const body = init?.body ? new Uint8Array(await new Response(init.body).arrayBuffer()) : null;
    const request: Request = { url, range, body };
    this.requests.push(request);
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");

    let override: Override | undefined;
    for (const rule of this.overrides) {
      override = rule(request);
      if (override) break;
    }
    if (override && "status" in override) return new Response(null, { status: override.status });
    if (override && "network" in override) throw new TypeError("Failed to fetch");
    if (override && "hold" in override) {
      await new Promise<void>((resolve, reject) => {
        this.released.push(resolve);
        signal?.addEventListener("abort", () => {
          // The bytes reached Google; only the answer is lost.
          this.answer(request);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    return this.answer(request, override && "keepOnly" in override ? override.keepOnly : null);
  };

  private answer(request: Request, keepOnly: number | null = null): Response {
    const session = this.sessions.get(request.url);
    if (!session) return new Response(null, { status: 404 });
    const status = /^bytes \*\/(\d+)$/.exec(request.range);
    if (!status) {
      const chunk = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(request.range);
      if (!chunk || !request.body) return new Response(null, { status: 400 });
      const start = Number(chunk[1]);
      const end = Number(chunk[2]);
      if (Number(chunk[3]) !== session.total || end - start + 1 !== request.body.length) {
        return new Response(null, { status: 400 });
      }
      if (start > session.received) return this.where(session);
      if (start < session.received) session.duplicates += 1;
      const kept = keepOnly === null ? request.body : request.body.subarray(0, keepOnly);
      session.bytes.set(kept, start);
      session.received = Math.max(session.received, start + kept.length);
      if (session.received === session.total) session.done = true;
    }
    return this.where(session);
  }

  private where(session: FakeSession): Response {
    if (session.done) {
      return Response.json({ id: `drive-${session.url.slice(-2)}`, md5Checksum: "abc123" });
    }
    const headers = new Headers();
    if (session.received > 0) headers.set("range", `bytes=0-${session.received - 1}`);
    return new Response(null, { status: 308, headers });
  }
}

function bytesOf(size: number, seed = 1): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + seed) % 251;
  return bytes;
}

/** Whether Google holds exactly the test file (a deep equal on a large array is slow). */
function holdsFile(session: FakeSession | undefined, size: number): boolean {
  return session !== undefined && Buffer.compare(session.bytes, bytesOf(size)) === 0;
}

/** The true MD5 of the test file, from node:crypto. */
function md5Of(size: number): string {
  return createHash("md5").update(bytesOf(size)).digest("hex");
}

function itemOf(key: string, size: number, seed = 1): UploadItem {
  return { key, file: new File([bytesOf(size, seed)], `${key}.mov`), relativePath: "" };
}

/** Turns the event loop until `cond`, moving the fake clock `stepMs` each turn. */
async function until(cond: () => boolean, stepMs = 0): Promise<void> {
  for (let turn = 0; turn < 400; turn += 1) {
    if (cond()) return;
    await new Promise((resolve) => setImmediate(resolve));
    if (stepMs > 0) await vi.advanceTimersByTimeAsync(stepMs);
  }
  throw new Error("the engine never got there");
}

type ReportEvent = Parameters<Report>[0];

/** `overrides` replace the test defaults; keys in `unset` fall back to the engine's own. */
function harness(overrides: Partial<EngineOptions> = {}, unset: Array<keyof EngineOptions> = []) {
  const google = new FakeGoogle();
  const states = new Map<string, ItemState[]>();
  const reports: ReportEvent[] = [];
  const opened: string[] = [];
  let clock = 1_000;
  let onlineNow = true;
  const listeners = new Set<(online: boolean) => void>();
  const openSession = vi.fn<OpenSession>(async (item) => {
    const sessionUrl = google.open(item.file.size);
    opened.push(sessionUrl);
    return { sessionUrl, fileId: `row-${item.key}-${opened.length}` };
  });
  const options: EngineOptions = {
    openSession,
    report: async (event) => {
      reports.push(event);
    },
    onChange: (key, state) => {
      states.set(key, [...(states.get(key) ?? []), state]);
    },
    chunkBytes: KIB256,
    fetchImpl: google.fetch,
    now: () => clock,
    online: {
      isOnline: () => onlineNow,
      subscribe(onChange) {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
    },
    ...overrides,
  };
  for (const key of unset) delete options[key];
  const engine = createUploadEngine(options);
  const last = (key: string) => engine.snapshot().get(key);
  return {
    google,
    engine,
    states,
    reports,
    opened,
    openSession,
    last,
    tick(ms: number) {
      clock += ms;
    },
    setOnline(value: boolean) {
      onlineNow = value;
      listeners.forEach((listener) => listener(value));
    },
    listeners,
    sessionOf(index = 0) {
      const url = opened[index];
      if (!url) throw new Error(`no session ${index}`);
      return google.sessions.get(url);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the upload engine", () => {
  it("sends a 3-chunk file in order and finishes it", async () => {
    const h = harness();
    const size = 2 * KIB256 + 1000;
    h.engine.add([itemOf("a", size)]);
    await until(() => h.last("a")?.state === "done");

    const chunks = h.google.requests.map((request) => request.range);
    expect(chunks).toEqual([
      `bytes 0-${KIB256 - 1}/${size}`,
      `bytes ${KIB256}-${2 * KIB256 - 1}/${size}`,
      `bytes ${2 * KIB256}-${size - 1}/${size}`,
    ]);
    const session = h.sessionOf();
    expect(holdsFile(session, size)).toBe(true);
    expect(session?.duplicates).toBe(0);
    expect(h.last("a")).toEqual({ state: "done", driveFileId: "drive-s1" });
    expect(h.states.get("a")?.map((state) => state.state)).toEqual([
      "waiting",
      "uploading",
      "uploading",
      "uploading",
      "done",
    ]);
    await until(() => h.reports.some((event) => event.kind === "done"));
    expect(h.reports.at(-1)).toEqual({
      kind: "done",
      fileId: "row-a-1",
      driveFileId: "drive-s1",
      md5Checksum: "abc123",
      localMd5: md5Of(size),
    });
  });

  it("rounds the chunk size down to 256 KiB and defaults to 8 MiB", async () => {
    const h = harness({ chunkBytes: KIB256 + 5 });
    h.engine.add([itemOf("a", KIB256 + 10)]);
    await until(() => h.last("a")?.state === "done");
    expect(h.google.requests[0]?.range).toBe(`bytes 0-${KIB256 - 1}/${KIB256 + 10}`);

    const d = harness({}, ["chunkBytes"]);
    const size = 8 * 1024 * 1024 + 3;
    d.engine.add([itemOf("big", size)]);
    await until(() => d.last("big")?.state === "done");
    expect(d.google.requests.map((request) => request.range)).toEqual([
      `bytes 0-${8 * 1024 * 1024 - 1}/${size}`,
      `bytes ${8 * 1024 * 1024}-${size - 1}/${size}`,
    ]);
  });

  it("sends two files at once and keeps the third waiting, first in first out", async () => {
    const h = harness();
    h.google.overrides.push(() => ({ hold: true }));
    h.engine.add([itemOf("a", 100), itemOf("b", 100), itemOf("c", 100)]);
    await until(() => h.google.holding === 2);

    expect(h.last("a")?.state).toBe("uploading");
    expect(h.last("b")?.state).toBe("uploading");
    expect(h.last("c")).toEqual({ state: "waiting" });
    expect(h.openSession).toHaveBeenCalledTimes(2);

    h.google.overrides.length = 0;
    h.google.release();
    await until(() => ["a", "b", "c"].every((key) => h.last(key)?.state === "done"));
    expect(h.openSession.mock.calls.map(([item]) => item.key)).toEqual(["a", "b", "c"]);
  });

  it("resends from Range + 1 after a partial 308", async () => {
    const h = harness();
    const size = 2 * KIB256;
    let first = true;
    h.google.overrides.push((request) => {
      if (request.body && first) {
        first = false;
        return { keepOnly: 1000 };
      }
      return undefined;
    });
    h.engine.add([itemOf("a", size)]);
    await until(() => h.last("a")?.state === "done");

    expect(h.google.requests.map((request) => request.range)).toEqual([
      `bytes 0-${KIB256 - 1}/${size}`,
      `bytes 1000-${1000 + KIB256 - 1}/${size}`,
      `bytes ${1000 + KIB256}-${size - 1}/${size}`,
    ]);
    expect(holdsFile(h.sessionOf(), size)).toBe(true);
    expect(h.sessionOf()?.duplicates).toBe(0);
  });

  it("retries a 503 after a backoff and a status question, then finishes", async () => {
    const h = harness();
    const size = 2 * KIB256;
    let failed = false;
    h.google.overrides.push((request) => {
      if (request.body && request.range.startsWith(`bytes ${KIB256}-`) && !failed) {
        failed = true;
        return { status: 503 };
      }
      return undefined;
    });
    h.engine.add([itemOf("a", size)]);
    await until(() => h.google.requests.length === 2);
    // Backing off: nothing more until the timer runs.
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.google.requests).toHaveLength(2);
    expect(h.last("a")).toMatchObject({ state: "uploading", sent: KIB256 });

    await until(() => h.last("a")?.state === "done", 250);
    expect(h.google.requests.map((request) => request.range)).toEqual([
      `bytes 0-${KIB256 - 1}/${size}`,
      `bytes ${KIB256}-${size - 1}/${size}`,
      `bytes */${size}`,
      `bytes ${KIB256}-${size - 1}/${size}`,
    ]);
    expect(holdsFile(h.sessionOf(), size)).toBe(true);
  });

  it("treats 429 and a dropped connection like a 503", async () => {
    const h = harness();
    const answers: Override[] = [{ status: 429 }, { network: true }];
    h.google.overrides.push((request) => (request.body ? answers.shift() : undefined));
    h.engine.add([itemOf("a", 100)]);
    await until(() => h.last("a")?.state === "done", 1000);
    expect(h.google.requests.filter((request) => request.body)).toHaveLength(3);
  });

  it("opens a new session when Google forgot the old one, and starts the file again", async () => {
    const h = harness();
    const size = 2 * KIB256;
    h.google.overrides.push((request) => {
      if (request.url === h.opened[0] && request.range.startsWith(`bytes ${KIB256}-`)) {
        h.google.forget(request.url);
      }
      return undefined;
    });
    h.engine.add([itemOf("a", size)]);
    await until(() => h.last("a")?.state === "done");

    expect(h.openSession).toHaveBeenCalledTimes(2);
    const second = h.google.requests.filter((request) => request.url === h.opened[1]);
    expect(second[0]?.range).toBe(`bytes 0-${KIB256 - 1}/${size}`);
    expect(holdsFile(h.sessionOf(1), size)).toBe(true);
    await until(() => h.reports.some((event) => event.kind === "done"));
    expect(h.reports.find((event) => event.kind === "done")).toMatchObject({ fileId: "row-a-2" });
  });

  it("fails after six tries, can be retried by hand, and then finishes", async () => {
    const h = harness();
    let down = true;
    h.google.overrides.push((request) => (down && request.body ? { status: 500 } : undefined));
    h.engine.add([itemOf("a", 100)]);
    await until(() => h.last("a")?.state === "failed", 1000);

    expect(h.last("a")).toEqual({
      state: "failed",
      reason: "Google answered 500",
      canRetry: true,
    });
    expect(h.google.requests.filter((request) => request.body)).toHaveLength(6);
    await until(() => h.reports.some((event) => event.kind === "failed"));
    expect(h.reports.find((event) => event.kind === "failed")).toEqual({
      kind: "failed",
      fileId: "row-a-1",
      reason: "Google answered 500",
    });

    down = false;
    const before = h.google.requests.length;
    h.engine.retry("a");
    expect(h.last("a")?.state).not.toBe("failed");
    await until(() => h.last("a")?.state === "done");
    // The same session: first where it stands, then the bytes.
    expect(h.openSession).toHaveBeenCalledTimes(1);
    expect(h.google.requests.slice(before).map((request) => request.range)).toEqual([
      "bytes */100",
      "bytes 0-99/100",
    ]);
  });

  it("fails for good on another 4xx", async () => {
    const h = harness();
    h.google.overrides.push(() => ({ status: 403 }));
    h.engine.add([itemOf("a", 100)]);
    await until(() => h.last("a")?.state === "failed");
    expect(h.last("a")).toEqual({
      state: "failed",
      reason: "Google refused the file (403)",
      canRetry: false,
    });
    h.engine.retry("a");
    expect(h.last("a")?.state).toBe("failed");
  });

  it("pauses offline mid-file, asks Google on return and sends only the rest", async () => {
    const h = harness();
    const size = 3 * KIB256;
    h.google.overrides.push((request) =>
      request.range.startsWith(`bytes ${KIB256}-`) ? { hold: true } : undefined,
    );
    h.engine.add([itemOf("a", size)]);
    await until(() => h.google.holding === 1);

    h.setOnline(false);
    expect(h.last("a")).toEqual({ state: "paused", sent: KIB256, total: size, why: "offline" });
    await new Promise((resolve) => setImmediate(resolve));
    const whileOffline = h.google.requests.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.google.requests).toHaveLength(whileOffline);

    h.google.overrides.length = 0;
    h.setOnline(true);
    await until(() => h.last("a")?.state === "done");
    expect(h.google.requests.slice(whileOffline).map((request) => request.range)).toEqual([
      `bytes */${size}`,
      `bytes ${2 * KIB256}-${size - 1}/${size}`,
    ]);
    expect(holdsFile(h.sessionOf(), size)).toBe(true);
    expect(h.sessionOf()?.duplicates).toBe(0);
  });

  it("pauses and resumes by the person", async () => {
    const h = harness();
    const size = 2 * KIB256;
    h.google.overrides.push((request) =>
      request.range.startsWith(`bytes ${KIB256}-`) ? { hold: true } : undefined,
    );
    h.engine.add([itemOf("a", size), itemOf("b", 100), itemOf("c", 100)]);
    await until(() => h.google.holding === 1 && h.last("c")?.state === "done");

    h.engine.pause();
    expect(h.last("a")).toEqual({ state: "paused", sent: KIB256, total: size, why: "by_person" });
    h.setOnline(false);
    expect(h.last("a")).toMatchObject({ why: "by_person" });
    h.engine.resume();
    expect(h.last("a")).toMatchObject({ state: "paused", why: "offline" });

    h.google.overrides.length = 0;
    h.setOnline(true);
    await until(() => h.last("a")?.state === "done");
    expect(holdsFile(h.sessionOf(), size)).toBe(true);
  });

  describe("a session the module opened before", () => {
    /** A harness whose first `openSession` hands back `url` as resumed, then fresh ones. */
    function resumedHarness(prepare: (google: FakeGoogle) => string) {
      let first: string | null = null;
      const h = harness({
        openSession: async (item) => {
          if (first === null) {
            first = prepare(h.google);
            h.opened.push(first);
            return { sessionUrl: first, fileId: "row-old", resumed: true };
          }
          const sessionUrl = h.google.open(item.file.size);
          h.opened.push(sessionUrl);
          return { sessionUrl, fileId: "row-new" };
        },
      });
      return h;
    }

    /** A session in which Google already holds the first `held` bytes of the test file. */
    function heldSession(google: FakeGoogle, size: number, held: number): string {
      const url = google.open(size);
      const session = google.sessions.get(url) as FakeSession;
      session.bytes.set(bytesOf(size).subarray(0, held));
      session.received = held;
      session.done = held === size;
      return url;
    }

    it("asks Google first and sends only the chunk it lacks", async () => {
      const size = 3 * KIB256 - 500;
      const h = resumedHarness((google) => heldSession(google, size, 2 * KIB256));
      h.engine.add([itemOf("a", size)]);
      await until(() => h.last("a")?.state === "done");

      expect(h.google.requests.map((request) => request.range)).toEqual([
        `bytes */${size}`,
        `bytes ${2 * KIB256}-${size - 1}/${size}`,
      ]);
      expect(holdsFile(h.sessionOf(), size)).toBe(true);
      expect(h.sessionOf()?.duplicates).toBe(0);
      await until(() => h.reports.some((event) => event.kind === "done"));
      expect(h.reports.at(-1)).toMatchObject({
        kind: "done",
        fileId: "row-old",
        localMd5: md5Of(size),
      });
    });

    it("reports done with no bytes sent when Google already has the whole file", async () => {
      const size = 2 * KIB256;
      const h = resumedHarness((google) => heldSession(google, size, size));
      h.engine.add([itemOf("a", size)]);
      await until(() => h.reports.some((event) => event.kind === "done"));

      expect(h.google.requests.map((request) => request.range)).toEqual([`bytes */${size}`]);
      expect(h.google.requests.every((request) => request.body === null)).toBe(true);
      expect(h.last("a")).toEqual({ state: "done", driveFileId: "drive-s1" });
      expect(h.reports).toEqual([
        {
          kind: "done",
          fileId: "row-old",
          driveFileId: "drive-s1",
          md5Checksum: "abc123",
          localMd5: md5Of(size),
        },
      ]);
    });

    it("opens a fresh session when Google forgot the old one", async () => {
      const size = 2 * KIB256;
      const h = resumedHarness(() => `${UPLOAD_URL}?uploadType=resumable&upload_id=forgotten`);
      h.engine.add([itemOf("a", size)]);
      await until(() => h.last("a")?.state === "done");

      expect(h.opened).toHaveLength(2);
      expect(h.google.requests.map((request) => [request.url, request.range])).toEqual([
        [h.opened[0], `bytes */${size}`],
        [h.opened[1], `bytes 0-${KIB256 - 1}/${size}`],
        [h.opened[1], `bytes ${KIB256}-${size - 1}/${size}`],
      ]);
      expect(holdsFile(h.sessionOf(1), size)).toBe(true);
      await until(() => h.reports.some((event) => event.kind === "done"));
      expect(h.reports.at(-1)).toMatchObject({
        kind: "done",
        fileId: "row-new",
        localMd5: md5Of(size),
      });
    });
  });

  it("shows a refusal and never calls Google or report", async () => {
    const h = harness({
      openSession: async () => ({ refused: "too_big" }),
    });
    h.engine.add([itemOf("a", 100), itemOf("b", 100)]);
    await until(() => h.last("b")?.state === "refused");
    expect(h.last("a")).toEqual({ state: "refused", refused: "too_big" });
    expect(h.google.requests).toHaveLength(0);
    expect(h.reports).toHaveLength(0);
  });

  it("refuses a file already sent like any refusal: no Google call, no report, no retry", async () => {
    const h = harness({ openSession: async () => ({ refused: "already_sent" }) });
    h.engine.add([itemOf("a", 100)]);
    await until(() => h.last("a")?.state === "refused");
    expect(h.last("a")).toEqual({ state: "refused", refused: "already_sent" });
    h.engine.retry("a");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.last("a")).toEqual({ state: "refused", refused: "already_sent" });
    expect(h.google.requests).toHaveLength(0);
    expect(h.reports).toHaveLength(0);
  });

  describe("the file's own MD5", () => {
    const doneReport = (reports: ReportEvent[]) => reports.find((event) => event.kind === "done");

    it("is the true MD5 after a normal upload", async () => {
      const h = harness();
      const size = 3 * KIB256 - 77;
      h.engine.add([itemOf("a", size)]);
      await until(() => doneReport(h.reports) !== undefined);
      expect(doneReport(h.reports)).toMatchObject({ localMd5: md5Of(size) });
    });

    it("restarts from 0 when Google's Range falls below what was hashed, and stays true", async () => {
      const h = harness();
      const size = 3 * KIB256;
      let lost = false;
      h.google.overrides.push((request) => {
        if (!lost && request.range.startsWith(`bytes ${2 * KIB256}-`)) {
          // Google lost the second chunk it had confirmed: it now holds only the first.
          lost = true;
          const session = h.sessionOf();
          if (session) session.received = KIB256;
        }
        return undefined;
      });
      h.engine.add([itemOf("a", size)]);
      await until(() => doneReport(h.reports) !== undefined, 1000);

      expect(h.google.requests.map((request) => request.range)).toEqual([
        `bytes 0-${KIB256 - 1}/${size}`,
        `bytes ${KIB256}-${2 * KIB256 - 1}/${size}`,
        `bytes ${2 * KIB256}-${size - 1}/${size}`,
        `bytes ${KIB256}-${2 * KIB256 - 1}/${size}`,
        `bytes ${2 * KIB256}-${size - 1}/${size}`,
      ]);
      expect(holdsFile(h.sessionOf(), size)).toBe(true);
      expect(doneReport(h.reports)).toMatchObject({ localMd5: md5Of(size) });
    });

    it("is null when the file cannot be read back, and the upload still finishes", async () => {
      /** A file whose slices refuse `arrayBuffer()` (the hash's read) but still stream to Google. */
      class UnreadableFile extends File {
        override slice(start?: number, end?: number, contentType?: string): Blob {
          const part = super.slice(start, end, contentType);
          part.arrayBuffer = () => Promise.reject(new Error("The file changed on disk"));
          return part;
        }
      }
      const h = harness();
      const size = 2 * KIB256 + 9;
      h.engine.add([
        { key: "a", file: new UnreadableFile([bytesOf(size)], "a.mov"), relativePath: "" },
      ]);
      await until(() => doneReport(h.reports) !== undefined);
      expect(h.last("a")).toEqual({ state: "done", driveFileId: "drive-s1" });
      expect(holdsFile(h.sessionOf(), size)).toBe(true);
      expect(doneReport(h.reports)).toMatchObject({ localMd5: null, md5Checksum: "abc123" });
    });
  });

  it("stops everything on dispose and aborts the requests in flight", async () => {
    let calls = 0;
    let aborted = 0;
    const held: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        calls += 1;
        init?.signal?.addEventListener("abort", () => {
          aborted += 1;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const h = harness({ fetchImpl: held });
    h.engine.add([itemOf("a", 100), itemOf("b", 100), itemOf("c", 100)]);
    await until(() => calls === 2);
    const changes = [...h.states.values()].flat().length;

    h.engine.dispose();
    expect(aborted).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    await new Promise((resolve) => setImmediate(resolve));
    expect([...h.states.values()].flat()).toHaveLength(changes);
    expect(h.openSession).toHaveBeenCalledTimes(2);
    expect(calls).toBe(2);
    expect(h.reports).toHaveLength(0);
    expect(h.listeners.size).toBe(0);
    h.engine.add([itemOf("d", 100)]);
    expect(h.engine.snapshot().has("d")).toBe(false);
  });

  it("keeps uploading when report throws, and retries the report later", async () => {
    const delivered: ReportEvent[] = [];
    let failures = 0;
    const h = harness({
      report: (event) => {
        if (event.kind === "done" && failures < 2) {
          failures += 1;
          throw new Error("server down");
        }
        delivered.push(event);
        return Promise.resolve();
      },
    });
    h.engine.add([itemOf("a", 2 * KIB256)]);
    await until(() => h.last("a")?.state === "done");
    await until(() => delivered.some((event) => event.kind === "done"), 1000);
    expect(failures).toBe(2);
    expect(delivered.filter((event) => event.kind === "done")).toHaveLength(1);
  });

  it("reports progress at most every reportEveryMs, plus the finish", async () => {
    const h = harness({ reportEveryMs: 5000 });
    const size = 5 * KIB256;
    h.google.overrides.push((request) => {
      // The clock moves 2 s per chunk Google answers.
      if (request.body) h.tick(2000);
      return undefined;
    });
    h.engine.add([itemOf("a", size)]);
    await until(() => h.last("a")?.state === "done");
    await until(() => h.reports.some((event) => event.kind === "done"));

    // Chunks answered at 3s, 5s, 7s, 9s (+done at 11s): progress at 3s and 9s only.
    expect(h.reports).toEqual([
      { kind: "progress", fileId: "row-a-1", sent: KIB256, total: size },
      { kind: "progress", fileId: "row-a-1", sent: 4 * KIB256, total: size },
      {
        kind: "done",
        fileId: "row-a-1",
        driveFileId: "drive-s1",
        md5Checksum: "abc123",
        localMd5: md5Of(size),
      },
    ]);
    // The screen hears every chunk.
    expect(h.states.get("a")?.filter((state) => state.state === "uploading")).toHaveLength(5);
  });

  it("works without navigator or window (server render, tests)", async () => {
    const h = harness({}, ["online"]);
    h.engine.add([itemOf("a", 100)]);
    await until(() => h.last("a")?.state === "done");
  });
});
