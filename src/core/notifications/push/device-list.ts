import { formatIST } from "@/core/time";

import { platformLabel, type AppPlatform } from "../reachability";
import { deviceName } from "./device-name";

/**
 * Me's device list (task 5.5, owner decision 2026-10-03): every subscription of the member, in
 * plain words: the device's name, its platform, the last notification it received, and, for one
 * that stopped, why. **Never an endpoint or an id on screen**: the id is the Remove action's
 * handle and the endpoint this device's check, neither is ever rendered. Pure.
 */
export interface DeviceSource {
  id: string;
  endpoint: string;
  userAgent: string | null;
  label: string | null;
  platform: AppPlatform;
  isStandalone: boolean;
  createdAt: string;
  lastSuccessAt: string | null;
  failureCount: number;
  disabledReason: string | null;
}

export interface DeviceRow {
  id: string;
  endpoint: string;
  name: string;
  /** "Android · installed app", "Computer · browser". */
  detail: string;
  /** "Last notification 2 h ago" / "No notification yet". */
  delivery: string;
  /** Why it stopped (or keeps failing), in plain words; null while it works. */
  problem: string | null;
  active: boolean;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Last notification 2 h ago", "… just now", "… 3 days ago", "… on 4 Oct"; "No notification yet". */
export function deliveryLine(lastSuccessAt: string | null, now: Date): string {
  if (!lastSuccessAt) return "No notification yet";
  const at = new Date(lastSuccessAt);
  const ago = Math.max(0, now.getTime() - at.getTime());
  if (ago < MINUTE) return "Last notification just now";
  if (ago < HOUR) return `Last notification ${Math.floor(ago / MINUTE)} min ago`;
  if (ago < DAY) return `Last notification ${Math.floor(ago / HOUR)} h ago`;
  const days = Math.floor(ago / DAY);
  if (days < 7) return `Last notification ${days} ${days === 1 ? "day" : "days"} ago`;
  return `Last notification on ${formatIST(at, "d MMM")}`;
}

/** Why a device no longer gets notifications (or keeps failing to). */
export function problemLine(device: {
  disabledReason: string | null;
  failureCount: number;
}): string | null {
  switch (device.disabledReason) {
    case null:
      // Two errors in a row is "failing" (5.4); the device is still tried until the fifth.
      return device.failureCount >= 2 ? "Notifications keep failing on this device" : null;
    case "gone":
      return "Notifications were turned off on this device";
    case "expired":
      return "Stopped after repeated failures";
    case "signed_out":
      return "Signed out of this device";
    case "deactivated":
      return "Stopped when the account was deactivated";
    default:
      return "Notifications stopped on this device";
  }
}

/** Working devices first (most recent delivery first), then the stopped ones. */
export function deviceRowsOf(devices: readonly DeviceSource[], now: Date): DeviceRow[] {
  const sorted = [...devices].sort((a, b) => {
    const activeOrder = Number(b.disabledReason === null) - Number(a.disabledReason === null);
    if (activeOrder !== 0) return activeOrder;
    const delivered = (b.lastSuccessAt ?? "").localeCompare(a.lastSuccessAt ?? "");
    return delivered !== 0 ? delivered : b.createdAt.localeCompare(a.createdAt);
  });
  return sorted.map((device) => ({
    id: device.id,
    endpoint: device.endpoint,
    name: deviceName(device),
    detail: `${platformLabel(device.platform) ?? "Other device"} · ${device.isStandalone ? "installed app" : "browser"}`,
    delivery: deliveryLine(device.lastSuccessAt, now),
    problem: problemLine(device),
    active: device.disabledReason === null,
  }));
}
