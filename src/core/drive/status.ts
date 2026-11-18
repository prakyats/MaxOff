/**
 * Settings → Google Drive, in words (v4.0). Pure: the page passes `drive_status()` and the
 * `?drive=` outcome; the screen and its tests read the same lines. No token ever reaches here
 * (`drive_status()` holds none).
 */

export type DriveState = "connected" | "needs_reconnect" | "disconnected";

export type DriveStatus = {
  state: DriveState;
  email: string | null;
  connectedAt: string | null;
  totalBytes: number | null;
  usedBytes: number | null;
  checkedAt: string | null;
  lastError: string | null;
};

const STATES: readonly DriveState[] = ["connected", "needs_reconnect", "disconnected"];

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bytes(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/** `drive_status()`'s jsonb, read defensively: anything unexpected is "not connected". */
export function toDriveStatus(raw: unknown): DriveStatus {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const state = STATES.find((s) => s === row.state) ?? "disconnected";
  return {
    state,
    email: text(row.google_email),
    connectedAt: text(row.connected_at),
    totalBytes: bytes(row.quota_total_bytes),
    usedBytes: bytes(row.quota_used_bytes),
    checkedAt: text(row.quota_checked_at),
    lastError: text(row.last_error),
  };
}

/** Bytes as people read storage: decimal units, like Google's own "2 TB". */
export function sizeWords(value: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"] as const;
  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(size)} bytes`;
  const rounded = size >= 100 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export type SpaceView = {
  /** Whole per cent used, 0 to 100, for the bar. */
  percent: number;
  /** "640 GB free of 2 TB" */
  line: string;
  /** 80 % and up: the line is a warning; 90 % and up: urgent. */
  level: "ok" | "warning" | "urgent";
};

export function spaceView(status: DriveStatus): SpaceView | null {
  if (status.totalBytes === null || status.usedBytes === null || status.totalBytes <= 0) {
    return null;
  }
  const ratio = Math.min(status.usedBytes / status.totalBytes, 1);
  const percent = Math.floor(ratio * 100);
  const free = Math.max(status.totalBytes - status.usedBytes, 0);
  return {
    percent,
    line: `${sizeWords(free)} free of ${sizeWords(status.totalBytes)}`,
    level: percent >= 90 ? "urgent" : percent >= 80 ? "warning" : "ok",
  };
}

/** The line under the heading: what is true now, in one sentence. */
export function stateLine(status: DriveStatus): string {
  switch (status.state) {
    case "connected":
      return "Connected. MaxOff will archive client work into this Google account; archiving starts in a later update.";
    case "needs_reconnect":
      return "MaxOff can no longer reach this Google account. Reconnect to carry on.";
    case "disconnected":
      return "Not connected. Connect the studio's Google account: MaxOff will archive client work to its Drive.";
  }
}

/** What the screen says after Google sends the Owner back (`?drive=`); null for anything else. */
export function outcomeLine(
  outcome: string | null | undefined,
): { tone: "success" | "error"; text: string } | null {
  switch (outcome) {
    case "connected":
      return { tone: "success", text: "Google Drive is connected." };
    case "reconnected":
      return { tone: "success", text: "Google Drive is reconnected." };
    case "account_switched":
      return {
        tone: "success",
        text: "Now using the new Google account. Nothing was moved or deleted from the old one.",
      };
    case "disconnected":
      return {
        tone: "success",
        text: "Google Drive is disconnected. Everything already in it stays there.",
      };
    case "cancelled":
      return { tone: "error", text: "Google Drive was not connected: the sign-in was cancelled." };
    case "expired":
      return {
        tone: "error",
        text: "That sign-in took too long or came from another tab. Tap Connect again.",
      };
    case "no_access":
      return {
        tone: "error",
        text: "Google did not give MaxOff access to Drive. Tap Connect again and allow access when Google asks.",
      };
    case "failed":
      return { tone: "error", text: "Google Drive could not be connected. Try again in a minute." };
    case "off":
      return { tone: "error", text: "Google Drive is not set up for this environment yet." };
    default:
      return null;
  }
}
