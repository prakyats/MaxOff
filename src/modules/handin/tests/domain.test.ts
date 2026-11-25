import { describe, expect, it } from "vitest";

import {
  cleanFileName,
  cleanRelativePath,
  isRiskyName,
  NAME_MAX,
  openVersion,
  PATH_DEPTH_MAX,
  sameFileKey,
  typeLabel,
  versionFolderName,
} from "../domain/files";
import {
  formatSize,
  handInTag,
  markDoneBlock,
  minutesLeft,
  progressLines,
  statusOf,
  versionSummary,
} from "../domain/summary";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe("cleanFileName", () => {
  it("keeps an ordinary name", () => {
    expect(cleanFileName("C0041.MP4")).toBe("C0041.MP4");
  });
  it("removes slashes, controls, zero-width and bidi characters", () => {
    expect(cleanFileName("a/b\\c\u0007\u200b\u202e.jpg")).toBe("abc.jpg");
  });
  it("normalises to NFC and squeezes spaces", () => {
    expect(cleanFileName("  Café   menu.jpg ")).toBe("Café menu.jpg");
  });
  it("is null when nothing is left", () => {
    expect(cleanFileName("  \u200b ")).toBeNull();
    expect(cleanFileName("..")).toBeNull();
  });
  it("cuts a long name and keeps the extension", () => {
    const name = cleanFileName(`${"x".repeat(400)}.mov`);
    expect(name).not.toBeNull();
    expect(Array.from(name ?? "").length).toBe(NAME_MAX);
    expect(name?.endsWith(".mov")).toBe(true);
  });
});

describe("cleanRelativePath", () => {
  it("is empty on a phone", () => {
    expect(cleanRelativePath("")).toEqual({ ok: true, path: "" });
  });
  it("joins a laptop's folders and drops empty, dot and climbing parts", () => {
    expect(cleanRelativePath("Day 1//./../Camera A\\raw")).toEqual({
      ok: true,
      path: "Day 1/Camera A/raw",
    });
  });
  it("refuses a path deeper than the limit", () => {
    const deep = Array.from({ length: PATH_DEPTH_MAX + 1 }, (_, i) => `d${i}`).join("/");
    expect(cleanRelativePath(deep)).toEqual({ ok: false, reason: "too_deep" });
    const ok = Array.from({ length: PATH_DEPTH_MAX }, (_, i) => `d${i}`).join("/");
    expect(cleanRelativePath(ok).ok).toBe(true);
  });
});

describe("versions", () => {
  it("names the folder v1, v2…", () => {
    expect(versionFolderName(1)).toBe("v1");
    expect(versionFolderName(12)).toBe("v12");
    expect(() => versionFolderName(0)).toThrow(RangeError);
  });
  it("opens the version after the last one handed in", () => {
    expect(openVersion([])).toBe(1);
    expect(openVersion([1, 3, 2])).toBe(4);
  });
});

describe("isRiskyName", () => {
  it("flags programs, scripts and web pages, by the last part only", () => {
    expect(isRiskyName("setup.EXE")).toBe(true);
    expect(isRiskyName("clip.mp4.exe")).toBe(true);
    expect(isRiskyName("preview.html")).toBe(true);
    expect(isRiskyName("logo.svg")).toBe(true);
  });
  it("leaves media, documents and names without an extension alone", () => {
    expect(isRiskyName("C0041.MP4")).toBe(false);
    expect(isRiskyName("IMG_2210.HEIC")).toBe(false);
    expect(isRiskyName("brief.pdf")).toBe(false);
    expect(isRiskyName("README")).toBe(false);
    expect(isRiskyName("odd.")).toBe(false);
  });
});

describe("sameFileKey and typeLabel", () => {
  it("matches the same folder, name and size only", () => {
    const a = sameFileKey({ relativePath: "Day 1", name: "a.mp4", size: 10 });
    expect(a).toBe(sameFileKey({ relativePath: "Day 1", name: "a.mp4", size: 10 }));
    expect(a).not.toBe(sameFileKey({ relativePath: "Day 2", name: "a.mp4", size: 10 }));
    expect(a).not.toBe(sameFileKey({ relativePath: "Day 1", name: "a.mp4", size: 11 }));
  });
  it("labels the type square", () => {
    expect(typeLabel("IMG_2210.heic")).toBe("HEIC");
    expect(typeLabel("README")).toBe("FILE");
    expect(typeLabel("x.toolongext")).toBe("FILE");
  });
});

describe("summary words", () => {
  it("names each status with its tone", () => {
    expect(statusOf("done")).toEqual({ label: "In Drive", tone: "success" });
    expect(statusOf("failed").tone).toBe("danger");
    expect(statusOf("missing_in_drive")).toEqual({ label: "Removed in Drive", tone: "neutral" });
    expect(statusOf("already_added").label).toBe("Already added");
  });
  it("formats sizes the way Drive counts them", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(18 * 1024)).toBe("18 KB");
    expect(formatSize(940 * MB)).toBe("940 MB");
    expect(formatSize(5.4 * GB)).toBe("5.4 GB");
    expect(formatSize(-1)).toBe("0 B");
  });
  it("summarises a version", () => {
    expect(versionSummary(14, 6.1 * GB)).toBe("14 files · 6.1 GB");
    expect(versionSummary(1, 2 * MB)).toBe("1 file · 2 MB");
    expect(versionSummary(0, 0)).toBe("note only");
    expect(handInTag(2, 14)).toBe("v2 · 14 files");
    expect(handInTag(1, 0)).toBe("");
  });
  it("makes Mark done wait while files upload", () => {
    expect(markDoneBlock(0)).toBeNull();
    expect(markDoneBlock(1)).toBe("1 file is still uploading. Wait for it, or leave it out.");
    expect(markDoneBlock(2)).toBe("2 files are still uploading. Wait for them, or leave them out.");
  });
});

describe("progress", () => {
  const progress = { done: 8, total: 12, bytesDone: 3.1 * GB, bytesTotal: 5.4 * GB };
  it("says how many minutes are left at the recent speed", () => {
    expect(minutesLeft(progress, 0)).toBeNull();
    expect(minutesLeft(progress, (2.3 * GB) / 350)).toBe(6);
    expect(minutesLeft({ ...progress, bytesDone: progress.bytesTotal }, 1)).toBe(1);
  });
  it("words the headline and the detail", () => {
    expect(progressLines(progress, (2.3 * GB) / 350, false)).toEqual({
      headline: "8 of 12 in Drive",
      detail: "3.1 of 5.4 GB · about 6 min left",
    });
    expect(progressLines(progress, 1, true).detail).toBe("3.1 of 5.4 GB · paused");
    expect(
      progressLines({ done: 1, total: 3, bytesDone: 900 * MB, bytesTotal: 2 * GB }, 0, false)
        .detail,
    ).toBe("900 MB of 2 GB");
    expect(
      progressLines({ ...progress, done: 12, bytesDone: progress.bytesTotal }, 5, false).detail,
    ).toBe("5.4 of 5.4 GB");
  });
});
