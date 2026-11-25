/**
 * The browser upload engine's contract (shared: v4.5 upload links, v5.0 hand-ins). The engine sends
 * files straight to Google Drive through resumable sessions the server opens
 * (`core/drive/resumable.ts`): it never sees a Drive credential and never sends bytes to MaxOff.
 * It knows nothing about links, tasks or versions: a module plugs in through `openSession`
 * (ask its own server action for a session for this file) and `report` (tell its own server what
 * happened), and draws its own screen from the engine's events.
 *
 * The engine: sends each file in chunks (a multiple of 256 KiB, Google's rule), two files at a
 * time; resumes a chunk from Google's `Range` answer; after a dropped connection, a reload or a
 * screen lock it asks Google how much arrived and sends only the rest; pauses while the browser is
 * offline and carries on when it is back; retries a failed chunk with backoff, and gives up on a
 * file only after its retries (the file is then `failed` and can be retried by hand).
 */

/** One file the person chose. `key` is the engine's own id for it, stable across a resume. */
export type UploadItem = {
  key: string;
  file: Blob & { name: string; type: string; size: number };
  /** The folder path inside what the person chose ("Day 1/CAM A"), or "" for a loose file. */
  relativePath: string;
};

/** What the module's server action gives back for one file. */
export type OpenedSession = {
  /** Google's session address (a credential for this one file: never logged). */
  sessionUrl: string;
  /** The module's own id for the file's row, passed back in every `report`. */
  fileId: string;
  /**
   * True when this is a session the module opened before (the same file after a reload or on
   * another visit): the engine first asks Google how much arrived and sends only the rest.
   */
  resumed?: boolean;
};

/** Why the module refused to open a session; shown on the file's row, never retried. */
export type SessionRefusal = {
  refused:
    | "too_big"
    | "type_not_allowed"
    | "empty"
    | "bad_name"
    | "stopped"
    | "limit"
    | "no_space"
    /** The same path, name and size is already in Drive from this sender (plan B4): "Already added". */
    | "already_sent";
};

/** Asks the module's server for a session for this file (or the module's refusal). */
export type OpenSession = (item: UploadItem) => Promise<OpenedSession | SessionRefusal>;

/** Tells the module's server what happened to a file; awaited, retried by the engine on failure. */
export type Report = (
  event:
    | { kind: "progress"; fileId: string; sent: number; total: number }
    | {
        kind: "done";
        fileId: string;
        /** Google's id for the finished file, and its checksum when Google gives one. */
        driveFileId: string;
        md5Checksum: string | null;
        /**
         * The MD5 the engine computed from the file's own bytes (lower-case hex), for the server's
         * damaged-transfer check against Google's `md5Checksum` (plan F1/F2). Null only when it
         * could not be computed (the file could not be read back).
         */
        localMd5: string | null;
      }
    | { kind: "failed"; fileId: string; reason: string },
) => Promise<void>;

export type ItemState =
  | { state: "waiting" }
  | { state: "uploading"; sent: number; total: number }
  | { state: "paused"; sent: number; total: number; why: "offline" | "by_person" }
  | { state: "done"; driveFileId: string }
  | { state: "failed"; reason: string; canRetry: boolean }
  | { state: "refused"; refused: SessionRefusal["refused"] };

export type EngineOptions = {
  openSession: OpenSession;
  report: Report;
  /** Called on every change, for the screen; never awaited. */
  onChange: (key: string, state: ItemState) => void;
  /** Bytes per chunk; rounded down to a multiple of 256 KiB. Default 8 MiB. */
  chunkBytes?: number;
  /** Files sent at once. Default 2. */
  concurrency?: number;
  /** How often to `report` progress for one file, at most, in ms. Default 5000. */
  reportEveryMs?: number;
  /** Injected for tests: the network, the clock, the online state. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  online?: { isOnline(): boolean; subscribe(onChange: (online: boolean) => void): () => void };
};

export type UploadEngine = {
  /** Adds files; they start as soon as a slot is free. */
  add(items: readonly UploadItem[]): void;
  /** Retries a failed file (a new session if Google forgot the old one). */
  retry(key: string): void;
  /** Pauses everything (the person's choice) or resumes it. */
  pause(): void;
  resume(): void;
  /** Stops sending; what Google holds stays (the session can be resumed until Google drops it). */
  dispose(): void;
  /** The current state of every file. */
  snapshot(): ReadonlyMap<string, ItemState>;
};
