/**
 * The attributes the pre-hydration script reads (`pre-hydration.ts`). In their own file so the
 * components that set them do not carry the script's text into the browser bundle.
 */

/**
 * Set on an enhanced link in the commit that hydrates it (`markLive`, a callback ref): from then
 * on the app's own handler answers its taps and the script leaves it alone. Per link, not per
 * document: the root layout hydrates before the streamed shell and page, so a document-wide mark
 * would hand over too early (found by CI in 2.8).
 */
export const LIVE_ATTRIBUTE = "data-live";

/** A callback ref for an enhanced link: marks it live once React owns it. */
export function markLive(element: HTMLElement | null): void {
  element?.setAttribute(LIVE_ATTRIBUTE, "");
}
export const VIEW_LINK_ATTRIBUTE = "data-view-link";
export const TAB_ATTRIBUTE = "data-tab";
export const TAB_HOME_ATTRIBUTE = "data-tab-home";
export const TAB_TOP_ATTRIBUTE = "data-tab-top";
