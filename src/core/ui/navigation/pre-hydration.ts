/**
 * Taps before hydration (task 2.8, ARCHITECTURE §14.2 l).
 *
 * Until React hydrates, every enhanced control is its server-rendered `<a href>`, and a tap is a
 * plain document navigation that **pushes**: the ‹ back control went forward to the parent
 * (detail → parent → detail…), and a view control or an installed tab stacked an entry it should
 * have replaced (found by the 2.7b tests; ~0.9 s of that on a mid-range phone). This script,
 * inline in `<head>` on every document, answers those taps with the same moves as the hydrated
 * app (`moves.ts`, one shared table of cases) and leaves each link alone once React has hydrated
 * it (`data-live`, `attributes.ts`). There is no slide before hydration; everything else matches.
 *
 * Which links it reads: `data-slot="page-back"` (`BackLink`), `data-view-link` (`ViewLink`) and
 * `data-tab` inside the bar that carries `data-tab-home` / `data-tab-top` (`BottomNav`). Any
 * other link, a modified click, another origin or a new-tab target keeps the browser's default.
 *
 * Every in-app link tap, before and after hydration, also starts the navigation progress bar
 * (`progress.ts`): `data-nav-pending` on `<html>` and `data-nav-target` on the tapped link, which
 * CSS draws at once, so a tap on a slow connection never looks dead (§14.2 i). `NavProgress`
 * finishes it when the new screen is there.
 *
 * It also registers an empty passive `touchstart` listener: without one, iOS Safari never applies
 * `:active`, and the pressed state (`pressable`, `globals.css`) would not show on an iPhone.
 */

import {
  LIVE_ATTRIBUTE,
  TAB_ATTRIBUTE,
  TAB_HOME_ATTRIBUTE,
  TAB_TOP_ATTRIBUTE,
  VIEW_LINK_ATTRIBUTE,
} from "./attributes";
import {
  NAV_DONE_ATTRIBUTE,
  NAV_PENDING_ATTRIBUTE,
  NAV_TARGET_ATTRIBUTE,
  startsNavigation,
} from "./progress";

export {
  LIVE_ATTRIBUTE,
  TAB_ATTRIBUTE,
  TAB_HOME_ATTRIBUTE,
  TAB_TOP_ATTRIBUTE,
  VIEW_LINK_ATTRIBUTE,
} from "./attributes";

/**
 * How long a tap on an enhanced link that React has not hydrated yet waits for the hand-over
 * before the script makes the move itself with a full document load (see the script).
 */
export const PRE_HYDRATION_WAIT_MS = 2_000;
/** How often a held tap looks again. */
const HELD_TAP_POLL_MS = 50;

/*
 * `backMove`, `viewMove` and `tabMove` below are `moves.ts` written out in ES5 for a `<head>`
 * script (no bundler reaches it). `pre-hydration.test.ts` runs them through `move-cases.ts`, the
 * table the app's own functions are tested against.
 *
 * **A tap is held, not loaded (owner 2026-10-01).** Until 2026-10-01 the script answered a tap on
 * a not-yet-hydrated link with the move at once, as a full document load (`location.replace`,
 * `history.back()` or the browser's own push). The root layout hydrates before a streamed page,
 * so a tap that landed in the gap between the shell and the page (hundreds of milliseconds on a
 * loaded phone, where the e2e helper `hydrated()` also stands) reloaded the whole document: the
 * scroll and any draft were lost and the back slide never ran (CI, `motion.spec` "opened
 * directly", 2 of 3 runs). Now the tap is **held**: the script prevents the browser's navigation,
 * starts the progress bar, and watches the link until React marks it `data-live`, then replays
 * the click so the app makes its own move (with its slide). Only if hydration has not come after
 * `PRE_HYDRATION_WAIT_MS` (the page's scripts failed or are still downloading) does the script
 * make the move itself, in full, as before. A link React swaps while streaming (a Suspense
 * fallback's back control replaced by the streamed header's) is found again by kind and address.
 * A second tap while one is held is ignored.
 */
export const PRE_HYDRATION_SCRIPT = `(function(){try{
var d=document,held=false;
d.addEventListener("touchstart",function(){},{passive:true});
function backMove(i){return i!==undefined&&i>0?"back":"parent"}
var startsNavigation=${startsNavigation.toString()};
function startNav(a,u){try{if(!startsNavigation({origin:u.origin,pathname:u.pathname,search:u.search},location))return;var h=d.documentElement;h.removeAttribute("${NAV_DONE_ATTRIBUTE}");h.setAttribute("${NAV_PENDING_ATTRIBUTE}",String(Date.now()));var old=d.querySelectorAll("[${NAV_TARGET_ATTRIBUTE}]");for(var k=0;k<old.length;k++)old[k].removeAttribute("${NAV_TARGET_ATTRIBUTE}");a.setAttribute("${NAV_TARGET_ATTRIBUTE}",u.href)}catch(err){}}
function tabMove(href,path,home,top,standalone,pushed){if(!standalone||top.indexOf(href)<0||top.indexOf(path)<0||href===path)return null;if(href===home)return pushed?"back":"replace";return path===home?"push":"replace"}
function sameLink(a,kind,href){if(a.isConnected!==false)return a;var all=d.querySelectorAll(kind),k;for(k=0;k<all.length;k++){if(all[k].href===href)return all[k]}return null}
function perform(move,href){if(move==="back")history.back();else if(move==="replace")location.replace(href);else location.assign(href)}
function hold(a,kind,move,href){if(held)return;held=true;var started=Date.now();var timer=setInterval(function(){try{var link=sameLink(a,kind,href);if(link&&link.hasAttribute("${LIVE_ATTRIBUTE}")){clearInterval(timer);held=false;link.click();return}if(Date.now()-started>=${PRE_HYDRATION_WAIT_MS}){clearInterval(timer);held=false;perform(move,href)}}catch(err){clearInterval(timer);held=false;perform(move,href)}},${HELD_TAP_POLL_MS})}
d.addEventListener("click",function(e){try{
if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;
if(!a||(a.target&&a.target!=="_self")||a.hasAttribute("download"))return;
var u=new URL(a.href,location.href);if(u.origin!==location.origin)return;
startNav(a,u);
if(a.hasAttribute("${LIVE_ATTRIBUTE}"))return;
var nav=window.navigation,entry=nav&&nav.currentEntry,i=entry?entry.index:undefined,move=null,kind=null;
if(a.getAttribute("data-slot")==="page-back"){kind='[data-slot="page-back"]';move=backMove(i)==="back"?"back":"replace"}
else if(a.hasAttribute("${VIEW_LINK_ATTRIBUTE}")){kind="[${VIEW_LINK_ATTRIBUTE}]";move="replace"}
else if(a.hasAttribute("${TAB_ATTRIBUTE}")){var bar=a.closest("[${TAB_HOME_ATTRIBUTE}]");if(bar){kind="[${TAB_ATTRIBUTE}]";var home=bar.getAttribute("${TAB_HOME_ATTRIBUTE}");var below=nav&&i>0?nav.entries()[i-1]:null;var standalone=window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;move=tabMove(u.pathname,location.pathname,home,(bar.getAttribute("${TAB_TOP_ATTRIBUTE}")||"").split(" "),standalone,!!(below&&below.url&&new URL(below.url).pathname===home))}}
if(!kind)return;
e.preventDefault();
hold(a,kind,move||"push",u.href);
}catch(err){}},true)}catch(err){}})();`;
