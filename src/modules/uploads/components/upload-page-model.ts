/**
 * The uploader's page in words (v4.5, WORKFLOWS §5B.2; the approved sample §2, §3, §4): what each
 * file's row says, the overall line, the banners, and how a server answer becomes the engine's.
 * Pure: the page (`components/upload-page.tsx`) and its tests read the same lines. Names are text
 * only (plan D2). Nothing here knows the token or the device key.
 */
import { sizeWords } from "@/core/lib/size-words";
import type { ItemState, OpenedSession, SessionRefusal } from "@/core/upload";

import type { DoneAnswer, StartAnswer, UploaderOwnFile, WaitReason } from "../domain/api";
import { fileTag } from "../domain/card-view";

/** A file the person chose, before and after Upload. */
export type PageFile = {
  key: string;
  name: string;
  relativePath: string;
  size: number;
  /** Not yet handed to the engine: the "ready" list (screen C), where ✕ takes it out. */
  queued: boolean;
  /** The engine's state, once it has the file. */
  engine: ItemState | null;
  /** The server's verdict on a finished file (Done means Google's own answer, F1). */
  verdict: DoneAnswer | null;
  /** Held for space or waiting for a limit: asked again by itself (screens N, O, Q, R). */
  waiting: "no_space" | WaitReason | null;
  /** The link stopped before this file started (screen M). */
  notSent: boolean;
};

export type RowTone = "neutral" | "info" | "success" | "danger";
export type Row = {
  label: string;
  tone: RowTone;
  /** The line under the name. */
  line: string;
  /** A failed file Retry can carry on. */
  retry: boolean;
  /** Counts as finished for the overall line. */
  finished: boolean;
};

const pct = (sent: number, total: number) =>
  total > 0 ? Math.min(100, Math.floor((sent / total) * 100)) : 100;

/** "410 MB of 980 MB · 42%", or "1.2 of 5.4 GB · 22%" when both share a unit. */
export function progressWords(sent: number, total: number): string {
  const a = sizeWords(sent);
  const b = sizeWords(total);
  const both = a.split(" ")[1] === b.split(" ")[1] ? `${a.split(" ")[0]} of ${b}` : `${a} of ${b}`;
  return `${both} · ${pct(sent, total)}%`;
}

const FAILED_WORDS: Record<string, string> = {
  damaged: "Failed: damaged on the way. Send it again.",
  size_mismatch: "Google received a different size. Send it again.",
  wrong_folder: "It reached the wrong folder. Send it again.",
};

/** What a file's row says (sample §2 "Statuses", §3). */
export function rowOf(file: PageFile): Row {
  const size = sizeWords(file.size);
  if (file.notSent) {
    return {
      label: "Not sent",
      tone: "neutral",
      line: `${size} · the link was stopped`,
      retry: false,
      finished: true,
    };
  }
  if (file.verdict?.state === "done") {
    return { label: "Done", tone: "success", line: size, retry: false, finished: true };
  }
  if (file.verdict?.state === "failed") {
    return {
      label: "Failed",
      tone: "danger",
      line: FAILED_WORDS[file.verdict.reason] ?? "Failed. Send it again.",
      retry: true,
      finished: false,
    };
  }
  if (file.waiting === "no_space") {
    return {
      label: "Held",
      tone: "neutral",
      line: `${size} · doesn't fit right now`,
      retry: false,
      finished: false,
    };
  }
  if (file.waiting) {
    return {
      label: "Waiting",
      tone: "neutral",
      line: `${size} · starts by itself`,
      retry: false,
      finished: false,
    };
  }
  const engine = file.engine;
  if (!engine)
    return { label: "Waiting", tone: "neutral", line: size, retry: false, finished: false };
  switch (engine.state) {
    case "waiting":
      return { label: "Waiting", tone: "neutral", line: size, retry: false, finished: false };
    case "uploading":
      return {
        label: "Uploading",
        tone: "info",
        line: progressWords(engine.sent, engine.total),
        retry: false,
        finished: false,
      };
    case "paused":
      return {
        label: "Paused",
        tone: "neutral",
        line: `${progressWords(engine.sent, engine.total).split(" · ")[0]} · ${
          engine.why === "offline" ? "waiting for connection" : "paused"
        }`,
        retry: false,
        finished: false,
      };
    case "done":
      // Google has the bytes; MaxOff is checking its answer (F1). Shown as on its way.
      return {
        label: "Uploading",
        tone: "info",
        line: `${size} · checking`,
        retry: false,
        finished: false,
      };
    case "failed":
      return {
        label: "Failed",
        tone: "danger",
        line: engine.reason.startsWith("unreadable")
          ? "Couldn't read this file. It may still be copying from the camera card, or it was moved. Choose it again."
          : "Stopped before the end. We tried several times.",
        retry: engine.canRetry && !engine.reason.startsWith("unreadable"),
        finished: false,
      };
    case "refused":
      return refusedRow(engine.refused, size);
  }
}

function refusedRow(refused: SessionRefusal["refused"], size: string): Row {
  switch (refused) {
    case "already_sent":
      return {
        label: "Already sent",
        tone: "neutral",
        line: "Already received from you",
        retry: false,
        finished: true,
      };
    case "stopped":
      return {
        label: "Not sent",
        tone: "neutral",
        line: `${size} · the link was stopped`,
        retry: false,
        finished: true,
      };
    case "empty":
      return {
        label: "Failed",
        tone: "danger",
        line: "This file is empty.",
        retry: false,
        finished: true,
      };
    default:
      return {
        label: "Failed",
        tone: "danger",
        line: "This file can't be sent.",
        retry: false,
        finished: true,
      };
  }
}

/** Rows in progress at the top, then waiting, then the rest (the sample's D). */
export function rowOrder(file: PageFile): number {
  const row = rowOf(file);
  if (row.tone === "info") return 0;
  if (row.tone === "danger" && row.retry) return 1;
  if (!row.finished) return 2;
  return 3;
}

/** Bytes Google holds for a file, as far as the page knows. */
export function sentOf(file: PageFile): number {
  if (file.verdict?.state === "done" || rowOf(file).label === "Already sent") return file.size;
  const engine = file.engine;
  if (!engine) return 0;
  if (engine.state === "uploading" || engine.state === "paused") return engine.sent;
  if (engine.state === "done") return file.size;
  return 0;
}

export type Overall = {
  done: number;
  total: number;
  failed: number;
  sent: number;
  bytes: number;
  /** Everything handed over is finished (done, already sent, or not sendable). */
  allFinished: boolean;
  /** Anything is still moving (uploading, waiting, held). */
  moving: boolean;
};

export function overallOf(files: readonly PageFile[]): Overall {
  const started = files.filter((file) => !file.queued);
  let done = 0;
  let failed = 0;
  let moving = false;
  for (const file of started) {
    const row = rowOf(file);
    if (row.label === "Done" || row.label === "Already sent") done += 1;
    else if (row.tone === "danger") failed += 1;
    if (!row.finished && !(row.tone === "danger")) moving = true;
  }
  return {
    done,
    total: started.length,
    failed,
    sent: started.reduce((n, file) => n + sentOf(file), 0),
    bytes: started.reduce((n, file) => n + file.size, 0),
    allFinished: started.length > 0 && started.every((file) => rowOf(file).finished),
    moving,
  };
}

/** "8 of 12 done · 1 failed" */
export function overallTitle(overall: Overall): string {
  const failed = overall.failed > 0 ? ` · ${overall.failed} failed` : "";
  return `${overall.done} of ${overall.total} done${failed}`;
}

/** "3.1 GB of 5.4 GB · about 6 min left", "· paused" while offline. */
export function overallLine(
  overall: Overall,
  input: { offline: boolean; bytesPerSecond: number | null },
): string {
  const a = sizeWords(overall.sent);
  const b = sizeWords(overall.bytes);
  const both = a.split(" ")[1] === b.split(" ")[1] ? `${a.split(" ")[0]} of ${b}` : `${a} of ${b}`;
  if (input.offline) return `${both} · paused`;
  if (!overall.moving) return both;
  return `${both}${etaWords(overall.bytes - overall.sent, input.bytesPerSecond)}`;
}

/** " · about 6 min left", or nothing while the speed isn't known yet. */
export function etaWords(left: number, bytesPerSecond: number | null): string {
  if (!bytesPerSecond || bytesPerSecond <= 0 || left <= 0) return "";
  const seconds = left / bytesPerSecond;
  if (seconds < 60) return " · less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return ` · about ${minutes} min left`;
  const hours = Math.round(minutes / 6) / 10;
  return ` · about ${hours} h left`;
}

/** The speed over the last samples: bytes per second, or null with too little to go on. */
export function speedOf(samples: readonly { at: number; sent: number }[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const seconds = (last.at - first.at) / 1000;
  if (seconds < 3) return null;
  return Math.max(0, (last.sent - first.sent) / seconds);
}

/**
 * The server's answer to `start`, for the engine: a session, a final refusal, or a wait the page
 * asks again after (it is the engine's `limit` / `no_space` refusal, and the page re-adds the file).
 */
export function engineOpening(
  answer: StartAnswer,
):
  | { session: OpenedSession }
  | { refused: SessionRefusal["refused"]; wait: null }
  | { refused: "no_space" | "limit"; wait: { reason: "no_space" | WaitReason; seconds: number } } {
  switch (answer.kind) {
    case "start":
      return {
        session: { sessionUrl: answer.sessionUrl, fileId: answer.fileId, resumed: answer.resumed },
      };
    case "already_sent":
      return { refused: "already_sent", wait: null };
    case "held":
      return { refused: "no_space", wait: { reason: "no_space", seconds: HELD_RETRY_SECONDS } };
    case "wait":
      return {
        refused: "limit",
        wait: { reason: answer.reason, seconds: Math.max(1, answer.waitSeconds) },
      };
    case "refused":
      return { refused: answer.refused, wait: null };
  }
}

/** A held file asks again after this long, while the page is open (screen N). */
export const HELD_RETRY_SECONDS = 120;

/** The banner a waiting file puts at the top (one at a time, the most important first). */
export type Banner =
  "drive_unavailable" | "daily_limit" | "too_many" | "no_space" | "stopped" | null;

export function bannerOf(files: readonly PageFile[], stopped: boolean): Banner {
  if (stopped) return "stopped";
  const reasons = new Set(files.map((file) => file.waiting).filter(Boolean));
  if (reasons.has("drive_unavailable")) return "drive_unavailable";
  if (reasons.has("daily_limit")) return "daily_limit";
  if (reasons.has("too_many") || reasons.has("busy")) return "too_many";
  if (reasons.has("no_space")) return "no_space";
  return null;
}

export const BANNER_WORDS: Record<Exclude<Banner, null>, { title: string; text: string }> = {
  drive_unavailable: {
    title: "The studio's Drive can't take files right now.",
    text: "Keep this page open and it tries again by itself every few minutes, or come back later. Files already received are safe.",
  },
  daily_limit: {
    title: "Paused by Google's daily upload limit.",
    text: "The studio's Drive has taken in all Google allows for today. Keep this page open; it carries on by itself when Google allows it, or come back later.",
  },
  too_many: {
    title: "Slow down a moment.",
    text: "Too many files were started from this network in a short time. Uploads carry on by themselves in about a minute.",
  },
  no_space: {
    title: "The studio's storage is nearly full.",
    text: "Some of your files may not fit. Tell the person who sent you this link; your other files are sent as usual.",
  },
  stopped: {
    title: "The studio has stopped this link.",
    text: "Files that were halfway may still finish; nothing new can start.",
  },
};

/** "Welcome back" (screen J): what this device sent before, and what didn't finish. */
export function welcomeWords(files: readonly UploaderOwnFile[]): {
  line: string;
  unfinished: UploaderOwnFile[];
} {
  const arrived = files.filter((file) => file.state === "done").length;
  const unfinished = files.filter((file) => file.state !== "done");
  if (files.length === 0) return { line: "Nothing has arrived from this device yet.", unfinished };
  const device = "from this device";
  if (unfinished.length === 0) {
    return {
      line: `All ${arrived} ${arrived === 1 ? "file" : "files"} arrived ${device}.`,
      unfinished,
    };
  }
  return {
    line: `${arrived} of ${files.length} files arrived ${device}. The other ${unfinished.length} didn't finish. Choose them again: files already received are skipped, and the rest carry on.`,
    unfinished,
  };
}

/** The folder path of a file chosen inside a folder (`webkitRelativePath`), without its name. */
export function folderOf(webkitRelativePath: string): string {
  const parts = webkitRelativePath.split("/").filter((part) => part !== "");
  return parts.slice(0, -1).join("/");
}

/** Files grouped by folder for the laptop's list (sample §4); "" is loose files, first. */
export function byFolder<T extends { relativePath: string }>(files: readonly T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const list = groups.get(file.relativePath) ?? [];
    list.push(file);
    groups.set(file.relativePath, list);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
  );
}

/** The short tag in a file's icon ("MOV", "HEIC"), as on the Admin's sheet. */
export const tagOf = fileTag;
