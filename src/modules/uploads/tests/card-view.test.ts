import { describe, expect, it } from "vitest";

import type { UploadCard, UploadCardUploader, UploaderSheetFile } from "../domain/card";
import {
  activityWords,
  bytesOf,
  cardChip,
  cardIsMoving,
  cardShown,
  cardSummary,
  checkBeforeOpening,
  driveFileUrl,
  driveFolderUrl,
  fileChip,
  fileLine,
  fileNotes,
  fileTag,
  peopleWords,
  receivedCopy,
  stoppedLine,
  uploaderChips,
  uploaderFilesLine,
} from "../domain/card-view";

// 18 Nov 2026, 2:30 pm IST.
const NOW = new Date("2026-11-18T09:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function uploader(over: Partial<UploadCardUploader> = {}): UploadCardUploader {
  return {
    id: "u1",
    linkId: "l1",
    currentLink: true,
    name: "Sam",
    onTask: true,
    filesDone: 0,
    filesUploading: 0,
    filesHeld: 0,
    filesFailed: 0,
    filesRemoved: 0,
    bytesDone: 0,
    bytesTotal: 0,
    lastActivityAt: ago(0),
    saidDoneAt: null,
    stuckSince: null,
    looksFinished: false,
    ...over,
  };
}

function card(over: Partial<UploadCard> = {}): UploadCard {
  return {
    taskId: "t1",
    state: "active",
    driveState: "connected",
    taskFolderId: "folder-1",
    link: {
      id: "l1",
      sealed: true,
      createdAt: ago(600),
      createdByName: "Asha",
      ageDays: 0,
      renewedFromId: null,
      stoppedAt: null,
      stoppedByName: null,
      stopReason: null,
      filesReceivedAt: null,
      filesReceivedByName: null,
      pausedUntil: null,
    },
    files: 0,
    bytes: 0,
    people: 0,
    uploading: 0,
    uploaders: [],
    ...over,
  };
}

function file(over: Partial<UploaderSheetFile> = {}): UploaderSheetFile {
  return {
    id: "f1",
    name: "IMG_0412.MOV",
    relativePath: "",
    sizeBytes: 1_200_000_000,
    state: "done",
    failedReason: null,
    bytesAtGoogle: 0,
    bytesReported: 0,
    doneAt: "2026-11-18T07:50:00.000Z",
    checkKind: "md5",
    afterStop: false,
    driveFileId: "drive-1",
    missingSeenAt: null,
    inCurrentAccount: true,
    createdAt: "2026-11-18T07:40:00.000Z",
    ...over,
  };
}

describe("the card is drawn", () => {
  it("before a link only where Get upload link can work", () => {
    const none = card({ state: "none", link: null });
    expect(cardShown(none, "in_progress")).toBe(true);
    expect(cardShown(none, "changes_requested")).toBe(true);
    expect(cardShown({ ...none, driveState: "needs_reconnect" }, "todo")).toBe(true);
    expect(cardShown({ ...none, driveState: "disconnected" }, "todo")).toBe(false);
    expect(cardShown(none, "submitted")).toBe(false);
    expect(cardShown(none, "completed")).toBe(false);
  });
  it("always once the task has had a link, its history stays", () => {
    expect(cardShown(card({ state: "stopped" }), "completed")).toBe(true);
    expect(cardShown(card({ state: "stopped" }), "cancelled")).toBe(true);
  });
});

describe("the card's words", () => {
  it("bytes share a unit where they can", () => {
    expect(bytesOf(3_100_000_000, 5_400_000_000)).toBe("3.1 of 5.4 GB");
    expect(bytesOf(640_000_000, 1_200_000_000)).toBe("640 MB of 1.2 GB");
  });
  it("last activity: just now, minutes ago, the time today, the day before", () => {
    expect(activityWords(ago(0.5), NOW)).toBe("just now");
    expect(activityWords(ago(18), NOW)).toBe("18 min ago");
    expect(activityWords("2026-11-18T07:44:00.000Z", NOW)).toBe("1:14 pm");
    expect(activityWords("2026-11-17T12:10:00.000Z", NOW)).toBe("17 Nov, 5:40 pm");
  });
  it("the summary counts the shown link's people, files received of all, and data", () => {
    const c = card({
      files: 43,
      bytes: 51_900_000_000,
      uploaders: [
        uploader({ filesDone: 8, filesUploading: 2, filesHeld: 0, filesFailed: 2 }),
        uploader({ id: "u2", filesDone: 4, filesFailed: 1, filesUploading: 4 }),
        uploader({ id: "u3", filesDone: 31 }),
        uploader({ id: "old", currentLink: false, filesDone: 9 }),
      ],
    });
    expect(cardSummary(c)).toBe("3 people · 43 of 52 files · 51.9 GB");
    expect(cardSummary(card())).toBeNull();
  });
  it("a row's files line: removed in Drive counts as received", () => {
    expect(
      uploaderFilesLine(
        uploader({
          filesDone: 7,
          filesRemoved: 1,
          filesUploading: 2,
          filesHeld: 1,
          filesFailed: 1,
        }),
      ),
    ).toBe("8 of 12 done · 2 in progress · 1 waiting for space · 1 failed");
    expect(uploaderFilesLine(uploader({ filesDone: 31 }))).toBe("31 of 31 done");
  });
  it("a row's chips: Stuck (red) wins over Uploading; new name grey; said done or looks finished", () => {
    expect(uploaderChips(uploader({ filesUploading: 2 }), NOW)).toEqual([
      { label: "Uploading", tone: "info" },
    ]);
    expect(
      uploaderChips(uploader({ filesUploading: 1, stuckSince: ago(18), onTask: false }), NOW),
    ).toEqual([
      { label: "Stuck 18 min", tone: "danger" },
      { label: "Not on this task · new name", tone: "neutral" },
    ]);
    expect(uploaderChips(uploader({ saidDoneAt: ago(5), looksFinished: true }), NOW)).toEqual([
      { label: 'Said "I\'m done"', tone: "success" },
    ]);
    expect(uploaderChips(uploader({ looksFinished: true }), NOW)).toEqual([
      { label: "Looks finished", tone: "attention" },
    ]);
  });
  it("the header chip follows the card's state and how the link stopped", () => {
    expect(cardChip(card())).toEqual({ label: "Link active", tone: "info" });
    expect(cardChip(card({ state: "looks_finished" }))?.label).toBe("Looks finished");
    expect(cardChip(card({ state: "none", link: null }))).toBeNull();
    const stopped = card({ state: "stopped" });
    expect(cardChip(stopped)).toEqual({ label: "Link stopped", tone: "neutral" });
    expect(
      cardChip({ ...stopped, link: { ...stopped.link!, stopReason: "files_received" } }),
    ).toEqual({ label: "All files received", tone: "success" });
  });
  it("the stopped line names who closed it, 'you' for the viewer", () => {
    const base = card({ state: "stopped" });
    const link = { ...base.link!, stoppedAt: "2026-11-18T12:10:00.000Z" };
    const closed = {
      ...base,
      link: { ...link, stopReason: "files_received" as const, filesReceivedByName: "Asha" },
    };
    expect(stoppedLine(closed, "Asha")).toBe(
      "Closed by you, 18 Nov, 5:40 pm. The link no longer works.",
    );
    expect(stoppedLine(closed, "Ravi")).toBe(
      "Closed by Asha, 18 Nov, 5:40 pm. The link no longer works.",
    );
    expect(
      stoppedLine(
        { ...base, link: { ...link, stopReason: "task_done", stoppedByName: "Jo" } },
        null,
      ),
    ).toBe("Stopped when the task was marked done, 18 Nov, 5:40 pm. The link no longer works.");
    expect(stoppedLine(card(), null)).toBeNull();
  });
  it("Drive addresses are Google's own pages, ids encoded", () => {
    expect(driveFolderUrl("abc_1-x")).toBe("https://drive.google.com/drive/folders/abc_1-x");
    expect(driveFileUrl("a/b")).toBe("https://drive.google.com/file/d/a%2Fb/view");
  });
});

describe("Check before opening (plan D3, Q13)", () => {
  it.each([
    ["clip_final.mp4.exe", true],
    ["setup.EXE", true],
    ["page.html", true],
    ["logo.svg", true],
    ["app.apk", true],
    ["notes.pdf.zip", true],
    ["IMG_0412.MOV", false],
    ["A001_C001.MP4", false],
    ["my.holiday.mp4", false],
    ["README", false],
    [".mp4", false],
  ])("%s → %s", (name, risky) => {
    expect(checkBeforeOpening(name)).toBe(risky);
  });
  it("the icon tag is the last extension, up to four letters", () => {
    expect(fileTag("IMG_0414.heic")).toBe("HEIC");
    expect(fileTag("archive.tar.gz")).toBe("GZ");
    expect(fileTag("noext")).toBe("FILE");
    expect(fileTag("odd.verylong")).toBe("FILE");
  });
});

describe("a file on the uploader's sheet", () => {
  it("chips: Removed in Drive is grey, never red", () => {
    expect(fileChip(file())).toEqual({ label: "Done", tone: "success" });
    expect(fileChip(file({ state: "missing_in_drive" }))).toEqual({
      label: "Removed in Drive",
      tone: "neutral",
    });
    expect(fileChip(file({ state: "failed" })).tone).toBe("danger");
    expect(fileChip(file({ state: "held" })).tone).toBe("neutral");
    expect(fileChip(file({ state: "uploading" })).tone).toBe("info");
  });
  it("lines: size and time, how far it got, why it failed", () => {
    expect(fileLine(file(), NOW)).toBe("1.2 GB · 1:20 pm");
    expect(fileLine(file({ doneAt: "2026-11-17T07:50:00.000Z" }), NOW)).toBe(
      "1.2 GB · 17 Nov, 1:20 pm",
    );
    expect(
      fileLine(
        file({ state: "uploading", sizeBytes: 1_400_000_000, bytesAtGoogle: 500_000_000 }),
        NOW,
      ),
    ).toBe("500 MB of 1.4 GB");
    expect(fileLine(file({ state: "failed", bytesReported: 40_000_000 }), NOW)).toBe(
      "Failed at 40 MB",
    );
    expect(fileLine(file({ state: "failed", failedReason: "damaged" }), NOW)).toBe(
      "Damaged on the way",
    );
    expect(fileLine(file({ state: "failed" }), NOW)).toBe("Failed before it started");
  });
  it("notes: after the stop, size only, the previous account", () => {
    expect(fileNotes(file())).toEqual([]);
    expect(
      fileNotes(file({ afterStop: true, checkKind: "size_only", inCurrentAccount: false })),
    ).toEqual([
      "Arrived after the link stopped",
      "Checked by size only",
      "In the studio's previous Google account",
    ]);
  });
});

describe("All files received", () => {
  const c = card({
    files: 52,
    bytes: 55_700_000_000,
    uploaders: [
      uploader({ name: "Sam", filesDone: 12 }),
      uploader({ id: "u2", name: "Alex", filesDone: 9, filesUploading: 1 }),
      uploader({ id: "u3", name: "Jordan", filesDone: 31 }),
    ],
  });
  it("as the freelancer's coordinator: stops and marks Done for them", () => {
    expect(
      receivedCopy({
        card: c,
        taskTitle: "Brand reel",
        markDoneFor: "Jordan",
        primaryName: "Jordan",
      }),
    ).toEqual({
      description:
        "This stops the upload link and marks Brand reel Done for Jordan. It then goes for approval as usual.",
      facts: "52 files · 55.7 GB from Sam, Alex and Jordan",
      stillUploading:
        '1 file is still uploading from Alex. If it finishes, it\'s kept and marked "arrived after the link stopped".',
      confirm: "Received, mark Done",
    });
  });
  it("as the primary owner themself: no 'for'", () => {
    expect(
      receivedCopy({ card: c, taskTitle: "Brand reel", markDoneFor: "", primaryName: "Asha" })
        .description,
    ).toBe(
      "This stops the upload link and marks Brand reel Done. It then goes for approval as usual.",
    );
  });
  it("with a Crew primary: the primary is told", () => {
    const copy = receivedCopy({
      card: c,
      taskTitle: "Brand reel",
      markDoneFor: null,
      primaryName: "Jo",
    });
    expect(copy.description).toBe(
      'This stops the upload link. Jo (the task\'s primary) gets "Files received for Brand reel: mark it done".',
    );
    expect(copy.confirm).toBe("Files received");
  });
  it("people past three are counted", () => {
    expect(peopleWords(["A", "B", "C", "D"])).toBe("4 people");
    expect(peopleWords(["A", "B"])).toBe("A and B");
    expect(peopleWords([])).toBe("nobody yet");
  });
});

describe("the card re-reads itself only while something moves", () => {
  it("uploading somewhere, or not", () => {
    expect(cardIsMoving(card())).toBe(false);
    expect(cardIsMoving(card({ uploading: 1 }))).toBe(true);
    expect(
      cardIsMoving(card({ uploaders: [uploader({ currentLink: false, filesUploading: 1 })] })),
    ).toBe(true);
  });
});
