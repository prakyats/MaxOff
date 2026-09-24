import "server-only";

/**
 * `SESSION_IP_HASH_SALT` (optional, `.env.example`): salts the client IP before it is stored
 * as `session_events.ip_hash`. Unset means the hash is stored as null, never an unsalted one.
 */
export function sessionIpHashSalt(): string | undefined {
  const value = process.env.SESSION_IP_HASH_SALT?.trim();
  return value ? value : undefined;
}

/**
 * `DAY_GATE_COOKIE_SECRET` (`.env.example`): signs the once-a-day gate pass (ARCHITECTURE §8).
 * Unset means no pass is ever issued, so every signed-in page load asks the database
 * (`attendance_touch()`): correct but slower, and reported once per server instance.
 */
export function dayGateCookieSecret(): string | undefined {
  const value = process.env.DAY_GATE_COOKIE_SECRET?.trim();
  return value ? value : undefined;
}
