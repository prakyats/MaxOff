/**
 * The colour of the browser / OS chrome band above the app (task 1.5).
 *
 * These are the **page background tokens**, not approximations of them: `--background` from
 * `:root` and from `.dark` in `globals.css`. The band and the app must be exactly the same
 * colour, so `pwa-files.test.ts` fails if the two ever drift apart. They drive the page's
 * `theme-color` meta (a browser tab's toolbar). An installed Android app ignores that meta and
 * takes its status bar from the manifest, which declares no `theme_color` on purpose (2026-09-26,
 * see `pwa-files.test.ts`); the manifest's `background_color` (the splash) is the dark one.
 */
export const THEME_COLORS = {
  light: "#fafaf9",
  dark: "#0b0b0c",
} as const;

/** next-themes' localStorage key. The pre-paint script below reads the same one. */
export const THEME_STORAGE_KEY = "theme";

/**
 * Applies the theme **before first paint** — the class, `color-scheme` and the theme-colour
 * metas, for `light`, `dark` **and `system`**.
 *
 * next-themes does ship its own pre-paint script, but it renders inside `<body>` where the
 * provider is: measured at byte 3382 of the login document, *after* the first `<div>` at 3247.
 * The browser has paintable content before it runs, which is the light flash on every reload of
 * the installed app. This one goes in `<head>`, so nothing paintable exists yet.
 *
 * The earlier version of this script handled only an explicit `light`/`dark` and returned early
 * for the default `system`, which is why the flash survived it.
 *
 * Inline and blocking on purpose. The CSP is `frame-ancestors 'none'` only, so no script-src
 * nonce is needed. `theme-color-flash.spec.ts` proves there is no light frame before paint.
 */
export const THEME_COLOR_SCRIPT = `(function(){try{
var d=document.documentElement;
var t=null;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});}catch(e){}
if(t!=="light"&&t!=="dark")t="system";
var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
d.classList.toggle("dark",dark);
d.style.colorScheme=dark?"dark":"light";
var c=dark?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)};
var m=document.querySelectorAll('meta[name="theme-color"]');
for(var i=0;i<m.length;i++){m[i].setAttribute("content",c);m[i].removeAttribute("media");}
}catch(e){}})();`;
