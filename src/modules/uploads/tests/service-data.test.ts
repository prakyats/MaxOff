import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/service", () => ({ createServiceSupabase: () => null }));

import type { ServiceSupabase } from "@/core/db/service";

import { uploadService } from "../data/service";
import { fakeSupabase } from "./fakes";

const HASH = Uint8Array.from({ length: 32 }, () => 0xab);
const HEX = `\\x${"ab".repeat(32)}`;
const AT = new Date("2026-11-25T10:00:00Z");

function service(answer?: Parameters<typeof fakeSupabase>[0]) {
  const db = fakeSupabase(answer);
  return { svc: uploadService(db.client as unknown as ServiceSupabase), calls: db.calls };
}

/** The service-role repository against a recording Supabase client (DATA-MODEL §8a). */
describe("the upload link's service-role repository", () => {
  it("sends hashes as Postgres hex, never raw bytes, and a missing device key as null", async () => {
    const { svc, calls } = service(() => null);
    await expect(svc.resolve(HASH, null)).resolves.toBeNull();
    await svc.seal("link-1", HASH);
    expect(calls).toEqual([
      {
        kind: "rpc",
        name: "upload_resolve",
        args: [{ p_token_hash: HEX, p_device_key_hash: null }],
      },
      { kind: "rpc", name: "upload_link_seal", args: [{ p_link_id: "link-1", p_token_hash: HEX }] },
    ]);
  });

  it("starts a file with the IP and browser for the database only", async () => {
    const { svc, calls } = service(() => ({ result: "already_sent" }));
    await expect(
      svc.fileStart({
        token: HASH,
        device: HASH,
        name: "a.mp4",
        relativePath: "Day 1",
        sizeBytes: 9,
        mimeType: null,
        ip: "203.0.113.7",
        userAgent: "UA",
      }),
    ).resolves.toEqual({ result: "already_sent" });
    expect(calls[0]?.args[0]).toEqual({
      p_token_hash: HEX,
      p_device_key_hash: HEX,
      p_name: "a.mp4",
      p_relative_path: "Day 1",
      p_size_bytes: 9,
      p_mime_hint: null,
      p_ip: "203.0.113.7",
      p_user_agent: "UA",
    });
  });

  it("calls the Drive check claim with the uploader, the sheet's files and the time", async () => {
    const { svc, calls } = service(() => [{ file_id: "f1", drive_file_id: "d1" }]);
    await expect(svc.driveCheckClaim("up-1", ["f1", "f2"], AT)).resolves.toEqual([
      { file_id: "f1", drive_file_id: "d1" },
    ]);
    expect(calls[0]).toEqual({
      kind: "rpc",
      name: "upload_drive_check_claim",
      args: [{ p_uploader_id: "up-1", p_file_ids: ["f1", "f2"], p_now: AT.toISOString() }],
    });
  });

  it("reads a network's bad-link block without counting a hit", async () => {
    const { svc, calls } = service((call) =>
      call.kind === "from" ? [{ blocked_until: "2026-11-25T10:10:00Z" }] : null,
    );
    await expect(svc.rateBlocked("bad_link", HASH, AT)).resolves.toBe(true);
    expect(calls).toEqual([
      {
        kind: "from",
        name: "upload_rate_hits",
        args: [
          ["select", "blocked_until"],
          ["eq", "bucket", "bad_link"],
          ["eq", "key_hash", HEX],
          ["gt", "blocked_until", AT.toISOString()],
          ["limit", 1],
        ],
      },
    ]);
  });

  it("finds a file only through this token's link and this device's uploader", async () => {
    const row = {
      id: "f1",
      org_id: "org-1",
      link_id: "l1",
      state: "uploading",
      size_bytes: 5,
      drive_parent_id: "p1",
      session_uri_encrypted: "sealed",
      uploader: { device_key_hash: HEX },
      link: { token_hash: HEX },
    };
    const { svc, calls } = service(() => row);
    const file = await svc.ownFile(HASH, HASH, "f1");
    expect(file).toEqual({
      id: "f1",
      org_id: "org-1",
      link_id: "l1",
      state: "uploading",
      size_bytes: 5,
      drive_parent_id: "p1",
      session_uri_encrypted: "sealed",
    });
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        ["eq", "id", "f1"],
        ["eq", "uploader.device_key_hash", HEX],
        ["eq", "link.token_hash", HEX],
      ]),
    );
  });

  it("throws the database's error as it came", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { code: "P0001", message: "NOT_FOUND" } }),
    };
    const svc = uploadService(client as unknown as ServiceSupabase);
    await expect(svc.saidDone(HASH, HASH)).rejects.toMatchObject({ message: "NOT_FOUND" });
  });
});
