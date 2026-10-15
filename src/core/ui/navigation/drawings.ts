/**
 * The server drawings a screen has mounted in this document (`FreshOnReturn`), by their render id:
 * the first mount of one is fresh, any later mount is the same drawing shown again from the
 * router's cache. Module state: one document's lifetime, no storage.
 */
const mounted = new Set<string>();

/** Notes the mount of drawing `renderId`; true when it had been mounted before. */
export function drawingShownAgain(renderId: string): boolean {
  if (mounted.has(renderId)) return true;
  mounted.add(renderId);
  return false;
}
