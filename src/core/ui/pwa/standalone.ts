/**
 * No zoom in the installed app, where the phone's own text size reaches it (ARCHITECTURE §14.2 i,
 * task 2.7b, owner decision 2026-09-25; iOS since 6.6, Kickoff 6 decision 20).
 *
 * An installed app does not pinch-zoom or double-tap-zoom; it follows the system text size
 * instead. That trade is only fair where the system text size actually applies:
 * - **Android:** Chrome scales the app's text with the phone's font size, so an installed Android
 *   app is locked.
 * - **iPhone (6.6):** iOS passes its text size (Dynamic Type) to a web app only when the app opts
 *   in with `font: -apple-system-body`. The installed iPhone app opts in: the root font size
 *   becomes the system body size over its default (17px at iOS's default "Large"), so at the
 *   default text size nothing changes and every rem-sized part grows with the phone's setting,
 *   exactly as the large-text sweep scales the root (`e2e/mobile.spec.ts`). It is kept between
 *   100% (never smaller than designed: 16px inputs, 44px targets) and 200% (the sweep's largest,
 *   and Android's), and read again whenever the app comes back to the foreground, where a changed
 *   setting shows. The iPhone app is locked only while iOS's size is within those bounds: above
 *   200% (iOS's largest accessibility sizes) the root stops at 200% and pinch-zoom stays, for
 *   whoever needs more than the app's tested maximum (advisor, 2026-10-08, decision 20); where
 *   the size cannot be read it keeps pinch-zoom too, as the accessibility safety valve.
 * - A browser tab is a website and always zooms, at the browser's own text size.
 *
 * `navigator.standalone` exists only on iOS (true when installed), so it is the iOS check.
 */
export const ZOOM_LOCK_ATTRIBUTE = "data-zoom-lock";

/** Set on `<html>` while the root font size follows iOS's text size. */
export const SYSTEM_TEXT_ATTRIBUTE = "data-system-text";

/** What the locked viewport adds to the one the root layout declares. */
export const ZOOM_LOCK_VIEWPORT = "maximum-scale=1, user-scalable=no";

/** iOS's body text size at its default setting ("Large"), which MaxOff's 16px root stands for. */
export const IOS_DEFAULT_BODY_PX = 17;

/** The root font size follows iOS's text size within these bounds (percent of the design). */
export const SYSTEM_TEXT_MIN_PERCENT = 100;
export const SYSTEM_TEXT_MAX_PERCENT = 200;

/**
 * Blocking, in `<head>`, before first paint and on every document (unlike the launch intro, which
 * runs once per session). Next writes the layout's `<meta name="viewport">` at the top of
 * `<head>`, before this script, so it is read and a second, locked copy is appended after it:
 * the last viewport meta wins, and Next's own element (owned by React) is never touched.
 * `html[data-zoom-lock]` turns off pinch in CSS as well (`globals.css`). On an installed iPhone the
 * system body size is read from a hidden probe (`font: -apple-system-body`, on `<html>` since
 * `<body>` does not exist yet) and set as the root's font size, as a percentage; each read locks
 * or unlocks (removing the appended copy) by whether iOS's size is within the bounds.
 */
export const STANDALONE_SCRIPT = `(function(){try{var w=window,n=w.navigator,d=document,h=d.documentElement,m=null;var lock=function(on){if(on){if(m)return;h.setAttribute("${ZOOM_LOCK_ATTRIBUTE}","");var v=d.querySelector('meta[name="viewport"]');m=d.createElement("meta");m.name="viewport";m.content=(v?v.content+", ":"width=device-width, initial-scale=1, ")+"${ZOOM_LOCK_VIEWPORT}";m.setAttribute("${ZOOM_LOCK_ATTRIBUTE}","");d.head.appendChild(m)}else if(m){h.removeAttribute("${ZOOM_LOCK_ATTRIBUTE}");d.head.removeChild(m);m=null}};if("standalone" in n){if(n.standalone!==true||!w.CSS||!w.CSS.supports("font","-apple-system-body"))return;var read=function(){var p=d.createElement("div");p.setAttribute("data-system-text-probe","");p.style.cssText="font:-apple-system-body;position:absolute;visibility:hidden";h.appendChild(p);var px=parseFloat(w.getComputedStyle(p).fontSize);h.removeChild(p);if(!(px>0))return 0;return Math.max(${SYSTEM_TEXT_MIN_PERCENT},Math.round(px/${IOS_DEFAULT_BODY_PX}*1000)/10)};var apply=function(){var size=read();if(!size)return false;var pct=Math.min(${SYSTEM_TEXT_MAX_PERCENT},size);h.style.fontSize=pct===100?"":pct+"%";h.setAttribute("${SYSTEM_TEXT_ATTRIBUTE}",String(pct));lock(size<=${SYSTEM_TEXT_MAX_PERCENT});return true};if(!apply())return;d.addEventListener("visibilitychange",function(){if(d.visibilityState==="visible")apply()})}else if(w.matchMedia("(display-mode: standalone)").matches)lock(true)}catch(e){}})();`;
