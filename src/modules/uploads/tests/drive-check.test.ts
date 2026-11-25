import { afterEach, describe, expect, it, vi } from "vitest";

const { readUploaderSheet, svc, driveFilesSeen, assertPermission } = vi.hoisted(() => ({
  readUploaderSheet: vi.fn(),
  svc: {
    driveCheckClaim: vi.fn(),
    uploaderOrg: vi.fn(async () => "org-1"),
    driveSeen: vi.fn(async () => "missing_in_drive"),
  },
  driveFilesSeen: vi.fn(),
  assertPermission: vi.fn(async () => ({ id: "m1", role: "admin" })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/permissions/server", () => ({ assertPermission }));
vi.mock("@/core/drive/upload-session", () => ({ driveFilesSeen }));
vi.mock("../data/links", () => ({ readUploaderSheet, readUploadCard: vi.fn() }));
vi.mock("../data/service", () => ({ serviceClient: () => ({}), uploadService: () => svc }));

import { checkUploaderFilesInDrive } from "../actions/background";

const UPLOADER = "44444444-4444-4444-8444-444444444444";
const F1 = "55555555-5555-4555-8555-555555555551";
const F2 = "55555555-5555-4555-8555-555555555552";
const OTHER = "55555555-5555-4555-8555-555555555559";
const NOW = new Date("2026-11-25T10:00:00Z");

const sheet = (state = "done") => ({
  uploader: { id: UPLOADER },
  files: [
    { id: F1, state },
    { id: F2, state: "done" },
  ],
});

afterEach(() => vi.clearAllMocks());

/** "Removed in Drive" from an open sheet (Q7; DATA-MODEL §8a). */
describe("the sheet's Drive check", () => {
  it("claims only the files on the caller's own sheet, and marks only a 404 or the bin", async () => {
    readUploaderSheet
      .mockResolvedValueOnce(sheet())
      .mockResolvedValueOnce(sheet("missing_in_drive"));
    svc.driveCheckClaim.mockResolvedValue([
      { file_id: F1, drive_file_id: "d1" },
      { file_id: F2, drive_file_id: "d2" },
    ]);
    driveFilesSeen.mockResolvedValue(
      new Map([
        ["d1", "trashed"],
        ["d2", "present"],
      ]),
    );
    const result = await checkUploaderFilesInDrive(
      { uploaderId: UPLOADER, fileIds: [F1, F2, OTHER] },
      { clock: () => NOW },
    );
    // The caller's own read is the permission and scope check, before any service call.
    expect(readUploaderSheet).toHaveBeenNthCalledWith(1, UPLOADER);
    expect(svc.driveCheckClaim).toHaveBeenCalledWith(UPLOADER, [F1, F2], NOW);
    expect(driveFilesSeen).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", driveFileIds: ["d1", "d2"], now: NOW }),
    );
    expect(svc.driveSeen).toHaveBeenCalledTimes(1);
    expect(svc.driveSeen).toHaveBeenCalledWith(F1, "trashed", NOW);
    expect(result.files[0]?.state).toBe("missing_in_drive");
  });

  it("a sheet the caller cannot read stops before any claim", async () => {
    readUploaderSheet.mockRejectedValue({ code: "P0001", message: "FORBIDDEN" });
    await expect(
      checkUploaderFilesInDrive({ uploaderId: UPLOADER, fileIds: [F1] }),
    ).rejects.toMatchObject({ message: "FORBIDDEN" });
    expect(svc.driveCheckClaim).not.toHaveBeenCalled();
  });

  it("files checked in the last 10 minutes (nothing claimed) ask Google nothing", async () => {
    readUploaderSheet.mockResolvedValue(sheet());
    svc.driveCheckClaim.mockResolvedValue([]);
    await checkUploaderFilesInDrive({ uploaderId: UPLOADER, fileIds: [F1] });
    expect(driveFilesSeen).not.toHaveBeenCalled();
  });

  it("a Drive that cannot be reached marks nothing", async () => {
    readUploaderSheet.mockResolvedValue(sheet());
    svc.driveCheckClaim.mockResolvedValue([{ file_id: F1, drive_file_id: "d1" }]);
    driveFilesSeen.mockRejectedValue(new Error("Google is down"));
    const result = await checkUploaderFilesInDrive({ uploaderId: UPLOADER, fileIds: [F1] });
    expect(svc.driveSeen).not.toHaveBeenCalled();
    expect(result.files[0]?.state).toBe("done");
  });
});
