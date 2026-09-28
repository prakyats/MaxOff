import "server-only";

/**
 * `SESSION_IP_HASH_SALT` (optional, `.env.example`): salts the client IP before it is stored
 * as `session_events.ip_hash`. Unset means the hash is stored as null, never an unsalted one.
 */
export function sessionIpHashSalt(): string | undefined {
  const value = process.env.SESSION_IP_HASH_SALT?.trim();
  return value ? value : undefined;
}
