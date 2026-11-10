/**
 * The browser's time-zone data, loaded in an idle moment before hydration (v2.0 X3 (d)).
 *
 * A page's first `Intl.DateTimeFormat` with a time zone loads the browser's time-zone and locale
 * data: ≈ 50 ms at CPU ×4 on a phone, once per page process, then 1–4 ms per formatter. The
 * first one used to be date-fns-tz's own (a formatter it builds when its module loads, to test the
 * browser) or `clockWords`', both inside the hydration task, the load's longest (Today and My Day,
 * 104–145 ms). This head script makes one in the first idle moment after the document is
 * parsed, while the page's scripts are still on their way, so hydration finds the data loaded.
 *
 * Idle only (`requestIdleCallback`); without it (Safari), after the first frame
 * (`requestAnimationFrame`, then a task), never before the first paint. It formats nothing the
 * page shows, and a browser without `Intl` time zones simply skips it.
 */
import { IST_TIMEZONE } from "./ist";

export const WARM_ZONE_SCRIPT = `(function(){try{var w=window;var warm=function(){try{new Intl.DateTimeFormat("en-GB",{hour:"numeric",timeZone:"${IST_TIMEZONE}"}).format(0)}catch(e){}};if(w.requestIdleCallback)w.requestIdleCallback(warm);else w.requestAnimationFrame(function(){w.setTimeout(warm,0)})}catch(e){}})();`;
