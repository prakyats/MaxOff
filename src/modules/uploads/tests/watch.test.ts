import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { unsealSession, driveFileFacts, captureException } = vi.hoisted(() => ({
  unsealSession: vi.fn(async (sealed: string) => `https://www.googleapis.com/upload/${sealed}`),
  driveFileFacts: vi.fn(),
  captureException: vi.fn(() => "event-1"),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/service", () => ({ createServiceSupabase: () => null }));
vi.mock("@/core/observability/capture", () => ({ captureException }));
vi.mock("@/core/drive/upload-session", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unsealSession,
  driveFileFacts,
}));

import type { ServiceSupabase } from "@/core/db/service";

import { runUploadWatch } from "../actions/watch";
import { fakeService, fakeSessionGoogle, KEY_BASE64 } from "./fakes";

const NOW = new Date("2026-11-25T10:00:00Z");
const url = (name: string) => `https://www.googleapis.com/upload/${name}`;
const due = (file: string, size = 1000, atGoogle = 0) => ({
  file_id: file,
  org_id: "org-1",
  session_uri_encrypted: file,
  size_bytes: size,
  bytes_at_google: atGoogle,
});

beforeEach(() => {
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "a-secret-value");
  vi.stubEnv("DRIVE_TOKEN_KEY", KEY_BASE64);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

/** `upload_watch` (WORKFLOWS §8, plan F3): Google's numbers, not the browser's. */
describe("the every-minute upload watch", () => {
  it("records Google's offset, receives a finished file, marks a forgotten session checked, then signals", async () => {
    const svc = fakeService({
      watchDue: vi.fn(async () => [due("s1"), due("s2"), due("s3", 1000, 300)]),
      fileRow: vi.fn(async (id: string) => ({
        id,
        org_id: "org-1",
        link_id: "l1",
        state: "uploading",
        size_bytes: 1000,
        drive_parent_id: "parent-1",
        session_uri_encrypted: id,
      })),
      signals: vi.fn(async () => ({ stuck: 1, looks_finished: 0 })),
    });
    const google = fakeSessionGoogle({
      [url("s1")]: { status: 308, range: "bytes=0-599" },
      [url("s2")]: { status: 200, body: { id: "drive-2" } },
      [url("s3")]: { status: 404 },
    });
    driveFileFacts.mockResolvedValue({
      id: "drive-2",
      sizeBytes: 1000,
      md5: "c".repeat(32),
      parents: ["parent-1"],
      trashed: false,
    });
    const report = await runUploadWatch({
      svc,
      service: {} as ServiceSupabase,
      fetchImpl: google.impl,
      now: NOW,
    });
    expect(report).toEqual({
      due: 3,
      offsets: 1,
      received: 1,
      failedChecks: 0,
      gone: 1,
      errors: 0,
      signals: { stuck: 1, looks_finished: 0 },
    });
    expect(svc.watchDue).toHaveBeenCalledWith(NOW);
    expect(svc.recordOffset).toHaveBeenCalledWith("s1", 600, NOW);
    expect(svc.recordOffset).toHaveBeenCalledWith("s3", 300, NOW);
    // No page MD5: checked by size (and folder) only.
    expect(svc.fileDone).toHaveBeenCalledWith({
      fileId: "s2",
      driveFileId: "drive-2",
      size: 1000,
      md5Drive: "c".repeat(32),
      parentId: "parent-1",
      md5Page: null,
    });
    expect(svc.signals).toHaveBeenCalledWith(NOW);
  });

  it("a Google error on one file leaves the others and the signals alone", async () => {
    const svc = fakeService({ watchDue: vi.fn(async () => [due("s1"), due("s2")]) });
    const google = fakeSessionGoogle({
      [url("s1")]: { status: 503 },
      [url("s2")]: { status: 308, range: "bytes=0-9" },
    });
    const report = await runUploadWatch({
      svc,
      service: {} as ServiceSupabase,
      fetchImpl: google.impl,
      now: NOW,
    });
    expect(report).toMatchObject({ due: 2, offsets: 1, errors: 1 });
    expect(svc.recordOffset).toHaveBeenCalledWith("s2", 10, NOW);
    expect(captureException).not.toHaveBeenCalled();
    expect(svc.signals).toHaveBeenCalled();
  });

  it("without the Google settings asks Google nothing but still runs the signals", async () => {
    vi.unstubAllEnvs();
    const svc = fakeService();
    const report = await runUploadWatch({
      svc,
      service: {} as ServiceSupabase,
      fetchImpl: fetch,
      now: NOW,
    });
    expect(svc.watchDue).not.toHaveBeenCalled();
    expect(report.due).toBe(0);
    expect(svc.signals).toHaveBeenCalledWith(NOW);
  });
});
