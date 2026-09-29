/**
 * The offline page's way back (ARCHITECTURE §14). The service worker serves `/offline` at the
 * address that failed, so loading that same address again is the way back: the worker then
 * fetches it for real. Never a client navigation: the cached page can come from an older build,
 * and a `next/link` there failed silently (found on a phone, staging, 2026-09-29).
 *
 * A plain inline script, not React: the page is shown when the network is gone, and its own
 * JavaScript chunks may never have been cached, so it may never hydrate. It notes the address
 * while the HTML is parsed, because when the page does hydrate, Next's router rewrites the
 * address bar to the page's own route (`/offline`, `replaceState`), and a plain reload then
 * reloaded the offline page (caught by e2e). Going back is `location.replace(address)`: the
 * same history entry, like a reload. "Try again" does it; back online (the `online` event), the
 * page does it by itself and says so. Either way once, and the button shows the shared pending
 * look (`data-pending`, "Trying…"). Never while the page is being left (`beforeunload` until a
 * `pageshow`): an offline page still on screen while another address loads took that
 * navigation over when the connection came back (caught by e2e, 2026-09-29).
 */

export const OFFLINE_RETRY_SLOT = "offline-retry";
export const OFFLINE_BACK_SLOT = "offline-back";

export const OFFLINE_RETRY_SCRIPT = `(function(){var here=location.href,b=document.querySelector('[data-slot="${OFFLINE_RETRY_SLOT}"]'),s=document.querySelector('[data-slot="${OFFLINE_BACK_SLOT}"]'),done=false,leaving=false;function go(back){if(done||leaving)return;done=true;if(b){b.setAttribute("data-pending","");b.setAttribute("aria-busy","true");b.disabled=true}if(back&&s)s.hidden=false;location.replace(here)}if(b)b.addEventListener("click",function(){go(false)});window.addEventListener("online",function(){go(true)});window.addEventListener("beforeunload",function(){leaving=true});window.addEventListener("pageshow",function(){leaving=false})})();`;
