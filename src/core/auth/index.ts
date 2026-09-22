/**
 * core/auth: who is signed in.
 *
 * `getCurrentMember()` is `server-only` and lives in `@/core/auth/server`. This entry point
 * exposes only types, so nothing here can reach a browser bundle by accident.
 */
export type { CurrentMember } from "./types";
