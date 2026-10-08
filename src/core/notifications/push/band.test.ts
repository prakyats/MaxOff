import { describe, expect, it } from "vitest";

import { BAND_COPY, BAND_KEYS, BAND_REASONS, bandKeyFor, toBandReason } from "./band";

describe("the band's reason (5.5)", () => {
  it("reads only the database's five reasons", () => {
    for (const reason of BAND_REASONS) expect(toBandReason(reason)).toBe(reason);
    expect(toBandReason("ok")).toBeNull();
    expect(toBandReason(null)).toBeNull();
    expect(toBandReason(3)).toBeNull();
  });
});

describe("the band's copy follows the reason (owner decision 2026-10-03)", () => {
  it("each reason on a device that can turn notifications on", () => {
    expect(BAND_COPY[bandKeyFor("no_subscription", "ready")]).toEqual({
      text: "Notifications are off",
      action: "Turn on",
    });
    expect(BAND_COPY[bandKeyFor("permission_revoked", "ready")]).toEqual({
      text: "Notifications are blocked",
      action: "Fix",
    });
    expect(BAND_COPY[bandKeyFor("failing", "ready")]).toEqual({
      text: "Notifications aren't reaching you",
      action: "Fix",
    });
    expect(BAND_COPY[bandKeyFor("unconfirmed", "ready")]).toEqual({
      text: "Check notifications reach you",
      action: "Send a test",
    });
  });

  it("an iPhone without the installed app: install, as before (owner 2026-10-01)", () => {
    expect(BAND_COPY[bandKeyFor("ios_not_installed", "ios_not_installed")]).toEqual({
      text: "Install MaxOff to get notifications",
      action: "How",
    });
    // On the iPhone in Safari, off or blocked can only be fixed by installing.
    expect(bandKeyFor("no_subscription", "ios_not_installed")).toBe("install");
    expect(bandKeyFor("permission_revoked", "ios_not_installed")).toBe("install");
  });

  it("before the device is known, the server's reason decides", () => {
    expect(bandKeyFor("ios_not_installed", "unknown")).toBe("install");
    expect(bandKeyFor("no_subscription", "unknown")).toBe("off");
    expect(bandKeyFor("permission_revoked", "unknown")).toBe("blocked");
  });

  it("a device that can turn notifications on is never told to install", () => {
    expect(bandKeyFor("ios_not_installed", "ready")).toBe("off");
  });

  it("a test goes from any device: unconfirmed and failing read the same everywhere", () => {
    for (const device of ["unknown", "ready", "ios_not_installed", "unsupported"] as const) {
      expect(bandKeyFor("unconfirmed", device)).toBe("unconfirmed");
      expect(bandKeyFor("failing", device)).toBe("failing");
    }
  });

  it("every line has its words", () => {
    for (const key of BAND_KEYS) {
      expect(BAND_COPY[key].text.length).toBeGreaterThan(0);
      expect(BAND_COPY[key].action.length).toBeGreaterThan(0);
    }
  });
});
