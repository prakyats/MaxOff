/**
 * What an error boundary shows (2.6). In production Next strips a server error's message before
 * it reaches the client and forwards only a string `digest`, so a server-side failure that
 * deserves its own words carries one of the digests below.
 */

/**
 * The session could not be used for a transient reason: GoTrue was unreachable (2.6), or PostgREST
 * refused a server read's access token as expired (PGRST303, 6.6) before the proxy renewed it.
 */
export const SESSION_UNAVAILABLE_DIGEST = "MAXOFF_SESSION_UNAVAILABLE";

/** The words for it, on the error screen and in a server action's failure alike. */
export const SESSION_UNAVAILABLE_TITLE = "Can't reach the server.";
export const SESSION_UNAVAILABLE_DESCRIPTION = "You're still signed in. Try again in a moment.";

/**
 * PostgREST's code for a JWT whose claims it refused: in practice an access token that expired
 * (`"JWT expired"`). Nothing is wrong with the person's session: the proxy renews it on the next
 * request, so it is the same retryable failure as an unreachable GoTrue, never "signed out".
 */
export const JWT_EXPIRED_CODE = "PGRST303";

/** A PostgREST error (or anything shaped like one) refusing the access token as expired. */
export function isJwtExpiredError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === JWT_EXPIRED_CODE
  );
}

export interface BoundaryCopy {
  kind: "session-unavailable" | "generic";
  title: string;
  description: string;
}

/**
 * The title and description for a boundary's `error`. A transient session failure (its digest,
 * or an expired-JWT error seen before Next scrubs it) says the person is still signed in (nothing
 * was cleared) and to try again; anything else is the generic copy with the reference code when
 * there is one.
 */
export function describeBoundaryError(error: {
  digest?: string | undefined;
  code?: unknown;
}): BoundaryCopy {
  if (error.digest === SESSION_UNAVAILABLE_DIGEST || isJwtExpiredError(error)) {
    return {
      kind: "session-unavailable",
      title: SESSION_UNAVAILABLE_TITLE,
      description: SESSION_UNAVAILABLE_DESCRIPTION,
    };
  }
  return {
    kind: "generic",
    title: "This page couldn't load",
    description: error.digest
      ? `Reference ${error.digest}. Try again, and mention this code if it keeps happening.`
      : "Try again in a moment.",
  };
}
