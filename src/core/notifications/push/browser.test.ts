import { describe, expect, it } from "vitest";

import { deviceLabel, isIOS, platformOf, pushSupport } from "./browser";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";

describe("pushSupport", () => {
  const all = { hasServiceWorker: true, hasPushManager: true, hasNotification: true };
  it("is ready on a capable browser, and on iOS only as the installed app", () => {
    expect(pushSupport({ ...all, ios: false, standalone: false })).toEqual({ kind: "ready" });
    expect(pushSupport({ ...all, ios: true, standalone: true })).toEqual({ kind: "ready" });
    expect(pushSupport({ ...all, ios: true, standalone: false })).toEqual({
      kind: "ios_not_installed",
    });
    // An iOS tab has no PushManager either: the guidance wins over "unsupported".
    expect(pushSupport({ ...all, hasPushManager: false, ios: true, standalone: false })).toEqual({
      kind: "ios_not_installed",
    });
    expect(pushSupport({ ...all, hasPushManager: false, ios: false, standalone: false })).toEqual({
      kind: "unsupported",
    });
  });
});

describe("platform and label", () => {
  it("recognises iPhone, iPad presenting as a Mac, Android and desktop", () => {
    expect(isIOS(IPHONE, 5)).toBe(true);
    expect(isIOS(IPAD_AS_MAC, 5)).toBe(true);
    expect(isIOS(IPAD_AS_MAC, 0)).toBe(false);
    expect(platformOf(IPHONE, 5)).toBe("ios");
    expect(platformOf(ANDROID, 5)).toBe("android");
    expect(platformOf(WINDOWS, 0)).toBe("desktop");
    expect(platformOf("Something else", 0)).toBe("other");
    expect(deviceLabel(IPHONE, 5)).toBe("iPhone");
    expect(deviceLabel(IPAD_AS_MAC, 5)).toBe("iPad");
    expect(deviceLabel(ANDROID, 5)).toBe("Android phone");
    expect(deviceLabel(WINDOWS, 0)).toBe("Windows");
    expect(deviceLabel(IPAD_AS_MAC, 0)).toBe("Mac");
    expect(deviceLabel("?", 0)).toBe("This device");
  });
});
