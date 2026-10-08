/**
 * The key `RouteTransition` remounts the page on (§14.2 j, 2.7b). A drill-down is a new key, so
 * it can slide. **The tabs of one screen share one key**: they are views of the same screen
 * (§14.2 d), switched with `ViewLink`, and a new key would remount the layout that draws their
 * header and tab bar, rebuilding both on every switch (the `/leave` layout promises they stay
 * put while a view loads).
 *
 * Each entry matches every tab route of one screen; the shared key is the entry's `key`, or else
 * group 1. A new screen with tab routes adds its entry here (`route-key.test.ts` lists the
 * current ones).
 */
const TAB_ROUTES: readonly { match: RegExp; key?: string }[] = [
  // Attendance & leave: `/leave` and `/leave/attendance` (2.3), under `leave/(leave)/layout.tsx`.
  { match: /^(\/leave)(?:\/attendance)?$/ },
  // Extra work & expenses (5B decision 3): `/leave/extra-work` (3b.2) and `/leave/expenses`
  // (3b.3), under `leave/(work)/layout.tsx`: another screen, so a key of its own.
  { match: /^\/leave\/(?:extra-work|expenses)$/, key: "/leave/extra-work" },
  // A person's page (3.4, `person-nav.tsx`): Profile, and for the Owner Leave, Attendance and
  // Month (3b.4).
  { match: /^(\/people\/[^/]+)(?:\/(?:leave|attendance|month))?$/ },
  // A client's page (3.4, `client-nav.tsx`): Overview, Brand, Activity.
  { match: /^(\/clients\/[^/]+)(?:\/(?:brand|activity))?$/ },
];

export function routeKey(pathname: string): string {
  for (const route of TAB_ROUTES) {
    const found = route.match.exec(pathname);
    if (found) return route.key ?? found[1] ?? pathname;
  }
  return pathname;
}
