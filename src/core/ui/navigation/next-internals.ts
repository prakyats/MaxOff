/**
 * **Every import from Next's internals, in one place** (v7.0; the advisor, 25 Nov 2026). Next
 * exports neither of these publicly, and an upgrade may move or reshape them without a note in
 * its changelog. `next-internals.test.ts` checks each against the installed Next, so an upgrade
 * that breaks one fails `pnpm test` with the name of what moved, instead of a tap drawing that
 * quietly marks the wrong tab or a prefetch that quietly stops.
 *
 * - `PathnameContext`: what `usePathname()` reads. A tap drawing (`tap-drawings.tsx`) is drawn at
 *   its screen's address, so the view tabs inside it (`ViewLink`, which marks the current one)
 *   mark the tapped screen's, not the screen the finger is still on.
 * - `PrefetchKind`: the router's prefetch kinds; `tab-history.ts` asks for `AUTO`.
 *
 * Nothing else may import from `next/dist` in app code: add it here, with its check.
 */
export { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
export { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
