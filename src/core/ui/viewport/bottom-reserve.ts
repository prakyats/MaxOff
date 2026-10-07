/**
 * What the page reserves at its bottom on a phone: the sticky save bar's height, the push band's
 * and the offline band's (custom properties on `<html>`, read by `main`'s bottom padding and by
 * the bars docked above the bands, `globals.css`). Each is published when it is measured, so it
 * can grow while a person rests at the page's end: the offline band appears, a band or the bar
 * wraps to a second line, the text size changes. The padding grows by the same amount, but the
 * page keeps its scroll position, so the bar moved up over the last field, which stayed where
 * it was, and it stayed covered until the person scrolled again (v1.3.1: "Job title" 20 px
 * behind the Save bar at 200% text, CI 36879970598; 20 px at 100% when the connection dropped).
 *
 * `changeBottomReserve` makes the change and, **if the person was at the page's end, keeps them
 * there**, in the same task: called from a layout effect or a `ResizeObserver` callback, before
 * the frame is painted, so no frame shows the field behind the bar. A page that fits on the
 * screen (scrolled 0) is left at its top; a page the person scrolled elsewhere is left alone.
 */

/** Where the page is scrolled, in CSS px. */
export type ScrollMetrics = { top: number; height: number; viewport: number };

/** The page's scroller, as `changeBottomReserve` needs it (injectable for the unit tests). */
export type PageScroll = { metrics(): ScrollMetrics; scrollTo(top: number): void };

/** Scrolled to the end: a page that actually scrolls, within a pixel of its bottom. */
export function atPageEnd({ top, height, viewport }: ScrollMetrics): boolean {
  return top > 0 && height - viewport - top <= 1;
}

/** Where to scroll after the reserve changed, or null to stay: only a page that grew past it. */
export function keepAtEnd(wasAtEnd: boolean, after: ScrollMetrics): number | null {
  if (!wasAtEnd) return null;
  const end = after.height - after.viewport;
  return end - after.top > 1 ? end : null;
}

function documentScroll(): PageScroll {
  const root = () => document.scrollingElement ?? document.documentElement;
  return {
    metrics: () => ({
      top: window.scrollY,
      height: root().scrollHeight,
      viewport: root().clientHeight,
    }),
    scrollTo: (top) => window.scrollTo({ top, behavior: "instant" }),
  };
}

/** Changes a bottom reserve (`change`), keeping a person who was at the page's end at its end. */
export function changeBottomReserve(change: () => void, page: PageScroll = documentScroll()) {
  const wasAtEnd = atPageEnd(page.metrics());
  change();
  const top = keepAtEnd(wasAtEnd, page.metrics());
  if (top !== null) page.scrollTo(top);
}
