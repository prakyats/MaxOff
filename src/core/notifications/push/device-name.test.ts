import { describe, expect, it } from "vitest";

import { deviceName } from "./device-name";

const UA = {
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  installedIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  samsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  operaAndroid:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 OPR/85.0",
  edgeAndroid:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 EdgA/130.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

const named = (userAgent: string | null, platform = "other", label: string | null = null) =>
  deviceName({ userAgent, label, platform });

describe("deviceName: the device in plain words (5.5)", () => {
  it("the owner's examples", () => {
    expect(named(UA.chromeAndroid, "android")).toBe("Chrome on Android");
    expect(named(UA.safariIphone, "ios")).toBe("Safari on iPhone");
    expect(named(UA.edgeWindows, "desktop")).toBe("Edge on Windows");
    expect(named(UA.firefoxMac, "desktop")).toBe("Firefox on Mac");
  });

  it("the installed app on an iPhone is Safari's", () => {
    expect(named(UA.installedIphone, "ios")).toBe("Safari on iPhone");
  });

  it("other browsers and systems", () => {
    expect(named(UA.chromeIphone, "ios")).toBe("Chrome on iPhone");
    expect(named(UA.chromeWindows, "desktop")).toBe("Chrome on Windows");
    expect(named(UA.safariMac, "desktop")).toBe("Safari on Mac");
    expect(named(UA.samsung, "android")).toBe("Samsung Internet on Android");
    expect(named(UA.operaAndroid, "android")).toBe("Opera on Android");
    expect(named(UA.edgeAndroid, "android")).toBe("Edge on Android");
    expect(named(UA.firefoxLinux, "desktop")).toBe("Firefox on Linux");
    expect(named(UA.chromebook, "desktop")).toBe("Chrome on Chromebook");
  });

  it("an iPad presenting itself as a Mac is an iPad when the subscription says iOS", () => {
    expect(named(UA.safariMac, "ios")).toBe("Safari on iPad");
  });

  it("falls back to the stored label, then to a plain word; never the agent itself", () => {
    expect(named(null, "android", "Android phone")).toBe("Android phone");
    expect(named("SomethingUnknown/1.0", "other", "Mac")).toBe("Mac");
    expect(named(null, "other", null)).toBe("A device");
    expect(named("  ", "other", "  ")).toBe("A device");
    expect(named("Mozilla/5.0 (Windows NT 10.0) Unknown/1.0", "desktop")).toBe("Windows");
  });
});
