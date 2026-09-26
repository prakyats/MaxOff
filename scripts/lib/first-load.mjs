// First-load JS of an App Router page, read from `next build`'s own manifests (task 2.8), so the
// budget check needs no server and no browser. A page's first load is the build's root main
// files (the runtime, React, instrumentation-client) plus the chunks of every client module the
// page's segments reference: layouts, loading and error boundaries and the page itself. That is
// the `entryJSFiles` map of the page's client reference manifest.

/**
 * The deduplicated, sorted list of chunk paths (relative to `.next/`) a page loads first.
 * @param {{ rootMainFiles: string[], entryJSFiles: Record<string, string[]> }} manifests
 * @returns {string[]}
 */
export function firstLoadFiles({ rootMainFiles, entryJSFiles }) {
  const files = new Set(rootMainFiles.filter((file) => file.endsWith(".js")));
  for (const chunks of Object.values(entryJSFiles)) {
    for (const file of chunks) if (file.endsWith(".js")) files.add(file);
  }
  return [...files].sort();
}

/**
 * Compares measured routes with their budgets. A route with a budget but no measurement fails
 * too: a renamed route must not slip out of the check.
 * @param {Record<string, number>} measured route → decompressed bytes
 * @param {Record<string, number>} budgets route → the most decompressed bytes allowed
 * @returns {{ route: string, bytes: number | undefined, budget: number, ok: boolean }[]}
 */
export function checkBudgets(measured, budgets) {
  return Object.entries(budgets).map(([route, budget]) => {
    const bytes = measured[route];
    return { route, bytes, budget, ok: bytes !== undefined && bytes <= budget };
  });
}
