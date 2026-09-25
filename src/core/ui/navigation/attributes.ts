/**
 * The attributes the pre-hydration script reads (`pre-hydration.ts`). In their own file so the
 * components that set them do not carry the script's text into the browser bundle.
 */

/** Set by `<HydratedMark>` in a layout effect of the root layout: the app handles taps now. */
export const HYDRATED_ATTRIBUTE = "data-hydrated";
export const VIEW_LINK_ATTRIBUTE = "data-view-link";
export const TAB_ATTRIBUTE = "data-tab";
export const TAB_HOME_ATTRIBUTE = "data-tab-home";
export const TAB_TOP_ATTRIBUTE = "data-tab-top";
