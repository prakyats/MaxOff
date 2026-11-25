import { describe, expect, it } from "vitest";

import { DriveApiError, DriveAuthError, type Fetch } from "./google";
import {
  bytesFromRange,
  ensureSubfolders,
  fileFacts,
  finishedFileProblem,
  openResumableSession,
  sessionState,
  type SubfolderStore,
} from "./resumable";

type Seen = { url: string; init: RequestInit | undefined };

function fakeFetch(
  answer: (url: string, init?: RequestInit) => Response,
  seen: Seen[] = [],
): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    seen.push({ url, init });
    return answer(url, init);
  }) as Fetch;
}

const SESSION =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc";
const INPUT = {
  name: "C0041.MP4",
  parentId: "folder-v1",
  sizeBytes: 1_000,
  mimeType: "video/mp4",
  description: "MaxOff task https://app.example.com/tasks/t1",
  origin: "https://app.example.com",
};

describe("openResumableSession", () => {
  it("fixes the name, parent, size and origin, and returns Google's address", async () => {
    const seen: Seen[] = [];
    const fetchImpl = fakeFetch(
      () => new Response(null, { status: 200, headers: { location: SESSION } }),
      seen,
    );
    await expect(openResumableSession(fetchImpl, "tok", INPUT)).resolves.toBe(SESSION);
    const call = seen[0];
    expect(call?.url).toContain("uploadType=resumable");
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers["x-upload-content-length"]).toBe("1000");
    expect(headers["x-upload-content-type"]).toBe("video/mp4");
    expect(headers.origin).toBe("https://app.example.com");
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      name: "C0041.MP4",
      parents: ["folder-v1"],
      description: INPUT.description,
    });
  });

  it("sends a neutral type when the browser's claim is missing or too long", async () => {
    const seen: Seen[] = [];
    const fetchImpl = fakeFetch(
      () => new Response(null, { status: 200, headers: { location: SESSION } }),
      seen,
    );
    await openResumableSession(fetchImpl, "tok", { ...INPUT, mimeType: null });
    expect((seen[0]?.init?.headers as Record<string, string>)["x-upload-content-type"]).toBe(
      "application/octet-stream",
    );
  });

  it("refuses a size that is not whole bytes", async () => {
    const fetchImpl = fakeFetch(() => new Response(null, { status: 200 }));
    await expect(
      openResumableSession(fetchImpl, "tok", { ...INPUT, sizeBytes: -1 }),
    ).rejects.toThrow(RangeError);
    await expect(
      openResumableSession(fetchImpl, "tok", { ...INPUT, sizeBytes: 1.5 }),
    ).rejects.toThrow(RangeError);
  });

  it("says when the token is refused, and when Google opens nothing", async () => {
    await expect(
      openResumableSession(
        fakeFetch(() => new Response("{}", { status: 401 })),
        "tok",
        INPUT,
      ),
    ).rejects.toBeInstanceOf(DriveAuthError);
    await expect(
      openResumableSession(
        fakeFetch(() =>
          Response.json({ error: { message: "storageQuotaExceeded" } }, { status: 403 }),
        ),
        "tok",
        INPUT,
      ),
    ).rejects.toMatchObject({ status: 403, message: "storageQuotaExceeded" });
  });

  it("never hands on an address that is not Google's upload endpoint", async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Response(null, { status: 200, headers: { location: "https://evil.example.com/x" } }),
    );
    await expect(openResumableSession(fetchImpl, "tok", INPUT)).rejects.toBeInstanceOf(
      DriveApiError,
    );
  });
});

describe("fileFacts and the finished-file check", () => {
  it("reads size, MD5, parents and the bin flag", async () => {
    const fetchImpl = fakeFetch(() =>
      Response.json({
        id: "f1",
        size: "1000",
        md5Checksum: "ABCDEF0123456789ABCDEF0123456789",
        parents: ["folder-v1"],
      }),
    );
    const facts = await fileFacts(fetchImpl, "tok", "f1");
    expect(facts).toEqual({
      id: "f1",
      sizeBytes: 1000,
      md5: "abcdef0123456789abcdef0123456789",
      parents: ["folder-v1"],
      trashed: false,
    });
    expect(finishedFileProblem(facts, { sizeBytes: 1000, parentId: "folder-v1" })).toBeNull();
    expect(finishedFileProblem(facts, { sizeBytes: 999, parentId: "folder-v1" })).toBe(
      "size_mismatch",
    );
    expect(finishedFileProblem(facts, { sizeBytes: 1000, parentId: "other" })).toBe("wrong_folder");
    expect(
      finishedFileProblem(facts && { ...facts, trashed: true }, {
        sizeBytes: 1000,
        parentId: "folder-v1",
      }),
    ).toBe("missing");
  });

  it("is null for a 404, and throws for anything else (an outage is never 'removed')", async () => {
    await expect(
      fileFacts(
        fakeFetch(() => new Response("{}", { status: 404 })),
        "tok",
        "f1",
      ),
    ).resolves.toBeNull();
    expect(finishedFileProblem(null, { sizeBytes: 1, parentId: "p" })).toBe("missing");
    await expect(
      fileFacts(
        fakeFetch(() => new Response("{}", { status: 503 })),
        "tok",
        "f1",
      ),
    ).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      fileFacts(
        fakeFetch(() => new Response("{}", { status: 401 })),
        "tok",
        "f1",
      ),
    ).rejects.toBeInstanceOf(DriveAuthError);
  });
});

describe("sessionState", () => {
  it("reads how far a session got", async () => {
    const seen: Seen[] = [];
    const partial = fakeFetch(
      () => new Response(null, { status: 308, headers: { range: "bytes=0-524287" } }),
      seen,
    );
    await expect(sessionState(partial, SESSION, 1000)).resolves.toEqual({
      kind: "partial",
      bytes: 524288,
    });
    expect((seen[0]?.init?.headers as Record<string, string>)["content-range"]).toBe(
      "bytes */1000",
    );
    const none = fakeFetch(() => new Response(null, { status: 308 }));
    await expect(sessionState(none, SESSION, 1000)).resolves.toEqual({ kind: "partial", bytes: 0 });
  });

  it("knows a finished and a lost session", async () => {
    await expect(
      sessionState(
        fakeFetch(() => Response.json({ id: "f9" }, { status: 201 })),
        SESSION,
        1,
      ),
    ).resolves.toEqual({ kind: "complete", fileId: "f9" });
    await expect(
      sessionState(
        fakeFetch(() => new Response(null, { status: 404 })),
        SESSION,
        1,
      ),
    ).resolves.toEqual({
      kind: "gone",
    });
    await expect(
      sessionState(
        fakeFetch(() => new Response(null, { status: 500 })),
        SESSION,
        1,
      ),
    ).rejects.toBeInstanceOf(DriveApiError);
  });

  it("parses Range", () => {
    expect(bytesFromRange(null)).toBe(0);
    expect(bytesFromRange("bytes=0-0")).toBe(1);
    expect(bytesFromRange("garbage")).toBe(0);
  });
});

describe("ensureSubfolders", () => {
  function memoryStore(
    start: Record<string, string> = {},
  ): SubfolderStore & { rows: Record<string, string> } {
    const rows = { ...start };
    return {
      rows,
      find: async (path) => rows[path] ?? null,
      put: async (path, id) => {
        rows[path] ??= id;
        return rows[path];
      },
    };
  }

  it("makes v‹n› then each folder of the path, once", async () => {
    const store = memoryStore();
    const made: { name: string; parentId: string }[] = [];
    let n = 0;
    const make = async (folder: { name: string; parentId: string }) => {
      made.push(folder);
      n += 1;
      return { id: `d${n}` };
    };
    const deepest = await ensureSubfolders({
      parentDriveId: "task",
      top: "v2",
      relativePath: "Day 1/Cam A",
      store,
      make,
    });
    expect(deepest).toBe("d3");
    expect(made).toEqual([
      { name: "v2", parentId: "task" },
      { name: "Day 1", parentId: "d1" },
      { name: "Cam A", parentId: "d2" },
    ]);
    expect(store.rows).toEqual({ "": "d1", "Day 1": "d2", "Day 1/Cam A": "d3" });
    // The same path again makes nothing.
    await ensureSubfolders({
      parentDriveId: "task",
      top: "v2",
      relativePath: "Day 1/Cam A",
      store,
      make,
    });
    expect(made).toHaveLength(3);
  });

  it("uses only the version folder for a phone's files, and keeps the folder that won a race", async () => {
    const store = memoryStore({ "": "existing" });
    const make = async () => ({ id: "never" });
    await expect(
      ensureSubfolders({ parentDriveId: "task", top: "v1", relativePath: "", store, make }),
    ).resolves.toBe("existing");
    const raced: SubfolderStore = { find: async () => null, put: async () => "winner" };
    await expect(
      ensureSubfolders({ parentDriveId: "task", top: "v1", relativePath: "", store: raced, make }),
    ).resolves.toBe("winner");
  });
});
