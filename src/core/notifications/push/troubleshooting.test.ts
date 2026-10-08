import { describe, expect, it } from "vitest";

import { troubleDeviceOf, troubleshootingFor, type TroubleDevice } from "./troubleshooting";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.5 Safari/605.1.15";

const device = (
  userAgent: string,
  more: Partial<{ standalone: boolean; brave: boolean; touch: number }> = {},
) =>
  troubleDeviceOf({
    userAgent,
    maxTouchPoints: more.touch ?? 0,
    standalone: more.standalone ?? false,
    brave: more.brave ?? false,
  });

describe("troubleDeviceOf (5.5)", () => {
  it("each phone and browser", () => {
    expect(device(IPHONE, { standalone: true })).toBe("iphone_installed");
    expect(device(IPHONE)).toBe("iphone_browser");
    expect(device(MAC, { touch: 5 })).toBe("iphone_browser");
    expect(device(ANDROID)).toBe("android");
    expect(device(ANDROID, { brave: true })).toBe("brave");
    expect(device(WINDOWS, { brave: true })).toBe("brave");
    expect(device(WINDOWS)).toBe("desktop");
    expect(device(MAC)).toBe("desktop");
    expect(device("SomethingElse/1.0")).toBe("other");
  });
});

describe("troubleshootingFor: the steps for that phone or browser", () => {
  const text = (kind: TroubleDevice) => troubleshootingFor(kind).steps.join(" ");

  it("iPhone: the installed app and notifications allowed in iOS Settings", () => {
    expect(text("iphone_installed")).toContain("Home Screen");
    expect(text("iphone_installed")).toContain("Settings → Notifications → MaxOff");
  });
  it("iPhone in Safari: install first", () => {
    expect(text("iphone_browser")).toContain("Add to Home Screen");
  });
  it("Android Chrome: the site's notifications, battery and Do Not Disturb", () => {
    expect(text("android")).toContain("Notifications");
    expect(text("android")).toContain("Battery");
    expect(text("android")).toContain("Do Not Disturb");
  });
  it("desktop: the site permission and the system's notification settings", () => {
    expect(text("desktop")).toContain("Site settings");
    expect(text("desktop")).toContain("Windows");
    expect(text("desktop")).toContain("System Settings → Notifications");
  });
  it("Brave: the Google push setting, as the band already explains it", () => {
    expect(text("brave")).toContain("Use Google services for push messaging");
  });
  it("every device has a title and ends with another test where one can be sent", () => {
    for (const kind of [
      "iphone_installed",
      "iphone_browser",
      "android",
      "brave",
      "desktop",
      "other",
    ] as const) {
      const help = troubleshootingFor(kind);
      expect(help.title.length).toBeGreaterThan(0);
      expect(help.steps.length).toBeGreaterThan(1);
      expect(help.steps.at(-1)).toMatch(/test/);
    }
  });
});
