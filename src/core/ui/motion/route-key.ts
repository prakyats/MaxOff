/**
 * The key `RouteTransition` remounts the page on (§14.2 j, 2.7b). A drill-down is a new key, so
 * it can slide. **The tabs of one screen share one key**: they are views of the same screen
 * (§14.2 d), switched with `ViewLink`, and a new key would remount the layout that draws their
 * header and tab bar, rebuilding both on every switch (the `/leave` layout promises they stay
 * put while a view loads).
 *
 * Each entry matches every tab route of one screen; group 1 is the shared key. A new screen
 * with tab routes adds its entry here (`route-key.test.ts` lists the current ones).
 */
const TAB_ROUTES: readonly RegExp[] = [
  // `/leave` and `/leave/attendance` (2.3), under `leave/layout.tsx`.
  /^(\/leave)(?:\/attendance)?$/,
  // A person's leave requests and attendance (2.4, `person-nav.tsx`).
  /^(\/people\/[^/]+)(?:\/attendance)?$/,
];

export function routeKey(pathname: string): string {
  for (const route of TAB_ROUTES) {
    const key = route.exec(pathname)?.[1];
    if (key) return key;
  }
  return pathname;
}
