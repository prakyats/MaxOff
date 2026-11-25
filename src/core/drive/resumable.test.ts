import { describe, expect, it } from "vitest";

import { DriveApiError, DriveAuthError, type Fetch } from "./google";
import {
  checkPolicy,
  fileStillThere,
  openResumableSession,
  type ResumableTarget,
  sessionStatus,
  UploadPolicyError,
} from "./resumable";

const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const SESSION = `${UPLOAD_URL}?uploadType=resumable&upload_id=abc`;
const BARE: ResumableTarget = {
  folderId: "folder1",
  name: "Day 1 CAM A.mov",
  size: 5_000_000,
  mimeType: "video/quicktime",
};
const TARGET: ResumableTarget = {
  ...BARE,
  description: "Sent by Sam through MaxOff for Brand reel",
};

type Call = { url: string; init: RequestInit | undefined };

/** A fake Google that records each call and answers with `answer`. */
function fakeGoogle(answer: (call: Call) => Response): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: Fetch = async (input, init) => {
    const call = { url: String(input), init };
    calls.push(call);
    return answer(call);
  };
  return { fetch, calls };
}

const opened = () =>
  fakeGoogle(() => new Response(null, { status: 200, headers: { location: SESSION } }));

function open(fetch: Fetch, target: Partial<ResumableTarget> = {}, policy = {}) {
  return openResumableSession(fetch, "token-1", {
    target: { ...TARGET, ...target },
    policy,
    origin: "https://app.maxoff.in",
  });
}

describe("opening a resumable session", () => {
  it.each([
    [{ name: "" }, {}, "bad_name"],
    [{ name: "x".repeat(256) }, {}, "bad_name"],
    [{ name: "bad\u0007name.mov" }, {}, "bad_name"],
    [{ size: 0 }, {}, "empty"],
    [{ size: 1.5 }, {}, "empty"],
    [{ size: 2_000 }, { maxBytes: 1_000 }, "too_big"],
    [
      { mimeType: "application/pdf" },
      { allowedTypes: ["video/*", "image/png"] },
      "type_not_allowed",
    ],
    [{ mimeType: "" }, { allowedTypes: ["video/*"] }, "type_not_allowed"],
  ] as const)(
    "refuses %j under %j as %s, without asking Google",
    async (target, policy, reason) => {
      const google = opened();
      const refusal = open(google.fetch, target, policy);
      await expect(refusal).rejects.toBeInstanceOf(UploadPolicyError);
      await expect(refusal).rejects.toMatchObject({ reason });
      expect(google.calls).toHaveLength(0);
      expect(checkPolicy({ ...TARGET, ...target }, policy)).toBe(reason);
    },
  );

  it("accepts a type family, an exact type, and anything with no list", () => {
    expect(checkPolicy(TARGET, { allowedTypes: ["video/*"] })).toBeNull();
    expect(checkPolicy(TARGET, { allowedTypes: ["video/quicktime"] })).toBeNull();
    expect(checkPolicy(TARGET, { maxBytes: TARGET.size })).toBeNull();
    expect(checkPolicy({ ...TARGET, mimeType: "" }, {})).toBeNull();
  });

  it("asks Google with the size, type, origin and token, and the name, folder and note", async () => {
    const google = opened();
    await expect(open(google.fetch)).resolves.toEqual({ sessionUrl: SESSION });

    expect(google.calls).toHaveLength(1);
    const [call] = google.calls;
    expect(call?.url).toMatch(new RegExp(`^${UPLOAD_URL}\\?uploadType=resumable`));
    expect(call?.url).toContain("fields=id,name,size,md5Checksum,mimeType,parents");
    expect(call?.init?.method).toBe("POST");
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer token-1");
    expect(headers.get("x-upload-content-length")).toBe("5000000");
    expect(headers.get("x-upload-content-type")).toBe("video/quicktime");
    expect(headers.get("origin")).toBe("https://app.maxoff.in");
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      name: "Day 1 CAM A.mov",
      parents: ["folder1"],
      description: "Sent by Sam through MaxOff for Brand reel",
    });
  });

  it("sends an unknown type as octet-stream and leaves out an empty description", async () => {
    const google = opened();
    await openResumableSession(google.fetch, "token-1", {
      target: { ...BARE, mimeType: "" },
      policy: {},
      origin: "https://app.maxoff.in",
    });
    const [call] = google.calls;
    expect(new Headers(call?.init?.headers).get("x-upload-content-type")).toBe(
      "application/octet-stream",
    );
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      name: "Day 1 CAM A.mov",
      parents: ["folder1"],
    });
  });

  it("turns a refused token into DriveAuthError", async () => {
    const google = fakeGoogle(() => new Response(null, { status: 401 }));
    await expect(open(google.fetch)).rejects.toBeInstanceOf(DriveAuthError);
  });

  it("passes Google's own message and status on another refusal", async () => {
    const google = fakeGoogle(() =>
      Response.json(
        { error: { message: "The user's Drive storage quota has been exceeded." } },
        {
          status: 403,
        },
      ),
    );
    const failure = open(google.fetch);
    await expect(failure).rejects.toBeInstanceOf(DriveApiError);
    await expect(failure).rejects.toMatchObject({
      status: 403,
      message: "The user's Drive storage quota has been exceeded.",
    });
  });

  it("is a DriveApiError when Google gives no upload address, or a foreign one", async () => {
    const none = fakeGoogle(() => new Response(null, { status: 200 }));
    await expect(open(none.fetch)).rejects.toBeInstanceOf(DriveApiError);
    const foreign = fakeGoogle(
      () => new Response(null, { status: 200, headers: { location: "https://evil.example/up" } }),
    );
    await expect(open(foreign.fetch)).rejects.toMatchObject({
      name: "DriveApiError",
      message: "Google gave no upload address",
    });
  });
});

describe("a session's status", () => {
  it("asks with an empty PUT and reads the Range Google holds", async () => {
    const google = fakeGoogle(
      () => new Response(null, { status: 308, headers: { range: "bytes=0-262143" } }),
    );
    await expect(
      sessionStatus(google.fetch, { sessionUrl: SESSION, size: 1_000_000 }),
    ).resolves.toEqual({ state: "incomplete", received: 262_144 });
    const [call] = google.calls;
    expect(call?.url).toBe(SESSION);
    expect(call?.init?.method).toBe("PUT");
    expect(new Headers(call?.init?.headers).get("content-range")).toBe("bytes */1000000");
    expect(call?.init?.body).toBeUndefined();
  });

  it("reads a 308 without Range as nothing received", async () => {
    const google = fakeGoogle(() => new Response(null, { status: 308 }));
    await expect(sessionStatus(google.fetch, { sessionUrl: SESSION, size: 10 })).resolves.toEqual({
      state: "incomplete",
      received: 0,
    });
  });

  it("gives the finished file on 200", async () => {
    const google = fakeGoogle(() =>
      Response.json({
        id: "drive1",
        name: "Day 1 CAM A.mov",
        size: "5000000",
        md5Checksum: "abc123",
        mimeType: "video/quicktime",
      }),
    );
    await expect(
      sessionStatus(google.fetch, { sessionUrl: SESSION, size: 5_000_000 }),
    ).resolves.toEqual({
      state: "complete",
      file: {
        id: "drive1",
        name: "Day 1 CAM A.mov",
        size: 5_000_000,
        md5Checksum: "abc123",
        mimeType: "video/quicktime",
      },
    });
  });

  it("gives a null checksum when Google sends none", async () => {
    const google = fakeGoogle(() => Response.json({ id: "drive1" }, { status: 201 }));
    const status = await sessionStatus(google.fetch, { sessionUrl: SESSION, size: 1 });
    expect(status).toMatchObject({ state: "complete", file: { id: "drive1", md5Checksum: null } });
  });

  it.each([404, 410])("is gone on %i", async (code) => {
    const google = fakeGoogle(() => new Response(null, { status: code }));
    await expect(sessionStatus(google.fetch, { sessionUrl: SESSION, size: 1 })).resolves.toEqual({
      state: "gone",
    });
  });

  it("throws DriveApiError on anything else", async () => {
    const google = fakeGoogle(() => new Response(null, { status: 503 }));
    await expect(
      sessionStatus(google.fetch, { sessionUrl: SESSION, size: 1 }),
    ).rejects.toMatchObject({
      name: "DriveApiError",
      status: 503,
    });
  });
});

describe("whether a file is still in Drive", () => {
  it("asks for the file's id and bin state with the token", async () => {
    const google = fakeGoogle(() => Response.json({ id: "drive/1", trashed: false }));
    await expect(fileStillThere(google.fetch, "token-1", "drive/1")).resolves.toBe("there");
    const [call] = google.calls;
    expect(call?.url).toBe("https://www.googleapis.com/drive/v3/files/drive%2F1?fields=id,trashed");
    expect(new Headers(call?.init?.headers).get("authorization")).toBe("Bearer token-1");
  });

  it("is removed when Google no longer has it", async () => {
    const google = fakeGoogle(() => new Response(null, { status: 404 }));
    await expect(fileStillThere(google.fetch, "token-1", "drive1")).resolves.toBe("removed");
  });

  it("is removed when it is in the bin", async () => {
    const google = fakeGoogle(() => Response.json({ id: "drive1", trashed: true }));
    await expect(fileStillThere(google.fetch, "token-1", "drive1")).resolves.toBe("removed");
  });

  it("turns a refused token into DriveAuthError, and another failure into DriveApiError", async () => {
    const auth = fakeGoogle(() => new Response(null, { status: 401 }));
    await expect(fileStillThere(auth.fetch, "token-1", "drive1")).rejects.toBeInstanceOf(
      DriveAuthError,
    );
    const down = fakeGoogle(() => new Response(null, { status: 500 }));
    await expect(fileStillThere(down.fetch, "token-1", "drive1")).rejects.toMatchObject({
      name: "DriveApiError",
      status: 500,
    });
  });
});
