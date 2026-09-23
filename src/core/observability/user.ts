import * as Sentry from "@sentry/nextjs";

/**
 * The only identity Sentry ever learns: a member id (ARCHITECTURE §18.2). `core/auth` calls
 * this on every request that resolves a member and on sign-out; `scrubEvent` drops every other
 * user field (name, email, IP, inferred geo) even if something else set them. Runtime-neutral:
 * on the server it lands on the request's isolation scope, in the browser on the global one.
 */
export function setSentryUser(memberId: string | null): void {
  Sentry.setUser(memberId ? { id: memberId } : null);
}
