/**
 * A device's name in plain words for Me's device list (task 5.5, owner decision 2026-10-03):
 * "Chrome on Android", "Safari on iPhone", "Edge on Windows", "Firefox on Mac", from the user
 * agent the subscription stored. Pure and unit-tested; never shows the agent itself. Brave says
 * it is Chrome, so it reads as Chrome. Without an agent it falls back to the stored label (the
 * subscribe's `deviceLabel`), then to "A device".
 */
type Os = "iPhone" | "iPad" | "Android" | "Windows" | "Mac" | "Chromebook" | "Linux";

function osOf(userAgent: string, platform: string): Os | null {
  if (/iPad/.test(userAgent)) return "iPad";
  if (/iPhone|iPod/.test(userAgent)) return "iPhone";
  if (/Android/.test(userAgent)) return "Android";
  if (/Windows/.test(userAgent)) return "Windows";
  // iPadOS presents itself as a Mac; the subscription's own platform knows better.
  if (/Macintosh/.test(userAgent)) return platform === "ios" ? "iPad" : "Mac";
  if (/CrOS/.test(userAgent)) return "Chromebook";
  if (/Linux/.test(userAgent)) return "Linux";
  return null;
}

function browserOf(userAgent: string, os: Os | null): string | null {
  if (/Edg(e|A|iOS)?\//.test(userAgent)) return "Edge";
  if (/SamsungBrowser\//.test(userAgent)) return "Samsung Internet";
  if (/OPR\/|OPiOS\/|OPT\//.test(userAgent)) return "Opera";
  if (/Firefox\/|FxiOS\//.test(userAgent)) return "Firefox";
  if (/CriOS\/|Chrome\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  // The installed app on an iPhone or iPad drops the Safari token; it is Safari's.
  if ((os === "iPhone" || os === "iPad") && /AppleWebKit\//.test(userAgent)) return "Safari";
  return null;
}

export function deviceName(device: {
  userAgent: string | null;
  label: string | null;
  platform: string;
}): string {
  const agent = device.userAgent ?? "";
  const os = agent ? osOf(agent, device.platform) : null;
  const browser = agent ? browserOf(agent, os) : null;
  if (browser && os) return `${browser} on ${os}`;
  if (os) return os;
  return device.label?.trim() || "A device";
}
