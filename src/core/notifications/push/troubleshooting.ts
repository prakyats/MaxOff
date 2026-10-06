import { isIOS } from "./browser";

/**
 * "Did it arrive? → No" (task 5.5, owner decision 2026-10-03, 6): what to check on the phone or
 * browser in hand. The push service accepting a test already counts as working for reachability;
 * these are the things between the service and the screen. Nothing is stored. Pure.
 */
export type TroubleDevice =
  "iphone_installed" | "iphone_browser" | "android" | "brave" | "desktop" | "other";

export function troubleDeviceOf(input: {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  brave: boolean;
}): TroubleDevice {
  if (isIOS(input.userAgent, input.maxTouchPoints)) {
    return input.standalone ? "iphone_installed" : "iphone_browser";
  }
  // Brave is checked before the platform: its push setting is the usual cause, phone or desktop.
  if (input.brave) return "brave";
  if (/Android/.test(input.userAgent)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/.test(input.userAgent)) return "desktop";
  return "other";
}

export interface Troubleshooting {
  title: string;
  steps: readonly string[];
}

const TROUBLESHOOTING: Readonly<Record<TroubleDevice, Troubleshooting>> = {
  iphone_installed: {
    title: "If it didn't arrive on your iPhone",
    steps: [
      "Open MaxOff from its icon on your Home Screen, not from Safari: only the installed app gets notifications.",
      "In the iPhone's Settings → Notifications → MaxOff, turn on Allow Notifications.",
      "Check that a Focus or Do Not Disturb isn't silencing them.",
      "Send another test.",
    ],
  },
  iphone_browser: {
    title: "iPhone notifies only the installed app",
    steps: [
      "In Safari, tap Share, then Add to Home Screen, then Add.",
      "Open MaxOff from its new icon and sign in again.",
      "Turn on notifications there, then send another test.",
    ],
  },
  android: {
    title: "If it didn't arrive on your Android phone",
    steps: [
      "Allow notifications for this site: tap the icon beside the address → Permissions → Notifications. For the installed app: hold its icon → App info → Notifications.",
      "In the phone's Settings → Apps → Chrome → Notifications, make sure they are on.",
      "Settings → Battery: let Chrome (and MaxOff) run without restrictions, so the phone doesn't stop it in the background.",
      "Check that Do Not Disturb is off.",
      "Send another test.",
    ],
  },
  brave: {
    title: "If it didn't arrive in Brave",
    steps: [
      "In Brave: Settings → Privacy and security → turn on “Use Google services for push messaging”.",
      "Allow notifications for this site: click the icon beside the address → Site settings → Notifications.",
      "Check your computer's or phone's notification settings allow Brave.",
      "Send another test.",
    ],
  },
  desktop: {
    title: "If it didn't arrive on this computer",
    steps: [
      "Allow notifications for this site: click the icon beside the address → Site settings → Notifications → Allow.",
      "Let your browser show notifications: on Windows, Settings → System → Notifications; on a Mac, System Settings → Notifications.",
      "Check that Focus or Do Not Disturb is off.",
      "Send another test.",
    ],
  },
  other: {
    title: "If it didn't arrive",
    steps: [
      "Allow notifications for MaxOff in this browser's site settings.",
      "Check the device's own notification settings allow the browser.",
      "Try MaxOff in Chrome or Safari, or as the installed app, then send another test.",
    ],
  },
};

export function troubleshootingFor(device: TroubleDevice): Troubleshooting {
  return TROUBLESHOOTING[device];
}
