import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServiceSupabase } from "@/core/db/service";

import { fakeDb } from "./fake-db.test-util";
import { encryptToken } from "./token-crypto";

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/service", () => ({ createServiceSupabase: () => null }));

const { connectionFor, runDriveSpaceCheck, withDrive } = await import("./server");

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));
const OTHER_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 200 - i)));
const NOW = new Date("2026-11-18T10:00:00Z");
const ENV = {
  GOOGLE_OAUTH_CLIENT_ID: "id.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "a-secret-value",
  DRIVE_TOKEN_KEY: KEY,
};

beforeEach(() => {
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function row(overrides: Record<string, unknown> = {}) {
  return {
    org_id: "org-1",
    google_sub: "acct-1",
    refresh_token_encrypted: await encryptToken("refresh-1", KEY),
    access_token_encrypted: await encryptToken("access-old", KEY),
    token_expires_at: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
    root_folder_id: "root-1",
    ...overrides,
  };
}

/** Google, scripted by URL: the token endpoint and Drive's about. */
function google(script: {
  token?: Array<{ status: number; body: unknown }>;
  drive?: Array<{ status: number; body: unknown }>;
}) {
  const seen: string[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    seen.push(
      `${init?.method ?? "GET"} ${href.split("?")[0]} ${new Headers(init?.headers).get("authorization") ?? ""}`.trim(),
    );
    const queue = href.includes("oauth2.googleapis.com/token") ? script.token : script.drive;
    const next = queue?.shift();
    if (!next) throw new Error(`no scripted answer for ${href}`);
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { impl, seen };
}

const service = (db: ReturnType<typeof fakeDb>) => db.client as unknown as ServiceSupabase;

describe("the Worker's access to Drive", () => {
  it("uses a fresh stored access token without asking Google", async () => {
    const db = fakeDb({});
    const g = google({});
    const connection = await connectionFor({
      service: service(db),
      row: await row(),
      fetchImpl: g.impl,
      now: NOW,
    });
    expect(connection?.accessToken).toBe("access-old");
    expect(g.seen).toEqual([]);
  });

  it("a 401 on the stored token is one refresh and a retry, not a reconnect (S2)", async () => {
    const db = fakeDb({ rpc: () => ({ data: true }) });
    const g = google({
      drive: [
        { status: 401, body: {} },
        {
          status: 200,
          body: {
            user: { emailAddress: "a@example.com", permissionId: "acct-1" },
            storageQuota: { usage: "5" },
          },
        },
      ],
      token: [{ status: 200, body: { access_token: "access-new", expires_in: 3600 } }],
    });
    const stored = await row();
    const { about } = await import("./google");
    const space = await withDrive(
      { service: service(db), row: stored, fetchImpl: g.impl, now: NOW },
      (c) => about(g.impl, c.accessToken),
    );
    expect(space?.usedBytes).toBe(5);
    expect(g.seen.at(-1)).toContain("Bearer access-new");
    expect(db.calls.map((c) => c.name)).toEqual(["drive_store_access_token"]);
    // The write names the connection it read (S4).
    expect(db.calls[0]!.args.p_read_refresh_enc).toBe(stored.refresh_token_encrypted);
  });

  it("a refused refresh marks this connection needs-reconnect", async () => {
    const db = fakeDb({ rpc: () => ({ data: true }) });
    const g = google({ token: [{ status: 400, body: { error: "invalid_grant" } }] });
    const stored = await row({ access_token_encrypted: null });
    expect(
      await connectionFor({ service: service(db), row: stored, fetchImpl: g.impl, now: NOW }),
    ).toBeNull();
    expect(db.calls).toEqual([
      {
        name: "drive_mark_needs_reconnect",
        args: {
          p_org: "org-1",
          p_read_refresh_enc: stored.refresh_token_encrypted,
          p_error: "invalid_grant",
        },
      },
    ]);
  });

  it("a wrong client secret is our failure, reported, never a reconnect (S1)", async () => {
    const db = fakeDb({});
    const g = google({ token: [{ status: 401, body: { error: "invalid_client" } }] });
    await expect(
      connectionFor({
        service: service(db),
        row: await row({ access_token_encrypted: null }),
        fetchImpl: g.impl,
        now: NOW,
      }),
    ).rejects.toThrow("invalid_client");
    expect(db.calls).toEqual([]);
  });

  it("a changed DRIVE_TOKEN_KEY tells the Owner to reconnect (S3)", async () => {
    const db = fakeDb({ rpc: () => ({ data: true }) });
    vi.stubEnv("DRIVE_TOKEN_KEY", OTHER_KEY);
    const g = google({});
    expect(
      await connectionFor({ service: service(db), row: await row(), fetchImpl: g.impl, now: NOW }),
    ).toBeNull();
    expect(db.calls.map((c) => c.name)).toEqual(["drive_mark_needs_reconnect"]);
    expect(String(db.calls[0]!.args.p_error)).toContain("key changed");
    expect(g.seen).toEqual([]);
  });

  it("the space check stores this connection's reading and counts the alert", async () => {
    const stored = await row();
    const db = fakeDb({
      account: stored,
      rpc: (call) => ({
        data:
          call.name === "drive_record_quota"
            ? 80
            : call.name === "upload_drive_check_daily"
              ? []
              : true,
      }),
    });
    const g = google({
      drive: [
        {
          status: 200,
          body: {
            user: { emailAddress: "a@example.com", permissionId: "acct-1" },
            storageQuota: { limit: "100", usage: "85" },
          },
        },
      ],
    });
    const report = await runDriveSpaceCheck({ service: service(db), fetchImpl: g.impl, now: NOW });
    expect(report).toEqual({
      checked: 1,
      alerts: 1,
      needsReconnect: 0,
      failed: [],
      uploads: { checked: 0, removed: 0, restored: 0 },
    });
    expect(db.calls).toEqual([
      {
        name: "drive_record_quota",
        args: {
          p_org: "org-1",
          p_read_refresh_enc: stored.refresh_token_encrypted,
          p_total: 100,
          p_used: 85,
        },
      },
      { name: "upload_drive_check_daily", args: { p_now: NOW.toISOString(), p_limit: 200 } },
    ]);
  });

  it("the daily Removed-in-Drive pass reads each file's metadata and records only 404 or the bin (v4.5)", async () => {
    const due = [
      { file_id: "f1", drive_file_id: "d1", state: "done" },
      { file_id: "f2", drive_file_id: "d2", state: "done" },
      { file_id: "f3", drive_file_id: "d3", state: "missing_in_drive" },
      { file_id: "f4", drive_file_id: "d4", state: "done" },
    ];
    const db = fakeDb({
      account: await row(),
      tables: { upload_files: due.map((file) => ({ id: file.file_id, org_id: "org-1" })) },
      rpc: (call) => {
        if (call.name === "drive_record_quota") return { data: 0 };
        if (call.name === "upload_drive_check_daily") return { data: due };
        if (call.name === "upload_drive_seen")
          return { data: call.args.p_outcome === "present" ? "done" : "missing_in_drive" };
        return { data: true };
      },
    });
    const g = google({
      drive: [
        {
          status: 200,
          body: {
            user: { emailAddress: "a@example.com", permissionId: "acct-1" },
            storageQuota: { usage: "1" },
          },
        },
        { status: 404, body: {} },
        { status: 200, body: { id: "d2", trashed: true } },
        { status: 200, body: { id: "d3", trashed: false } },
        // A passing error marks nothing.
        { status: 503, body: {} },
      ],
    });
    const report = await runDriveSpaceCheck({ service: service(db), fetchImpl: g.impl, now: NOW });
    expect(report.uploads).toEqual({ checked: 3, removed: 2, restored: 1 });
    expect(report.failed).toEqual([]);
    expect(g.seen.slice(1)).toEqual([
      "GET https://www.googleapis.com/drive/v3/files/d1 Bearer access-old",
      "GET https://www.googleapis.com/drive/v3/files/d2 Bearer access-old",
      "GET https://www.googleapis.com/drive/v3/files/d3 Bearer access-old",
      "GET https://www.googleapis.com/drive/v3/files/d4 Bearer access-old",
    ]);
    expect(db.calls.filter((c) => c.name === "upload_drive_seen").map((c) => c.args)).toEqual([
      { p_file_id: "f1", p_outcome: "not_found", p_at: NOW.toISOString() },
      { p_file_id: "f2", p_outcome: "trashed", p_at: NOW.toISOString() },
      { p_file_id: "f3", p_outcome: "present", p_at: NOW.toISOString() },
    ]);
    // Never a delete, a move or a trash: reads only.
    expect(g.seen.every((line) => line.startsWith("GET "))).toBe(true);
  });
});
