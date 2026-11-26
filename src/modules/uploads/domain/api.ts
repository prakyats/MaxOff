/**
 * The upload page's public API (v4.5, WORKFLOWS §5B.2; security plan A, B, C, F, J): what each
 * `/api/upload/*` call takes and answers. Platform-free: the route wrapper and the handlers parse
 * with these, and the page (the screens unit) builds its calls from the same types.
 *
 * Every call is a `POST` with a JSON body of at most 64 KB (plan C7) carrying the link's token as
 * `token` (plan A8; never a header or a URL). The browser sends its 32-byte device key as 43
 * base64url characters; the server keeps only its sha256 (plan B3). The answer is a `Result`
 * (`{ ok: true, data }` or `{ ok: false, error: { code, message } }`); a bad, unknown, stopped
 * or unsealed link is always the one `NOT_FOUND` answer (plan A6).
 */
import { z } from "zod";

import { isDeviceKeyShaped } from "./token";

/** Plan C7: metadata only; the bytes go to Google. */
export const UPLOAD_API_MAX_BODY_BYTES = 64 * 1024;

/** The words of the one answer every bad link gets (sample screen L). */
export const BAD_LINK_MESSAGE = "This upload link doesn't work any more.";

/** The database's own ceiling for a declared size (DATA-MODEL §8a, `upload_file_start`). */
export const MAX_DECLARED_BYTES = 5_000_000_000_000;

const deviceKey = z
  .string()
  .refine(isDeviceKeyShaped, { error: "This device's key is not valid. Reload the page." });

const fileId = z.uuid({ error: "Unknown file." });

export const resolveBodySchema = z.object({ deviceKey: deviceKey.nullish() });

export const registerBodySchema = z.object({
  deviceKey,
  // The database cleans and checks the name (1-60 after cleaning); this only bounds the request.
  name: z.string().max(400, { error: "Type your name (1 to 60 characters)." }),
});

export const startBodySchema = z.object({
  deviceKey,
  name: z.string().min(1).max(1000),
  relativePath: z.string().max(4000).default(""),
  sizeBytes: z.number().int().min(0).max(MAX_DECLARED_BYTES),
  mimeType: z.string().max(200).nullish(),
});

export const progressBodySchema = z.object({
  deviceKey,
  fileId,
  sent: z.number().int().min(0).max(MAX_DECLARED_BYTES),
});

export const failedBodySchema = z.object({
  deviceKey,
  fileId,
  reason: z.enum(["gave_up", "unreadable"]),
});

export const doneBodySchema = z.object({
  deviceKey,
  fileId,
  /** What the engine heard from Google; a hint only, the server asks Google itself (plan F1). */
  driveFileId: z.string().max(200).nullish(),
  /** The page's own MD5 of the file (plan F2), lower-case hex, or null when it had none. */
  localMd5: z
    .string()
    .regex(/^[0-9a-fA-F]{32}$/)
    .nullish(),
});

export const saidDoneBodySchema = z.object({ deviceKey });

export type ResolveBody = z.infer<typeof resolveBodySchema>;
export type RegisterBody = z.infer<typeof registerBodySchema>;
export type StartBody = z.input<typeof startBodySchema>;
export type ProgressBody = z.infer<typeof progressBodySchema>;
export type FailedBody = z.infer<typeof failedBodySchema>;
export type DoneBody = z.infer<typeof doneBodySchema>;
export type SaidDoneBody = z.infer<typeof saidDoneBodySchema>;

/** A file as its own uploader sees it ("Welcome back", Q4): never an id, never "Removed in Drive". */
export type UploaderOwnFile = {
  name: string;
  relativePath: string;
  sizeBytes: number;
  state: "held" | "uploading" | "done" | "failed";
};

/** `POST /api/upload/resolve`: the studio's name and the task's title only (Q5). */
export type ResolveAnswer = {
  studioName: string;
  taskTitle: string;
  /** `drive_unavailable`: screen R; `paused`: Google's daily limit, screen O. */
  canStart: "yes" | "drive_unavailable" | "paused";
  waitSeconds: number;
  /** This device's uploader, when it has sent before ("Welcome back, Sam"). */
  uploader: { name: string; files: UploaderOwnFile[] } | null;
};

/** `POST /api/upload/register`: the 21st new name on the link today is refused (plan C3). */
export type RegisterAnswer = { registered: true } | { refused: "rate_limited" };

export type WaitReason = "drive_unavailable" | "daily_limit" | "busy" | "too_many";

/**
 * `POST /api/upload/start`. `start` is the engine's `OpenedSession` (`core/upload`); the others
 * carry the engine's `refused` word, and `kind` for the page to tell a held or waiting file (it
 * asks again by itself) from one that is never retried.
 */
export type StartAnswer =
  | { kind: "start"; sessionUrl: string; fileId: string; resumed: boolean }
  | { kind: "already_sent"; refused: "already_sent" }
  /** Screen N: no room in the studio's Drive; ask again later, it starts when it fits. */
  | { kind: "held"; refused: "no_space"; fileId: string }
  /** Screens O, Q, R: ask again after `waitSeconds`. */
  | { kind: "wait"; refused: "limit"; reason: WaitReason; waitSeconds: number }
  | { kind: "refused"; refused: "empty" | "too_big" | "type_not_allowed" | "bad_name" };

/** `POST /api/upload/progress`: false when dropped (plan C6, one per file per 5 s). */
export type ProgressAnswer = { recorded: boolean };

/** `POST /api/upload/failed`. */
export type FailedAnswer = { state: "failed" };

export type FailedReason = "damaged" | "size_mismatch" | "wrong_folder";

/**
 * `POST /api/upload/done`: Google's own answer (plan F1–F2). `incomplete`: Google holds only
 * `received` bytes, so the engine sends the rest. A file Google cannot show yet is an error the
 * engine retries.
 */
export type DoneAnswer =
  | { state: "done" }
  | { state: "failed"; reason: FailedReason }
  | { state: "incomplete"; received: number };

/** `POST /api/upload/said-done`: always thanks; the database decides whether anyone is told. */
export type SaidDoneAnswer = { said: true };

/** What `finishedFileProblem` (core/drive) found, in the words a failed row keeps. */
export function failedReasonOf(
  problem: "size_mismatch" | "wrong_folder" | "checksum_mismatch",
): FailedReason {
  return problem === "checksum_mismatch" ? "damaged" : problem;
}

/**
 * Is this Google refusal the daily upload limit (Q10, WORKFLOWS §5B.6), rather than storage or a
 * passing rate limit? Google answers 403; its words name the upload or daily limit. (The exact
 * reason codes are the CORS spike's E0.6 to confirm on a test account.)
 */
export function isDailyUploadLimit(status: number, message: string): boolean {
  if (status !== 403) return false;
  if (/storage|quota.*(full|exceeded).*storage/i.test(message)) return false;
  return /upload ?limit|daily ?limit|dailyLimitExceeded|uploadLimitExceeded|upload quota/i.test(
    message,
  );
}

/** Whole seconds from `now` to `until` (at least 1), for a wait answer. */
export function secondsUntil(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}

/**
 * The network a rate limit counts (plan C1-C2; security review pass 2): an IPv4 address itself,
 * an IPv6 address by its /64 (one household or phone gets a whole /64, so a single address is
 * no limit at all). The IP kept on the uploader's rows stays the full address (G2).
 */
export function rateNetwork(ip: string | null): string {
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const full = ip.includes("::")
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  return `${full
    .slice(0, 4)
    .map((part) => part.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

const NUL = String.fromCharCode(0);

/** What the uploader is told when a name holds a character no file system makes (pen test M4). */
export const NUL_MESSAGE =
  "A name here has a character that can't be saved. Rename it and try again.";

/**
 * Any key or string anywhere in a request body holds a NUL (pen test M4). Postgres text can't hold
 * one, so such a name would fail in the database as INTERNAL; the API refuses it first.
 */
export function hasNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes(NUL);
  if (Array.isArray(value)) return value.some(hasNul);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([key, item]) => key.includes(NUL) || hasNul(item));
  }
  return false;
}

/**
 * The uploader's IP as Cloudflare reports it (`cf-connecting-ip`), when it looks like one;
 * anything else is no IP. Kept for 90 days on the uploader's rows only (plan G2, I3), never
 * logged and never in history.
 */
export function cleanIp(header: string | null): string | null {
  const value = header?.trim() ?? "";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255) ? value : null;
  }
  if (value.length <= 45 && value.includes(":") && /^[0-9a-fA-F:.]+$/.test(value)) return value;
  return null;
}
