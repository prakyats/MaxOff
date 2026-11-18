import { describe, expect, it } from "vitest";

import { readDriveEnv } from "./env";
import { type CachedFolder, ensureTaskFolder, type FolderStore } from "./ensure";
import { folderName, type FolderStep, taskFolderPath } from "./folders";
import {
  about,
  consentUrl,
  createFolder,
  DRIVE_FILE_SCOPE,
  DriveApiError,
  DriveAuthError,
  exchangeCode,
  FOLDER_MIME,
  refreshAccess,
} from "./google";
import { decryptToken, encryptToken } from "./token-crypto";

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));
const OTHER_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 255 - i)));
const ROOT = { id: "root1", driveFolderId: "r1" };
const NOW = new Date("2026-11-18T10:00:00Z");

describe("the Drive settings", () => {
  const good = {
    GOOGLE_OAUTH_CLIENT_ID: "123-abc.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "a-secret-value",
    DRIVE_TOKEN_KEY: KEY,
  };

  it("is on with all three", () => {
    expect(readDriveEnv(good)).toMatchObject({ mode: "on", clientId: good.GOOGLE_OAUTH_CLIENT_ID });
  });

  it("is not set up with none", () => {
    expect(readDriveEnv({})).toEqual({
      mode: "off",
      reason: "Google Drive is not set up for this environment.",
    });
  });

  it("names a bad or missing value, never prints it", () => {
    const result = readDriveEnv({ ...good, DRIVE_TOKEN_KEY: "c2hvcnQ=" });
    expect(result).toEqual({
      mode: "off",
      reason: "Google Drive settings are incomplete: DRIVE_TOKEN_KEY.",
    });
    const missing = readDriveEnv({ ...good, GOOGLE_OAUTH_CLIENT_SECRET: undefined });
    expect(missing.mode).toBe("off");
    expect(JSON.stringify(missing)).not.toContain(good.GOOGLE_OAUTH_CLIENT_ID);
  });
});

describe("the tokens at rest", () => {
  it("round-trips, and two encryptions of one token differ (fresh IV)", async () => {
    const a = await encryptToken("1//refresh-token", KEY);
    const b = await encryptToken("1//refresh-token", KEY);
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh-token");
    expect(await decryptToken(a, KEY)).toBe("1//refresh-token");
  });

  it("refuses another key and a changed value", async () => {
    const sealed = await encryptToken("token", KEY);
    await expect(decryptToken(sealed, OTHER_KEY)).rejects.toThrow();
    const [version, iv, body] = sealed.split(".");
    const flipped = `${body!.slice(0, -2)}${body!.endsWith("A") ? "B" : "A"}${body!.slice(-1)}`;
    await expect(decryptToken(`${version}.${iv}.${flipped}`, KEY)).rejects.toThrow();
    await expect(decryptToken("plain-text", KEY)).rejects.toThrow("Not a stored Drive token");
  });
});

describe("the folder path", () => {
  it("is Clients / client / month / task for a client's task", () => {
    const path = taskFolderPath({
      client: { id: "c1", name: "Cafe Mocha" },
      month: "2026-11",
      task: { id: "t1", title: "Brand reel" },
    });
    expect(path.map((step) => step.name)).toEqual([
      "Clients",
      "Cafe Mocha",
      "2026-11",
      "Brand reel",
    ]);
    expect(path.map((step) => step.kind)).toEqual(["clients", "client", "month", "task"]);
    // Keyed by ids and the month, never by names.
    expect(path[1]).toMatchObject({ clientId: "c1", taskId: null });
    expect(path[3]).toMatchObject({ clientId: "c1", month: "2026-11", taskId: "t1" });
  });

  it("is Internal / month / task without a client", () => {
    const path = taskFolderPath({
      client: null,
      month: "2026-01",
      task: { id: "t2", title: "Studio tidy" },
    });
    expect(path.map((step) => step.name)).toEqual(["Internal", "2026-01", "Studio tidy"]);
  });

  it("refuses a malformed month", () => {
    expect(() =>
      taskFolderPath({ client: null, month: "2026-13", task: { id: "t", title: "x" } }),
    ).toThrow("Not a month");
  });

  it("names folders on one line, without slashes, never empty, never endless", () => {
    expect(folderName("  Reel / cut\n2  ")).toBe("Reel - cut 2");
    expect(folderName("   ")).toBe("Untitled");
    const long = folderName("x".repeat(500));
    expect(long).toHaveLength(120);
    expect(long.endsWith("…")).toBe(true);
  });
});

/** A fake Google: records each call and answers from a script. */
function fakeFetch(answers: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = answers.shift();
    if (!next) throw new Error("no scripted answer");
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { impl, calls };
}

describe("the Google calls", () => {
  it("asks for drive.file only, offline, with consent and the state", () => {
    const url = new URL(
      consentUrl({
        clientId: "id.apps.googleusercontent.com",
        redirectUri: "https://app.example/cb",
        state: "s1",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(DRIVE_FILE_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("select_account consent");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/cb");
  });

  it("exchanges a code for both tokens and their expiry", async () => {
    const google = fakeFetch([
      {
        status: 200,
        body: {
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3599,
          scope: DRIVE_FILE_SCOPE,
        },
      },
    ]);
    const grant = await exchangeCode(
      google.impl,
      { code: "c", clientId: "id", clientSecret: "sec", redirectUri: "https://app.example/cb" },
      NOW,
    );
    expect(grant).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(NOW.getTime() + 3599_000),
      scopes: [DRIVE_FILE_SCOPE],
    });
    const body = new URLSearchParams(String(google.calls[0]!.init!.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(google.calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
  });

  it("a refused refresh is a reconnect, not a crash", async () => {
    const google = fakeFetch([
      {
        status: 400,
        body: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
      },
    ]);
    await expect(
      refreshAccess(google.impl, { refreshToken: "rt", clientId: "id", clientSecret: "sec" }, NOW),
    ).rejects.toBeInstanceOf(DriveAuthError);
  });

  it("reads the account and its storage under drive.file", async () => {
    const google = fakeFetch([
      {
        status: 200,
        body: {
          user: { emailAddress: "studio@example.com", permissionId: "p123" },
          storageQuota: { limit: "2199023255552", usage: "1000" },
        },
      },
    ]);
    expect(await about(google.impl, "at")).toEqual({
      email: "studio@example.com",
      accountId: "p123",
      totalBytes: 2199023255552,
      usedBytes: 1000,
    });
    expect(new Headers(google.calls[0]!.init!.headers).get("authorization")).toBe("Bearer at");
  });

  it("makes a folder inside its parent, and tells a 401 from other failures", async () => {
    const google = fakeFetch([
      { status: 200, body: { id: "f1" } },
      { status: 401, body: {} },
      {
        status: 403,
        body: { error: { message: "The user's Drive storage quota has been exceeded." } },
      },
    ]);
    expect(await createFolder(google.impl, "at", { name: "Clients", parentId: "root1" })).toEqual({
      id: "f1",
    });
    expect(JSON.parse(String(google.calls[0]!.init!.body))).toEqual({
      name: "Clients",
      mimeType: FOLDER_MIME,
      parents: ["root1"],
    });
    await expect(
      createFolder(google.impl, "at", { name: "x", parentId: null }),
    ).rejects.toBeInstanceOf(DriveAuthError);
    const quota = createFolder(google.impl, "at", { name: "x", parentId: null });
    await expect(quota).rejects.toBeInstanceOf(DriveApiError);
  });
});

/** The folder cache in memory, keyed like `drive_folders`. */
function memoryStore() {
  const rows = new Map<string, CachedFolder & { parent: string | null; name: string }>();
  const key = (step: FolderStep, account: string) =>
    [account, step.kind, step.clientId, step.month, step.taskId].join("|");
  const store: FolderStore = {
    async find(step, account) {
      return rows.get(key(step, account)) ?? null;
    },
    async put(step, account, parent, driveFolderId) {
      const existing = rows.get(key(step, account));
      if (existing) return existing;
      const row = {
        id: `row${rows.size + 1}`,
        driveFolderId,
        parent: parent?.driveFolderId ?? null,
        name: step.name,
      };
      rows.set(key(step, account), row);
      return row;
    },
  };
  return { store, rows };
}

describe("making a task's folder", () => {
  const folder = {
    client: { id: "c1", name: "Cafe Mocha" },
    month: "2026-11",
    task: { id: "t1", title: "Brand reel" },
  };

  it("makes each missing folder inside the one before, once", async () => {
    const { store, rows } = memoryStore();
    const made: Array<{ name: string; parentId: string | null }> = [];
    const make = async (input: { name: string; parentId: string | null }) => {
      made.push(input);
      return { id: `g${made.length}` };
    };
    const task = await ensureTaskFolder({ store, make, accountId: "acct1", root: ROOT, folder });
    expect(made).toEqual([
      { name: "Clients", parentId: "r1" },
      { name: "Cafe Mocha", parentId: "g1" },
      { name: "2026-11", parentId: "g2" },
      { name: "Brand reel", parentId: "g3" },
    ]);
    expect(task.driveFolderId).toBe("g4");
    // Again: nothing new is made.
    await ensureTaskFolder({ store, make, accountId: "acct1", root: ROOT, folder });
    expect(made).toHaveLength(4);
    // The client's next task reuses Clients, the client and the month.
    await ensureTaskFolder({
      store,
      make,
      accountId: "acct1",
      root: ROOT,
      folder: { ...folder, task: { id: "t2", title: "Menu shoot" } },
    });
    expect(made.slice(4)).toEqual([{ name: "Menu shoot", parentId: "g3" }]);
    expect(rows.size).toBe(5);
  });

  it("resumes after a stop half way, and another account gets its own folders", async () => {
    const { store } = memoryStore();
    let calls = 0;
    const failing = async (input: { name: string; parentId: string | null }) => {
      calls += 1;
      if (calls === 3) throw new DriveApiError("rate limited", 429);
      return { id: `h${calls}:${input.name}` };
    };
    await expect(
      ensureTaskFolder({ store, make: failing, accountId: "acct1", root: ROOT, folder }),
    ).rejects.toThrow("rate limited");
    const made: string[] = [];
    const make = async (input: { name: string; parentId: string | null }) => {
      made.push(input.name);
      return { id: `k:${input.name}` };
    };
    await ensureTaskFolder({ store, make, accountId: "acct1", root: ROOT, folder });
    expect(made).toEqual(["2026-11", "Brand reel"]);
    await ensureTaskFolder({
      store,
      make,
      accountId: "acct2",
      root: { id: "root2", driveFolderId: "r2" },
      folder,
    });
    expect(made.slice(2)).toEqual(["Clients", "Cafe Mocha", "2026-11", "Brand reel"]);
  });
});
