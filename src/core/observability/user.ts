import { setUser } from "@sentry/core";

/**
 * The only identity Sentry ever learns: a member id (ARCHITECTURE §18.2). `core/auth` calls
 * this on every request that resolves a member and on sign-out; `scrubEvent` drops every other
 * user field (name, email, IP, inferred geo) even if something else set them. Server-only (the
 * browser's is `client.ts` `setClientSentryUser`): it lands on the request's own isolation scope
 * (`request-scope.ts`, ADR-0014).
 */
export function setSentryUser(memberId: string | null): void {
  setUser(memberId ? { id: memberId } : null);
}
