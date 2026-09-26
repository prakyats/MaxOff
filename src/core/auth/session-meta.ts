import "server-only";

import { headers } from "next/headers";

import { sessionIpHashSalt } from "./env";
import { sessionMetaFrom } from "./request-meta";

/**
 * The `user_agent` / `ip_hash` arguments of `session_login()`, `session_logout()` and
 * `attendance_touch()` for the current request; absent values are left out rather than passed
 * as undefined.
 */
export async function sessionMetaArgs(): Promise<{ user_agent?: string; ip_hash?: string }> {
  const { userAgent, ipHash } = await sessionMetaFrom(await headers(), sessionIpHashSalt());
  return {
    ...(userAgent ? { user_agent: userAgent } : {}),
    ...(ipHash ? { ip_hash: ipHash } : {}),
  };
}
