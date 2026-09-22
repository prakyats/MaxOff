/**
 * `core/auth` public surface for client-safe code: types, path rules and form schemas.
 * Server-side pieces are imported by path so `server-only` never reaches a browser bundle:
 * - `@/core/auth/server`: `getCurrentMember()`, `requireMember()`, `getSessionState()`
 * - `@/core/auth/actions`: `login`, `logout`, `setPassword`, `requestPasswordReset`
 * - `@/core/auth/session`: `updateSession()` for `src/proxy.ts`
 */
export {
  FORGOT_PASSWORD_PATH,
  isPublicPath,
  isSignedOutOnlyPath,
  LOGIN_PATH,
  safeNextPath,
  SET_PASSWORD_PATH,
} from "./paths";
export {
  type LoginInput,
  loginSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordResetInput,
  passwordResetSchema,
  type SetPasswordInput,
  setPasswordSchema,
} from "./schemas";
export type { CurrentMember } from "./types";
