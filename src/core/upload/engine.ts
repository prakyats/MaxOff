/**
 * The browser upload engine (the contract and its behaviour: `./types.ts`). Plain TypeScript, no
 * React: a screen subscribes through `onChange` and draws the states.
 *
 * Each file runs one loop: open a session (the module's `openSession`), then PUT chunks to
 * Google's session address and follow Google's answer: 308 carries on from the `Range` it holds,
 * 200/201 is the finished file, 404/410 means the session is gone (a new one, from byte 0), 5xx,
 * 429 or a dropped connection retries the chunk with backoff after asking Google how much arrived
 * (an empty PUT, `bytes * /total`), and any other 4xx is final. Pausing (offline, or the person)
 * aborts the PUT in flight; on resume the file asks Google where it stands and sends only the rest.
 *
 * The session address is a credential for one file: it is never logged and never leaves here
 * except to Google. A session the module hands back as `resumed` (after a reload, or on another
 * visit) starts with the status question too, so only what Google lacks is sent.
 *
 * Each file's MD5 (`localMd5` in the done report, for the server to compare with Drive's) is fed
 * in order with the bytes Google confirms, from the chunk just sent. A span Google holds that this
 * engine did not send (a resumed session, a Range after an outage) is read back from the file in
 * chunk-sized pieces, so the whole file is never in memory. If Google's Range falls below what is
 * hashed, the hash restarts from 0. A file that cannot be read back gives a null MD5; the upload
 * itself carries on.
 */
import { systemClock } from "@/core/time/clock";

import { Md5 } from "./md5";

import type {
  EngineOptions,
  ItemState,
  OpenedSession,
  Report,
  UploadEngine,
  UploadItem,
} from "./types";

/** Google's rule: every chunk but the last is a multiple of 256 KiB. */
const CHUNK_QUANTUM = 256 * 1024;
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_REPORT_EVERY_MS = 5000;
/** Tries per chunk before the file is `failed` (it can then be retried by hand). */
const MAX_CHUNK_TRIES = 6;
/** New sessions in one run after Google forgot the last one, before giving up. */
const MAX_SESSION_RESTARTS = 3;
/** Tries per `report` call before the engine lets that event go. */
const MAX_REPORT_TRIES = 6;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 32_000;

type ReportEvent = Parameters<Report>[0];

/** A chunk's bytes as sent, kept until Google answers so the hash need not read them again. */
type SentChunk = { start: number; bytes: Uint8Array<ArrayBuffer> };

/** What Google's answer to a PUT means for the loop. */
type Answer =
  | { kind: "incomplete"; received: number }
  | { kind: "done"; driveFileId: string; md5Checksum: string | null }
  | { kind: "gone" }
  | { kind: "transient"; reason: string }
  | { kind: "fatal"; reason: string };

type Entry = {
  item: UploadItem;
  state: ItemState;
  session: OpenedSession | null;
  /** A session being opened, shared by a run that resumes while the first is still waiting. */
  opening: Promise<Awaited<ReturnType<EngineOptions["openSession"]>>> | null;
  /** Bytes Google has confirmed. */
  sent: number;
  /** Ask Google where the session stands before sending more (after a pause or a failure). */
  needsStatus: boolean;
  /** Bumped whenever a run is started or stopped: a run whose number is old stops quietly. */
  gen: number;
  controller: AbortController | null;
  lastReportAt: number | null;
  /** Progress reports carry the newest number; an older one still being retried is dropped. */
  reportSeq: number;
  reporting: Promise<void>;
  /** The MD5 of bytes [0, hashed) of the file; null once the file could not be read back. */
  hash: Md5 | null;
  hashed: number;
};

/** Google's `Range: bytes=0-N` means N + 1 bytes arrived; no header means none. */
function receivedFrom(range: string | null): number {
  const match = range ? /bytes=0-(\d+)/.exec(range) : null;
  return match ? Number(match[1]) + 1 : 0;
}

async function readAnswer(response: Response): Promise<Answer> {
  const status = response.status;
  if (status === 308) {
    return { kind: "incomplete", received: receivedFrom(response.headers.get("range")) };
  }
  if (status === 200 || status === 201) {
    const body = (await response.json().catch(() => null)) as {
      id?: unknown;
      md5Checksum?: unknown;
    } | null;
    if (!body || typeof body.id !== "string" || body.id === "") {
      return { kind: "transient", reason: "Google gave no file id" };
    }
    return {
      kind: "done",
      driveFileId: body.id,
      md5Checksum: typeof body.md5Checksum === "string" ? body.md5Checksum : null,
    };
  }
  if (status === 404 || status === 410) return { kind: "gone" };
  if (status === 429 || status >= 500) {
    return { kind: "transient", reason: `Google answered ${status}` };
  }
  return { kind: "fatal", reason: `Google refused the file (${status})` };
}

/** Exponential backoff with jitter: half the step fixed, half random. */
function backoffMs(attempt: number): number {
  const step = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return step / 2 + Math.random() * (step / 2);
}

/** Waits `ms`, or less if `signal` aborts first. Never rejects. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/**
 * The browser's own online state. Safe without `navigator` or `window` (server render, tests):
 * then it reads as online and never changes.
 */
function browserOnline(): NonNullable<EngineOptions["online"]> {
  return {
    isOnline() {
      const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
      return nav?.onLine ?? true;
    },
    subscribe(onChange) {
      const target = globalThis as {
        addEventListener?: (type: string, listener: () => void) => void;
        removeEventListener?: (type: string, listener: () => void) => void;
      };
      if (!target.addEventListener || !target.removeEventListener) return () => {};
      const on = () => onChange(true);
      const off = () => onChange(false);
      target.addEventListener("online", on);
      target.addEventListener("offline", off);
      return () => {
        target.removeEventListener?.("online", on);
        target.removeEventListener?.("offline", off);
      };
    },
  };
}

export function createUploadEngine(options: EngineOptions): UploadEngine {
  const chunkBytes = Math.max(
    CHUNK_QUANTUM,
    Math.floor((options.chunkBytes ?? DEFAULT_CHUNK_BYTES) / CHUNK_QUANTUM) * CHUNK_QUANTUM,
  );
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const reportEveryMs = options.reportEveryMs ?? DEFAULT_REPORT_EVERY_MS;
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => systemClock().getTime());
  const online = options.online ?? browserOnline();

  const entries = new Map<string, Entry>();
  /** Keys waiting for a slot, first in first out. */
  const queue: string[] = [];
  /** Keys holding a slot. */
  const active = new Set<string>();
  /** Files stopped mid-way (offline or by the person), in the order they were running. */
  const paused: Entry[] = [];
  /** Ends report retries on dispose. */
  const lifetime = new AbortController();
  let disposed = false;
  let pausedByPerson = false;
  let isOnline = online.isOnline();

  function setState(entry: Entry, state: ItemState): void {
    entry.state = state;
    if (disposed) return;
    try {
      options.onChange(entry.item.key, state);
    } catch {
      // A screen that throws never stops an upload.
    }
  }

  function uploading(entry: Entry): void {
    setState(entry, { state: "uploading", sent: entry.sent, total: entry.item.file.size });
  }

  /** Sends one report, retried with backoff; never throws, never blocks the upload. */
  function deliver(entry: Entry, event: ReportEvent): void {
    const seq = ++entry.reportSeq;
    entry.reporting = entry.reporting.then(async () => {
      for (let attempt = 1; ; attempt += 1) {
        if (disposed) return;
        // A newer report for this file already says more than this progress would.
        if (event.kind === "progress" && seq !== entry.reportSeq) return;
        try {
          await options.report(event);
          return;
        } catch {
          if (attempt >= MAX_REPORT_TRIES) return;
          await sleep(backoffMs(attempt), lifetime.signal);
        }
      }
    });
  }

  function reportProgress(entry: Entry): void {
    if (!entry.session) return;
    const at = now();
    if (entry.lastReportAt !== null && at - entry.lastReportAt < reportEveryMs) return;
    entry.lastReportAt = at;
    deliver(entry, {
      kind: "progress",
      fileId: entry.session.fileId,
      sent: entry.sent,
      total: entry.item.file.size,
    });
  }

  function fail(entry: Entry, reason: string, canRetry: boolean): void {
    entry.needsStatus = canRetry && entry.session !== null;
    setState(entry, { state: "failed", reason, canRetry });
    if (entry.session) deliver(entry, { kind: "failed", fileId: entry.session.fileId, reason });
  }

  /**
   * Brings the file's MD5 up to `upTo` bytes (what Google confirmed): from the chunk just sent
   * where it covers the span, else read back from the file one chunk at a time. A run that has
   * been stopped (its `gen` is old) leaves the hash alone.
   */
  async function advanceHash(
    entry: Entry,
    gen: number,
    upTo: number,
    chunk: SentChunk | null,
  ): Promise<void> {
    if (entry.hash && upTo < entry.hashed) {
      // Google holds less than was hashed: start again from the first byte.
      entry.hash = new Md5();
      entry.hashed = 0;
    }
    while (entry.hash && entry.hashed < upTo) {
      const from = entry.hashed;
      let piece: Uint8Array;
      if (chunk && from >= chunk.start && from < chunk.start + chunk.bytes.length) {
        piece = chunk.bytes.subarray(
          from - chunk.start,
          Math.min(upTo, chunk.start + chunk.bytes.length) - chunk.start,
        );
      } else {
        const stop = Math.min(
          upTo,
          from + chunkBytes,
          chunk && chunk.start > from ? chunk.start : Number.POSITIVE_INFINITY,
        );
        try {
          piece = new Uint8Array(await entry.item.file.slice(from, stop).arrayBuffer());
        } catch {
          if (entry.gen === gen) entry.hash = null;
          return;
        }
        if (entry.gen !== gen || disposed) return;
        if (entry.hashed !== from || !entry.hash) continue;
        if (piece.length !== stop - from) {
          entry.hash = null;
          return;
        }
      }
      entry.hash.update(piece);
      entry.hashed = from + piece.length;
    }
  }

  async function put(
    url: string,
    contentRange: string,
    body: Blob | Uint8Array<ArrayBuffer> | null,
    signal: AbortSignal,
  ): Promise<Answer> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "PUT",
        headers: { "content-range": contentRange },
        body,
        signal,
      });
    } catch {
      return { kind: "transient", reason: "The connection dropped" };
    }
    return readAnswer(response);
  }

  /** One file's loop, from opening its session to Google's final answer. */
  async function run(entry: Entry, gen: number): Promise<void> {
    const controller = new AbortController();
    entry.controller = controller;
    const live = () => !disposed && entry.gen === gen;
    const total = entry.item.file.size;
    let tries = 0;
    let restarts = 0;
    let ask = entry.needsStatus;
    uploading(entry);

    for (;;) {
      if (!live()) return;

      if (!entry.session) {
        const opening = (entry.opening ??= Promise.resolve().then(() =>
          options.openSession(entry.item),
        ));
        let opened: Awaited<typeof opening>;
        try {
          opened = await opening;
        } catch {
          if (entry.opening === opening) entry.opening = null;
          if (live()) fail(entry, "The upload could not be started", true);
          return;
        }
        if (entry.opening === opening) entry.opening = null;
        if ("refused" in opened) {
          // Final, even for a run that was paused meanwhile: no Google call, no report.
          forget(entry);
          setState(entry, { state: "refused", refused: opened.refused });
          return;
        }
        if (!entry.session) {
          entry.session = opened;
          entry.sent = 0;
          entry.lastReportAt = null;
        }
        // A session the module opened before: Google may already hold some or all of the file.
        ask = opened.resumed === true;
        continue;
      }

      const { sessionUrl } = entry.session;
      const start = entry.sent;
      const statusOnly = ask;
      let answer: Answer;
      /** The chunk's bytes, read once: sent to Google and fed to the hash. */
      let chunk: SentChunk | null = null;
      if (statusOnly || start >= total) {
        answer = await put(sessionUrl, `bytes */${total}`, null, controller.signal);
      } else {
        const end = Math.min(start + chunkBytes, total);
        const blob = entry.item.file.slice(start, end);
        if (entry.hash) {
          try {
            chunk = { start, bytes: new Uint8Array(await blob.arrayBuffer()) };
          } catch {
            // Unreadable here: no MD5 for this file, and the browser streams the slice itself.
            entry.hash = null;
          }
          if (!live()) return;
        }
        answer = await put(
          sessionUrl,
          `bytes ${start}-${end - 1}/${total}`,
          chunk?.bytes ?? blob,
          controller.signal,
        );
      }
      if (!live()) return;
      ask = false;
      entry.needsStatus = false;

      switch (answer.kind) {
        case "incomplete": {
          entry.sent = Math.min(answer.received, total);
          await advanceHash(entry, gen, entry.sent, chunk);
          if (!live()) return;
          if (answer.received > start) {
            tries = 0;
            uploading(entry);
            reportProgress(entry);
          } else if (statusOnly) {
            uploading(entry);
          } else {
            // Google took none of the chunk: counts as a try, then the chunk is sent again.
            tries += 1;
            if (tries >= MAX_CHUNK_TRIES) return fail(entry, "Google took none of the file", true);
            uploading(entry);
            await sleep(backoffMs(tries), controller.signal);
          }
          continue;
        }
        case "done": {
          entry.sent = total;
          const { fileId } = entry.session;
          await advanceHash(entry, gen, total, chunk);
          if (!live()) return;
          const localMd5 = entry.hash && entry.hashed === total ? entry.hash.hex() : null;
          entry.hash = null;
          setState(entry, { state: "done", driveFileId: answer.driveFileId });
          deliver(entry, {
            kind: "done",
            fileId,
            driveFileId: answer.driveFileId,
            md5Checksum: answer.md5Checksum,
            localMd5,
          });
          return;
        }
        case "gone": {
          restarts += 1;
          entry.session = null;
          entry.sent = 0;
          tries = 0;
          if (restarts > MAX_SESSION_RESTARTS) {
            return fail(entry, "Google kept losing the upload", true);
          }
          uploading(entry);
          continue;
        }
        case "transient": {
          // A failed status question is not a try: the chunk itself is sent next.
          if (statusOnly) continue;
          tries += 1;
          if (tries >= MAX_CHUNK_TRIES) return fail(entry, answer.reason, true);
          await sleep(backoffMs(tries), controller.signal);
          ask = true;
          continue;
        }
        case "fatal":
          return fail(entry, answer.reason, false);
      }
    }
  }

  /** Drops a file from the queue and the paused list (its run is over for good). */
  function forget(entry: Entry): void {
    const queued = queue.indexOf(entry.item.key);
    if (queued >= 0) queue.splice(queued, 1);
    const held = paused.indexOf(entry);
    if (held >= 0) paused.splice(held, 1);
  }

  function start(entry: Entry): void {
    entry.gen += 1;
    const gen = entry.gen;
    active.add(entry.item.key);
    run(entry, gen)
      .catch(() => {
        if (!disposed && entry.gen === gen) fail(entry, "The upload stopped unexpectedly", true);
      })
      .finally(() => {
        if (entry.gen === gen) {
          active.delete(entry.item.key);
          entry.controller = null;
        }
        pump();
      });
  }

  function pump(): void {
    while (
      !disposed &&
      !pausedByPerson &&
      isOnline &&
      active.size < concurrency &&
      queue.length > 0
    ) {
      const entry = entries.get(queue.shift() as string);
      if (entry) start(entry);
    }
  }

  function pauseWhy(): "offline" | "by_person" {
    return pausedByPerson ? "by_person" : "offline";
  }

  /** Stops every running file where it is; each asks Google where it stands on resume. */
  function halt(): void {
    for (const key of active) {
      const entry = entries.get(key);
      if (!entry) continue;
      entry.gen += 1;
      entry.controller?.abort();
      entry.controller = null;
      entry.needsStatus = entry.session !== null;
      paused.push(entry);
    }
    active.clear();
    refreshPaused();
  }

  function refreshPaused(): void {
    for (const entry of paused) {
      setState(entry, {
        state: "paused",
        sent: entry.sent,
        total: entry.item.file.size,
        why: pauseWhy(),
      });
    }
  }

  function carryOn(): void {
    if (disposed || pausedByPerson || !isOnline) return refreshPaused();
    const back = paused.splice(0);
    queue.unshift(...back.map((entry) => entry.item.key));
    pump();
  }

  const unsubscribe = online.subscribe((nowOnline) => {
    if (disposed || nowOnline === isOnline) return;
    isOnline = nowOnline;
    if (nowOnline) carryOn();
    else halt();
  });

  return {
    add(items) {
      if (disposed) return;
      for (const item of items) {
        if (entries.has(item.key)) continue;
        const entry: Entry = {
          item,
          state: { state: "waiting" },
          session: null,
          opening: null,
          sent: 0,
          needsStatus: false,
          gen: 0,
          controller: null,
          lastReportAt: null,
          reportSeq: 0,
          reporting: Promise.resolve(),
          hash: new Md5(),
          hashed: 0,
        };
        entries.set(item.key, entry);
        queue.push(item.key);
        setState(entry, entry.state);
      }
      pump();
    },
    retry(key) {
      const entry = entries.get(key);
      if (disposed || !entry || entry.state.state !== "failed" || !entry.state.canRetry) return;
      setState(entry, { state: "waiting" });
      queue.push(key);
      pump();
    },
    pause() {
      if (disposed || pausedByPerson) return;
      pausedByPerson = true;
      halt();
    },
    resume() {
      if (disposed || !pausedByPerson) return;
      pausedByPerson = false;
      carryOn();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const key of active) {
        const entry = entries.get(key);
        if (!entry) continue;
        entry.gen += 1;
        entry.controller?.abort();
        entry.controller = null;
      }
      active.clear();
      queue.length = 0;
      lifetime.abort();
      unsubscribe();
    },
    snapshot() {
      return new Map(Array.from(entries, ([key, entry]) => [key, entry.state]));
    },
  };
}
