"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useSyncExternalStore, ViewTransition } from "react";

import { NAV_BACK, NAV_FORWARD } from "./nav-types";
import { routeKey } from "./route-key";
import { canSlide, slideCommitted, subscribeSlide } from "./slide";

/** The class each typed navigation gets; anything untyped gets none. */
const SLIDE = { [NAV_FORWARD]: NAV_FORWARD, [NAV_BACK]: NAV_BACK, default: "none" } as const;

/**
 * The drill-down slide around the page content (§14.2 j, task 2.7b).
 *
 * **Keyed by the path**, not placed in a `template.tsx`: a template remounts only when its own
 * child segment changes, so `/people` → `/people/[id]` (the same `people` segment) would never
 * enter or exit. The key is the path without the query, so a view control that only changes the
 * query (a filter, a month, a pager) never remounts or animates anything, and **the tabs of one
 * screen share a key** (`routeKey`), so switching them never remounts the layout that draws their
 * header and tab bar. A new key remounts everything under `(app)`, nested layouts included.
 *
 * The direction comes twice: as React's transition type (`transitionTypes` on the router call,
 * the classes below) and as `html[data-nav-slide]` named at the tap (`nameSlide`, `globals.css`),
 * because the type is lost when the navigation commits while React is still hydrating (see
 * `slide.ts`); the attribute slides the route either way.
 *
 * Only `nav-forward` and `nav-back` animate (`default: "none"`), so a tab switch, a refresh, a
 * streamed reveal and the system back gesture change the page with no motion at all; where
 * sliding is not allowed (`slideAllowed`) nothing animates. `BackLink`'s own back is the one
 * slide React cannot type (`slideBack`). The shell's bars are pinned in `globals.css`, so only
 * the page moves.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const slide = useSyncExternalStore(subscribeSlide, canSlide, () => false);
  const motion = slide ? SLIDE : "none";
  // The screen is there: a slide named at the tap (`nameSlide`) that started no view transition
  // loses its name now (one that did loses it as the transition captures, `slide.ts`).
  useEffect(() => {
    slideCommitted();
  }, [pathname]);
  return (
    <ViewTransition key={routeKey(pathname)} enter={motion} exit={motion} default="none">
      <div data-slot="route">{children}</div>
    </ViewTransition>
  );
}
