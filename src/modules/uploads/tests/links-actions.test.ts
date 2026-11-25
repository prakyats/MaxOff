import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { repo, seal, assertPermission, revalidateScreens, dispatchPushSoon } = vi.hoisted(() => ({
  repo: {
    rpcCreateLink: vi.fn(async () => "link-1"),
    rpcRenewLink: vi.fn(async () => "link-2"),
    rpcStopLink: vi.fn(async () => undefined),
    rpcLinkSecret: vi.fn(async (linkId: string) => ({
      linkId,
      salt: Uint8Array.from({ length: 16 }, (_, i) => i),
      keyVersion: 1,
    })),
    rpcFilesReceived: vi.fn(async () => "primary_told"),
    rpcEraseNetwork: vi.fn(async () => true),
  },
  seal: vi.fn(async () => true),
  assertPermission: vi.fn(async () => ({ id: "m1", role: "admin" })),
  revalidateScreens: vi.fn(),
  dispatchPushSoon: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "app.example", "x-forwarded-proto": "https" }),
}));
vi.mock("@/core/permissions/server", () => ({ assertPermission }));
vi.mock("@/core/lib/revalidate-screens", () => ({ revalidateScreens }));
vi.mock("@/core/notifications/push/dispatch", () => ({ dispatchPushSoon }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
vi.mock("../data/links", () => repo);
vi.mock("../data/service", () => ({ uploadService: () => ({ seal }) }));

import {
  copyUploadLink,
  eraseUploaderNetwork,
  getUploadLink,
  markFilesReceived,
  stopUploadLink,
} from "../actions/links";
import { deriveLinkToken, linkKeyBytes, tokenHash } from "../domain/token";
import { KEY_BASE64 } from "./fakes";

const TASK = "22222222-2222-4222-8222-222222222222";
const LINK = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.stubEnv("UPLOAD_LINK_KEY", KEY_BASE64);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.maxoff.in");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

async function expectedToken(linkId: string): Promise<string> {
  return deriveLinkToken({
    key: linkKeyBytes(KEY_BASE64),
    linkId,
    salt: Uint8Array.from({ length: 16 }, (_, i) => i),
  });
}

/** The member actions (WORKFLOWS §5B.1, §5B.5; plan A2-A3, A8). */
describe("the upload link's member actions", () => {
  it("Get upload link makes the link, derives the token, seals its hash and answers the address", async () => {
    const result = await getUploadLink({ taskId: TASK });
    const token = await expectedToken("link-1");
    expect(result).toEqual({
      ok: true,
      data: { linkId: "link-1", url: `https://app.maxoff.in/upload#${token}` },
    });
    expect(assertPermission).toHaveBeenCalledWith("uploads.manage");
    expect(repo.rpcCreateLink).toHaveBeenCalledWith(TASK);
    // Showing it right after making it is not a copy (no history row).
    expect(repo.rpcLinkSecret).toHaveBeenCalledWith("link-1", false);
    expect(seal).toHaveBeenCalledWith("link-1", await tokenHash(token));
    expect(revalidateScreens).toHaveBeenCalled();
  });

  it("Copy link writes the copied row and answers the same address again", async () => {
    const result = await copyUploadLink({ linkId: LINK });
    const token = await expectedToken(LINK);
    expect(result).toEqual({
      ok: true,
      data: { linkId: LINK, url: `https://app.maxoff.in/upload#${token}` },
    });
    expect(repo.rpcLinkSecret).toHaveBeenCalledWith(LINK, true);
  });

  it("a link sealed under another key is refused with Make a new link", async () => {
    seal.mockResolvedValueOnce(false);
    const result = await copyUploadLink({ linkId: LINK });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } });
  });

  it("without UPLOAD_LINK_KEY no link is made, and the reason is plain", async () => {
    vi.stubEnv("UPLOAD_LINK_KEY", "");
    const result = await getUploadLink({ taskId: TASK });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", message: expect.stringContaining("aren't set up") },
    });
    expect(repo.rpcCreateLink).not.toHaveBeenCalled();
  });

  it("Stop link and All files received go to their functions", async () => {
    expect(await stopUploadLink({ linkId: LINK })).toEqual({ ok: true, data: null });
    expect(repo.rpcStopLink).toHaveBeenCalledWith(LINK);
    expect(await markFilesReceived({ linkId: LINK, markDone: true, lateReason: "  " })).toEqual({
      ok: true,
      data: { path: "primary_told" },
    });
    expect(repo.rpcFilesReceived).toHaveBeenCalledWith({
      linkId: LINK,
      markDone: true,
      lateReason: null,
    });
    expect(dispatchPushSoon).toHaveBeenCalled();
  });

  it("erasing network details needs uploads.network", async () => {
    await eraseUploaderNetwork({ uploaderId: LINK });
    expect(assertPermission).toHaveBeenCalledWith("uploads.network");
  });

  it("a malformed id is VALIDATION before any permission or database call", async () => {
    const result = await getUploadLink({ taskId: "nope" });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(assertPermission).not.toHaveBeenCalled();
  });
});
