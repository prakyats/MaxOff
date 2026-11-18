/**
 * Google Drive configuration (v4.0, ADR-0010). The three values are read at runtime (Worker
 * secrets through `deploy.yml`; `.env.local` locally) and checked with zod. Anything missing or
 * malformed means **Drive is not set up**: Settings says so, nothing calls Google, and the app
 * never crashes. Values are never printed or logged here.
 */
import { z } from "zod";

export const GOOGLE_OAUTH_CLIENT_ID = "GOOGLE_OAUTH_CLIENT_ID";
export const GOOGLE_OAUTH_CLIENT_SECRET = "GOOGLE_OAUTH_CLIENT_SECRET";
export const DRIVE_TOKEN_KEY = "DRIVE_TOKEN_KEY";

export type EnvSource = Readonly<Record<string, string | undefined>>;

const driveEnvSchema = z.object({
  [GOOGLE_OAUTH_CLIENT_ID]: z
    .string()
    .trim()
    .regex(/\.apps\.googleusercontent\.com$/, `${GOOGLE_OAUTH_CLIENT_ID} must be a web client id`),
  [GOOGLE_OAUTH_CLIENT_SECRET]: z
    .string()
    .trim()
    .min(10, `${GOOGLE_OAUTH_CLIENT_SECRET} is too short`),
  // 32 random bytes, base64 (`openssl rand -base64 32`): the AES-256-GCM key for the tokens.
  [DRIVE_TOKEN_KEY]: z
    .string()
    .trim()
    .refine((value) => decodedLength(value) === 32, `${DRIVE_TOKEN_KEY} must be 32 bytes, base64`),
});

export type DriveEnv =
  | { mode: "on"; clientId: string; clientSecret: string; tokenKey: string }
  | { mode: "off"; reason: string };

export function readDriveEnv(env: EnvSource = process.env): DriveEnv {
  const raw = {
    [GOOGLE_OAUTH_CLIENT_ID]: env[GOOGLE_OAUTH_CLIENT_ID],
    [GOOGLE_OAUTH_CLIENT_SECRET]: env[GOOGLE_OAUTH_CLIENT_SECRET],
    [DRIVE_TOKEN_KEY]: env[DRIVE_TOKEN_KEY],
  };
  if (Object.values(raw).every((value) => value === undefined || value.trim() === "")) {
    return { mode: "off", reason: "Google Drive is not set up for this environment." };
  }
  const parsed = driveEnvSchema.safeParse(raw);
  if (!parsed.success) {
    // The names of the faulty values only, never the values.
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    return { mode: "off", reason: `Google Drive settings are incomplete: ${names.join(", ")}.` };
  }
  return {
    mode: "on",
    clientId: parsed.data[GOOGLE_OAUTH_CLIENT_ID],
    clientSecret: parsed.data[GOOGLE_OAUTH_CLIENT_SECRET],
    tokenKey: parsed.data[DRIVE_TOKEN_KEY],
  };
}

function decodedLength(base64: string): number {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return -1;
  return (base64.length / 4) * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}
