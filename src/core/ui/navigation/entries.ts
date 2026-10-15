/**
 * This tab's history as the Navigation API sees it: the pathnames of this origin's entries up to
 * and including the current one, for `backSteps` (`moves.ts`). Null without the API (an older
 * browser), where nothing beneath can be read and the back control goes to its parent.
 */

type NavigationLike = {
  currentEntry?: { index: number } | null;
  entries?: () => readonly { url: string | null }[];
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

function navigation(): NavigationLike | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as { navigation?: NavigationLike }).navigation;
}

export function entryPaths(): (string | null)[] | null {
  const api = navigation();
  const index = api?.currentEntry?.index;
  if (!api?.entries || index === undefined || index < 0) return null;
  return api
    .entries()
    .slice(0, index + 1)
    .map((entry) => (entry.url ? new URL(entry.url).pathname : null));
}

/** Calls `onChange` whenever the current entry changes (nothing to watch without the API). */
export function subscribeEntries(onChange: () => void): () => void {
  const api = navigation();
  if (!api?.addEventListener || !api.removeEventListener) return () => undefined;
  api.addEventListener("currententrychange", onChange);
  return () => api.removeEventListener?.("currententrychange", onChange);
}
