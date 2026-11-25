import "server-only";

import type { ServiceSupabase } from "@/core/db/service";
import { DriveApiError, type Fetch } from "@/core/drive/google";
import { UploadPolicyError } from "@/core/drive/resumable";
import { refreshDriveQuota } from "@/core/drive/server";
import {
  DriveUnavailableError,
  openUploadSession,
  unsealSession,
} from "@/core/drive/upload-session";
import { AppError, fail, ok, type Result, toAppError } from "@/core/errors";
import { sameOrigin } from "@/core/http/origin";
import { SECURITY_HEADERS, UPLOAD_API_ROUTE_HEADERS } from "@/core/http/response-headers";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { captureException } from "@/core/observability/capture";
import { type Clock, systemClock, todayIST } from "@/core/time";

import {
  BAD_LINK_MESSAGE,
  cleanIp,
  rateNetwork,
  type DoneAnswer,
  doneBodySchema,
  type FailedAnswer,
  failedBodySchema,
  isDailyUploadLimit,
  type ProgressAnswer,
  progressBodySchema,
  type RegisterAnswer,
  registerBodySchema,
  type ResolveAnswer,
  resolveBodySchema,
  type SaidDoneAnswer,
  saidDoneBodySchema,
  secondsUntil,
  type StartAnswer,
  startBodySchema,
  UPLOAD_API_MAX_BODY_BYTES,
} from "../domain/api";
import {
  deviceKeyHash,
  isTokenShaped,
  rateKeyHash,
  tokenFromBody,
  withoutToken,
  tokenHash,
} from "../domain/token";
import { readLinkKey } from "../data/link-key";
import { serviceClient, type StartRow, uploadService, type UploadService } from "../data/service";
import { hasSession, verifyFinished } from "./verify";

/**
 * The upload page's public API (v4.5, WORKFLOWS §5B.2; security plan A, B, C, F, J), behind the
 * route handlers `src/app/api/upload/<endpoint>/route.ts`. `/api/*` is public in the proxy, so
 * each call authenticates itself by the link's token, sent as `token` in the JSON body (never
 * <token>` and never in a URL (plan A8); no MaxOff session or cookie is read (plan B5, J7).
 *
 * The order of every call: same origin, JSON of at most 64 KB (C7), the network's bad-link block
 * (C1), link opens for `resolve` (C2), the token's shape, the body (zod), then the service-role
 * function, which checks the link is alive itself (A5). Any bad, unknown, stopped or unsealed link
 * gets **one** answer, byte for byte (A6), and counts as a bad-link attempt for the network.
 *
 * Never logged: the token, the device key, the session address, the IP (the network is counted
 * under an HMAC of it). An unexpected error goes to Sentry through the scrubber, and the log
 * line holds only its event id.
 */

/**
 * Plan J: on every answer: the app's security headers with the upload API's own on top (the same
 * list `next.config.ts` sets for `/api/upload/*`; the last one of a name wins).
 */
export const UPLOAD_API_HEADERS: Readonly<Record<string, string>> = Object.fromEntries(
  [...SECURITY_HEADERS, ...UPLOAD_API_ROUTE_HEADERS].map((header) => [header.key, header.value]),
);

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  INVALID_STATE: 409,
  REASON_REQUIRED: 400,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

function answer(result: Result<unknown>, status?: number): Response {
  return Response.json(result, {
    status: status ?? (result.ok ? 200 : (STATUS[result.error.code] ?? 500)),
    headers: UPLOAD_API_HEADERS,
  });
}

/** The one answer for every link that does not work (plan A6): no title, no studio, no hint. */
function badLink(): Response {
  return answer(fail("NOT_FOUND", BAD_LINK_MESSAGE));
}

/**
 * The app's own origin for a link back to the task, which is not the page's when the upload page
 * has an origin of its own (plan J9, `upload.maxoff.in`): the configured app URL, else the page's.
 */
function appOrigin(pageOrigin: string): string {
  try {
    return process.env.NEXT_PUBLIC_APP_URL
      ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
      : pageOrigin;
  } catch {
    return pageOrigin;
  }
}

/** What every handler is given once the token passed its shape check. */
export type PublicCall = {
  token: Uint8Array;
  ip: string | null;
  userAgent: string | null;
  /** The page's own origin (checked same as the request's): Google ties the session's CORS to it. */
  origin: string;
};

export type PublicDeps = {
  svc: UploadService;
  service: ServiceSupabase;
  fetchImpl: Fetch;
  clock: Clock;
  /** C8: one organisation's Drive quota read again (`core/drive`). */
  refreshQuota: typeof refreshDriveQuota;
};

function defaultDeps(): PublicDeps {
  const service = serviceClient();
  return {
    svc: uploadService(service),
    service,
    fetchImpl: fetch,
    clock: systemClock,
    refreshQuota: refreshDriveQuota,
  };
}

async function device(deviceKey: string): Promise<Uint8Array> {
  return deviceKeyHash(deviceKey);
}

// --- The handlers -------------------------------------------------------------------------------

async function resolve(body: unknown, call: PublicCall, deps: PublicDeps): Promise<ResolveAnswer> {
  const data = resolveBodySchema.parse(body);
  const row = await deps.svc.resolve(
    call.token,
    data.deviceKey ? await device(data.deviceKey) : null,
  );
  if (!row) throw new AppError("NOT_FOUND");
  return {
    studioName: row.studio_name,
    taskTitle: row.task_title,
    canStart: row.can_start,
    waitSeconds: row.wait_seconds,
    uploader: row.uploader
      ? {
          name: row.uploader.name,
          files: row.uploader.files.map((file) => ({
            name: file.name,
            relativePath: file.relative_path,
            sizeBytes: Number(file.size_bytes),
            state: file.state,
          })),
        }
      : null,
  };
}

async function register(
  body: unknown,
  call: PublicCall,
  deps: PublicDeps,
): Promise<RegisterAnswer> {
  const data = registerBodySchema.parse(body);
  const row = await deps.svc.register({
    token: call.token,
    device: await device(data.deviceKey),
    name: data.name,
    ip: call.ip,
    userAgent: call.userAgent,
  });
  // The task's Admins may have been told (not on the task, too many names).
  dispatchPushSoon();
  // Never the uploader's id, nor whether the name matched someone on the task (S4).
  return "refused" in row ? { refused: "rate_limited" } : { registered: true };
}

async function start(body: unknown, call: PublicCall, deps: PublicDeps): Promise<StartAnswer> {
  const data = startBodySchema.parse(body);
  // Google opens no session for an empty file (`checkPolicy`); asked before a row is made.
  if (data.sizeBytes === 0) return { kind: "refused", refused: "empty" };
  // C8 (WORKFLOWS §5B.6; review pass 2): the space guard's quota is read again from Google when
  // the reading is older than 5 minutes. A failed read leaves the last one (the guard still
  // counts what Google took since).
  const staleOrg = await deps.svc.quotaStale(call.token);
  if (staleOrg) {
    await deps
      .refreshQuota({
        service: deps.service,
        orgId: staleOrg,
        fetchImpl: deps.fetchImpl,
        now: deps.clock(),
      })
      .catch(() => undefined);
  }
  const row = await deps.svc.fileStart({
    token: call.token,
    device: await device(data.deviceKey),
    name: data.name,
    relativePath: data.relativePath,
    sizeBytes: data.sizeBytes,
    mimeType: data.mimeType ?? null,
    ip: call.ip,
    userAgent: call.userAgent,
  });
  switch (row.result) {
    case "already_sent":
      return { kind: "already_sent", refused: "already_sent" };
    case "held":
      // The Owner may have been told (space_held).
      dispatchPushSoon();
      return { kind: "held", refused: "no_space", fileId: row.file_id };
    case "wait":
      return { kind: "wait", refused: "limit", reason: row.reason, waitSeconds: row.seconds };
    case "start":
      return openSession(row, call, deps);
  }
}

/**
 * Opens (or hands back) the Google session for a file the database just let start: the task's
 * folder, the uploader's folder and the file's own folders, then the session with the file's
 * fixed name, parent, declared size and a description linking to the task (plan E2). The browser
 * gets the session address only (E1); the database keeps it sealed (E4).
 */
async function openSession(
  row: Extract<StartRow, { result: "start" }>,
  call: PublicCall,
  deps: PublicDeps,
): Promise<StartAnswer> {
  if (row.session_uri_encrypted) {
    try {
      const sessionUrl = await unsealSession(row.session_uri_encrypted);
      return { kind: "start", sessionUrl, fileId: row.file_id, resumed: true };
    } catch {
      // Sealed under another key, or Drive is off here: a new session below.
    }
  }
  const file = await deps.svc.fileRow(row.file_id);
  if (!file) throw new AppError("NOT_FOUND");
  const now = deps.clock();
  const top = row.folders[0];
  const cached = new Map(
    row.folders.flatMap((folder) =>
      folder.drive_folder_id ? [[folder.relative_path, folder.drive_folder_id] as const] : [],
    ),
  );
  const clientName = row.client_id ? await deps.svc.clientName(row.client_id) : null;
  try {
    const opened = await openUploadSession({
      service: deps.service,
      orgId: file.org_id,
      accountId: row.account_sub,
      task: {
        client: row.client_id ? { id: row.client_id, name: clientName ?? "Client" } : null,
        month: todayIST(() => now).slice(0, 7),
        task: { id: row.task_id, title: row.task_title },
      },
      top: top?.name ?? "Uploads",
      relativePath: row.folders.at(-1)?.relative_path ?? "",
      subfolders: {
        find: async (relativePath) => cached.get(relativePath) ?? null,
        put: (relativePath, driveFolderId) =>
          deps.svc.folderPut({
            uploaderId: row.uploader_id,
            accountSub: row.account_sub,
            relativePath,
            driveFolderId,
          }),
      },
      file: {
        name: row.name,
        size: Number(row.size_bytes),
        mimeType: row.mime_hint ?? "",
        description: `Sent through a MaxOff upload link for "${row.task_title}": ${appOrigin(call.origin)}/tasks/${row.task_id}`,
      },
      // "Any type, any size" (decided); the database already refused over 5 TB.
      policy: {},
      origin: call.origin,
      fetchImpl: deps.fetchImpl,
      now,
    });
    await deps.svc.sessionSet({
      fileId: row.file_id,
      accountSub: opened.accountId,
      parentId: opened.parentId,
      sealedSession: opened.sealedSession,
    });
    return { kind: "start", sessionUrl: opened.sessionUrl, fileId: row.file_id, resumed: false };
  } catch (error) {
    if (error instanceof DriveUnavailableError) {
      return { kind: "wait", refused: "limit", reason: "drive_unavailable", waitSeconds: 300 };
    }
    if (error instanceof UploadPolicyError) return { kind: "refused", refused: error.reason };
    if (error instanceof DriveApiError && isDailyUploadLimit(error.status, error.message)) {
      // §5B.6: the link pauses new files (15 min, then an hour at a time today).
      const until = await deps.svc.dailyLimitHit(file.link_id, now);
      dispatchPushSoon();
      return {
        kind: "wait",
        refused: "limit",
        reason: "daily_limit",
        waitSeconds: secondsUntil(until, now),
      };
    }
    if (error instanceof DriveApiError && (error.status === 429 || error.status >= 500)) {
      return { kind: "wait", refused: "limit", reason: "busy", waitSeconds: 30 };
    }
    throw error;
  }
}

async function progress(
  body: unknown,
  call: PublicCall,
  deps: PublicDeps,
): Promise<ProgressAnswer> {
  const data = progressBodySchema.parse(body);
  const recorded = await deps.svc.progress(
    call.token,
    await device(data.deviceKey),
    data.fileId,
    data.sent,
  );
  return { recorded };
}

async function failed(body: unknown, call: PublicCall, deps: PublicDeps): Promise<FailedAnswer> {
  const data = failedBodySchema.parse(body);
  await deps.svc.fileFailed(call.token, await device(data.deviceKey), data.fileId, data.reason);
  return { state: "failed" };
}

async function done(body: unknown, call: PublicCall, deps: PublicDeps): Promise<DoneAnswer> {
  const data = doneBodySchema.parse(body);
  const file = await deps.svc.ownFile(call.token, await device(data.deviceKey), data.fileId);
  if (!file) throw new AppError("NOT_FOUND");
  // A retry after the watch (or an earlier call) recorded it.
  if (file.state === "done" || file.state === "missing_in_drive") return { state: "done" };
  if (!hasSession(file)) {
    throw new AppError("INVALID_STATE", "This file is not on its way to Google.");
  }
  // At most one Google check per file per 5 seconds (review pass 2): a loop of `done` cannot burn
  // the studio's Drive API quota. The page's report is retried with backoff, so it asks again.
  if (!(await deps.svc.doneCheckClaim(data.fileId, deps.clock()))) {
    throw new AppError("RATE_LIMITED", "Checking this file already. Trying again in a moment.");
  }
  const verdict = await verifyFinished({
    svc: deps.svc,
    service: deps.service,
    file,
    localMd5: data.localMd5 ?? null,
    browserDriveFileId: data.driveFileId ?? null,
    fetchImpl: deps.fetchImpl,
    now: deps.clock(),
  });
  switch (verdict.outcome) {
    case "done":
      return { state: "done" };
    case "failed":
      return { state: "failed", reason: verdict.reason };
    case "incomplete":
      return { state: "incomplete", received: verdict.received };
    case "not_ready":
      // The engine retries a report that failed.
      throw new AppError("INVALID_STATE", "Google doesn't show this file yet. Trying again.");
  }
}

async function saidDone(
  body: unknown,
  call: PublicCall,
  deps: PublicDeps,
): Promise<SaidDoneAnswer> {
  const data = saidDoneBodySchema.parse(body);
  await deps.svc.saidDone(call.token, await device(data.deviceKey));
  dispatchPushSoon();
  return { said: true };
}

const HANDLERS = {
  resolve,
  register,
  start,
  progress,
  failed,
  done,
  "said-done": saidDone,
} as const;

export type UploadEndpoint = keyof typeof HANDLERS;

// --- The wrapper --------------------------------------------------------------------------------

async function readJson(request: Request): Promise<{ body: unknown } | { refused: Response }> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return { refused: answer(fail("VALIDATION", "Send JSON."), 415) };
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > UPLOAD_API_MAX_BODY_BYTES) {
    return { refused: answer(fail("VALIDATION", "This request is too large."), 413) };
  }
  // Read up to the cap and no further, whatever Content-Length said (or if it said nothing):
  // a body is never buffered whole before the 64 KB check (plan C7; review pass 2).
  const text = await readCapped(request, UPLOAD_API_MAX_BODY_BYTES);
  if (text === null) {
    return { refused: answer(fail("VALIDATION", "This request is too large."), 413) };
  }
  try {
    return { body: JSON.parse(text) as unknown };
  } catch {
    return { refused: answer(fail("VALIDATION", "Send JSON.")) };
  }
}

/** The body as text, or null past `max` bytes (the stream is cancelled there). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * One public call, end to end. `deps` is for the tests; the route passes none. Never throws:
 * every outcome is an answer with the plan J headers.
 */
export async function handleUploadApi(
  endpoint: UploadEndpoint,
  request: Request,
  deps: PublicDeps = defaultDeps(),
): Promise<Response> {
  try {
    const originHeader = request.headers.get("origin");
    if (!sameOrigin(originHeader, request.url)) return answer(fail("FORBIDDEN"));
    const origin = new URL(originHeader ?? request.url).origin;
    const read = await readJson(request);
    if ("refused" in read) return read.refused;

    const linkKey = readLinkKey();
    // No key here: no link can work, so every link gets the one answer.
    if (linkKey.mode === "off") return badLink();
    const now = deps.clock();
    const ip = cleanIp(request.headers.get("cf-connecting-ip"));
    const network = await rateKeyHash(linkKey.key, rateNetwork(ip));

    // Plan C1: a network that tried too many bad links is refused every link for 15 minutes.
    if (await deps.svc.rateBlocked("bad_link", network, now)) return badLink();
    // Every public call per network (review pass 2): 1,200 a minute, far above a real bulk upload
    // (a few hundred calls), so a loop of calls is stopped before it costs the database or Google.
    const callsBlocked = await deps.svc.rateHit("call", network, now);
    if (callsBlocked) {
      return answer(
        fail(
          "RATE_LIMITED",
          `Too many tries. Carrying on in ${secondsUntil(callsBlocked, now)} s.`,
        ),
      );
    }
    if (endpoint === "resolve") {
      // Plan C2: link opens per network.
      const blockedUntil = await deps.svc.rateHit("open", network, now);
      if (blockedUntil) {
        return answer(
          fail(
            "RATE_LIMITED",
            `Too many tries. Carrying on in ${secondsUntil(blockedUntil, now)} s.`,
          ),
        );
      }
    }
    const token = tokenFromBody(read.body);
    if (!token || !isTokenShaped(token)) {
      await deps.svc.rateHit("bad_link", network, now);
      return badLink();
    }

    const call: PublicCall = {
      token: await tokenHash(token),
      ip,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      origin,
    };
    try {
      const data: unknown = await HANDLERS[endpoint](withoutToken(read.body), call, deps);
      return answer(ok(data));
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === "NOT_FOUND") {
        await deps.svc.rateHit("bad_link", network, now);
        return badLink();
      }
      throw error;
    }
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code !== "INTERNAL")
      return answer(fail(appError.code, appError.message, appError.fieldErrors));
    const eventId = captureException(appError.cause ?? appError);
    console.error(`[upload] ${endpoint} INTERNAL (sentry event ${eventId})`);
    return answer(fail("INTERNAL"));
  }
}

/** The route handlers' `POST` for each endpoint. */
export function uploadApiPost(endpoint: UploadEndpoint): (request: Request) => Promise<Response> {
  return (request) => handleUploadApi(endpoint, request);
}
