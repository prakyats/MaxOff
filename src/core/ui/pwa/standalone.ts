/**
 * No zoom in the installed app, where the phone's own text size reaches it (ARCHITECTURE §14.2 i,
 * task 2.7b, owner decision 2026-09-25).
 *
 * An installed app does not pinch-zoom or double-tap-zoom; it follows the system text size
 * instead. That trade is only fair where the system text size actually applies. Android's
 * Chrome scales the app's text with the phone's font size, so an installed Android app is
 * locked. **iOS does not pass its text size to a web app** unless the app opts in
 * (`font: -apple-system-body`), so an installed iPhone app keeps pinch-zoom as the accessibility
 * safety valve until that opt-in lands (PROGRESS, Ideas, tied to 6.6). A browser tab is a
 * website and always zooms.
 *
 * `navigator.standalone` exists only on iOS, so its presence is the iOS check.
 */
export const ZOOM_LOCK_ATTRIBUTE = "data-zoom-lock";

/** What the locked viewport adds to the one the root layout declares. */
export const ZOOM_LOCK_VIEWPORT = "maximum-scale=1, user-scalable=no";

/**
 * Blocking, in `<head>`, before first paint and on every document (unlike the launch intro, which
 * runs once per session). Next writes the layout's `<meta name="viewport">` at the top of
 * `<head>`, before this script, so it is read and a second, locked copy is appended after it:
 * the last viewport meta wins, and Next's own element (owned by React) is never touched.
 * `html[data-zoom-lock]` turns off pinch in CSS as well (`globals.css`).
 */
export const STANDALONE_SCRIPT = `(function(){try{var n=window.navigator;if("standalone" in n||!window.matchMedia("(display-mode: standalone)").matches)return;var h=document.documentElement;h.setAttribute("${ZOOM_LOCK_ATTRIBUTE}","");var v=document.querySelector('meta[name="viewport"]');var m=document.createElement("meta");m.name="viewport";m.content=(v?v.content+", ":"width=device-width, initial-scale=1, ")+"${ZOOM_LOCK_VIEWPORT}";m.setAttribute("${ZOOM_LOCK_ATTRIBUTE}","");document.head.appendChild(m)}catch(e){}})();`;
