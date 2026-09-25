/**
 * What an error boundary shows (2.6). In production Next strips a server error's message before
 * it reaches the client and forwards only a string `digest`, so a server-side failure that
 * deserves its own words carries one of the digests below.
 */

/** The session could not be checked because GoTrue was unreachable (a transient failure). */
export const SESSION_UNAVAILABLE_DIGEST = "MAXOFF_SESSION_UNAVAILABLE";

export interface BoundaryCopy {
  kind: "session-unavailable" | "generic";
  title: string;
  description: string;
}

/**
 * The title and description for a boundary's `error`. A transient session failure says the
 * person is still signed in (nothing was cleared) and to try again; anything else is the
 * generic copy with the reference code when there is one.
 */
export function describeBoundaryError(error: { digest?: string | undefined }): BoundaryCopy {
  if (error.digest === SESSION_UNAVAILABLE_DIGEST) {
    return {
      kind: "session-unavailable",
      title: "Can't reach the server.",
      description: "You're still signed in. Try again in a moment.",
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
