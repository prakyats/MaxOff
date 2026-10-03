/**
 * The notifications band's reasons and words (task 5.5, owner decisions 2026-10-03; WORKFLOWS
 * "Settled at kickoff 5", the band). Pure: no React, no database.
 *
 * **When it shows** is the database's (`app.push_band`, read with the member's endpoints in the
 * layout's one call, `push_status_own()`): until one of the member's devices has received a push
 * (a test or a real one) and is not failing; and again whenever their reachability is not `ok`.
 * **What it says** follows that reason, and on the device in hand: an iPhone outside the
 * installed app can only install, and a device that can turn notifications on is never told to
 * install.
 */
export const BAND_REASONS = [
  "no_subscription",
  "permission_revoked",
  "ios_not_installed",
  "failing",
  "unconfirmed",
] as const;
export type BandReason = (typeof BAND_REASONS)[number];

/** The database's answer, checked: anything else reads as no band rather than a wrong one. */
export function toBandReason(value: unknown): BandReason | null {
  return typeof value === "string" && (BAND_REASONS as readonly string[]).includes(value)
    ? (value as BandReason)
    : null;
}

/** The band's one line, by what the member can do about it. */
export type BandKey = "off" | "blocked" | "install" | "failing" | "unconfirmed";

export const BAND_KEYS: readonly BandKey[] = [
  "off",
  "blocked",
  "install",
  "failing",
  "unconfirmed",
];

/** What this device is, as far as the band cares (`currentSupport()`); "unknown" before it is read. */
export type BandDevice = "unknown" | "ready" | "ios_not_installed" | "unsupported";

/**
 * The line for this reason on this device. Turning notifications on, or installing, is done on a
 * device, so an iPhone in Safari says "install" and a device that can turn them on never does;
 * a test is sent from any device, so "unconfirmed" and "failing" read the same everywhere.
 */
export function bandKeyFor(reason: BandReason, device: BandDevice): BandKey {
  if (reason === "unconfirmed") return "unconfirmed";
  if (reason === "failing") return "failing";
  if (device === "ios_not_installed") return "install";
  if (reason === "ios_not_installed") return device === "ready" ? "off" : "install";
  return reason === "permission_revoked" ? "blocked" : "off";
}

/** "Notifications are off · Turn on" (owner 2026-10-01) and its siblings, one per reason. */
export const BAND_COPY: Readonly<Record<BandKey, { text: string; action: string }>> = {
  off: { text: "Notifications are off", action: "Turn on" },
  blocked: { text: "Notifications are blocked", action: "Fix" },
  install: { text: "Install MaxOff to get notifications", action: "How" },
  failing: { text: "Notifications aren't reaching you", action: "Fix" },
  unconfirmed: { text: "Check notifications reach you", action: "Send a test" },
};
