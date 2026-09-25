/**
 * Taps before hydration (task 2.8, ARCHITECTURE §14.2 l).
 *
 * Until React hydrates, every enhanced control is its server-rendered `<a href>`, and a tap is a
 * plain document navigation that **pushes**: the ‹ back control went forward to the parent
 * (detail → parent → detail…), and a view control or an installed tab stacked an entry it should
 * have replaced (found by the 2.7b tests; ~0.9 s of that on a mid-range phone). This script,
 * inline in `<head>` on every document, answers those taps with the same moves as the hydrated
 * app (`moves.ts`, one shared table of cases) and steps aside for good once the root layout
 * marks the document hydrated. There is no slide before hydration; everything else matches.
 *
 * Which links it reads: `data-slot="page-back"` (`BackLink`), `data-view-link` (`ViewLink`) and
 * `data-tab` inside the bar that carries `data-tab-home` / `data-tab-top` (`BottomNav`). Any
 * other link, a modified click, another origin or a new-tab target keeps the browser's default.
 */

import {
  HYDRATED_ATTRIBUTE,
  TAB_ATTRIBUTE,
  TAB_HOME_ATTRIBUTE,
  TAB_TOP_ATTRIBUTE,
  VIEW_LINK_ATTRIBUTE,
} from "./attributes";

export {
  HYDRATED_ATTRIBUTE,
  TAB_ATTRIBUTE,
  TAB_HOME_ATTRIBUTE,
  TAB_TOP_ATTRIBUTE,
  VIEW_LINK_ATTRIBUTE,
} from "./attributes";

/*
 * `backMove`, `viewMove` and `tabMove` below are `moves.ts` written out in ES5 for a `<head>`
 * script (no bundler reaches it). `pre-hydration.test.ts` runs them through `move-cases.ts`, the
 * table the app's own functions are tested against.
 */
export const PRE_HYDRATION_SCRIPT = `(function(){try{
var d=document,h=d.documentElement;
function backMove(i){return i!==undefined&&i>0?"back":"parent"}
function tabMove(href,path,home,top,standalone,pushed){if(!standalone||top.indexOf(href)<0||top.indexOf(path)<0||href===path)return null;if(href===home)return pushed?"back":"replace";return path===home?"push":"replace"}
d.addEventListener("click",function(e){try{
if(h.hasAttribute("${HYDRATED_ATTRIBUTE}")||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;
if(!a||(a.target&&a.target!=="_self")||a.hasAttribute("download"))return;
var u=new URL(a.href,location.href);if(u.origin!==location.origin)return;
var nav=window.navigation,entry=nav&&nav.currentEntry,i=entry?entry.index:undefined,move=null;
if(a.getAttribute("data-slot")==="page-back"){move=backMove(i)==="back"?"back":"replace"}
else if(a.hasAttribute("${VIEW_LINK_ATTRIBUTE}")){move="replace"}
else if(a.hasAttribute("${TAB_ATTRIBUTE}")){var bar=a.closest("[${TAB_HOME_ATTRIBUTE}]");if(bar){var home=bar.getAttribute("${TAB_HOME_ATTRIBUTE}");var below=nav&&i>0?nav.entries()[i-1]:null;var standalone=window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;move=tabMove(u.pathname,location.pathname,home,(bar.getAttribute("${TAB_TOP_ATTRIBUTE}")||"").split(" "),standalone,!!(below&&below.url&&new URL(below.url).pathname===home))}}
if(move==="back"){e.preventDefault();history.back()}else if(move==="replace"){e.preventDefault();location.replace(u.href)}
}catch(err){}},true)}catch(err){}})();`;
