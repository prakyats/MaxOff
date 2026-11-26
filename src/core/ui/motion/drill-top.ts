/**
 * A drill-down opens at its top (ARCHITECTURE §14.2 b; owner walk, v3.0 step 8). Next scrolls a
 * new screen only to its leaf page's first element, and only if that is off screen: on a detail
 * whose header and tabs sit in a layout above the page (a client), the window first clamps to the
 * shorter loading screen, the page's first element is then on screen, and Next leaves the window
 * where the clamp put it (76 px down, the header cut off). So the tap names its destination here
 * (`DrillLink`) and the route's commit (`RouteTransition`) opens it at the top. Back is a history
 * move, never named here, so the browser and Next still restore the list's place.
 */
let pending: string | null = null;

/** The path a drill-down is going to (no query, no hash). */
export function markDrill(href: string): void {
  pending = new URL(href, window.location.href).pathname;
}

/** True once, when `pathname` is the drill-down's destination; any other arrival forgets it. */
export function takeDrill(pathname: string): boolean {
  const hit = pending === pathname;
  pending = null;
  return hit;
}
