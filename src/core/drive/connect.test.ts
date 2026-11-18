import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type RpcCall } from "./fake-db.test-util";
import { DRIVE_FILE_SCOPE } from "./google";
import { encryptToken } from "./token-crypto";

/**
 * The Owner's Google sign-in callback (review S10): every way back from Google, with the
 * session, the state cookie, both database clients and Google itself as stand-ins.
 */
vi.mock("server-only", () => ({}));
const captured: unknown[] = [];
vi.mock("@/core/observability/capture", () => ({
  captureException: (error: unknown) => {
    captured.push(error);
    return "event-1";
  },
}));

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: ({ name }: { name: string }) => jar.delete(name),
  }),
  headers: async () => new Headers({ host: "app.example" }),
}));

let member: { id: string; role: string } | null = { id: "owner-1", role: "owner" };
vi.mock("@/core/auth/server", () => ({ getCurrentMember: async () => member }));

let userDb = fakeDb({});
let serviceDb = fakeDb({});
vi.mock("@/core/db/server", () => ({ createServerSupabase: async () => userDb.client }));
vi.mock("@/core/db/service", () => ({ createServiceSupabase: () => serviceDb.client }));

const { completeDriveConnect } = await import("./connect");

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));
const STATE = "s".repeat(43);

beforeEach(() => {
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "a-secret-value");
  vi.stubEnv("DRIVE_TOKEN_KEY", KEY);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
  member = { id: "owner-1", role: "owner" };
  jar.clear();
  jar.set("maxoff_drive_state", `${STATE}.owner-1`);
  captured.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

type Answer = { status: number; body: unknown };

/** Google: the token exchange, about, folder reads and creates, and revoke, by URL. */
function google(input: { token?: Answer; account?: string; folderGet?: Answer }) {
  const seen: string[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";
    seen.push(`${method} ${href.split("?")[0]}`);
    const reply = (answer: Answer) =>
      new Response(JSON.stringify(answer.body), { status: answer.status });
    if (href.includes("/token")) {
      return reply(
        input.token ?? {
          status: 200,
          body: {
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
            scope: DRIVE_FILE_SCOPE,
          },
        },
      );
    }
    if (href.includes("/revoke")) return reply({ status: 200, body: {} });
    if (href.includes("/about")) {
      return reply({
        status: 200,
        body: {
          user: { emailAddress: "studio@example.com", permissionId: input.account ?? "acct-1" },
          storageQuota: { limit: "100", usage: "10" },
        },
      });
    }
    if (href.includes("/files") && method === "POST")
      return reply({ status: 200, body: { id: "root-new" } });
    if (href.includes("/files"))
      return reply(input.folderGet ?? { status: 200, body: { id: "root-old", trashed: false } });
    throw new Error(`unexpected ${href}`);
  }) as typeof fetch;
  return { impl, seen };
}

const callback = (extra: Record<string, string> = {}) =>
  new URLSearchParams({ state: STATE, code: "code-1", ...extra });

function databases(input: {
  action?: string;
  cachedRoot?: boolean;
  previous?: Record<string, unknown> | null;
  quotaError?: boolean;
}) {
  userDb = fakeDb({ rpc: () => ({ data: input.action ?? "connected" }) });
  serviceDb = fakeDb({
    account: input.previous ?? null,
    rpc: (call: RpcCall) => {
      if (call.name === "drive_folder_find") {
        return {
          data: input.cachedRoot
            ? { id: "row-root", drive_folder_id: "root-old", name: "MaxOff" }
            : null,
        };
      }
      if (call.name === "drive_folder_put" || call.name === "drive_folder_replace") {
        return {
          data: {
            id: "row-root",
            drive_folder_id: String(call.args.p_drive_folder_id),
            name: "MaxOff",
          },
        };
      }
      if (call.name === "drive_record_quota") {
        return input.quotaError ? { error: { message: "boom" } } : { data: 0 };
      }
      return {};
    },
  });
}

describe("the Google sign-in callback", () => {
  it("a first connect makes the MaxOff folder and stores the sealed grant", async () => {
    databases({});
    const g = google({});
    expect(await completeDriveConnect(callback(), g.impl)).toBe("/settings/drive?drive=connected");
    const stored = userDb.calls.find((c) => c.name === "drive_connect_complete")!.args;
    expect(stored).toMatchObject({
      p_email: "studio@example.com",
      p_sub: "acct-1",
      p_root_folder_id: "root-new",
    });
    expect(String(stored.p_refresh_enc)).toMatch(/^v1\./);
    expect(String(stored.p_refresh_enc)).not.toContain("refresh-1");
    expect(
      serviceDb.calls.find((c) => c.name === "drive_record_quota")?.args.p_read_refresh_enc,
    ).toBe(stored.p_refresh_enc);
    expect(jar.has("maxoff_drive_state")).toBe(false);
  });

  it("a reconnect of the same account reuses its folder and revokes nothing", async () => {
    databases({
      action: "reconnected",
      cachedRoot: true,
      previous: {
        google_sub: "acct-1",
        refresh_token_encrypted: await encryptToken("refresh-0", KEY),
      },
    });
    const g = google({});
    expect(await completeDriveConnect(callback(), g.impl)).toBe(
      "/settings/drive?drive=reconnected",
    );
    expect(userDb.calls[0]!.args.p_root_folder_id).toBe("root-old");
    expect(g.seen.some((line) => line.includes("revoke"))).toBe(false);
    expect(g.seen.some((line) => line.startsWith("POST") && line.includes("/files"))).toBe(false);
  });

  it("a cached folder that was put in the bin is replaced, keeping the key (S6)", async () => {
    databases({ action: "reconnected", cachedRoot: true });
    const g = google({ folderGet: { status: 200, body: { id: "root-old", trashed: true } } });
    await completeDriveConnect(callback(), g.impl);
    expect(serviceDb.calls.find((c) => c.name === "drive_folder_replace")?.args).toMatchObject({
      p_id: "row-root",
      p_drive_folder_id: "root-new",
    });
    expect(userDb.calls[0]!.args.p_root_folder_id).toBe("root-new");
  });

  it("switching accounts revokes the old account's grant", async () => {
    databases({
      action: "account_switched",
      previous: {
        google_sub: "acct-old",
        refresh_token_encrypted: await encryptToken("refresh-old", KEY),
      },
    });
    const g = google({ account: "acct-new" });
    expect(await completeDriveConnect(callback(), g.impl)).toBe(
      "/settings/drive?drive=account_switched",
    );
    expect(g.seen).toContain("POST https://oauth2.googleapis.com/revoke");
  });

  it("a failed first space reading still says connected (S5)", async () => {
    databases({ quotaError: true });
    expect(await completeDriveConnect(callback(), google({}).impl)).toBe(
      "/settings/drive?drive=connected",
    );
    expect(captured).toHaveLength(1);
  });

  it("no lasting access, or not drive.file, is no_access and stores nothing", async () => {
    for (const body of [
      { access_token: "a", expires_in: 3600, scope: DRIVE_FILE_SCOPE },
      { access_token: "a", refresh_token: "r", expires_in: 3600, scope: "openid" },
    ]) {
      databases({});
      jar.set("maxoff_drive_state", `${STATE}.owner-1`);
      expect(
        await completeDriveConnect(callback(), google({ token: { status: 200, body } }).impl),
      ).toBe("/settings/drive?drive=no_access");
      expect(userDb.calls).toEqual([]);
    }
  });

  it("refuses another member's state, a missing cookie and a forged state", async () => {
    databases({});
    jar.set("maxoff_drive_state", `${STATE}.someone-else`);
    expect(await completeDriveConnect(callback(), google({}).impl)).toBe(
      "/settings/drive?drive=expired",
    );
    expect(await completeDriveConnect(callback(), google({}).impl)).toBe(
      "/settings/drive?drive=expired",
    );
    jar.set("maxoff_drive_state", `${STATE}.owner-1`);
    expect(await completeDriveConnect(callback({ state: "forged" }), google({}).impl)).toBe(
      "/settings/drive?drive=expired",
    );
    expect(userDb.calls).toEqual([]);
  });

  it("a cancelled consent is cancelled; an Admin and nobody never get that far", async () => {
    databases({});
    expect(await completeDriveConnect(callback({ error: "access_denied" }), google({}).impl)).toBe(
      "/settings/drive?drive=cancelled",
    );
    member = { id: "admin-1", role: "admin" };
    expect(await completeDriveConnect(callback(), google({}).impl)).toBe(
      "/forbidden?for=drive.manage",
    );
    member = null;
    expect(await completeDriveConnect(callback(), google({}).impl)).toBe("/login");
    expect(userDb.calls).toEqual([]);
  });
});
