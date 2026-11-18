import { describe, expect, it } from "vitest";

import { outcomeLine, sizeWords, spaceView, stateLine, toDriveStatus } from "./status";

const TB2 = 2_000_000_000_000;

describe("the Drive status in words", () => {
  it("reads drive_status(), and anything odd as not connected", () => {
    expect(toDriveStatus(null).state).toBe("disconnected");
    expect(toDriveStatus({ state: "weird" }).state).toBe("disconnected");
    const status = toDriveStatus({
      state: "connected",
      google_email: "studio@example.com",
      quota_total_bytes: String(TB2),
      quota_used_bytes: 1_360_000_000_000,
    });
    expect(status).toMatchObject({
      state: "connected",
      email: "studio@example.com",
      totalBytes: TB2,
    });
  });

  it("says the space left as Google does, with the level", () => {
    const view = spaceView(
      toDriveStatus({ quota_total_bytes: TB2, quota_used_bytes: 1_360_000_000_000 }),
    );
    expect(view).toEqual({ percent: 68, line: "640 GB free of 2 TB", level: "ok" });
    expect(
      spaceView(toDriveStatus({ quota_total_bytes: TB2, quota_used_bytes: 1.6e12 }))?.level,
    ).toBe("warning");
    expect(
      spaceView(toDriveStatus({ quota_total_bytes: TB2, quota_used_bytes: 1.9e12 }))?.level,
    ).toBe("urgent");
    expect(
      spaceView(toDriveStatus({ quota_total_bytes: TB2, quota_used_bytes: 3e12 })),
    ).toMatchObject({
      percent: 100,
      line: "0 bytes free of 2 TB",
    });
    expect(spaceView(toDriveStatus({ quota_used_bytes: 5 }))).toBeNull();
  });

  it("rounds sizes to one place below 100", () => {
    expect(sizeWords(999)).toBe("999 bytes");
    expect(sizeWords(1_250_000)).toBe("1.3 MB");
    expect(sizeWords(15_000_000_000)).toBe("15 GB");
    expect(sizeWords(150_400_000_000)).toBe("150 GB");
  });

  it("has a line for each state and each known outcome only", () => {
    expect(stateLine(toDriveStatus({ state: "needs_reconnect" }))).toContain("Reconnect");
    expect(outcomeLine("connected")?.tone).toBe("success");
    expect(outcomeLine("no_access")?.tone).toBe("error");
    expect(outcomeLine("<script>")).toBeNull();
    expect(outcomeLine(null)).toBeNull();
  });
});
