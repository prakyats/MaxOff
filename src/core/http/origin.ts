/**
 * Is the request's `Origin` header this app? A route handler under `/api/*` is public in the
 * proxy, so it refuses cross-site calls itself. A missing header, `Origin: null` (sandboxed
 * frames, some privacy modes) or an unparsable value all read as "not ours" rather than throwing:
 * the answer must be a clean 403, never a 500.
 */
export function sameOrigin(originHeader: string | null, requestUrl: string): boolean {
  if (originHeader === null) return false;
  try {
    return new URL(originHeader).host === new URL(requestUrl).host;
  } catch {
    return false;
  }
}
