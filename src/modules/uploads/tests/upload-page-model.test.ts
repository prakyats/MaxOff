import { describe, expect, it } from "vitest";

import {
  bannerOf,
  byFolder,
  engineOpening,
  etaWords,
  folderOf,
  overallLine,
  overallOf,
  overallTitle,
  type PageFile,
  progressWords,
  rowOf,
  rowOrder,
  speedOf,
  welcomeWords,
} from "../components/upload-page-model";

function file(over: Partial<PageFile> = {}): PageFile {
  return {
    key: "k1",
    name: "IMG_0420.MOV",
    relativePath: "",
    size: 980_000_000,
    queued: false,
    engine: null,
    verdict: null,
    waiting: null,
    notSent: false,
    ...over,
  };
}

describe("a file's row (sample §2, §3)", () => {
  it("uploading shows how far it got", () => {
    const row = rowOf(
      file({ engine: { state: "uploading", sent: 410_000_000, total: 980_000_000 } }),
    );
    expect(row).toMatchObject({ label: "Uploading", tone: "info", line: "410 of 980 MB · 41%" });
  });
  it("offline is Paused, waiting for connection", () => {
    const row = rowOf(
      file({ engine: { state: "paused", sent: 410_000_000, total: 980_000_000, why: "offline" } }),
    );
    expect(row).toMatchObject({ label: "Paused", line: "410 of 980 MB · waiting for connection" });
  });
  it("Done only on the server's answer (F1); before it, still on its way", () => {
    const sent = file({ engine: { state: "done", driveFileId: "d1" } });
    expect(rowOf(sent).label).toBe("Uploading");
    expect(rowOf({ ...sent, verdict: { state: "done" } })).toMatchObject({
      label: "Done",
      tone: "success",
      finished: true,
    });
    expect(rowOf({ ...sent, verdict: { state: "failed", reason: "damaged" } })).toMatchObject({
      label: "Failed",
      tone: "danger",
      line: "Failed: damaged on the way. Send it again.",
      retry: true,
    });
  });
  it("a failed chunk loop offers Retry; an unreadable file asks to choose it again", () => {
    expect(
      rowOf(file({ engine: { state: "failed", reason: "Google answered 503", canRetry: true } })),
    ).toMatchObject({ label: "Failed", retry: true });
    expect(
      rowOf(
        file({
          engine: { state: "failed", reason: "unreadable: NotReadableError", canRetry: true },
        }),
      ),
    ).toMatchObject({ retry: false, line: expect.stringContaining("Choose it again") });
  });
  it("refusals: already sent, the link stopped, held for space, waiting for a limit", () => {
    expect(rowOf(file({ engine: { state: "refused", refused: "already_sent" } }))).toMatchObject({
      label: "Already sent",
      finished: true,
    });
    expect(rowOf(file({ notSent: true })).label).toBe("Not sent");
    expect(rowOf(file({ waiting: "no_space" }))).toMatchObject({
      label: "Held",
      line: "980 MB · doesn't fit right now",
      finished: false,
    });
    expect(rowOf(file({ waiting: "daily_limit" })).label).toBe("Waiting");
  });
  it("in progress first, then failed, then waiting, then finished", () => {
    const up = file({ engine: { state: "uploading", sent: 1, total: 2 } });
    const failed = file({ engine: { state: "failed", reason: "x", canRetry: true } });
    const waiting = file({ engine: { state: "waiting" } });
    const done = file({ verdict: { state: "done" } });
    expect([done, waiting, failed, up].sort((a, b) => rowOrder(a) - rowOrder(b))).toEqual([
      up,
      failed,
      waiting,
      done,
    ]);
  });
});

describe("the overall line", () => {
  const files = [
    file({ key: "a", size: 1_000_000_000, verdict: { state: "done" } }),
    file({
      key: "b",
      size: 2_000_000_000,
      engine: { state: "uploading", sent: 500_000_000, total: 2_000_000_000 },
    }),
    file({
      key: "c",
      size: 1_000_000_000,
      engine: { state: "failed", reason: "x", canRetry: true },
    }),
    file({ key: "d", size: 5_000_000, queued: true }),
  ];
  it("counts what was handed over, not the ready list", () => {
    const overall = overallOf(files);
    expect(overall).toMatchObject({
      done: 1,
      total: 3,
      failed: 1,
      sent: 1_500_000_000,
      bytes: 4_000_000_000,
    });
    expect(overallTitle(overall)).toBe("1 of 3 done · 1 failed");
    expect(overallLine(overall, { offline: false, bytesPerSecond: 5_000_000 })).toBe(
      "1.5 of 4 GB · about 8 min left",
    );
    expect(overallLine(overall, { offline: true, bytesPerSecond: 5_000_000 })).toBe(
      "1.5 of 4 GB · paused",
    );
  });
  it("all finished once every handed-over file is done or not sendable", () => {
    expect(overallOf([file({ verdict: { state: "done" } })]).allFinished).toBe(true);
    expect(overallOf(files).allFinished).toBe(false);
    expect(overallOf([]).allFinished).toBe(false);
  });
  it("the time left, as people say it", () => {
    expect(etaWords(10_000_000, 1_000_000)).toBe(" · less than a minute left");
    expect(etaWords(600_000_000, 1_000_000)).toBe(" · about 10 min left");
    expect(etaWords(9_000_000_000, 1_000_000)).toBe(" · about 2.5 h left");
    expect(etaWords(100, null)).toBe("");
  });
  it("the speed needs a few seconds of samples", () => {
    expect(speedOf([{ at: 0, sent: 0 }])).toBeNull();
    expect(
      speedOf([
        { at: 0, sent: 0 },
        { at: 1000, sent: 10 },
      ]),
    ).toBeNull();
    expect(
      speedOf([
        { at: 0, sent: 0 },
        { at: 10_000, sent: 50_000_000 },
      ]),
    ).toBe(5_000_000);
  });
  it("progress words share a unit where they can", () => {
    expect(progressWords(120_000_000, 1_100_000_000)).toBe("120 MB of 1.1 GB · 10%");
  });
});

describe("the server's start answer, for the engine", () => {
  it("a session, a final refusal, or a wait to ask again after", () => {
    expect(
      engineOpening({ kind: "start", sessionUrl: "https://x", fileId: "f", resumed: true }),
    ).toEqual({
      session: { sessionUrl: "https://x", fileId: "f", resumed: true },
    });
    expect(engineOpening({ kind: "already_sent", refused: "already_sent" })).toEqual({
      refused: "already_sent",
      wait: null,
    });
    expect(engineOpening({ kind: "held", refused: "no_space", fileId: "f" })).toMatchObject({
      refused: "no_space",
      wait: { reason: "no_space" },
    });
    expect(
      engineOpening({ kind: "wait", refused: "limit", reason: "daily_limit", waitSeconds: 900 }),
    ).toEqual({ refused: "limit", wait: { reason: "daily_limit", seconds: 900 } });
    expect(engineOpening({ kind: "refused", refused: "too_big" })).toEqual({
      refused: "too_big",
      wait: null,
    });
  });
  it("one banner at a time, the most important first", () => {
    expect(bannerOf([file({ waiting: "no_space" }), file({ waiting: "daily_limit" })], false)).toBe(
      "daily_limit",
    );
    expect(bannerOf([file({ waiting: "busy" })], false)).toBe("too_many");
    expect(bannerOf([file({ waiting: "drive_unavailable" })], true)).toBe("stopped");
    expect(bannerOf([file()], false)).toBeNull();
  });
});

describe("folders and the welcome back", () => {
  it("a chosen folder keeps its path; loose files come first", () => {
    expect(folderOf("Day 1/CAM A/A001_C001.MP4")).toBe("Day 1/CAM A");
    expect(folderOf("clip.mp4")).toBe("");
    const groups = byFolder([
      { relativePath: "Day 2", n: 1 },
      { relativePath: "", n: 2 },
      { relativePath: "Day 1/CAM A", n: 3 },
    ]);
    expect(groups.map(([folder]) => folder)).toEqual(["", "Day 1/CAM A", "Day 2"]);
  });
  it("what this device sent before, and what didn't finish (screen J)", () => {
    const own = [
      { name: "a.mov", relativePath: "", sizeBytes: 1, state: "done" as const },
      { name: "b.mov", relativePath: "", sizeBytes: 1, state: "uploading" as const },
    ];
    expect(welcomeWords(own)).toEqual({
      line: "1 of 2 files arrived from this device. The other 1 didn't finish. Choose them again: files already received are skipped, and the rest carry on.",
      unfinished: [own[1]],
    });
    expect(welcomeWords([own[0]!]).line).toBe("All 1 file arrived from this device.");
  });
});
