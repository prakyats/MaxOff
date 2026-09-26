import launch from "./launch-screens.json";

/**
 * The launch intro (task 2.7): the hand-off from the OS splash to the app.
 *
 * The splash (Android's from the maskable icon, iOS's from the `startupImage` launch screens) shows
 * the mark on the dark launch background. The app's first frame draws **the same mark, at the
 * same size and place** (`launch-screens.json`: `markSize` CSS px, centred in the web view), so
 * the switch from the OS to the page cannot be seen. Then the cover fades out over the page
 * with a slight settle of the mark, and the app is simply there.
 *
 * **It never adds delay.** It is plain CSS, painted in the same frame as the page under it, and
 * starts fading on that first frame without waiting for anything: gone 300 ms after first
 * paint, well inside the 600 ms cap, and it never takes a tap (`pointer-events: none`). When
 * the page is ready in 100 ms the cover is already fading at 100 ms. No spinner, no tagline.
 *
 * **Cold start only.** `LAUNCH_INTRO_SCRIPT` runs in `<head>` before anything paints and marks
 * `<html data-launch>` only when the app is installed and this is the first document of the
 * window's session (`sessionStorage`), so a reload, a browser tab, a return from background
 * (no new document) and a client-side navigation (the root layout never re-renders) never see
 * it. Without the attribute the cover is `display: none`. The styles are in `globals.css`;
 * `prefers-reduced-motion` gets the fade without the settle.
 */
export function LaunchIntro() {
  return (
    <div data-slot="launch-intro" aria-hidden="true">
      <svg viewBox="0 0 512 512" width={launch.markSize} height={launch.markSize}>
        <rect width="512" height="512" rx="112" style={{ fill: "var(--logo)" }} />
        <path
          d="M132 372V152l124 128 124-128v220"
          fill="none"
          stroke="#ffffff"
          strokeWidth="52"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** The `sessionStorage` key: set by the first document of an installed window. */
export const LAUNCH_SESSION_KEY = "maxoff-launched";

/**
 * Blocking, in `<head>`, before first paint. Installed (`display-mode: standalone`, or iOS's
 * `navigator.standalone`) and first in this session → `data-launch` on `<html>`. Storage that
 * throws (private mode) means no intro, never an error.
 */
export const LAUNCH_INTRO_SCRIPT = `(function(){try{var d=window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;if(!d||sessionStorage.getItem("${LAUNCH_SESSION_KEY}"))return;sessionStorage.setItem("${LAUNCH_SESSION_KEY}","1");document.documentElement.setAttribute("data-launch","")}catch(e){}})();`;
