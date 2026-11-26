/**
 * What an RSC request from the router asks for, read from its `Next-Router-State-Tree` header
 * (v7.0, the advisor 26 Nov 2026; `dashboards.spec` "never re-reads the screen it moved to").
 *
 * Each node of the tree is `[segment, children, refreshState, refreshMarker, prefetchHints]`
 * (Next 16.3 `flight-data-helpers.js`). The `'refetch'` marker sits on the top-most segment whose
 * data the server must send again:
 * - **`refresh`**: on the root. A `router.refresh()` (Next's RefreshAll, or its
 *   `DynamicRequestTreeForEntireRoute`) re-reads the whole screen. This is a re-read.
 * - **`partial`**: below the root. A move's own request for the segments it lacks, or Next's own
 *   follow-up for the dynamic data a committed move still lacks (`ppr-navigations`
 *   `spawnDynamicRequests`, CI 45777256059). Neither re-reads the screen.
 * - **`plain`**: no marker (a move from a tree with nothing marked).
 * Checked against real headers: a move to `/leave` marks `leave`, a refresh on it marks the root.
 */
export type RscRequestKind = "refresh" | "partial" | "plain";

type TreeNode = [unknown, Record<string, unknown>?, unknown?, unknown?, unknown?];

function isNode(value: unknown): value is TreeNode {
  return Array.isArray(value) && value.length >= 2 && typeof value[1] === "object";
}

function marked(node: TreeNode): boolean {
  return node[3] === "refetch";
}

function anyMarkedBelow(node: TreeNode): boolean {
  return Object.values(node[1] ?? {}).some(
    (child) => isNode(child) && (marked(child) || anyMarkedBelow(child)),
  );
}

/** The kind of RSC request a `Next-Router-State-Tree` header (URI-encoded JSON) describes. */
export function rscRequestKind(header: string | undefined): RscRequestKind | null {
  if (!header) return null;
  let tree: unknown;
  try {
    tree = JSON.parse(decodeURIComponent(header));
  } catch {
    return null;
  }
  if (!isNode(tree)) return null;
  if (marked(tree)) return "refresh";
  return anyMarkedBelow(tree) ? "partial" : "plain";
}
