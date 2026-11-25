import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openUploadSession, unsealSession, driveFileFacts, captureException, dispatchPushSoon } =
  vi.hoisted(() => ({
    openUploadSession: vi.fn(),
    unsealSession: vi.fn(),
    driveFileFacts: vi.fn(),
    captureException: vi.fn(() => "event-1"),
    dispatchPushSoon: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/service", () => ({ createServiceSupabase: () => null }));
vi.mock("@/core/observability/capture", () => ({ captureException }));
vi.mock("@/core/notifications/push/dispatch", () => ({ dispatchPushSoon }));
vi.mock("@/core/drive/upload-session", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openUploadSession,
  unsealSession,
  driveFileFacts,
}));

import { DriveApiError } from "@/core/drive/google";
import { DriveUnavailableError } from "@/core/drive/upload-session";

import { handleUploadApi, type PublicDeps, type UploadEndpoint } from "../actions/public-api";
import { BAD_LINK_MESSAGE } from "../domain/api";
import { deviceKeyHash, rateKeyHash, linkKeyBytes, tokenHash } from "../domain/token";
import { DEVICE_KEY, fakeService, fakeSessionGoogle, KEY_BASE64, TOKEN } from "./fakes";

const ORIGIN = "https://app.example";
const NOW = new Date("2026-11-25T10:00:00Z");
const SESSION =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=s1";
const FILE_ID = "11111111-1111-4111-8111-111111111111";

function call(
  endpoint: UploadEndpoint,
  body: unknown,
  options: { token?: string | null; origin?: string | null; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "cf-connecting-ip": "203.0.113.7",
    "user-agent": "Mozilla/5.0 (Linux; Android 14)",
    ...options.headers,
  });
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const token = options.token === undefined ? TOKEN : options.token;
  const withToken =
    token !== null && typeof body === "object" && body !== null ? { ...body, token } : body;
  return new Request(`${ORIGIN}/api/upload/${endpoint}`, {
    method: "POST",
    headers,
    body: typeof withToken === "string" ? withToken : JSON.stringify(withToken),
  });
}

function deps(svc = fakeService(), fetchImpl: typeof fetch = fetch): PublicDeps {
  return { svc, service: {} as PublicDeps["service"], fetchImpl, clock: () => NOW };
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

const START_ROW = {
  result: "start",
  file_id: FILE_ID,
  name: "clip.mp4",
  size_bytes: 1000,
  mime_hint: "video/mp4",
  session_uri_encrypted: null,
  account_sub: "acct-1",
  task_id: "task-1",
  task_title: "Brand reel",
  client_id: "client-1",
  task_folder_id: "task-folder",
  uploader_id: "up-1",
  folders: [
    { relative_path: "", name: "Sam", drive_folder_id: "f-sam" },
    { relative_path: "Day 1", name: "Day 1", drive_folder_id: null },
  ],
} as const;

const FILE_ROW = {
  id: FILE_ID,
  org_id: "org-1",
  link_id: "link-1",
  state: "uploading",
  size_bytes: 1000,
  drive_parent_id: "parent-1",
  session_uri_encrypted: "sealed-session",
};

beforeEach(() => {
  vi.stubEnv("UPLOAD_LINK_KEY", KEY_BASE64);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("the upload API: one answer for every bad link (plan A6, A8, C1)", () => {
  it("refuses a missing, malformed or unknown token with the same answer, and counts each", async () => {
    const svc = fakeService();
    const answers = await Promise.all([
      handleUploadApi("resolve", call("resolve", {}, { token: null }), deps(svc)),
      handleUploadApi("resolve", call("resolve", {}, { token: "short" }), deps(svc)),
      handleUploadApi("resolve", call("resolve", {}), deps(svc)),
      handleUploadApi(
        "start",
        call("start", { deviceKey: DEVICE_KEY }, { token: "x".repeat(44) }),
        deps(svc),
      ),
    ]);
    const bodies = await Promise.all(answers.map((answer) => answer.text()));
    expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404, 404]);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0] ?? "")).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: BAD_LINK_MESSAGE },
    });
    expect(svc.rateHit.mock.calls.filter(([bucket]) => bucket === "bad_link")).toHaveLength(4);
  });

  it("a database NOT_FOUND (stopped link, another device's file) is the same answer", async () => {
    const svc = fakeService({
      fileStart: vi.fn(async () => {
        throw { code: "P0001", message: "NOT_FOUND", details: "Give your name first." };
      }),
    });
    const response = await handleUploadApi(
      "start",
      call("start", { deviceKey: DEVICE_KEY, name: "a.mp4", sizeBytes: 5 }),
      deps(svc),
    );
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: BAD_LINK_MESSAGE },
    });
    expect(svc.rateHit).toHaveBeenCalledWith("bad_link", expect.any(Uint8Array), NOW);
  });

  it("reads the token from the header only, never the URL", async () => {
    const svc = fakeService();
    const request = new Request(`${ORIGIN}/api/upload/resolve?token=${TOKEN}#${TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: "{}",
    });
    expect((await handleUploadApi("resolve", request, deps(svc))).status).toBe(404);
    expect(svc.resolve).not.toHaveBeenCalled();
  });

  it("a network blocked for bad links is refused even a good link, before any lookup", async () => {
    const svc = fakeService({ rateBlocked: vi.fn(async () => true) });
    const response = await handleUploadApi("resolve", call("resolve", {}), deps(svc));
    expect(response.status).toBe(404);
    expect(svc.resolve).not.toHaveBeenCalled();
    const key = await rateKeyHash(linkKeyBytes(KEY_BASE64), "203.0.113.7");
    // The network is counted under an HMAC of the IP, never the IP.
    expect(svc.rateBlocked).toHaveBeenCalledWith("bad_link", key, NOW);
  });

  it("too many link opens from one network answer RATE_LIMITED (screen Q)", async () => {
    const svc = fakeService({ rateHit: vi.fn(async () => new Date("2026-11-25T10:00:30Z")) });
    const response = await handleUploadApi("resolve", call("resolve", {}), deps(svc));
    expect(response.status).toBe(429);
    expect(await json(response)).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
    expect(svc.rateHit).toHaveBeenCalledWith("open", expect.any(Uint8Array), NOW);
    expect(svc.resolve).not.toHaveBeenCalled();
  });

  it("without UPLOAD_LINK_KEY every link is the bad-link answer", async () => {
    vi.stubEnv("UPLOAD_LINK_KEY", "");
    const svc = fakeService();
    const response = await handleUploadApi("resolve", call("resolve", {}), deps(svc));
    expect(response.status).toBe(404);
    expect(svc.resolve).not.toHaveBeenCalled();
  });
});

describe("the upload API: the request itself (plan C7, J)", () => {
  it("answers with no-store, nosniff, no referrer and the isolation headers", async () => {
    const response = await handleUploadApi("resolve", call("resolve", {}), deps());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("refuses another origin, a body over 64 KB and anything but JSON", async () => {
    const svc = fakeService();
    expect(
      (
        await handleUploadApi(
          "resolve",
          call("resolve", {}, { origin: "https://evil.example" }),
          deps(svc),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleUploadApi(
          "register",
          call("register", { deviceKey: DEVICE_KEY, name: "x".repeat(70_000) }),
          deps(svc),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await handleUploadApi(
          "resolve",
          call("resolve", "{}", { headers: { "content-type": "text/plain" } }),
          deps(svc),
        )
      ).status,
    ).toBe(415);
    expect(svc.resolve).not.toHaveBeenCalled();
    expect(svc.register).not.toHaveBeenCalled();
  });

  it("a malformed device key is VALIDATION, before the database", async () => {
    const svc = fakeService();
    const response = await handleUploadApi(
      "register",
      call("register", { deviceKey: "nope", name: "Sam" }),
      deps(svc),
    );
    expect(response.status).toBe(400);
    expect(svc.register).not.toHaveBeenCalled();
  });

  it("an unexpected failure is INTERNAL: reported scrubbed, and no token in the log line", async () => {
    const svc = fakeService({
      resolve: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });
    const response = await handleUploadApi("resolve", call("resolve", {}), deps(svc));
    expect(response.status).toBe(500);
    expect(await json(response)).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    expect(captureException).toHaveBeenCalledTimes(1);
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("event-1");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("203.0.113.7");
  });
});

describe("the upload API: resolve and register (Q4, Q5, B3)", () => {
  it("resolve hashes the token and the device key and answers the studio, the title and own files", async () => {
    const svc = fakeService({
      resolve: vi.fn(async () => ({
        studio_name: "Pixora Clips",
        task_title: "Brand reel",
        can_start: "yes",
        wait_seconds: 0,
        uploader: {
          name: "Sam",
          files: [{ name: "a.mp4", relative_path: "", size_bytes: 12, state: "done" }],
        },
      })),
    });
    const response = await handleUploadApi(
      "resolve",
      call("resolve", { deviceKey: DEVICE_KEY }),
      deps(svc),
    );
    expect(await json(response)).toEqual({
      ok: true,
      data: {
        studioName: "Pixora Clips",
        taskTitle: "Brand reel",
        canStart: "yes",
        waitSeconds: 0,
        uploader: {
          name: "Sam",
          files: [{ name: "a.mp4", relativePath: "", sizeBytes: 12, state: "done" }],
        },
      },
    });
    expect(svc.resolve).toHaveBeenCalledWith(
      await tokenHash(TOKEN),
      await deviceKeyHash(DEVICE_KEY),
    );
  });

  it("register passes the IP and browser to the database and answers no id", async () => {
    const svc = fakeService();
    const response = await handleUploadApi(
      "register",
      call("register", { deviceKey: DEVICE_KEY, name: "Sam" }),
      deps(svc),
    );
    expect(await json(response)).toEqual({ ok: true, data: { registered: true } });
    expect(svc.register).toHaveBeenCalledWith({
      token: await tokenHash(TOKEN),
      device: await deviceKeyHash(DEVICE_KEY),
      name: "Sam",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
    });
    expect(dispatchPushSoon).toHaveBeenCalled();
  });

  it("the 21st new name is an answer, not an error (plan C3)", async () => {
    const svc = fakeService({ register: vi.fn(async () => ({ refused: "rate_limited" })) });
    const response = await handleUploadApi(
      "register",
      call("register", { deviceKey: DEVICE_KEY, name: "Sam" }),
      deps(svc),
    );
    expect(await json(response)).toEqual({ ok: true, data: { refused: "rate_limited" } });
  });
});

describe("the upload API: start opens Google's session (plan E1-E3)", () => {
  it("opens the session in the uploader's folder and hands back only its address", async () => {
    const svc = fakeService({
      fileStart: vi.fn(async () => START_ROW),
      fileRow: vi.fn(async () => FILE_ROW),
    });
    openUploadSession.mockResolvedValue({
      sessionUrl: SESSION,
      sealedSession: "sealed-new",
      parentId: "parent-1",
      accountId: "acct-1",
    });
    const response = await handleUploadApi(
      "start",
      call("start", {
        deviceKey: DEVICE_KEY,
        name: "clip.mp4",
        relativePath: "Day 1",
        sizeBytes: 1000,
        mimeType: "video/mp4",
      }),
      deps(svc),
    );
    const body = await json(response);
    expect(body).toEqual({
      ok: true,
      data: { kind: "start", sessionUrl: SESSION, fileId: FILE_ID, resumed: false },
    });
    // Never a Drive id, the task's id, the folder's name or whether the name is on the task.
    const text = JSON.stringify(body);
    for (const secret of ["parent-1", "acct-1", "task-1", "f-sam", "Sam", "sealed-new", "up-1"]) {
      expect(text).not.toContain(secret);
    }
    const opened = openUploadSession.mock.calls[0]?.[0];
    expect(opened).toMatchObject({
      orgId: "org-1",
      accountId: "acct-1",
      top: "Sam",
      relativePath: "Day 1",
      origin: ORIGIN,
      task: {
        client: { id: "client-1", name: "Acme" },
        month: "2026-11",
        task: { id: "task-1", title: "Brand reel" },
      },
      file: { name: "clip.mp4", size: 1000, mimeType: "video/mp4" },
    });
    // The link back names the app (NEXT_PUBLIC_APP_URL), not the page's origin (plan J9).
    expect(opened.file.description).toContain(
      `${new URL(process.env.NEXT_PUBLIC_APP_URL ?? ORIGIN).origin}/tasks/task-1`,
    );
    // The cached folders are reused; a new one goes through upload_folder_put.
    await expect(opened.subfolders.find("")).resolves.toBe("f-sam");
    await expect(opened.subfolders.find("Day 1")).resolves.toBeNull();
    await opened.subfolders.put("Day 1", "f-day1");
    expect(svc.folderPut).toHaveBeenCalledWith({
      uploaderId: "up-1",
      accountSub: "acct-1",
      relativePath: "Day 1",
      driveFolderId: "f-day1",
    });
    expect(svc.sessionSet).toHaveBeenCalledWith({
      fileId: FILE_ID,
      accountSub: "acct-1",
      parentId: "parent-1",
      sealedSession: "sealed-new",
    });
    expect(svc.fileStart).toHaveBeenCalledWith(
      expect.objectContaining({ name: "clip.mp4", sizeBytes: 1000, ip: "203.0.113.7" }),
    );
  });

  it("hands back the same session for a file asked for again (resumed)", async () => {
    const svc = fakeService({
      fileStart: vi.fn(async () => ({ ...START_ROW, session_uri_encrypted: "sealed-old" })),
    });
    unsealSession.mockResolvedValue(SESSION);
    const response = await handleUploadApi(
      "start",
      call("start", { deviceKey: DEVICE_KEY, name: "clip.mp4", sizeBytes: 1000 }),
      deps(svc),
    );
    expect(await json(response)).toEqual({
      ok: true,
      data: { kind: "start", sessionUrl: SESSION, fileId: FILE_ID, resumed: true },
    });
    expect(openUploadSession).not.toHaveBeenCalled();
    expect(unsealSession).toHaveBeenCalledWith("sealed-old");
  });

  it("maps already sent, held and wait to the engine's refusals", async () => {
    const answers = [
      [{ result: "already_sent" }, { kind: "already_sent", refused: "already_sent" }],
      [
        { result: "held", file_id: FILE_ID },
        { kind: "held", refused: "no_space", fileId: FILE_ID },
      ],
      [
        { result: "wait", seconds: 30, reason: "busy" },
        { kind: "wait", refused: "limit", reason: "busy", waitSeconds: 30 },
      ],
    ] as const;
    for (const [row, data] of answers) {
      const svc = fakeService({ fileStart: vi.fn(async () => row) });
      const response = await handleUploadApi(
        "start",
        call("start", { deviceKey: DEVICE_KEY, name: "a", sizeBytes: 3 }),
        deps(svc),
      );
      expect(await json(response)).toEqual({ ok: true, data });
    }
  });

  it("an empty file is refused before a row is made", async () => {
    const svc = fakeService();
    const response = await handleUploadApi(
      "start",
      call("start", { deviceKey: DEVICE_KEY, name: "a", sizeBytes: 0 }),
      deps(svc),
    );
    expect(await json(response)).toEqual({ ok: true, data: { kind: "refused", refused: "empty" } });
    expect(svc.fileStart).not.toHaveBeenCalled();
  });

  it("Google's daily limit pauses the link (§5B.6) and answers wait", async () => {
    const svc = fakeService({
      fileStart: vi.fn(async () => START_ROW),
      fileRow: vi.fn(async () => FILE_ROW),
    });
    openUploadSession.mockRejectedValue(
      new DriveApiError("The user has exceeded their daily upload limit.", 403),
    );
    const response = await handleUploadApi(
      "start",
      call("start", { deviceKey: DEVICE_KEY, name: "clip.mp4", sizeBytes: 1000 }),
      deps(svc),
    );
    expect(await json(response)).toEqual({
      ok: true,
      data: { kind: "wait", refused: "limit", reason: "daily_limit", waitSeconds: 900 },
    });
    expect(svc.dailyLimitHit).toHaveBeenCalledWith("link-1", NOW);
    expect(svc.sessionSet).not.toHaveBeenCalled();
  });

  it("a Drive that needs reconnecting answers wait (screen R)", async () => {
    const svc = fakeService({
      fileStart: vi.fn(async () => START_ROW),
      fileRow: vi.fn(async () => FILE_ROW),
    });
    openUploadSession.mockRejectedValue(new DriveUnavailableError());
    const response = await handleUploadApi(
      "start",
      call("start", { deviceKey: DEVICE_KEY, name: "clip.mp4", sizeBytes: 1000 }),
      deps(svc),
    );
    expect(await json(response)).toMatchObject({
      ok: true,
      data: { kind: "wait", reason: "drive_unavailable" },
    });
  });
});

describe("the upload API: done is Google's answer, not the browser's (plan F1-F2)", () => {
  const facts = {
    id: "drive-1",
    sizeBytes: 1000,
    md5: "a".repeat(32),
    parents: ["parent-1"],
    trashed: false,
  };

  function doneCase(input: {
    session: { status: number; range?: string; body?: unknown };
    facts?: unknown;
    fileDone?: string;
    localMd5?: string | null;
    driveFileId?: string;
  }) {
    const svc = fakeService({
      ownFile: vi.fn(async () => FILE_ROW),
      fileDone: vi.fn(async () => input.fileDone ?? "done"),
    });
    const google = fakeSessionGoogle({ [SESSION]: input.session });
    unsealSession.mockResolvedValue(SESSION);
    driveFileFacts.mockResolvedValue(input.facts ?? facts);
    const request = call("done", {
      deviceKey: DEVICE_KEY,
      fileId: FILE_ID,
      driveFileId: input.driveFileId ?? "drive-1",
      localMd5: input.localMd5 === undefined ? "a".repeat(32) : input.localMd5,
    });
    return { svc, google, run: () => handleUploadApi("done", request, deps(svc, google.impl)) };
  }

  it("asks the session itself, then files.get, and records the file done", async () => {
    const { svc, google, run } = doneCase({
      session: { status: 200, body: { id: "drive-1", size: "1000" } },
      driveFileId: "something-else",
    });
    expect(await json(await run())).toEqual({ ok: true, data: { state: "done" } });
    // An empty PUT with Content-Range: the status query (plan F1).
    expect(google.seen[0]?.init?.method).toBe("PUT");
    expect(new Headers(google.seen[0]?.init?.headers).get("content-range")).toBe("bytes */1000");
    // The session's own file id, not the browser's.
    expect(driveFileFacts).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", driveFileId: "drive-1" }),
    );
    expect(svc.ownFile).toHaveBeenCalledWith(
      await tokenHash(TOKEN),
      await deviceKeyHash(DEVICE_KEY),
      FILE_ID,
    );
    expect(svc.fileDone).toHaveBeenCalledWith({
      fileId: FILE_ID,
      driveFileId: "drive-1",
      size: 1000,
      md5Drive: "a".repeat(32),
      parentId: "parent-1",
      md5Page: "a".repeat(32),
    });
  });

  it("a size that differs is failed: size_mismatch", async () => {
    const { run } = doneCase({
      session: { status: 200, body: { id: "drive-1" } },
      facts: { ...facts, sizeBytes: 999 },
      fileDone: "failed",
    });
    expect(await json(await run())).toEqual({
      ok: true,
      data: { state: "failed", reason: "size_mismatch" },
    });
  });

  it("another folder is failed: wrong_folder, and the database is told the folder Google holds", async () => {
    const { svc, run } = doneCase({
      session: { status: 200, body: { id: "drive-1" } },
      facts: { ...facts, parents: ["elsewhere"] },
      fileDone: "failed",
    });
    expect(await json(await run())).toEqual({
      ok: true,
      data: { state: "failed", reason: "wrong_folder" },
    });
    expect(svc.fileDone).toHaveBeenCalledWith(expect.objectContaining({ parentId: "elsewhere" }));
  });

  it("an MD5 unlike Google's is failed: damaged", async () => {
    const { svc, run } = doneCase({
      session: { status: 200, body: { id: "drive-1" } },
      localMd5: "b".repeat(32),
      fileDone: "failed",
    });
    expect(await json(await run())).toEqual({
      ok: true,
      data: { state: "failed", reason: "damaged" },
    });
    expect(svc.fileDone).toHaveBeenCalledWith(
      expect.objectContaining({ md5Page: "b".repeat(32), md5Drive: "a".repeat(32) }),
    );
  });

  it("a session Google holds only part of is incomplete, and nothing is recorded", async () => {
    const { svc, run } = doneCase({ session: { status: 308, range: "bytes=0-499" } });
    expect(await json(await run())).toEqual({
      ok: true,
      data: { state: "incomplete", received: 500 },
    });
    expect(svc.fileDone).not.toHaveBeenCalled();
    expect(driveFileFacts).not.toHaveBeenCalled();
  });

  it("another device's file, or another link's, is the bad-link answer", async () => {
    const svc = fakeService({ ownFile: vi.fn(async () => null) });
    const response = await handleUploadApi(
      "done",
      call("done", { deviceKey: DEVICE_KEY, fileId: FILE_ID, localMd5: null }),
      deps(svc),
    );
    expect(response.status).toBe(404);
    expect(svc.fileDone).not.toHaveBeenCalled();
  });
});

describe("the upload API: progress, failed and I'm done", () => {
  it("progress and failed reach the uploader's own file by token and device", async () => {
    const svc = fakeService({ progress: vi.fn(async () => false) });
    const progress = await handleUploadApi(
      "progress",
      call("progress", { deviceKey: DEVICE_KEY, fileId: FILE_ID, sent: 500 }),
      deps(svc),
    );
    expect(await json(progress)).toEqual({ ok: true, data: { recorded: false } });
    expect(svc.progress).toHaveBeenCalledWith(
      await tokenHash(TOKEN),
      await deviceKeyHash(DEVICE_KEY),
      FILE_ID,
      500,
    );
    const failed = await handleUploadApi(
      "failed",
      call("failed", { deviceKey: DEVICE_KEY, fileId: FILE_ID, reason: "gave_up" }),
      deps(svc),
    );
    expect(await json(failed)).toEqual({ ok: true, data: { state: "failed" } });
  });

  it("I'm done always thanks the uploader", async () => {
    const svc = fakeService();
    const response = await handleUploadApi(
      "said-done",
      call("said-done", { deviceKey: DEVICE_KEY }),
      deps(svc),
    );
    expect(await json(response)).toEqual({ ok: true, data: { said: true } });
    expect(svc.saidDone).toHaveBeenCalledTimes(1);
  });
});
