/**
 * The colour of the browser / OS chrome band above the app (task 1.5).
 *
 * These are the **page background tokens**, not approximations of them: `--background` from
 * `:root` and from `.dark` in `globals.css`. The band and the app must be exactly the same
 * colour, so `pwa-files.test.ts` fails if the two ever drift apart, and the manifest's
 * `theme_color` / `background_color` are checked against the light one.
 */
export const THEME_COLORS = {
  light: "#fafaf9",
  dark: "#0b0b0c",
} as const;

/** next-themes' localStorage key. The pre-paint script below reads the same one. */
export const THEME_STORAGE_KEY = "theme";

/**
 * Runs before first paint, so an explicit Light/Dark choice never shows the wrong band for a
 * frame. `<meta name="theme-color">` is rendered by the viewport export with `prefers-color-scheme`
 * media queries, which follow the **OS** — they cannot know that this user picked Dark while
 * their phone is in Light. This rewrites every theme-color meta to the resolved colour, exactly
 * as `ThemeColorMeta` does after hydration.
 *
 * Inline and blocking on purpose, the same trick next-themes uses for the `dark` class. The CSP
 * is `frame-ancestors 'none'` only, so no script-src nonce is needed.
 */
export const THEME_COLOR_SCRIPT = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
if(t!=="light"&&t!=="dark")return;
var c=t==="dark"?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)};
var m=document.querySelectorAll('meta[name="theme-color"]');
for(var i=0;i<m.length;i++){m[i].setAttribute("content",c);m[i].removeAttribute("media");}
}catch(e){}})();`;
