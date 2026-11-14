import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The guard on the first reads' hold (advisor, v2.0 X2 review): a read started by
 * `startTokenRead` holds every later `createServerSupabase()` until its own request has left, so
 * a session client made **inside** that read would wait on itself. In development and tests the
 * read runs in this scope and `createServerSupabase()` throws a clear error when called from it;
 * in production nothing is tracked or thrown, and `FIRST_READS_WAIT_MS` bounds any such wait.
 * The scope follows the read's own async work only: the page's reads, running meanwhile, are
 * outside it.
 */
const guarded = process.env.NODE_ENV !== "production";
const scope = guarded ? new AsyncLocalStorage<true>() : null;

export const TOKEN_READ_SESSION_CLIENT =
  "createServerSupabase() was called inside a startTokenRead read: it would wait on its own hold. " +
  'Use only the client the read is given (ARCHITECTURE §19 "Six connections").';

/** Runs `read` as a token read (tracked outside production only). */
export function runAsTokenRead<R>(read: () => R): R {
  return scope ? scope.run(true, read) : read();
}

/** Throws, outside production, when called from a token read. */
export function assertNotInTokenRead(): void {
  if (scope?.getStore()) throw new Error(TOKEN_READ_SESSION_CLIENT);
}
