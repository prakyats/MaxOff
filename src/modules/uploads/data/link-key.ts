import { linkKeyBytes } from "../domain/token";

/**
 * `UPLOAD_LINK_KEY` (v4.5, plan A3; `.env.example`), read at runtime like the Drive settings
 * (`core/drive/env.ts`): a Worker secret through `deploy.yml`, `.env.local` locally. Absent or
 * malformed means **upload links are off**: no link is made, Copy link says why, and the public
 * API answers every link as not working. The value is never printed or logged.
 */
export const UPLOAD_LINK_KEY = "UPLOAD_LINK_KEY";

export type LinkKey = { mode: "on"; key: Uint8Array } | { mode: "off"; reason: string };

export const LINK_KEY_OFF_MESSAGE =
  "Upload links aren't set up on this server yet. Ask the Owner to add the upload link key.";

export function readLinkKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LinkKey {
  const raw = env[UPLOAD_LINK_KEY]?.trim();
  if (!raw) return { mode: "off", reason: LINK_KEY_OFF_MESSAGE };
  try {
    return { mode: "on", key: linkKeyBytes(raw) };
  } catch {
    // The name only, never the value.
    return { mode: "off", reason: `${UPLOAD_LINK_KEY} must be 32 bytes, base64.` };
  }
}
