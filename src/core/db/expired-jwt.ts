import { isJwtExpiredError, SESSION_UNAVAILABLE_DIGEST } from "@/core/errors/boundary";

/**
 * A server read that PostgREST refuses because its access token has expired (`401`, `PGRST303`
 * "JWT expired"; Sentry MAXOFF-3/-6 on `GET /today`, 6.6) is the retryable "Can't reach the
 * server. You're still signed in." screen of 2.6, never an unhandled error and never "signed out".
 *
 * **Why not refresh and retry here:** a Server Component cannot write cookies. A refresh made
 * during a render rotates the refresh token at GoTrue, but the browser never receives the new
 * one, so its next request presents the spent token outside GoTrue's reuse interval, and GoTrue
 * revokes the whole session: the person would be signed out by the very retry meant to spare
 * them. The proxy (`core/auth/session.ts`) is the one place that renews a session, because it can
 * hand the new cookies to the browser; the error screen's **Try again** re-requests the page
 * (`retry()`), which passes through the proxy and reads with a renewed token.
 *
 * **How the screen is reached:** every data layer throws PostgREST's error object as it is
 * (`if (error) throw error`), and in production Next forwards only a thrown error's `digest` to
 * the error boundary. postgrest-js makes that object from the answer's JSON body, so this
 * wrapper gives an expired-JWT answer the session-unavailable `digest` (and a `name`, which is
 * what makes Next keep a thrown value's own digest) in its body. Code, message, details and hint
 * stay PostgREST's; every other answer passes untouched, body unread.
 */
export function withExpiredJwtAsSessionUnavailable(
  base: typeof fetch = (input, init) => fetch(input, init),
): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init);
    if (response.status !== 401 || !isPostgrestUrl(input)) return response;
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      return response;
    }
    if (!isJwtExpiredError(body)) return response;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(
      JSON.stringify({
        ...(body as object),
        name: "SessionUnavailableError",
        digest: SESSION_UNAVAILABLE_DIGEST,
      }),
      { status: response.status, statusText: response.statusText, headers },
    );
  };
}

function isPostgrestUrl(input: RequestInfo | URL): boolean {
  const href = input instanceof Request ? input.url : String(input);
  try {
    return new URL(href).pathname.includes("/rest/v1/");
  } catch {
    return false;
  }
}
